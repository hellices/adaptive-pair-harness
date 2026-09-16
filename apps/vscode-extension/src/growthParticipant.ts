import type * as vscode from "vscode";
import { growthFailureReason as failureReason } from "@adaptive-pair/runtime";
import type { GrowthParticipantDependencies, GrowthTransferState, GrowthTransientState } from "./growthHostState.js";
import { GrowthLocalRoutes } from "./growthLocalRoutes.js";
import { GrowthGuidanceRoutes } from "./growthGuidanceRoutes.js";
import { interpretGrowthIntent } from "./growthIntent.js";
import { RESTRAINT_FAILURE_MESSAGE } from "./growthPresentation.js";

export { WITHHELD_RESPONSE_MESSAGE } from "./growthPresentation.js";
export { isDistinctVariation } from "./growthGuidanceRoutes.js";
export { GROWTH_COMMAND_INTENTS, interpretGrowthIntent, type GrowthIntent, type GrowthIntentResult } from "./growthIntent.js";
export {
  GrowthEvaluationLog,
  ModelConsentRegistry,
  modelConsentKey,
  type GrowthEvaluationOutcome,
  type GrowthEvaluationRecord,
  type GrowthEvaluationInput,
  type GrowthTransferState,
  type GrowthCheckState,
  type GrowthConsentResult,
  type GrowthParticipantDependencies,
} from "./growthHostState.js";

const abortSignalFromToken = (token: vscode.CancellationToken): AbortSignal => {
  const controller = new AbortController();
  if (token.isCancellationRequested) {
    controller.abort();
  } else {
    token.onCancellationRequested(() => controller.abort());
  }
  return controller.signal;
};

export class GrowthParticipant {
  private readonly state: GrowthTransientState = { transfer: undefined, lastCheck: undefined };
  private readonly local: GrowthLocalRoutes;
  private readonly guidance: GrowthGuidanceRoutes;

  public constructor(private readonly deps: GrowthParticipantDependencies) {
    this.local = new GrowthLocalRoutes(deps, this.state);
    this.guidance = new GrowthGuidanceRoutes(deps, this.state);
  }

  /** The current independent transfer state, or `undefined` when none started. */
  public transferStatus(): GrowthTransferState | undefined {
    return this.state.transfer;
  }

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
          await this.local.handleQuiet(response);
          return;
        case "attempt":
          await this.local.handleRecord(request, response, signal, "attempt");
          return;
        case "hypothesis":
          await this.local.handleRecord(request, response, signal, "hypothesis");
          return;
        case "join":
          this.local.handleJoin(response);
          return;
        case "brief":
          await this.local.handleBrief(response);
          return;
        case "session":
          await this.local.handleSession(response);
          return;
        case "check":
          await this.local.handleCheck(response, signal);
          return;
        case "transfer":
          await this.guidance.handleTransfer(request, context, model, response, signal);
          return;
        case "reveal":
          await this.guidance.handleReveal(request, context, model, response, signal);
          return;
        case "hint":
          await this.guidance.handleGuidance(request, context, model, response, signal, {
            escalate: true,
            level,
          });
          return;
        default:
          await this.guidance.handleGuidance(request, context, model, response, signal, {
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
}
