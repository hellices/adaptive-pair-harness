import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../core/modelRouter";
import type {
  TokenBudget,
  TokenBudgetReservationId,
} from "../core/tokenBudget";
import {
  buildStructuredModelPrompt,
  createRemoteSafeModelRequest,
} from "../core/modelRouter";

export interface CopilotModelReference {
  readonly id: string;
  readonly name: string;
}

export interface VsCodeRequestCancellation {
  cancel(): void;
  dispose(): void;
}

export interface VsCodeLanguageModelApi {
  selectChatModels(
    selector: { readonly vendor: "copilot" },
  ): PromiseLike<readonly CopilotModelReference[]>;
  canSendRequest(model: CopilotModelReference): boolean | undefined;
  createCancellationTokenSource(): VsCodeRequestCancellation;
  classifyError(error: unknown): VsCodeLanguageModelErrorKind;
  countTokens(
    model: CopilotModelReference,
    text: string,
    cancellation: VsCodeRequestCancellation,
  ): PromiseLike<number>;
  sendRequest(
    model: CopilotModelReference,
    prompt: string,
    cancellation: VsCodeRequestCancellation,
    maxOutputTokens: number,
  ): PromiseLike<AsyncIterable<string>>;
}

export type VsCodeLanguageModelErrorKind =
  | "no-permissions"
  | "not-found"
  | "blocked"
  | "cancelled"
  | "unknown";

export type CopilotUnavailableReason =
  | "no-model"
  | "consent-required"
  | "access-denied";

export class CopilotModelUnavailableError extends Error {
  public constructor(
    public readonly reason: CopilotUnavailableReason,
    public readonly requestMayHaveBeenSent = false,
  ) {
    super(`GitHub Copilot model unavailable: ${reason}`);
    this.name = "CopilotModelUnavailableError";
  }
}

export class CopilotModelResponseError extends Error {
  public constructor() {
    super("GitHub Copilot returned an empty response.");
    this.name = "CopilotModelResponseError";
  }
}

export const buildCopilotPrompt = (request: ModelRequest): string =>
  [
    "You are an ask-first programming pair. Ask one concise question grounded only in the structured evidence.",
    buildStructuredModelPrompt(createRemoteSafeModelRequest(request)),
  ].join("\n");

export class VsCodeLanguageModelProvider implements ModelProvider {
  public readonly id = "vscode-copilot";

  public constructor(private readonly api: VsCodeLanguageModelApi) {}

  public async generate(
    request: ModelRequest,
    signal: AbortSignal,
  ): Promise<ModelResponse> {
    return this.generateInternal(request, signal, false);
  }

  public async generateFromUserAction(
    request: ModelRequest,
    signal: AbortSignal,
  ): Promise<ModelResponse> {
    return this.generateInternal(request, signal, true);
  }

  private async generateInternal(
    request: ModelRequest,
    signal: AbortSignal,
    userInitiated: boolean,
  ): Promise<ModelResponse> {
    const cancellation = this.api.createCancellationTokenSource();
    const cancelRequest = (): void => {
      cancellation.cancel();
    };
    signal.addEventListener("abort", cancelRequest, { once: true });

    try {
      if (signal.aborted) {
        cancelRequest();
        signal.throwIfAborted();
      }

      const models = await this.callAndMapUnavailable(
        () => this.api.selectChatModels({ vendor: "copilot" }),
        false,
      );
      signal.throwIfAborted();
      const model = models[0];
      if (model === undefined) {
        throw new CopilotModelUnavailableError("no-model");
      }

      const access = this.api.canSendRequest(model);
      if (!userInitiated && access !== true) {
        throw new CopilotModelUnavailableError(
          access === false ? "access-denied" : "consent-required",
        );
      }

      const prompt = buildCopilotPrompt(request);
      const maxOutputTokens = normalizeTokenCount(
        request.maxOutputTokens ?? 180,
      );
      const inputTokens = normalizeTokenCount(
        await this.callAndMapUnavailable(
          () => this.api.countTokens(model, prompt, cancellation),
          false,
        ),
      );
      const text = await this.callAndMapUnavailable(
        async () => {
          const stream = await this.api.sendRequest(
            model,
            prompt,
            cancellation,
            maxOutputTokens,
          );
          let streamedText = "";
          let observedOutputTokens = 0;
          for await (const fragment of stream) {
            signal.throwIfAborted();
            if (fragment.length === 0) {
              continue;
            }
            const candidate = streamedText + fragment;
            const candidateTokens = normalizeTokenCount(
              await this.api.countTokens(model, candidate, cancellation),
            );
            observedOutputTokens = Math.max(
              observedOutputTokens,
              candidateTokens,
            );
            if (candidateTokens <= maxOutputTokens) {
              streamedText = candidate;
              if (candidateTokens === maxOutputTokens) {
                cancellation.cancel();
                break;
              }
              continue;
            }

            for (const character of fragment) {
              const prefixCandidate = streamedText + character;
              const prefixTokens = normalizeTokenCount(
                await this.api.countTokens(
                  model,
                  prefixCandidate,
                  cancellation,
                ),
              );
              if (prefixTokens > maxOutputTokens) {
                break;
              }
              streamedText = prefixCandidate;
            }
            cancellation.cancel();
            break;
          }
          return { streamedText, observedOutputTokens };
        },
        true,
      );

      if (text.streamedText.trim().length === 0) {
        throw new CopilotModelResponseError();
      }

      return {
        text: text.streamedText,
        inputTokens,
        outputTokens: text.observedOutputTokens,
      };
    } finally {
      signal.removeEventListener("abort", cancelRequest);
      cancellation.dispose();
    }
  }

  private async callAndMapUnavailable<T>(
    operation: () => PromiseLike<T>,
    requestMayHaveBeenSent: boolean,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      switch (this.api.classifyError(error)) {
        case "no-permissions":
          throw new CopilotModelUnavailableError(
            "access-denied",
            requestMayHaveBeenSent,
          );
        case "not-found":
          throw new CopilotModelUnavailableError(
            "no-model",
            requestMayHaveBeenSent,
          );
        case "blocked":
        case "cancelled":
        case "unknown":
          throw error;
      }
    }
  }
}

export const releaseUnusedCopilotReservation = (
  budget: TokenBudget,
  reservationId: TokenBudgetReservationId,
  error: unknown,
): boolean =>
  error instanceof CopilotModelUnavailableError &&
  !error.requestMayHaveBeenSent &&
  budget.release(reservationId);

const normalizeTokenCount = (tokens: number): number => {
  if (!Number.isFinite(tokens) || tokens < 0) {
    throw new Error("GitHub Copilot returned an invalid token count.");
  }
  return Math.max(1, Math.ceil(tokens));
};
