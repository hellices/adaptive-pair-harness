import type * as vscode from "vscode";
import { finishGuardedGrowthTurn, requestGuardedGrowthTurn, type GrowthTurnIntent, type GrowthTurnOutcome } from "@adaptive-pair/runtime";
import type { GrowthResponse } from "@adaptive-pair/restraint";
import type { GrowthEvaluationOutcome, GrowthParticipantDependencies } from "./growthHostState.js";
import { WITHHELD_RESPONSE_MESSAGE, STALE_TURN_MESSAGE, REPREPARE_TURN_MESSAGE, RESTRAINT_FAILURE_MESSAGE } from "./growthPresentation.js";
import { createGrowthModel } from "./modelAdapter.js";

type PublishedGrowthTurn = Extract<GrowthTurnOutcome, { readonly status: "delivered" }>;

export class GrowthTurnPublisher {
  public constructor(
    private readonly deps: Pick<GrowthParticipantDependencies, "coordinator" | "snapshotNow" | "createModel" | "evaluations">,
  ) {}

  public async run(
    model: vscode.LanguageModelChat,
    request: vscode.ChatRequest,
    taskContext: string | undefined,
    response: vscode.ChatResponseStream,
    signal: AbortSignal,
    options: {
      /** Replaces the developer prompt as the trusted user-request layer. */
      readonly userRequest?: string;
      readonly intent?: GrowthTurnIntent;
      readonly acceptedOutcome?: GrowthEvaluationOutcome;
      /** Returns a stable reason code to withhold an otherwise valid response. */
      readonly validate?: (result: GrowthResponse) => string | undefined;
      readonly withheldMessage?: string;
    } = {},
  ): Promise<PublishedGrowthTurn | undefined> {
    const requested = await requestGuardedGrowthTurn({
      coordinator: this.deps.coordinator,
      createModel: () => (this.deps.createModel ??
        (candidate => createGrowthModel(candidate, this.deps.coordinator)))(model),
      signal,
      userRequest: options.userRequest ?? request.prompt ?? "",
      ...(taskContext === undefined ? {} : { repositoryContext: taskContext }),
      ...(options.intent === undefined ? {} : { intent: options.intent }),
    });
    if (signal.aborted) {
      this.deps.evaluations.record({ outcome: "restraint-failure", reason: "GROWTH_CANCELLED" });
      return undefined;
    }
    const outcome = requested.status === "ready"
      ? finishGuardedGrowthTurn(requested, this.deps.snapshotNow(), options.validate)
      : requested;

    switch (outcome.status) {
      case "reprepare":
        response.markdown(REPREPARE_TURN_MESSAGE);
        return undefined;
      case "stale":
        this.rejectStale(response);
        return undefined;
      case "failed":
        this.deps.evaluations.record({
          outcome: "restraint-failure",
          reason: outcome.reason,
        });
        response.markdown(RESTRAINT_FAILURE_MESSAGE);
        return undefined;
      case "withheld":
        this.deps.evaluations.record({
          outcome: "withheld",
          level: outcome.response.level,
          kind: outcome.response.kind,
          reason: outcome.reason,
        });
        response.markdown(outcome.source === "validation"
          ? options.withheldMessage ?? WITHHELD_RESPONSE_MESSAGE
          : WITHHELD_RESPONSE_MESSAGE);
        return undefined;
      case "delivered":
        this.deps.evaluations.record({
          outcome: options.acceptedOutcome ?? "delivered",
          level: outcome.response.level,
          kind: outcome.response.kind,
        });
        response.markdown(outcome.response.text);
        return outcome;
    }
  }

  private rejectStale(response: vscode.ChatResponseStream): void {
    this.deps.evaluations.record({
      outcome: "restraint-failure",
      reason: "STALE_TURN",
    });
    response.markdown(STALE_TURN_MESSAGE);
  }
}
