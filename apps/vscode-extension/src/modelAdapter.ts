import * as vscode from "vscode";
import type { CompiledInstructionEnvelope, PairToolView } from "@adaptive-pair/harness";
import { GrowthModelFailure, type GrowthModel, type GrowthModelOutput, type PairCoordinatorPort } from "@adaptive-pair/runtime";
import { buildInitialMessages, messageText, parseEnvelope, serializeToolCall } from "./growthModelMessages.js";
import { GrowthModelToolRunner, toGrowthChatTools, type ConfirmGrowthToolAction } from "./growthModelTools.js";

export {
  GrowthModelFailure,
  isGrowthModelResult,
  type GrowthModel,
  type GrowthModelFailureCode,
  type GrowthModelOutput,
  type GrowthModelResult,
  type GrowthRuntimeBoundary,
} from "@adaptive-pair/runtime";
export { authorizedHintLevelFor } from "./growthModelMessages.js";
export { toGrowthChatTools, type ConfirmGrowthToolAction } from "./growthModelTools.js";

export interface GrowthTurnCaps {
  readonly maxModelCalls: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly deadlineMs: number;
}

export const GROWTH_TURN_CAPS: GrowthTurnCaps = Object.freeze({
  maxModelCalls: 4,
  maxInputTokens: 20_000,
  maxOutputTokens: 1_200,
  deadlineMs: 60_000,
});

const tokenFromSignal = (signal: AbortSignal): vscode.CancellationToken => {
  const token: vscode.CancellationToken = {
    get isCancellationRequested(): boolean {
      return signal.aborted;
    },
    onCancellationRequested: (listener: (event: unknown) => unknown) => {
      if (signal.aborted) {
        queueMicrotask(() => listener(undefined));
        return { dispose: () => undefined };
      }
      const handler = (): void => {
        listener(undefined);
      };
      signal.addEventListener("abort", handler, { once: true });
      return {
        dispose: () => signal.removeEventListener("abort", handler),
      };
    },
  };
  return token;
};

class VscodeGrowthModel implements GrowthModel {
  private readonly toolRunner: GrowthModelToolRunner;

  public constructor(
    private readonly model: vscode.LanguageModelChat,
    coordinator: PairCoordinatorPort,
    private readonly caps: GrowthTurnCaps,
    private readonly now: () => number,
    confirmToolAction: ConfirmGrowthToolAction,
  ) {
    this.toolRunner = new GrowthModelToolRunner(
      coordinator,
      confirmToolAction,
      (signal, deadline) => this.ensureLive(signal, deadline),
    );
  }

  public async request(
    instructions: CompiledInstructionEnvelope,
    tools: PairToolView,
    signal: AbortSignal,
  ): Promise<GrowthModelOutput> {
    this.ensureLive(signal, Number.POSITIVE_INFINITY);

    const deadline = this.now() + this.caps.deadlineMs;
    const chatTools = toGrowthChatTools(tools);
    const messages = buildInitialMessages(instructions);
    let runtime = await this.toolRunner.captureRuntime(
      tools.runtimeRevision,
      tools.authorityEpoch,
    );

    const derived = new AbortController();
    const relayAbort = (): void => derived.abort();
    if (signal.aborted) {
      derived.abort();
    } else {
      signal.addEventListener("abort", relayAbort, { once: true });
    }
    const timer = setTimeout(
      () => derived.abort(),
      Math.max(0, deadline - this.now()),
    );
    const token = tokenFromSignal(derived.signal);

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    try {
      for (let call = 0; call < this.caps.maxModelCalls; call += 1) {
        this.ensureLive(signal, deadline);
        runtime = await this.toolRunner.captureRuntime(
          runtime.runtimeRevision,
          runtime.authorityEpoch,
        );

        totalInputTokens += await this.countInput(messages, token);
        if (totalInputTokens > this.caps.maxInputTokens) {
          throw new GrowthModelFailure("GROWTH_INPUT_TOKEN_CAP");
        }

        const response = await this.dispatch(messages, chatTools, token, signal, deadline);
        const { text, toolCalls } = await this.consume(
          response,
          signal,
          deadline,
        );

        if (text.length > 0) {
          totalOutputTokens += await this.model.countTokens(text, token);
          if (totalOutputTokens > this.caps.maxOutputTokens) {
            throw new GrowthModelFailure("GROWTH_OUTPUT_TOKEN_CAP");
          }
        }

        if (toolCalls.length > 0) {
          // Tool-call names and serialized arguments are model-generated output
          // and count toward the same output budget as text. Account for them
          // through the model's own token boundary before executing anything,
          // and reject an over-budget turn without invoking any tool.
          for (const toolCall of toolCalls) {
            totalOutputTokens += await this.model.countTokens(
              serializeToolCall(toolCall),
              token,
            );
            if (totalOutputTokens > this.caps.maxOutputTokens) {
              throw new GrowthModelFailure("GROWTH_OUTPUT_TOKEN_CAP");
            }
          }
          runtime = await this.toolRunner.appendToolResults(
            messages,
            toolCalls,
            tools,
            runtime,
            derived.signal,
            deadline,
          );
          continue;
        }

        return Object.freeze({
          response: parseEnvelope(text),
          runtime,
        });
      }

      throw new GrowthModelFailure("GROWTH_MODEL_CALL_CAP");
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", relayAbort);
    }
  }

  private ensureLive(signal: AbortSignal, deadline: number): void {
    if (this.now() >= deadline) {
      throw new GrowthModelFailure("GROWTH_TIME_CAP");
    }
    if (signal.aborted) {
      throw new GrowthModelFailure("GROWTH_CANCELLED");
    }
  }

  private async countInput(
    messages: readonly vscode.LanguageModelChatMessage[],
    token: vscode.CancellationToken,
  ): Promise<number> {
    let total = 0;
    for (const message of messages) {
      total += await this.model.countTokens(messageText(message), token);
    }
    return total;
  }

  private async dispatch(
    messages: vscode.LanguageModelChatMessage[],
    tools: vscode.LanguageModelChatTool[],
    token: vscode.CancellationToken,
    signal: AbortSignal,
    deadline: number,
  ): Promise<vscode.LanguageModelChatResponse> {
    try {
      return await this.model.sendRequest(
        messages,
        {
          justification:
            "Adaptive Pair Growth Mode returns a bounded, restraint-checked hint.",
          tools,
          toolMode: vscode.LanguageModelChatToolMode.Auto,
        },
        token,
      );
    } catch (error) {
      this.rethrowLifecycle(error, signal, deadline);
      throw new GrowthModelFailure(
        "GROWTH_MODEL_ERROR",
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  private async consume(
    response: vscode.LanguageModelChatResponse,
    signal: AbortSignal,
    deadline: number,
  ): Promise<{
    readonly text: string;
    readonly toolCalls: vscode.LanguageModelToolCallPart[];
  }> {
    const chunks: string[] = [];
    const toolCalls: vscode.LanguageModelToolCallPart[] = [];
    try {
      for await (const part of response.stream) {
        this.ensureLive(signal, deadline);
        if (part instanceof vscode.LanguageModelTextPart) {
          chunks.push(part.value);
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          toolCalls.push(part);
        }
      }
    } catch (error) {
      this.rethrowLifecycle(error, signal, deadline);
      throw new GrowthModelFailure(
        "GROWTH_MODEL_ERROR",
        error instanceof Error ? error.message : undefined,
      );
    }

    return { text: chunks.join(""), toolCalls };
  }

  private rethrowLifecycle(
    error: unknown,
    signal: AbortSignal,
    deadline: number,
  ): void {
    if (error instanceof GrowthModelFailure) {
      throw error;
    }
    if (this.now() >= deadline) {
      throw new GrowthModelFailure("GROWTH_TIME_CAP");
    }
    if (signal.aborted) {
      throw new GrowthModelFailure("GROWTH_CANCELLED");
    }
  }
}

export const createGrowthModel = (
  model: vscode.LanguageModelChat,
  coordinator: PairCoordinatorPort,
  options: {
    readonly caps?: GrowthTurnCaps;
    readonly now?: () => number;
    readonly confirmToolAction?: ConfirmGrowthToolAction;
  } = {},
): GrowthModel =>
  new VscodeGrowthModel(
    model,
    coordinator,
    options.caps ?? GROWTH_TURN_CAPS,
    options.now ?? (() => Date.now()),
    options.confirmToolAction ?? (() => Promise.resolve(false)),
  );
