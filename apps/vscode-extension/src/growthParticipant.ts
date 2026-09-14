import type * as vscode from "vscode";
import type { HintLevel, PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import type { PairCoordinatorPort } from "@adaptive-pair/runtime";
import type { PairToolName } from "@adaptive-pair/harness";
import { guardGrowthResponse, type GrowthResponse } from "@adaptive-pair/restraint";
import { createGrowthModel, GrowthModelFailure, type GrowthModel } from "./modelAdapter.js";

export const WITHHELD_RESPONSE_MESSAGE = [
  "Adaptive Pair withheld this response because it exceeded the current Growth",
  "hint boundary. Your work was not changed. Ask for the same hint level again,",
  "request a smaller clue, or explicitly reveal the solution.",
].join("\n");

const STALE_TURN_MESSAGE =
  "Adaptive Pair discarded this response because the session mode or authority changed while it was generating. Your work was not changed. Ask again for a fresh, in-boundary response.";

const RESTRAINT_FAILURE_MESSAGE =
  "Adaptive Pair could not produce an in-boundary response, so nothing was shown. Your work was not changed. Try again or ask for a smaller clue.";

const ATTEMPT_REQUIRED_MESSAGE =
  "Make an attempt first. Growth Mode needs a recorded attempt before it will raise the hint level to 2 or higher. Share what you tried, then ask for the hint again.";

const REVEAL_REQUIRED_MESSAGE =
  "A full solution needs an explicit reveal. Use /reveal (or ask to see the answer) so Adaptive Pair can record your authorization before showing a level-5 solution.";

const CONSENT_DECLINED_MESSAGE =
  "Adaptive Pair kept your workspace private. Grant workspace consent for this model to receive grounded, in-boundary hints about your task.";

export type GrowthIntent =
  | "brief"
  | "join"
  | "attempt"
  | "hypothesis"
  | "hint"
  | "reveal"
  | "check"
  | "transfer"
  | "session"
  | "quiet"
  | "chat";

export interface GrowthIntentResult {
  readonly intent: GrowthIntent;
  readonly level: HintLevel | undefined;
}

const COMMAND_INTENTS: Record<string, GrowthIntent> = {
  brief: "brief",
  attempt: "attempt",
  hypothesis: "hypothesis",
  hint: "hint",
  reveal: "reveal",
  check: "check",
  transfer: "transfer",
  session: "session",
};

const parseExplicitLevel = (prompt: string): HintLevel | undefined => {
  const match = /\blevel\s*([0-5])\b/u.exec(prompt);
  if (match === null) {
    return undefined;
  }
  return Number(match[1]) as HintLevel;
};

const naturalIntent = (prompt: string): GrowthIntent => {
  const text = prompt.toLowerCase();

  if (/\b(stay|be|keep)\s+quiet\b/u.test(text) || /\bquiet\s+mode\b/u.test(text)) {
    return "quiet";
  }
  if (
    /\bshow me (the )?(answer|solution)\b/u.test(text) ||
    /\breveal (the )?(answer|solution)\b/u.test(text) ||
    /\bjust tell me (the )?(answer|solution)\b/u.test(text)
  ) {
    return "reveal";
  }
  if (
    /\bi (think|believe|suspect)\b.*\bcause\b/u.test(text) ||
    /\bthe cause is\b/u.test(text) ||
    /\bmy hypothesis\b/u.test(text)
  ) {
    return "hypothesis";
  }
  if (
    /\bi (tried|attempted)\b/u.test(text) ||
    /\bmy attempt\b/u.test(text) ||
    /\bhere'?s what i (did|tried)\b/u.test(text)
  ) {
    return "attempt";
  }
  if (/\bjoin (me|in|here)\b/u.test(text) || /\bjoin my\b/u.test(text)) {
    return "join";
  }
  if (/\b(hint|clue|nudge)\b/u.test(text) || /\bpoint me\b/u.test(text)) {
    return "hint";
  }
  if (/\b(run|do) (the )?(check|verification|tests?)\b/u.test(text)) {
    return "check";
  }
  if (/\b(on my own|independent|transfer|variation)\b/u.test(text)) {
    return "transfer";
  }
  if (/\b(what mode|current mode|show (mode|status)|session status)\b/u.test(text)) {
    return "session";
  }

  return "chat";
};

export const interpretGrowthIntent = (
  request: vscode.ChatRequest,
): GrowthIntentResult => {
  const level = parseExplicitLevel(request.prompt ?? "");
  if (typeof request.command === "string" && request.command in COMMAND_INTENTS) {
    return { intent: COMMAND_INTENTS[request.command]!, level };
  }
  return { intent: naturalIntent(request.prompt ?? ""), level };
};

export type GrowthEvaluationOutcome =
  | "delivered"
  | "withheld"
  | "restraint-failure";

export interface GrowthEvaluationRecord {
  readonly outcome: GrowthEvaluationOutcome;
  readonly level: HintLevel | undefined;
  readonly kind: GrowthResponse["kind"] | undefined;
  readonly reason: string | undefined;
  readonly recordedAt: number;
}

export interface GrowthEvaluationInput {
  readonly outcome: GrowthEvaluationOutcome;
  readonly level?: HintLevel;
  readonly kind?: GrowthResponse["kind"];
  readonly reason?: string;
}

export class GrowthEvaluationLog {
  private readonly entries: GrowthEvaluationRecord[] = [];

  public constructor(private readonly now: () => number = () => Date.now()) {}

  public record(input: GrowthEvaluationInput): void {
    this.entries.push(
      Object.freeze({
        outcome: input.outcome,
        level: input.level,
        kind: input.kind,
        reason: input.reason,
        recordedAt: this.now(),
      }),
    );
  }

  public get records(): readonly GrowthEvaluationRecord[] {
    return Object.freeze([...this.entries]);
  }
}

export const modelConsentKey = (model: vscode.LanguageModelChat): string =>
  `${model.vendor}::${model.family}::${model.id}::${model.version}`;

export class ModelConsentRegistry {
  private readonly granted = new Set<string>();

  public has(model: vscode.LanguageModelChat): boolean {
    return this.granted.has(modelConsentKey(model));
  }

  public grant(model: vscode.LanguageModelChat): void {
    this.granted.add(modelConsentKey(model));
  }

  public revoke(model: vscode.LanguageModelChat): void {
    this.granted.delete(modelConsentKey(model));
  }
}

export interface GrowthParticipantDependencies {
  readonly coordinator: PairCoordinatorPort;
  readonly consent: ModelConsentRegistry;
  readonly evaluations: GrowthEvaluationLog;
  readonly createModel?: (model: vscode.LanguageModelChat) => GrowthModel;
  readonly requestWorkspaceConsent: (
    model: vscode.LanguageModelChat,
  ) => Promise<boolean>;
  readonly confirmSolutionReveal: (
    model: vscode.LanguageModelChat,
  ) => Promise<boolean>;
  readonly stayQuiet?: () => Promise<unknown>;
  readonly now?: () => number;
}

const MAX_CONTEXT_CHARS = 6_000;
const MAX_RECORD_SUMMARY = 500;

const stem = (path: string): string | undefined => {
  const base = path.split(/[\\/]/u).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const name = dot > 0 ? base.slice(0, dot) : base;
  return name.length > 1 ? name : undefined;
};

const deriveTargetIdentifiers = (
  snapshot: PairRuntimeSnapshot,
): readonly string[] => {
  const identifiers = new Set<string>();
  const workUnit = snapshot.session?.workUnit;
  if (workUnit !== undefined) {
    for (const path of workUnit.allowedPaths) {
      const value = stem(path);
      if (value !== undefined) {
        identifiers.add(value);
      }
    }
    for (const key of Object.keys(workUnit.baseline)) {
      const value = stem(key);
      if (value !== undefined) {
        identifiers.add(value);
      }
    }
  }
  return [...identifiers];
};

const abortSignalFromToken = (token: vscode.CancellationToken): AbortSignal => {
  const controller = new AbortController();
  if (token.isCancellationRequested) {
    controller.abort();
  } else {
    token.onCancellationRequested(() => controller.abort());
  }
  return controller.signal;
};

const failureReason = (error: unknown): string => {
  if (error instanceof GrowthModelFailure) {
    return error.code;
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "GROWTH_UNKNOWN_ERROR";
};

export class GrowthParticipant {
  public constructor(private readonly deps: GrowthParticipantDependencies) {}

  public handler(): vscode.ChatRequestHandler {
    return (request, context, response, token) =>
      this.handle(request, context, response, token);
  }

  public async handle(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    response: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const signal = abortSignalFromToken(token);
    const model = request.model;
    const { intent, level } = interpretGrowthIntent(request);

    try {
      switch (intent) {
        case "quiet":
          await this.handleQuiet(response);
          return;
        case "attempt":
          await this.handleRecord(request, response, signal, "attempt");
          return;
        case "hypothesis":
          await this.handleRecord(request, response, signal, "hypothesis");
          return;
        case "join":
          this.handleJoin(response);
          return;
        case "reveal":
          await this.handleReveal(request, context, model, response, signal);
          return;
        case "hint":
          await this.handleGuidance(request, context, model, response, signal, {
            escalate: true,
            level,
          });
          return;
        default:
          await this.handleGuidance(request, context, model, response, signal, {
            escalate: false,
            level: undefined,
          });
          return;
      }
    } catch (error) {
      this.deps.evaluations.record({
        outcome: "restraint-failure",
        reason: failureReason(error),
      });
      response.markdown(RESTRAINT_FAILURE_MESSAGE);
    }
  }

  private async handleQuiet(
    response: vscode.ChatResponseStream,
  ): Promise<void> {
    if (this.deps.stayQuiet !== undefined) {
      await this.deps.stayQuiet();
    }
    response.markdown(
      "Staying quiet. Pair Presence remains on and your task continues; ask again whenever you want a hint.",
    );
  }

  private handleJoin(response: vscode.ChatResponseStream): void {
    response.markdown(
      "Run \"Adaptive Pair: Join Work in Progress\" to capture a bounded local entry snapshot. Capturing context never grants edit authority.",
    );
  }

  private async handleRecord(
    request: vscode.ChatRequest,
    response: vscode.ChatResponseStream,
    signal: AbortSignal,
    kind: "attempt" | "hypothesis",
  ): Promise<void> {
    const snapshot = await this.deps.coordinator.snapshot();
    const workUnitId = snapshot.session?.workUnit?.id;
    if (workUnitId === undefined) {
      response.markdown(
        "Start a Growth work unit before recording your attempt or hypothesis.",
      );
      return;
    }

    const name: PairToolName =
      kind === "attempt" ? "pair_record_attempt" : "pair_record_hypothesis";
    await this.invokeWithUserAction(
      name,
      {
        workUnitId,
        summary: (request.prompt ?? "").slice(0, MAX_RECORD_SUMMARY),
        bypassed: false,
      },
      signal,
    );

    response.markdown(
      kind === "attempt"
        ? "Recorded your attempt. You can now request a higher hint level."
        : "Recorded your hypothesis. Diagnosis stays yours; ask for a hint whenever you are ready.",
    );
  }

  private async handleReveal(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    model: vscode.LanguageModelChat,
    response: vscode.ChatResponseStream,
    signal: AbortSignal,
  ): Promise<void> {
    const confirmed = await this.deps.confirmSolutionReveal(model);
    if (!confirmed) {
      response.markdown(
        "Solution reveal cancelled. Your work was not changed; keep going or ask for a smaller clue.",
      );
      return;
    }

    const snapshot = await this.deps.coordinator.snapshot();
    const workUnitId = snapshot.session?.workUnit?.id;
    if (workUnitId === undefined) {
      response.markdown("Start a Growth work unit before revealing a solution.");
      return;
    }

    await this.invokeWithUserAction(
      "pair_reveal_solution",
      { workUnitId },
      signal,
    );
    await this.invokeWithUserAction(
      "pair_request_hint",
      { workUnitId, level: 5 },
      signal,
    );

    const taskContext = await this.gatherConsentedContext(
      model,
      request,
      context,
      response,
    );
    await this.runGuardedTurn(model, request, taskContext, response, signal);
  }

  private async handleGuidance(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    model: vscode.LanguageModelChat,
    response: vscode.ChatResponseStream,
    signal: AbortSignal,
    options: { readonly escalate: boolean; readonly level: HintLevel | undefined },
  ): Promise<void> {
    const taskContext = await this.gatherConsentedContext(
      model,
      request,
      context,
      response,
    );

    if (options.escalate) {
      const escalated = await this.escalateHint(options.level, response, signal);
      if (!escalated) {
        return;
      }
    }

    await this.runGuardedTurn(model, request, taskContext, response, signal);
  }

  private async escalateHint(
    explicitLevel: HintLevel | undefined,
    response: vscode.ChatResponseStream,
    signal: AbortSignal,
  ): Promise<boolean> {
    const snapshot = await this.deps.coordinator.snapshot();
    const workUnitId = snapshot.session?.workUnit?.id;
    if (workUnitId === undefined) {
      response.markdown("Start a Growth work unit before requesting a hint.");
      return false;
    }

    const current = snapshot.session?.assistance?.hint?.level ?? 0;
    const requested =
      explicitLevel ?? (Math.min(current + 1, 5) as HintLevel);

    try {
      await this.invokeWithUserAction(
        "pair_request_hint",
        { workUnitId, level: requested },
        signal,
      );
      return true;
    } catch (error) {
      const reason = failureReason(error);
      if (reason === "HINT_REQUIRES_ATTEMPT") {
        response.markdown(ATTEMPT_REQUIRED_MESSAGE);
        return false;
      }
      if (reason === "HINT_REQUIRES_REVEAL") {
        response.markdown(REVEAL_REQUIRED_MESSAGE);
        return false;
      }
      throw error;
    }
  }

  private async runGuardedTurn(
    model: vscode.LanguageModelChat,
    request: vscode.ChatRequest,
    taskContext: string | undefined,
    response: vscode.ChatResponseStream,
    signal: AbortSignal,
  ): Promise<void> {
    const before = await this.deps.coordinator.snapshot();
    const prompt = request.prompt ?? "";
    const prepared = await this.deps.coordinator.prepareTurn({
      ...(prompt.length > 0 ? { userRequest: prompt } : {}),
      ...(taskContext === undefined ? {} : { repositoryContext: taskContext }),
    });

    if (
      prepared.instructions.runtimeRevision !== prepared.tools.runtimeRevision ||
      prepared.instructions.authorityEpoch !== prepared.tools.authorityEpoch ||
      prepared.instructions.runtimeRevision !== before.revision
    ) {
      this.rejectStale(response);
      return;
    }

    const growthModel = (this.deps.createModel ??
      (candidate => createGrowthModel(candidate, this.deps.coordinator)))(model);

    let result: GrowthResponse;
    try {
      result = await growthModel.request(
        prepared.instructions,
        prepared.tools,
        signal,
      );
    } catch (error) {
      this.deps.evaluations.record({
        outcome: "restraint-failure",
        reason: failureReason(error),
      });
      response.markdown(RESTRAINT_FAILURE_MESSAGE);
      return;
    }

    const after = await this.deps.coordinator.snapshot();
    if (
      after.revision !== before.revision ||
      after.session?.authorityEpoch !== before.session?.authorityEpoch ||
      after.session?.mode !== before.session?.mode
    ) {
      this.rejectStale(response);
      return;
    }

    const guard = guardGrowthResponse(result, {
      revealAuthorized: after.session?.assistance?.solutionReveal !== undefined,
      targetIdentifiers: deriveTargetIdentifiers(after),
    });

    if (!guard.accepted) {
      this.deps.evaluations.record({
        outcome: "withheld",
        level: result.level,
        kind: result.kind,
        reason: guard.reason,
      });
      response.markdown(WITHHELD_RESPONSE_MESSAGE);
      return;
    }

    this.deps.evaluations.record({
      outcome: "delivered",
      level: guard.response.level,
      kind: guard.response.kind,
    });
    response.markdown(guard.response.text);
  }

  private rejectStale(response: vscode.ChatResponseStream): void {
    this.deps.evaluations.record({
      outcome: "restraint-failure",
      reason: "STALE_TURN",
    });
    response.markdown(STALE_TURN_MESSAGE);
  }

  private async gatherConsentedContext(
    model: vscode.LanguageModelChat,
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    response: vscode.ChatResponseStream,
  ): Promise<string | undefined> {
    if (this.deps.consent.has(model)) {
      return this.gatherTaskContext(request, context);
    }

    const granted = await this.deps.requestWorkspaceConsent(model);
    if (granted) {
      this.deps.consent.grant(model);
      return this.gatherTaskContext(request, context);
    }

    response.markdown(CONSENT_DECLINED_MESSAGE);
    return undefined;
  }

  private gatherTaskContext(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
  ): string | undefined {
    const excerpts: string[] = [];
    for (const turn of context.history ?? []) {
      const prompt = (turn as { readonly prompt?: unknown }).prompt;
      if (typeof prompt === "string" && prompt.length > 0) {
        excerpts.push(prompt);
      }
    }

    for (const reference of request.references ?? []) {
      const value = (reference as { readonly value?: unknown }).value;
      if (typeof value === "string" && value.length > 0) {
        excerpts.push(value);
      }
    }

    if (excerpts.length === 0) {
      return undefined;
    }
    return excerpts.join("\n").slice(0, MAX_CONTEXT_CHARS);
  }

  private async invokeWithUserAction(
    name: PairToolName,
    input: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<void> {
    const grantId = await this.deps.coordinator.grantUserAction(name, signal);
    await this.deps.coordinator.invokeTool(name, input, signal, {
      userActionId: grantId,
    });
  }
}
