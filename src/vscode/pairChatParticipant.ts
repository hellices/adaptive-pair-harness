import type * as vscode from "vscode";
import type { PairProvider } from "../config/pairConfig";
import type {
  ModelRequestContext,
  ModelResponse,
  ModelSymbolContext,
  ModelConversationTurn,
  ModelPurpose,
} from "../core/modelRouter";
import type { WorkingAgreement } from "../core/projectContext";
import { collectPairConversation } from "./pairConversation";
import type { Evidence, PairRange } from "../core/types";
import type {
  PairDisposable,
  PairSessionControlPort,
} from "./pairRuntimeSupport";
import {
  formatChatResponseForDisplay,
  formatChatResponsePartsForDisplay,
} from "./chatResponseDisplay";
import type { ChatResponseDisplayPart } from "./chatResponseDisplay";
import type { PairChatResponse } from "./vsCodeChatResponse";

export interface PairSessionSnapshot {
  readonly enabled: boolean;
  readonly active: boolean;
  readonly generation: number;
  readonly goal: string;
  readonly role: "navigator";
  readonly provider: PairProvider;
  readonly chatMode?: "workspace-agent" | "local-only";
  readonly remainingCalls: number;
  readonly remainingInputTokens: number;
  readonly remainingOutputTokens?: number;
  readonly controlNotice: string | undefined;
  readonly configurationWarning: string | undefined;
  readonly startupGuidance?: string;
  readonly working?: WorkingAgreement;
}

export interface PairPublishedEvidence {
  readonly uri: string;
  readonly rootUri?: string;
  readonly evidence: Evidence;
  readonly question: string;
}

export interface PairContextSnapshot {
  readonly revision: number;
  readonly session: PairSessionSnapshot;
  readonly latest: PairPublishedEvidence | undefined;
}

declare const pairContextRevisionFenceBrand: unique symbol;
export type PairContextRevisionFence = {
  readonly [pairContextRevisionFenceBrand]: never;
};

declare const pairRuntimeRevisionBrand: unique symbol;
export type PairRuntimeRevision = number & {
  readonly [pairRuntimeRevisionBrand]: true;
};

export interface PairEvidenceRevisionFence extends PairDisposable {
  isCurrent(): boolean;
}

export const PAIR_SHARED_CONTEXT_URI_REVISION_LIMIT = 256;

export class PairSharedContext {
  private latest: PairPublishedEvidence | undefined;
  private session: PairSessionSnapshot;
  private revision = 0;
  private evidenceEpoch = 0;
  private readonly evidenceRevisionByUri = new Map<string, number>();
  private readonly activeEvidencePinsByUri = new Map<
    string,
    Set<object>
  >();
  private readonly contextRevisionByFence = new WeakMap<
    PairContextRevisionFence,
    number
  >();
  private currentRuntimeRevision = 0;

  public constructor(
    session: Omit<PairSessionSnapshot, "generation"> & {
      readonly generation?: number;
    },
  ) {
    this.session = {
      ...session,
      generation: session.generation ?? 0,
    };
  }

  public beginRuntime(): PairRuntimeRevision {
    this.currentRuntimeRevision += 1;
    this.revision += 1;
    this.releaseAllEvidenceUris();
    this.latest = undefined;
    return this.currentRuntimeRevision as PairRuntimeRevision;
  }

  public captureRuntimeFence(): () => boolean {
    const revision = this.currentRuntimeRevision;
    return () => revision === this.currentRuntimeRevision;
  }

  public endRuntime(runtimeRevision: PairRuntimeRevision): void {
    if (runtimeRevision !== this.currentRuntimeRevision) {
      return;
    }
    this.currentRuntimeRevision += 1;
    this.revision += 1;
    this.releaseAllEvidenceUris();
    this.latest = undefined;
  }

  public updateSession(
    session: PairSessionSnapshot,
    runtimeRevision?: PairRuntimeRevision,
    revisionFence?: PairContextRevisionFence,
  ): boolean {
    if (
      runtimeRevision !== undefined &&
      runtimeRevision !== this.currentRuntimeRevision
    ) {
      return false;
    }
    if (
      revisionFence !== undefined &&
      !this.isRevisionFenceCurrent(revisionFence)
    ) {
      return false;
    }
    if (!sameSessionSnapshot(session, this.session)) {
      this.revision += 1;
    }
    this.session = session;
    if (revisionFence !== undefined) {
      this.contextRevisionByFence.set(revisionFence, this.revision);
    }
    return true;
  }

  public publishEvidence(
    latest: PairPublishedEvidence,
    runtimeRevision?: PairRuntimeRevision,
    revisionFence?: PairContextRevisionFence,
  ): boolean {
    if (
      runtimeRevision !== undefined &&
      runtimeRevision !== this.currentRuntimeRevision
    ) {
      return false;
    }
    if (
      revisionFence !== undefined &&
      !this.isRevisionFenceCurrent(revisionFence)
    ) {
      return false;
    }
    this.revision += 1;
    this.bumpEvidenceRevision(latest.uri);
    this.latest = latest;
    if (revisionFence !== undefined) {
      this.contextRevisionByFence.set(revisionFence, this.revision);
    }
    return true;
  }

  public clearEvidence(
    uri?: string,
    runtimeRevision?: PairRuntimeRevision,
  ): void {
    if (
      runtimeRevision !== undefined &&
      runtimeRevision !== this.currentRuntimeRevision
    ) {
      return;
    }
    if (uri === undefined) {
      this.releaseAllEvidenceUris();
      if (this.latest !== undefined) {
        this.revision += 1;
      }
      this.latest = undefined;
      return;
    }

    this.bumpEvidenceRevision(uri);
    if (this.latest?.uri === uri) {
      this.revision += 1;
      this.latest = undefined;
    }
  }

  public releaseEvidenceUri(
    uri: string,
    runtimeRevision?: PairRuntimeRevision,
  ): void {
    if (
      runtimeRevision !== undefined &&
      runtimeRevision !== this.currentRuntimeRevision
    ) {
      return;
    }
    if (this.evidenceRevisionByUri.has(uri)) {
      this.nextEvidenceRevision();
      this.evidenceRevisionByUri.delete(uri);
    }
    if (this.latest?.uri === uri) {
      this.revision += 1;
      this.latest = undefined;
    }
  }

  public evidenceRevisionForUri(uri: string): number | undefined {
    const revision = this.evidenceRevisionByUri.get(uri);
    if (revision === undefined) {
      return undefined;
    }
    this.evidenceRevisionByUri.delete(uri);
    this.evidenceRevisionByUri.set(uri, revision);
    return revision;
  }

  public captureEvidenceRevisionForUri(uri: string): number {
    const revision = this.evidenceRevisionForUri(uri);
    if (revision !== undefined) {
      return revision;
    }
    return this.storeEvidenceRevision(uri, this.nextEvidenceRevision());
  }

  public captureEvidenceRevisionFenceForUri(
    uri: string,
  ): PairEvidenceRevisionFence {
    let revision = this.evidenceRevisionForUri(uri);
    if (revision === undefined) {
      revision = this.nextEvidenceRevision();
      this.evidenceRevisionByUri.set(uri, revision);
    }
    const pin = {};
    const activePins =
      this.activeEvidencePinsByUri.get(uri) ?? new Set<object>();
    activePins.add(pin);
    this.activeEvidencePinsByUri.set(uri, activePins);
    this.evictIdleEvidenceRevisions();
    let active = true;
    return {
      isCurrent: () =>
        active && this.evidenceRevisionForUri(uri) === revision,
      dispose: () => {
        if (!active) {
          return;
        }
        active = false;
        const currentPins = this.activeEvidencePinsByUri.get(uri);
        currentPins?.delete(pin);
        if (currentPins?.size === 0) {
          this.activeEvidencePinsByUri.delete(uri);
        }
        this.evictIdleEvidenceRevisions();
      },
    };
  }

  public invalidateEvidenceFenceForUri(
    uri: string,
    runtimeRevision?: PairRuntimeRevision,
  ): number | undefined {
    if (
      runtimeRevision !== undefined &&
      runtimeRevision !== this.currentRuntimeRevision
    ) {
      return undefined;
    }
    return this.storeEvidenceRevision(uri, this.nextEvidenceRevision());
  }

  public snapshot(): PairContextSnapshot {
    return {
      revision: this.revision,
      session: this.session,
      latest: this.latest,
    };
  }

  public captureRevisionFence(): PairContextRevisionFence {
    const fence = {} as PairContextRevisionFence;
    this.contextRevisionByFence.set(fence, this.revision);
    return fence;
  }

  public isRevisionFenceCurrent(
    fence: PairContextRevisionFence,
  ): boolean {
    return this.contextRevisionByFence.get(fence) === this.revision;
  }

  private bumpEvidenceRevision(uri: string): void {
    this.storeEvidenceRevision(uri, this.nextEvidenceRevision());
  }

  private storeEvidenceRevision(uri: string, revision: number): number {
    this.evidenceRevisionByUri.delete(uri);
    this.evidenceRevisionByUri.set(uri, revision);
    this.evictIdleEvidenceRevisions();
    return revision;
  }

  private evictIdleEvidenceRevisions(): void {
    while (
      this.evidenceRevisionByUri.size >
      PAIR_SHARED_CONTEXT_URI_REVISION_LIMIT
    ) {
      let evicted = false;
      for (const candidate of this.evidenceRevisionByUri.keys()) {
        if (!this.activeEvidencePinsByUri.has(candidate)) {
          this.evidenceRevisionByUri.delete(candidate);
          evicted = true;
          break;
        }
      }
      if (!evicted) {
        return;
      }
    }
  }

  private releaseAllEvidenceUris(): void {
    if (this.evidenceRevisionByUri.size > 0) {
      this.nextEvidenceRevision();
    }
    this.evidenceRevisionByUri.clear();
    this.activeEvidencePinsByUri.clear();
  }

  private nextEvidenceRevision(): number {
    if (this.evidenceEpoch >= Number.MAX_SAFE_INTEGER) {
      throw new Error("Pair shared-context evidence revision exhausted.");
    }
    this.evidenceEpoch += 1;
    return this.evidenceEpoch;
  }
}

const sameSessionSnapshot = (
  left: PairSessionSnapshot,
  right: PairSessionSnapshot,
): boolean =>
  left.enabled === right.enabled &&
  left.active === right.active &&
  left.generation === right.generation &&
  left.goal === right.goal &&
  left.role === right.role &&
  left.provider === right.provider &&
  left.chatMode === right.chatMode &&
  left.remainingCalls === right.remainingCalls &&
  left.remainingInputTokens === right.remainingInputTokens &&
  left.remainingOutputTokens === right.remainingOutputTokens &&
  left.controlNotice === right.controlNotice &&
  left.configurationWarning === right.configurationWarning &&
  left.startupGuidance === right.startupGuidance &&
  left.working === right.working;

const appendStartupGuidanceParts = (
  parts: ChatResponseDisplayPart[],
  startupGuidance: string | undefined,
): void => {
  if (startupGuidance === undefined) {
    return;
  }

  parts.push(
    { kind: "markdown", value: "\n\n**Start Here:** " },
    { kind: "text", value: startupGuidance },
  );
};

export type PairChatPlan =
  | {
      readonly kind: "message";
      readonly parts: readonly ChatResponseDisplayPart[];
    }
  | {
      readonly kind: "generate";
      readonly uri: string;
      readonly goal: string;
      readonly evidence?: Evidence;
      readonly context: ModelRequestContext;
      readonly purpose: Exclude<ModelPurpose, "intervention">;
      readonly conversationId?: string;
    };

export interface PairChatRequestContext {
  readonly prompt: string;
  readonly symbol?: ModelSymbolContext;
  readonly conversation?: readonly ModelConversationTurn[];
}

export const buildPairChatPlan = (
  command: string | undefined,
  context: PairContextSnapshot,
  requestContext: PairChatRequestContext = { prompt: "" },
): PairChatPlan => {
  if (!context.session.enabled) {
    return {
      kind: "message",
      parts: [
        {
          kind: "markdown",
          value:
            "Adaptive Pair is disabled. Enable it before requesting navigator guidance.",
        },
      ],
    };
  }

  if (!context.session.active) {
    return {
      kind: "message",
      parts: [
        {
          kind: "markdown",
          value:
            "Adaptive Pair is off. Run `@pair /start` or **Adaptive Pair: Start Pairing Session** first.",
        },
      ],
    };
  }

  if (command === "session") {
    const parts: ChatResponseDisplayPart[] = [
      { kind: "markdown", value: "**Goal:** " },
      { kind: "text", value: context.session.goal },
      { kind: "markdown", value: "\n\n**Role:** " },
      { kind: "text", value: context.session.role },
      {
        kind: "markdown",
        value: " (you remain the driver)\n\n**Provider:** ",
      },
      { kind: "text", value: context.session.provider },
      { kind: "markdown", value: "\n\n**Remaining budget:** " },
      {
        kind: "text",
        value: `${context.session.remainingCalls} calls / ${context.session.remainingInputTokens} input tokens${
          context.session.remainingOutputTokens === undefined
            ? ""
            : ` / ${context.session.remainingOutputTokens} output tokens`
        }`,
      },
    ];
    if (context.session.controlNotice !== undefined) {
      parts.push(
        { kind: "markdown", value: "\n\n**Coexistence:** " },
        { kind: "text", value: context.session.controlNotice },
      );
    }
    if (context.session.configurationWarning !== undefined) {
      parts.push(
        { kind: "markdown", value: "\n\n**Configuration:** " },
        { kind: "text", value: context.session.configurationWarning },
      );
    }
    if (context.session.chatMode !== undefined) {
      parts.push(
        { kind: "markdown", value: "\n\n**Interactive Chat:** " },
        { kind: "text", value: context.session.chatMode === "local-only" ? "local-only; no model or workspace-tool calls" : "selected Chat model with bounded workspace tools; the provider and rolling budget above apply to background navigator guidance" },
      );
    }
    const working = context.session.working;
    if (working !== undefined) {
      parts.push(
        { kind: "markdown", value: "\n\n**Phase:** " },
        { kind: "text", value: working.phase },
        { kind: "markdown", value: "\n\n**Workspace context:** " },
        { kind: "text", value: working.shareWorkspaceContext ? "sharing approved for this session" : "local only (not shared with models)" },
        { kind: "markdown", value: "\n\n**Documents read:** " },
        { kind: "text", value: working.project.documents.map((document) => `${document.label}${document.truncated ? " (partial)" : ""}`).join(", ") || "none" },
      );
      if (working.goal === undefined && working.project.suggestedGoal !== undefined) {
        parts.push(
          { kind: "markdown", value: "\n\n**Proposed goal — not confirmed:** " },
          { kind: "text", value: working.project.suggestedGoal },
        );
      }
      const criteria = working.acceptanceCriteria.length > 0 ? working.acceptanceCriteria : working.project.acceptanceCriteria;
      parts.push(
        { kind: "markdown", value: "\n\n**Acceptance criteria to verify:** " },
        { kind: "text", value: criteria.join("; ") || "not agreed yet — clarify these with @pair /plan" },
      );
    }
    appendStartupGuidanceParts(parts, context.session.startupGuidance);
    return {
      kind: "message",
      parts,
    };
  }

  const latest = context.latest;
  const planning = command === "plan" || command === "checkpoint" ||
    (latest === undefined && (command === undefined || command === "explain"));
  if (latest === undefined && !planning) {
    const parts: ChatResponseDisplayPart[] = [
      {
        kind: "markdown",
        value:
          "No active code evidence yet. Select code or run **Adaptive Pair: Review Current Block**.",
      },
    ];
    appendStartupGuidanceParts(parts, context.session.startupGuidance);
    return {
      kind: "message",
      parts,
    };
  }
  if (command === "trace" && requestContext.symbol === undefined) {
    return {
      kind: "message",
      parts: [
        {
          kind: "markdown",
          value:
            "No current symbol could be resolved through VS Code's document symbol providers.",
        },
      ],
    };
  }

  const belongsToWorkingRoot = latest?.rootUri !== undefined &&
    latest.rootUri === context.session.working?.project.rootUri;
  const working = planning || belongsToWorkingRoot ? context.session.working : undefined;
  const requestEvidence = planning && context.session.working !== undefined && !belongsToWorkingRoot
    ? undefined : latest?.evidence;

  return {
    kind: "generate",
    uri: planning
      ? working === undefined ? latest?.uri ?? "adaptive-pair:session" : working.project.rootUri ?? "adaptive-pair:session"
      : latest!.uri,
    ...(requestEvidence === undefined ? {} : { evidence: requestEvidence }),
    ...(working === undefined ? {} : { conversationId: working.conversationId }),
    goal: working?.goal ?? goalForCommand(planning && command !== "checkpoint" ? "plan" : command),
    context: {
      ...(requestContext.prompt.trim().length === 0
        ? {}
        : { userPrompt: requestContext.prompt }),
      ...(requestContext.symbol === undefined
        ? {}
        : { symbol: requestContext.symbol }),
      ...(working === undefined || requestContext.conversation === undefined || requestContext.conversation.length === 0
        ? {}
        : { conversation: requestContext.conversation }),
      ...(working?.goal === undefined ? {} : {
        task: {
          goal: working.goal,
          acceptanceCriteria: working.acceptanceCriteria,
          constraints: working.constraints,
          decisions: working.decisions,
          phase: working.phase,
          sensitiveDataDetected: working.taskSensitiveDataDetected === true,
        },
      }),
    },
    purpose: planning ? command === "checkpoint" ? "checkpoint" : "plan" : purposeForCommand(command),
  };
};

const purposeForCommand = (
  command: string | undefined,
): "why" | "explain" | "trace" => {
  switch (command) {
    case "trace":
      return "trace";
    case "why":
      return "why";
    case "explain":
    default:
      return "explain";
  }
};

const goalForCommand = (
  command: string | undefined,
): string => {
  switch (command) {
    case "plan":
      return "Clarify the development goal and observable acceptance criteria, then propose one small next step and its first test.";
    case "checkpoint":
      return "Compare the working goal with observed verification, identify remaining criteria, and ask for missing test results without claiming to run them.";
    case "trace":
      return "Describe the relevant control and data flow for this evidence without inventing code context.";
    case "why":
      return "Explain why the current evidence matters and ask one useful follow-up question.";
    case "explain":
    default:
      return "Explain the current evidence and its trade-off, then ask one useful follow-up question.";
  }
};

export interface PairChatGenerator {
  generate(
    uri: string,
    goal: string,
    evidence: Evidence | undefined,
    signal: AbortSignal,
    context: ModelRequestContext,
    purpose?: Exclude<ModelPurpose, "intervention">,
    revisionFence?: PairContextRevisionFence,
  ): Promise<ModelResponse>;
}

export interface PairChatContextSource {
  captureRuntimeFence?(): () => boolean;
  captureRevisionFence(): PairContextRevisionFence;
  isRevisionFenceCurrent(fence: PairContextRevisionFence): boolean;
  snapshot(): PairContextSnapshot;
}

export interface PairSymbolContextProvider {
  forEvidence(
    uri: string,
    range: PairRange,
    signal: AbortSignal,
  ): Promise<ModelSymbolContext | undefined>;
}

const NO_SYMBOL_CONTEXT: PairSymbolContextProvider = {
  forEvidence: async () => undefined,
};

export interface PairChatParticipantOptions {
  readonly workspaceAgent?: {
    enabled(): boolean;
    run(request: vscode.ChatRequest, context: vscode.ChatContext, response: PairChatResponse, signal: AbortSignal): Promise<vscode.ChatResult | undefined>;
  };
  readonly workingControl?: {
    setGoal(prompt: string, signal: AbortSignal): Promise<string>;
    refreshContext(signal: AbortSignal): Promise<string>;
    draftBrief(signal: AbortSignal): Promise<string>;
    recordDecision?(prompt: string, signal: AbortSignal): Promise<string>;
  };
  readonly symbolContextProvider?: PairSymbolContextProvider;
  readonly sessionControl?: PairSessionControlPort;
  readonly requestLifecycle?: {
    register(uri: string, request: AbortController): PairDisposable;
  };
  readonly isOfficialCancellationError?: (error: unknown) => boolean;
}

export type PairChatRequestHandler = (
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  response: PairChatResponse,
  token: vscode.CancellationToken,
) => vscode.ProviderResult<vscode.ChatResult>;

export const registerPairChatParticipant = (
  register: (
    id: string,
    handler: PairChatRequestHandler,
  ) => vscode.ChatParticipant,
  context: PairChatContextSource,
  generator: PairChatGenerator,
  options: PairChatParticipantOptions = {},
): vscode.ChatParticipant => {
  const symbolContextProvider =
    options.symbolContextProvider ?? NO_SYMBOL_CONTEXT;
  const handler: PairChatRequestHandler = async (
    request,
    chatContext,
    response,
    token,
  ) => {
    const abortController = new AbortController();
    let requestRegistration: PairDisposable | undefined;
    let requestRevisionFence: PairContextRevisionFence | undefined;
    if (token.isCancellationRequested) {
      abortController.abort();
    }
    const cancellationListener = token.onCancellationRequested(() => {
      abortController.abort();
    });
    try {
      if (abortController.signal.aborted) {
        return;
      }
      if (request.command === "start" || request.command === "stop") {
        const sessionControl = options.sessionControl;
        if (sessionControl === undefined) {
          response.markdown(
            "Adaptive Pair session controls are temporarily unavailable.",
          );
          return;
        }
        const result =
          request.command === "start"
            ? await sessionControl.startSession()
            : sessionControl.stopSession();
        if (!abortController.signal.aborted) {
          response.text(formatChatResponseForDisplay(result.message));
        }
        return;
      }

      let snapshot = context.snapshot();
      const runtimeIsCurrent = context.captureRuntimeFence?.() ?? (() => true);
      const workspaceAgentRequest = options.workspaceAgent?.enabled() === true &&
        !["start", "stop", "session", "goal", "decision", "context"].includes(request.command ?? "");
      if (workspaceAgentRequest && snapshot.session.enabled && !snapshot.session.active && options.sessionControl !== undefined) {
        const started = await options.sessionControl.startSession();
        if (abortController.signal.aborted || !started.active || !runtimeIsCurrent() || options.workspaceAgent?.enabled() !== true) {
          return;
        }
        snapshot = context.snapshot();
      }
      if (workspaceAgentRequest && snapshot.session.enabled && snapshot.session.active) {
        if (!runtimeIsCurrent() || options.workspaceAgent?.enabled() !== true) {
          return;
        }
        requestRegistration = options.requestLifecycle?.register(snapshot.session.working?.project.rootUri ?? "adaptive-pair:session", abortController);
        if (!abortController.signal.aborted && runtimeIsCurrent() && options.workspaceAgent?.enabled() === true) {
          return await options.workspaceAgent!.run(request, chatContext, response, abortController.signal);
        }
        return;
      }
      requestRevisionFence = context.captureRevisionFence();
      if (
        snapshot.session.enabled && snapshot.session.active &&
        (request.command === "goal" || request.command === "context" || request.command === "brief" || request.command === "decision")
      ) {
        const control = options.workingControl;
        if (control === undefined) {
          response.markdown("Working-goal controls are temporarily unavailable.");
          return;
        }
        const message = request.command === "decision"
          ? await control.recordDecision?.(request.prompt, abortController.signal) ?? "Decision recording is temporarily unavailable."
          : request.command === "goal"
          ? await control.setGoal(request.prompt, abortController.signal)
          : request.command === "context"
            ? await control.refreshContext(abortController.signal)
            : await control.draftBrief(abortController.signal);
        const current = context.snapshot();
        if (!abortController.signal.aborted && current.session.active && current.session.generation === snapshot.session.generation) {
          response.text(formatChatResponseForDisplay(message));
          return conversationResult(current, current.session.working?.conversationId);
        }
        return;
      }
      if (
        snapshot.session.enabled &&
        snapshot.session.active &&
        (snapshot.latest !== undefined || request.command === undefined || ["plan", "checkpoint", "explain"].includes(request.command))
      ) {
        requestRegistration = options.requestLifecycle?.register(
          snapshot.latest?.uri ?? snapshot.session.working?.project.rootUri ?? "adaptive-pair:session",
          abortController,
        );
        if (abortController.signal.aborted) {
          return;
        }
      }
      const traceLookupStarted =
        request.command === "trace" &&
        snapshot.session.enabled &&
        snapshot.session.active &&
        snapshot.latest !== undefined;
      const symbol =
        traceLookupStarted
          ? await (async (): Promise<ModelSymbolContext | undefined> => {
              const traceUri = snapshot.latest!.uri;
              const traceRange = snapshot.latest!.evidence.range;
              const resolved = await symbolContextProvider.forEvidence(
                traceUri,
                traceRange,
                abortController.signal,
              );
              if (abortController.signal.aborted) {
                return undefined;
              }
              const current = context.snapshot();
              if (
                !current.session.enabled ||
                !current.session.active ||
                !context.isRevisionFenceCurrent(requestRevisionFence)
              ) {
                return undefined;
              }
              snapshot = current;
              return resolved;
            })()
          : undefined;
      if (abortController.signal.aborted) {
        return;
      }
      if (traceLookupStarted && symbol === undefined) {
        const current = context.snapshot();
        if (
          !current.session.enabled ||
          !current.session.active ||
          !context.isRevisionFenceCurrent(requestRevisionFence)
        ) {
          return;
        }
      }
      const plan = buildPairChatPlan(request.command, snapshot, {
        prompt: request.prompt,
        ...(symbol === undefined ? {} : { symbol }),
        ...(snapshot.session.working === undefined ? {} : {
          conversation: collectPairConversation(
            chatContext.history ?? [],
            snapshot.session.working.conversationId,
            snapshot.session.working.shareWorkspaceContext,
          ),
        }),
      });
      if (plan.kind === "message") {
        for (const part of formatChatResponsePartsForDisplay(plan.parts)) {
          response[part.kind](part.value);
        }
        return;
      }

      const generated = await generator.generate(
        plan.uri,
        plan.goal,
        plan.evidence,
        abortController.signal,
        plan.context,
        plan.purpose,
        requestRevisionFence,
      );
      const current = context.snapshot();
      if (
        abortController.signal.aborted ||
        !isCurrentGeneratedResponse(
          current,
          requestRevisionFence,
          context,
        )
      ) {
        return;
      }
      response.text(formatChatResponseForDisplay(generated.text));
      return conversationResult(current, plan.conversationId);
    } catch (error: unknown) {
      if (
        abortController.signal.aborted ||
        options.isOfficialCancellationError?.(error) === true ||
        (requestRevisionFence !== undefined &&
          !context.isRevisionFenceCurrent(requestRevisionFence))
      ) {
        return;
      }
      if (!(error instanceof Error)) {
        throw error;
      }
      response.text(
        formatChatResponseForDisplay(
          `Adaptive Pair could not answer: ${error.message}`,
        ),
      );
      return {
        errorDetails: {
          message: "Adaptive Pair could not answer.",
        },
      };
    } finally {
      requestRegistration?.dispose();
      cancellationListener.dispose();
    }
  };

  return register("adaptivePair.chat", handler);
};

const conversationResult = (snapshot: PairContextSnapshot, conversationId: string | undefined): vscode.ChatResult | undefined =>
  conversationId === undefined || snapshot.session.working?.conversationId !== conversationId ? undefined : {
    metadata: { pairConversationId: conversationId },
  };

const isCurrentGeneratedResponse = (
  current: PairContextSnapshot,
  revisionFence: PairContextRevisionFence,
  context: PairChatContextSource,
): boolean =>
  current.session.enabled &&
  current.session.active &&
  context.isRevisionFenceCurrent(revisionFence);
