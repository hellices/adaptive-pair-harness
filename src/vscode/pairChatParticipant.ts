import type * as vscode from "vscode";
import type { PairProvider } from "../config/pairConfig";
import type { ModelResponse } from "../core/modelRouter";
import type { Evidence } from "../core/types";

export interface PairSessionSnapshot {
  readonly goal: string;
  readonly role: "navigator";
  readonly provider: PairProvider;
  readonly remainingCalls: number;
  readonly remainingInputTokens: number;
  readonly controlNotice: string | undefined;
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
      readonly goal: string;
      readonly evidence: Evidence;
    };

export const buildPairChatPlan = (
  command: string | undefined,
  context: PairContextSnapshot,
): PairChatPlan => {
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

  return {
    kind: "generate",
    evidence: latest.evidence,
    goal: goalForCommand(command, latest),
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
    goal: string,
    evidence: Evidence,
    signal: AbortSignal,
  ): Promise<ModelResponse>;
}

export const registerPairChatParticipant = (
  register: (
    id: string,
    handler: vscode.ChatRequestHandler,
  ) => vscode.ChatParticipant,
  context: PairSharedContext,
  generator: PairChatGenerator,
): vscode.ChatParticipant => {
  const handler: vscode.ChatRequestHandler = async (
    request,
    _chatContext,
    response,
    token,
  ) => {
    const plan = buildPairChatPlan(request.command, context.snapshot());
    if (plan.kind === "message") {
      response.markdown(plan.markdown);
      return;
    }

    const abortController = new AbortController();
    if (token.isCancellationRequested) {
      abortController.abort();
    }
    const cancellationListener = token.onCancellationRequested(() => {
      abortController.abort();
    });
    try {
      const generated = await generator.generate(
        plan.goal,
        plan.evidence,
        abortController.signal,
      );
      response.markdown(generated.text);
    } catch (error: unknown) {
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
