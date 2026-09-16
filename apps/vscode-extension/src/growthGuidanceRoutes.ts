import type * as vscode from "vscode";
import type { HintLevel, PairSessionSnapshot } from "@adaptive-pair/protocol";
import { growthFailureReason as failureReason, isGrowthTurnIntentCurrent } from "@adaptive-pair/runtime";
import type { GrowthConsentResult, GrowthParticipantDependencies, GrowthTransientState } from "./growthHostState.js";
import { bounded, ATTEMPT_REQUIRED_MESSAGE, REVEAL_REQUIRED_MESSAGE, CONSENT_DECLINED_MESSAGE, NO_WORK_UNIT_MESSAGE, TRANSFER_NOT_DISTINCT_MESSAGE, TRANSFER_NOT_DEMONSTRATED_NOTE } from "./growthPresentation.js";
import { GrowthTurnPublisher } from "./growthTurnPublisher.js";
import { invokeGrowthUserAction } from "./growthUserActions.js";

const MAX_CONTEXT_CHARS = 6_000;

const normalizeForComparison = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * A transfer variation must be a genuinely different exercise, so a response
 * that merely restates the agreed objective is rejected rather than delivered.
 */
export const isDistinctVariation = (text: string, objective: string): boolean => {
  const target = normalizeForComparison(objective);
  if (target.length === 0) {
    return text.normalize("NFKC").trim() !== objective.normalize("NFKC").trim();
  }
  return !normalizeForComparison(text).includes(target);
};

/**
 * The deterministic, trusted request used for a transfer turn. It names the
 * current objective only so the model can avoid repeating it.
 */
const transferRequest = (
  session: PairSessionSnapshot,
  objective: string,
  independentCheck: string,
): string =>
  [
    "Propose one independent transfer task for the developer to attempt alone.",
    `It must be distinct from the current work-unit objective: "${
      bounded(objective) ?? ""
    }".`,
    `Keep it within the same capability (${
      session.workUnit?.capability ?? "implementation"
    }) and aligned with the agreed independent check: "${
      bounded(independentCheck) ?? ""
    }".`,
    "State the variation and its success condition only. Do not include a solution, patch, or implementation of either task.",
  ].join(" ");

export class GrowthGuidanceRoutes {
  private readonly publisher: GrowthTurnPublisher;

  public constructor(
    private readonly deps: GrowthParticipantDependencies,
    private readonly state: GrowthTransientState,
  ) {
    this.publisher = new GrowthTurnPublisher(deps);
  }

  /**
   * Start an independent transfer task: a bounded variation that must be
   * distinct from the current work-unit objective. Starting one records a
   * non-raw `transfer-started` evaluation and never claims a demonstration.
   */
  public async handleTransfer(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    model: vscode.LanguageModelChat,
    response: vscode.ChatResponseStream,
    signal: AbortSignal,
  ): Promise<void> {
    const snapshot = await this.deps.coordinator.snapshot();
    const session = snapshot.session;
    const workUnit = session?.workUnit;
    if (session === undefined || workUnit === undefined || session.mode !== "growth") {
      response.markdown(NO_WORK_UNIT_MESSAGE);
      return;
    }
    const intent = Object.freeze({
      sessionId: session.sessionId,
      startedAtRevision: session.startedAtRevision,
      authorityEpoch: session.authorityEpoch,
      mode: session.mode,
      workUnitId: workUnit.id,
      objective: workUnit.objective,
      capability: workUnit.capability,
      independentCheck: session.learningAgreement?.independentCheck,
    });

    const consent = await this.gatherConsentedContext(
      model,
      request,
      context,
      response,
    );
    if (consent.status === "declined") {
      return;
    }

    const independentCheck =
      session.learningAgreement?.independentCheck ?? "an independent variation";
    const accepted = await this.publisher.run(
      model,
      request,
      consent.taskContext,
      response,
      signal,
      {
        userRequest: transferRequest(session, workUnit.objective, independentCheck),
        intent,
        acceptedOutcome: "transfer-started",
        validate: result =>
          isDistinctVariation(result.text, workUnit.objective)
            ? undefined
            : "TRANSFER_NOT_DISTINCT",
        withheldMessage: TRANSFER_NOT_DISTINCT_MESSAGE,
      },
    );

    if (accepted === undefined || signal.aborted) {
      return;
    }
    const current = this.deps.snapshotNow();
    if (
      !isGrowthTurnIntentCurrent(intent, current) ||
      current.revision !== accepted.runtime.runtimeRevision ||
      current.session?.authorityEpoch !== accepted.runtime.authorityEpoch ||
      current.session?.mode !== accepted.runtime.mode
    ) {
      return;
    }

    this.state.transfer = Object.freeze({
      status: "started" as const,
      sessionId: session.sessionId,
      workUnitId: workUnit.id,
      independentCheck,
      demonstrated: false as const,
      startedAt: (this.deps.now ?? Date.now)(),
    });
    response.markdown(TRANSFER_NOT_DEMONSTRATED_NOTE);
  }

  public async handleReveal(
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

    // Gate workspace consent before any reveal/hint state transition so a
    // decline leaves assistance state untouched and never dispatches the model.
    const consent = await this.gatherConsentedContext(
      model,
      request,
      context,
      response,
    );
    if (consent.status === "declined") {
      return;
    }

    const snapshot = await this.deps.coordinator.snapshot();
    const workUnitId = snapshot.session?.workUnit?.id;
    if (workUnitId === undefined) {
      response.markdown("Start a Growth work unit before revealing a solution.");
      return;
    }

    const revealed = await invokeGrowthUserAction(
      this.deps.coordinator,
      "pair_reveal_solution",
      { workUnitId },
      signal,
      { runtimeRevision: snapshot.revision, authorityEpoch: snapshot.session?.authorityEpoch },
    );
    await invokeGrowthUserAction(
      this.deps.coordinator,
      "pair_request_hint",
      { workUnitId, level: 5 },
      signal,
      { runtimeRevision: revealed.runtimeRevision, authorityEpoch: revealed.authorityEpoch },
    );

    await this.publisher.run(model, request, consent.taskContext, response, signal);
  }

  public async handleGuidance(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    model: vscode.LanguageModelChat,
    response: vscode.ChatResponseStream,
    signal: AbortSignal,
    options: { readonly escalate: boolean; readonly level: HintLevel | undefined },
  ): Promise<void> {
    const consent = await this.gatherConsentedContext(
      model,
      request,
      context,
      response,
    );
    if (consent.status === "declined") {
      return;
    }

    if (options.escalate) {
      const escalated = await this.escalateHint(options.level, response, signal);
      if (!escalated) {
        return;
      }
    }

    await this.publisher.run(model, request, consent.taskContext, response, signal);
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
      await invokeGrowthUserAction(
        this.deps.coordinator,
        "pair_request_hint",
        { workUnitId, level: requested },
        signal,
        { runtimeRevision: snapshot.revision, authorityEpoch: snapshot.session?.authorityEpoch },
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

  private gatherConsentedContext(
    model: vscode.LanguageModelChat,
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    response: vscode.ChatResponseStream,
  ): Promise<GrowthConsentResult> {
    return this.resolveConsent(model, request, context, response);
  }

  private async resolveConsent(
    model: vscode.LanguageModelChat,
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    response: vscode.ChatResponseStream,
  ): Promise<GrowthConsentResult> {
    if (this.deps.consent.has(model)) {
      return { status: "granted", taskContext: this.gatherTaskContext(request, context) };
    }

    const granted = await this.deps.requestWorkspaceConsent(model);
    if (granted) {
      this.deps.consent.grant(model);
      return { status: "granted", taskContext: this.gatherTaskContext(request, context) };
    }

    // Decline short-circuits the whole turn: no compiled trusted work-unit
    // layer, no model dispatch, and no assistance state transition. The neutral
    // message is the only side effect.
    response.markdown(CONSENT_DECLINED_MESSAGE);
    return { status: "declined" };
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
}
