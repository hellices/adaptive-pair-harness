import * as vscode from "vscode";
import { nativeToolName, pairToolNameFromNative, type PairToolDescriptor, type PairToolName, type PairToolView } from "@adaptive-pair/harness";
import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { GrowthModelFailure, type GrowthRuntimeBoundary, type PairCoordinatorPort } from "@adaptive-pair/runtime";
import { declinedToolResult, isRecord, untrustedToolResult } from "./growthModelMessages.js";

export type ConfirmGrowthToolAction = (
  name: PairToolDescriptor["name"],
  input: Readonly<Record<string, unknown>>,
  description: string,
  signal: AbortSignal,
) => Promise<boolean>;

const isMutatingTool = (descriptor: PairToolDescriptor): boolean =>
  descriptor.effectClass === "mutation" || descriptor.effectClass === "external";

const MODEL_CONFIRMABLE_TOOLS: ReadonlySet<PairToolName> = new Set([
  "pair_confirm_learning",
  "pair_select_mode",
  "pair_agree_work_unit",
]);

const isModelCallableTool = (descriptor: PairToolDescriptor): boolean =>
  !isMutatingTool(descriptor) &&
  (!descriptor.requiresExplicitUserAction ||
    MODEL_CONFIRMABLE_TOOLS.has(descriptor.name));

const inline = (value: string, limit = 160): string =>
  value.replace(/\s+/gu, " ").trim().slice(0, limit);

const describeGrowthToolAction = (
  name: PairToolName,
  input: Readonly<Record<string, unknown>>,
  snapshot: PairRuntimeSnapshot,
): string => {
  if (name === "pair_select_mode") {
    const mode = input["mode"];
    return `Mode: ${typeof mode === "string" ? inline(mode) : "invalid"}.`;
  }

  if (name === "pair_confirm_learning") {
    const agreement = input["agreement"];
    if (typeof agreement !== "object" || agreement === null) {
      return "Learning agreement: invalid.";
    }
    const fields = agreement as Record<string, unknown>;
    const goals = Array.isArray(fields["learningGoals"])
      ? fields["learningGoals"]
          .filter((goal): goal is string => typeof goal === "string")
          .map(goal => inline(goal, 80))
          .slice(0, 3)
          .join(", ")
      : "";
    const ceiling = fields["maximumHintLevel"];
    return `Learning goals: ${goals || "none"}; hint ceiling: ${
      typeof ceiling === "number" ? ceiling : "invalid"
    }.`;
  }

  const workUnit = snapshot.session?.workUnit;
  if (
    name !== "pair_agree_work_unit" ||
    workUnit === undefined ||
    input["workUnitId"] !== workUnit.id
  ) {
    return "Work unit: unavailable.";
  }
  return [
    `Work unit: ${inline(workUnit.objective)}.`,
    `Mode: ${workUnit.mode}.`,
    `Owner: ${workUnit.owner}.`,
    `Scope: ${workUnit.allowedPaths.map(path => inline(path, 100)).join(", ") || "none"}.`,
    `Verification: ${inline(workUnit.verificationPlan)}.`,
  ].join(" ");
};

const toolDescription = (descriptor: PairToolDescriptor): string =>
  `Adaptive Pair ${descriptor.name} (${descriptor.effectClass}). Every invocation is revalidated against the immutable snapshot; visibility is advisory only.`;

export const toGrowthChatTools = (
  view: PairToolView,
): vscode.LanguageModelChatTool[] =>
  view.tools
    .filter(isModelCallableTool)
    .map(descriptor => ({
      name: nativeToolName(descriptor.name),
      description: toolDescription(descriptor),
      inputSchema: descriptor.name === "pair_select_mode"
        ? {
            type: "object",
            properties: { mode: { type: "string", enum: ["growth"] } },
            required: ["mode"],
            additionalProperties: false,
          }
        : { type: "object", additionalProperties: true },
    }));

export class GrowthModelToolRunner {
  public constructor(
    private readonly coordinator: PairCoordinatorPort,
    private readonly confirmToolAction: ConfirmGrowthToolAction,
    private readonly ensureLive: (signal: AbortSignal, deadline: number) => void,
  ) {}

  public async appendToolResults(
    messages: vscode.LanguageModelChatMessage[],
    toolCalls: readonly vscode.LanguageModelToolCallPart[],
    tools: PairToolView,
    runtime: GrowthRuntimeBoundary,
    signal: AbortSignal,
    deadline: number,
  ): Promise<GrowthRuntimeBoundary> {
    messages.push(vscode.LanguageModelChatMessage.Assistant([...toolCalls]));

    const resultParts: vscode.LanguageModelToolResultPart[] = [];
    for (const toolCall of toolCalls) {
      const pairName = pairToolNameFromNative(toolCall.name);
      if (pairName === undefined) {
        throw new GrowthModelFailure("GROWTH_TOOL_TRANSLATION_FAILED");
      }

      const input = isRecord(toolCall.input) ? toolCall.input : {};
      const descriptor = tools.tools.find(tool => tool.name === pairName);
      if (descriptor === undefined) {
        throw new GrowthModelFailure("GROWTH_TOOL_TRANSLATION_FAILED");
      }
      if (pairName === "pair_select_mode" && input["mode"] !== "growth") {
        throw new GrowthModelFailure("GROWTH_UNSUPPORTED_MODE");
      }
      if (!isModelCallableTool(descriptor)) {
        throw new GrowthModelFailure("GROWTH_DIRECT_USER_ACTION_REQUIRED");
      }
      let userActionId: string | undefined;
      if (descriptor.requiresExplicitUserAction) {
        const confirmationSnapshot = await this.coordinator.snapshot();
        if (
          confirmationSnapshot.revision !== runtime.runtimeRevision ||
          confirmationSnapshot.session?.authorityEpoch !== runtime.authorityEpoch
        ) {
          throw new GrowthModelFailure("GROWTH_STALE_TURN");
        }
        const confirmed = await this.confirmToolAction(
          pairName,
          input,
          describeGrowthToolAction(pairName, input, confirmationSnapshot),
          signal,
        );
        this.ensureLive(signal, deadline);
        await this.captureRuntime(
          runtime.runtimeRevision,
          runtime.authorityEpoch,
        );
        this.ensureLive(signal, deadline);
        if (!confirmed) {
          resultParts.push(declinedToolResult(toolCall.callId));
          continue;
        }
        this.ensureLive(signal, deadline);
        userActionId = await this.coordinator.grantUserAction(pairName, signal, {
          runtimeRevision: runtime.runtimeRevision,
          authorityEpoch: runtime.authorityEpoch,
        });
      }

      this.ensureLive(signal, deadline);
      const result = await this.coordinator.invokeTool(pairName, input, signal, {
        ...(userActionId === undefined
          ? {
              runtimeRevision: runtime.runtimeRevision,
              authorityEpoch: runtime.authorityEpoch,
            }
          : { userActionId }),
      });
      if (result.observation["stale"] === true) {
        throw new GrowthModelFailure("GROWTH_STALE_TURN");
      }
      const nextRuntime = await this.captureRuntime(
        result.runtimeRevision,
        result.authorityEpoch,
      );
      if (
        nextRuntime.authorityEpoch !== runtime.authorityEpoch ||
        (nextRuntime.mode !== runtime.mode &&
          !(pairName === "pair_select_mode" && userActionId !== undefined))
      ) {
        throw new GrowthModelFailure("GROWTH_STALE_TURN");
      }
      runtime = nextRuntime;
      if (result.status === "confirmed" && descriptor.effectClass === "state") {
        throw new GrowthModelFailure("GROWTH_REPREPARE_REQUIRED");
      }

      resultParts.push(untrustedToolResult(toolCall.callId, result, descriptor.maximumResultCharacters));
    }

    messages.push(vscode.LanguageModelChatMessage.User(resultParts));
    return runtime;
  }

  public async captureRuntime(
    expectedRevision: number,
    expectedAuthorityEpoch: number | undefined,
  ): Promise<GrowthRuntimeBoundary> {
    const snapshot = await this.coordinator.snapshot();
    if (
      snapshot.revision !== expectedRevision ||
      snapshot.session?.authorityEpoch !== expectedAuthorityEpoch
    ) {
      throw new GrowthModelFailure("GROWTH_STALE_TURN");
    }
    return Object.freeze({
      runtimeRevision: snapshot.revision,
      authorityEpoch: snapshot.session?.authorityEpoch,
      mode: snapshot.session?.mode,
    });
  }
}
