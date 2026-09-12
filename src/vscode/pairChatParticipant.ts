import type * as vscode from "vscode";
import type { PairProvider } from "../config/pairConfig";
import {
  sanitizeModelRequestContext,
  type ModelRequestContext,
  type ModelResponse,
  type ModelSymbolContext,
} from "../core/modelRouter";
import type { Evidence } from "../core/types";

export interface PairSessionSnapshot {
  readonly enabled: boolean;
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

  public constructor(private session: PairSessionSnapshot) {}

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

  return {
    kind: "generate",
    uri: latest.uri,
    evidence: latest.evidence,
    goal: goalForCommand(command, latest),
    context:
      sanitizeModelRequestContext({
        ...(requestContext.prompt.trim().length === 0
          ? {}
          : { userPrompt: requestContext.prompt }),
        ...(requestContext.symbol === undefined
          ? {}
          : { symbol: requestContext.symbol }),
      }) ?? {},
  };
};

const goalForCommand = (
  command: string | undefined,
  latest: PairPublishedEvidence,
): string => {
  switch (command) {
    case "trace":
      return "Describe the relevant control and data flow for this evidence without inventing code context.";
    case "why":
      return `Expand why the latest inline question matters: ${latest.question}`;
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
  current(signal: AbortSignal): Promise<ModelSymbolContext | undefined>;
}

const NO_SYMBOL_CONTEXT: PairSymbolContextProvider = {
  current: async () => undefined,
};

export const registerPairChatParticipant = (
  register: (
    id: string,
    handler: vscode.ChatRequestHandler,
  ) => vscode.ChatParticipant,
  context: PairChatContextSource,
  generator: PairChatGenerator,
  symbolContextProvider: PairSymbolContextProvider = NO_SYMBOL_CONTEXT,
): vscode.ChatParticipant => {
  const handler: vscode.ChatRequestHandler = async (
    request,
    _chatContext,
    response,
    token,
  ) => {
    const abortController = new AbortController();
    if (token.isCancellationRequested) {
      abortController.abort();
    }
    const cancellationListener = token.onCancellationRequested(() => {
      abortController.abort();
    });
    try {
      const snapshot = context.snapshot();
      const symbol =
        request.command === "trace" &&
        snapshot.session.enabled &&
        snapshot.latest !== undefined
          ? await symbolContextProvider.current(abortController.signal)
          : undefined;
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
      response.markdown(generated.text);
    } catch (error: unknown) {
      if (abortController.signal.aborted || isCancellationErrorLike(error)) {
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
      cancellationListener.dispose();
    }
  };

  return register("adaptivePair.chat", handler);
};

const isCancellationErrorLike = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === "AbortError" ||
    error.name === "Canceled" ||
    error.name === "CancellationError");
