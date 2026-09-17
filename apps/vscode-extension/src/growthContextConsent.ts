import type * as vscode from "vscode";
import type { PairRuntimeSnapshot, PairSessionSnapshot, WorkUnit } from "@adaptive-pair/protocol";
import { isGrowthTurnIntentCurrent, type GrowthTurnIntent } from "@adaptive-pair/runtime";
import type { GrowthConsentResult, GrowthParticipantDependencies } from "./growthHostState.js";
import { CONSENT_DECLINED_MESSAGE, NO_WORK_UNIT_MESSAGE, STALE_TURN_MESSAGE } from "./growthPresentation.js";

const MAX_CONTEXT_CHARS = 6_000;

export interface GrowthGuidanceContext {
  readonly snapshot: PairRuntimeSnapshot;
  readonly session: PairSessionSnapshot;
  readonly workUnit: WorkUnit;
  readonly intent: GrowthTurnIntent;
}

export class GrowthContextConsent {
  public constructor(private readonly deps: GrowthParticipantDependencies) {}

  public async capture(response: vscode.ChatResponseStream): Promise<GrowthGuidanceContext | undefined> {
    const snapshot = await this.deps.coordinator.snapshot();
    const session = snapshot.session;
    const workUnit = session?.workUnit;
    if (
      snapshot.presence.status === "off" ||
      session?.mode !== "growth" ||
      (session.status !== "active" && session.status !== "ready") ||
      session.learningAgreement === undefined ||
      workUnit?.mode !== "growth" ||
      workUnit.status !== "agreed" || workUnit.owner !== "human"
    ) {
      response.markdown(NO_WORK_UNIT_MESSAGE);
      return undefined;
    }
    return {
      snapshot,
      session,
      workUnit,
      intent: Object.freeze({
        workspaceId: snapshot.presence.workspaceId,
        sessionId: session.sessionId,
        startedAtRevision: session.startedAtRevision,
        authorityEpoch: session.authorityEpoch,
        mode: session.mode,
        workUnitId: workUnit.id,
        objective: workUnit.objective,
        capability: workUnit.capability,
        independentCheck: session.learningAgreement.independentCheck,
      }),
    };
  }

  public isCurrent(
    captured: GrowthGuidanceContext,
    response: vscode.ChatResponseStream,
    signal: AbortSignal,
  ): boolean {
    if (signal.aborted) {
      this.deps.evaluations.record({ outcome: "restraint-failure", reason: "GROWTH_CANCELLED" });
      return false;
    }
    if (!isGrowthTurnIntentCurrent(captured.intent, this.deps.snapshotNow())) {
      this.deps.evaluations.record({ outcome: "restraint-failure", reason: "STALE_TURN" });
      response.markdown(STALE_TURN_MESSAGE);
      return false;
    }
    return true;
  }

  public async gather(
    captured: GrowthGuidanceContext,
    model: vscode.LanguageModelChat,
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    response: vscode.ChatResponseStream,
    signal: AbortSignal,
  ): Promise<GrowthConsentResult> {
    if (!this.isCurrent(captured, response, signal)) {
      return { status: "stale" };
    }
    const granted = this.deps.consent.has(model, captured.snapshot) ||
      await this.deps.requestWorkspaceConsent(model);
    if (!granted && !signal.aborted) {
      response.markdown(CONSENT_DECLINED_MESSAGE);
      return { status: "declined" };
    }
    if (!this.isCurrent(captured, response, signal)) {
      return { status: "stale" };
    }
    this.deps.consent.grant(model, captured.snapshot);
    return { status: "granted", taskContext: this.gatherTaskContext(request, context) };
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
    return excerpts.length === 0 ? undefined : excerpts.join("\n").slice(0, MAX_CONTEXT_CHARS);
  }
}
