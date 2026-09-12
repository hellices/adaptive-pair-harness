import type * as vscode from "vscode";
import type { PairProvider } from "../config/pairConfig";
import {
  createRemoteSafeModelRequest,
  sanitizeModelRequestContext,
  type ModelRequestContext,
  type ModelResponse,
  type ModelSymbolContext,
} from "../core/modelRouter";
import type { Evidence, PairRange } from "../core/types";
import type {
  PairDisposable,
  PairSessionControlPort,
} from "./pairRuntimeSupport";

export interface PairSessionSnapshot {
  readonly enabled: boolean;
  readonly active: boolean;
  readonly generation: number;
  readonly goal: string;
  readonly role: "navigator";
  readonly provider: PairProvider;
  readonly remainingCalls: number;
  readonly remainingInputTokens: number;
  readonly controlNotice: string | undefined;
  readonly configurationWarning: string | undefined;
}

export interface PairPublishedEvidence {
  readonly uri: string;
  readonly evidence: Evidence;
  readonly question: string;
}

export interface PairContextSnapshot {
  readonly session: PairSessionSnapshot;
  readonly latest: PairPublishedEvidence | undefined;
}

export class PairSharedContext {
  private latest: PairPublishedEvidence | undefined;
  private session: PairSessionSnapshot;

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

  public updateSession(session: PairSessionSnapshot): void {
    this.session = session;
  }

  public publishEvidence(latest: PairPublishedEvidence): void {
    this.latest = latest;
  }

  public clearEvidence(uri?: string): void {
    if (uri === undefined || this.latest?.uri === uri) {
      this.latest = undefined;
    }
  }

  public snapshot(): PairContextSnapshot {
    return {
      session: this.session,
      latest: this.latest,
    };
  }
}

export type PairChatPlan =
  | { readonly kind: "message"; readonly markdown: string }
  | {
      readonly kind: "generate";
      readonly uri: string;
      readonly goal: string;
      readonly evidence: Evidence;
      readonly context: ModelRequestContext;
    };

export interface PairChatRequestContext {
  readonly prompt: string;
  readonly symbol?: ModelSymbolContext;
}

export const buildPairChatPlan = (
  command: string | undefined,
  context: PairContextSnapshot,
  requestContext: PairChatRequestContext = { prompt: "" },
): PairChatPlan => {
  if (!context.session.enabled) {
    return {
      kind: "message",
      markdown:
        "Adaptive Pair is disabled. Enable it before requesting navigator guidance.",
    };
  }

  if (!context.session.active) {
    return {
      kind: "message",
      markdown:
        "Adaptive Pair is off. Run `@pair /start` or **Adaptive Pair: Start Pairing Session** first.",
    };
  }

  if (command === "session") {
    const sessionLines = [
      `**Goal:** ${context.session.goal}`,
      `**Role:** ${context.session.role} (you remain the driver)`,
      `**Provider:** ${context.session.provider}`,
      `**Remaining budget:** ${context.session.remainingCalls} calls / ${context.session.remainingInputTokens} input tokens`,
    ];
    if (context.session.controlNotice !== undefined) {
      sessionLines.push(`**Coexistence:** ${context.session.controlNotice}`);
    }
    if (context.session.configurationWarning !== undefined) {
      sessionLines.push(
        `**Configuration:** ${context.session.configurationWarning}`,
      );
    }
    return {
      kind: "message",
      markdown: sessionLines.join("\n\n"),
    };
  }

  const latest = context.latest;
  if (latest === undefined) {
    return {
      kind: "message",
      markdown:
        "No active evidence yet. Select code or run **Adaptive Pair: Review Current Block**.",
    };
  }
  if (command === "trace" && requestContext.symbol === undefined) {
    return {
      kind: "message",
      markdown:
        "No current symbol could be resolved through VS Code's document symbol providers.",
    };
  }

  const safeRequest = createRemoteSafeModelRequest({
    goal: goalForCommand(command),
    evidence: latest.evidence,
    interactionStyle: "ask-first",
    context:
      sanitizeModelRequestContext({
        ...(requestContext.prompt.trim().length === 0
          ? {}
          : { userPrompt: requestContext.prompt }),
        ...(requestContext.symbol === undefined
          ? {}
          : { symbol: requestContext.symbol }),
      }) ?? {},
  });
  return {
    kind: "generate",
    uri: latest.uri,
    evidence: safeRequest.evidence,
    goal: safeRequest.goal,
    context: safeRequest.context ?? {},
  };
};

const goalForCommand = (
  command: string | undefined,
): string => {
  switch (command) {
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
    evidence: Evidence,
    signal: AbortSignal,
    context: ModelRequestContext,
  ): Promise<ModelResponse>;
}

export interface PairChatContextSource {
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
  readonly symbolContextProvider?: PairSymbolContextProvider;
  readonly sessionControl?: PairSessionControlPort;
  readonly requestLifecycle?: {
    register(uri: string, request: AbortController): PairDisposable;
  };
  readonly isOfficialCancellationError?: (error: unknown) => boolean;
}

export const registerPairChatParticipant = (
  register: (
    id: string,
    handler: vscode.ChatRequestHandler,
  ) => vscode.ChatParticipant,
  context: PairChatContextSource,
  generator: PairChatGenerator,
  options: PairChatParticipantOptions = {},
): vscode.ChatParticipant => {
  const symbolContextProvider =
    options.symbolContextProvider ?? NO_SYMBOL_CONTEXT;
  const handler: vscode.ChatRequestHandler = async (
    request,
    _chatContext,
    response,
    token,
  ) => {
    const abortController = new AbortController();
    let requestRegistration: PairDisposable | undefined;
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
          response.markdown(result.message);
        }
        return;
      }

      let snapshot = context.snapshot();
      if (
        snapshot.session.enabled &&
        snapshot.session.active &&
        snapshot.latest !== undefined
      ) {
        requestRegistration = options.requestLifecycle?.register(
          snapshot.latest.uri,
          abortController,
        );
        if (abortController.signal.aborted) {
          return;
        }
      }
      const symbol =
        request.command === "trace" &&
        snapshot.session.enabled &&
        snapshot.session.active &&
        snapshot.latest !== undefined
          ? await (async (): Promise<ModelSymbolContext | undefined> => {
              const traceGeneration = snapshot.session.generation;
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
                current.session.generation !== traceGeneration ||
                current.latest?.uri !== traceUri ||
                !pairRangesEqual(current.latest.evidence.range, traceRange)
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
      if (request.command === "trace" && symbol === undefined) {
        const current = context.snapshot();
        if (
          !current.session.enabled ||
          !current.session.active ||
          current.session.generation !== snapshot.session.generation ||
          current.latest?.uri !== snapshot.latest?.uri ||
          (current.latest !== undefined &&
            snapshot.latest !== undefined &&
            !pairRangesEqual(
              current.latest.evidence.range,
              snapshot.latest.evidence.range,
            ))
        ) {
          return;
        }
      }
      const plan = buildPairChatPlan(request.command, snapshot, {
        prompt: request.prompt,
        ...(symbol === undefined ? {} : { symbol }),
      });
      if (plan.kind === "message") {
        response.markdown(plan.markdown);
        return;
      }

      const generated = await generator.generate(
        plan.uri,
        plan.goal,
        plan.evidence,
        abortController.signal,
        plan.context,
      );
      const current = context.snapshot();
      if (
        abortController.signal.aborted ||
        !isCurrentGeneratedResponse(current, snapshot, plan)
      ) {
        return;
      }
      response.markdown(generated.text);
    } catch (error: unknown) {
      if (
        abortController.signal.aborted ||
        options.isOfficialCancellationError?.(error) === true
      ) {
        return;
      }
      if (!(error instanceof Error)) {
        throw error;
      }
      return {
        errorDetails: {
          message: `Adaptive Pair could not answer: ${error.message}`,
        },
      };
    } finally {
      requestRegistration?.dispose();
      cancellationListener.dispose();
    }
  };

  return register("adaptivePair.chat", handler);
};

const pairRangesEqual = (left: PairRange, right: PairRange): boolean =>
  left.start.line === right.start.line &&
  left.start.character === right.start.character &&
  left.end.line === right.end.line &&
  left.end.character === right.end.character;

const isCurrentGeneratedResponse = (
  current: PairContextSnapshot,
  started: PairContextSnapshot,
  plan: Extract<PairChatPlan, { readonly kind: "generate" }>,
): boolean =>
  current.session.enabled &&
  current.session.active &&
  current.session.generation === started.session.generation &&
  current.latest?.uri === plan.uri &&
  current.latest.evidence.id === plan.evidence.id &&
  pairRangesEqual(current.latest.evidence.range, plan.evidence.range);
