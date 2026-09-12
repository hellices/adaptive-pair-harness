import type {
  ModelPreparationOptions,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  PreparedModelDispatch,
} from "../core/modelRouter";
import { ModelProviderTimeoutError } from "../core/modelRouter";
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

export interface VsCodeLanguageModelProviderOptions {
  readonly timeoutMs?: number;
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

export interface PreparedCopilotCandidates {
  next(
    previousUnavailable?: CopilotModelUnavailableError,
  ): Promise<PreparedModelDispatch>;
  dispose(): void;
}

export const buildCopilotPrompt = (request: ModelRequest): string =>
  [
    "You are an ask-first programming pair. Ask one concise question grounded only in the structured evidence.",
    buildStructuredModelPrompt(createRemoteSafeModelRequest(request)),
  ].join("\n");

const isCodePointBoundary = (text: string, index: number): boolean =>
  index <= 0 ||
  index >= text.length ||
  !(
    text.charCodeAt(index - 1) >= 0xd800 &&
    text.charCodeAt(index - 1) <= 0xdbff &&
    text.charCodeAt(index) >= 0xdc00 &&
    text.charCodeAt(index) <= 0xdfff
  );

const previousCodePointBoundary = (
  text: string,
  index: number,
): number =>
  isCodePointBoundary(text, index) ? index : index - 1;

const nextCodePointBoundary = (text: string, index: number): number =>
  isCodePointBoundary(text, index) ? index : index + 1;

const isHighSurrogate = (codeUnit: number): boolean =>
  codeUnit >= 0xd800 && codeUnit <= 0xdbff;

const isLowSurrogate = (codeUnit: number): boolean =>
  codeUnit >= 0xdc00 && codeUnit <= 0xdfff;

type DeadlineOutcome<T> =
  | { readonly kind: "value"; readonly value: T }
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "deadline" }
  | { readonly kind: "aborted" };

class CopilotProviderDeadline {
  private readonly timeout: ReturnType<typeof setTimeout>;
  private readonly deadlineReached: Promise<void>;
  private readonly callerAborted: Promise<void>;
  private readonly abortListener: () => void;
  private expired = false;

  public constructor(
    timeoutMs: number,
    private readonly signal: AbortSignal,
    onDeadline: () => void,
  ) {
    let announceDeadline!: () => void;
    this.deadlineReached = new Promise<void>((resolve) => {
      announceDeadline = resolve;
    });
    this.timeout = setTimeout(() => {
      this.expired = true;
      try {
        onDeadline();
      } finally {
        announceDeadline();
      }
    }, timeoutMs);

    let announceAbort!: () => void;
    this.callerAborted = new Promise<void>((resolve) => {
      announceAbort = resolve;
    });
    this.abortListener = announceAbort;
    if (signal.aborted) {
      announceAbort();
    } else {
      signal.addEventListener("abort", this.abortListener, { once: true });
    }
  }

  public throwIfExpired(requestDispatched: boolean): void {
    this.signal.throwIfAborted();
    if (this.expired) {
      throw new ModelProviderTimeoutError(
        "vscode-copilot",
        requestDispatched,
      );
    }
  }

  public isExpired(): boolean {
    return this.expired;
  }

  public async waitFor<T>(
    operation: () => T | PromiseLike<T>,
    requestDispatched: boolean,
  ): Promise<T> {
    this.throwIfExpired(requestDispatched);
    const operationOutcome = Promise.resolve()
      .then(operation)
      .then<DeadlineOutcome<T>, DeadlineOutcome<T>>(
        (value) => ({ kind: "value", value }),
        (error: unknown) => ({ kind: "error", error }),
      );
    const outcome = await Promise.race([
      operationOutcome,
      this.deadlineReached.then<DeadlineOutcome<T>>(() => ({
        kind: "deadline",
      })),
      this.callerAborted.then<DeadlineOutcome<T>>(() => ({
        kind: "aborted",
      })),
    ]);

    this.signal.throwIfAborted();
    if (this.expired || outcome.kind === "deadline") {
      throw new ModelProviderTimeoutError(
        "vscode-copilot",
        requestDispatched,
      );
    }
    if (outcome.kind === "error") {
      throw outcome.error;
    }
    if (outcome.kind === "aborted") {
      this.signal.throwIfAborted();
      throw new Error("Copilot request cancellation state is inconsistent.");
    }
    return outcome.value;
  }

  public dispose(): void {
    clearTimeout(this.timeout);
    this.signal.removeEventListener("abort", this.abortListener);
  }
}

export class VsCodeLanguageModelProvider implements ModelProvider {
  public readonly id = "vscode-copilot";
  private readonly timeoutMs: number;

  public constructor(
    private readonly api: VsCodeLanguageModelApi,
    options: VsCodeLanguageModelProviderOptions = {},
  ) {
    this.timeoutMs = normalizeTimeoutMs(options.timeoutMs ?? 15_000);
  }

  public async prepare(
    request: ModelRequest,
    signal: AbortSignal,
    options?: ModelPreparationOptions,
  ): Promise<PreparedModelDispatch> {
    return this.prepareInternal(
      request,
      signal,
      options?.userInitiated ?? false,
    );
  }

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
    const candidates = await this.prepareCandidates(
      request,
      signal,
      { userInitiated },
    );
    try {
      signal.throwIfAborted();
      let previousUnavailable: CopilotModelUnavailableError | undefined;
      for (;;) {
        const dispatch = await candidates.next(previousUnavailable);
        signal.throwIfAborted();
        previousUnavailable = undefined;
        try {
          const response = await dispatch.send();
          signal.throwIfAborted();
          return response;
        } catch (error: unknown) {
          if (!(error instanceof CopilotModelUnavailableError)) {
            throw error;
          }
          signal.throwIfAborted();
          previousUnavailable = error;
        }
      }
    } finally {
      candidates.dispose();
    }
  }

  private async prepareInternal(
    request: ModelRequest,
    signal: AbortSignal,
    userInitiated: boolean,
  ): Promise<PreparedModelDispatch> {
    const candidates = await this.prepareCandidates(
      request,
      signal,
      { userInitiated },
    );
    try {
      signal.throwIfAborted();
      const dispatch = await candidates.next();
      signal.throwIfAborted();
      return {
        inputTokens: dispatch.inputTokens,
        send: dispatch.send,
        dispose: candidates.dispose,
      };
    } catch (error: unknown) {
      candidates.dispose();
      throw error;
    }
  }

  public async prepareCandidates(
    request: ModelRequest,
    signal: AbortSignal,
    options: ModelPreparationOptions = {},
  ): Promise<PreparedCopilotCandidates> {
    const cancellation = this.api.createCancellationTokenSource();
    const cancelRequest = (): void => {
      cancellation.cancel();
    };
    signal.addEventListener("abort", cancelRequest, { once: true });
    const deadline = new CopilotProviderDeadline(
      this.timeoutMs,
      signal,
      cancelRequest,
    );
    let disposed = false;
    const dispose = (): void => {
      if (disposed) {
        return;
      }
      disposed = true;
      deadline.dispose();
      signal.removeEventListener("abort", cancelRequest);
      cancellation.dispose();
    };

    try {
      if (signal.aborted) {
        cancelRequest();
        signal.throwIfAborted();
      }

      const models = await this.callAndMapUnavailable(
        () => this.api.selectChatModels({ vendor: "copilot" }),
        false,
        signal,
        deadline,
      );
      signal.throwIfAborted();
      const prompt = buildCopilotPrompt(request);
      const maxOutputTokens = normalizeTokenCount(
        request.maxOutputTokens ?? 180,
      );
      let candidateIndex = 0;
      let lastUnavailable: CopilotModelUnavailableError | undefined;
      return {
        next: async (previousUnavailable) => {
          if (previousUnavailable !== undefined) {
            lastUnavailable = previousUnavailable;
          }
          while (candidateIndex < models.length) {
            signal.throwIfAborted();
            const model = models[candidateIndex];
            candidateIndex += 1;
            if (model === undefined) {
              continue;
            }

            const access = this.api.canSendRequest(model);
            if (
              access === false ||
              (options.userInitiated !== true && access !== true)
            ) {
              lastUnavailable = new CopilotModelUnavailableError(
                access === false ? "access-denied" : "consent-required",
              );
              continue;
            }

            let inputTokens: number;
            try {
              inputTokens = normalizeTokenCount(
                await this.callAndMapUnavailable(
                  () => this.api.countTokens(model, prompt, cancellation),
                  false,
                  signal,
                  deadline,
                ),
              );
            } catch (error: unknown) {
              signal.throwIfAborted();
              if (!(error instanceof CopilotModelUnavailableError)) {
                throw error;
              }
              lastUnavailable = error;
              continue;
            }
            signal.throwIfAborted();
            return {
              inputTokens,
              send: () =>
                this.sendPrepared(
                  model,
                  prompt,
                  maxOutputTokens,
                  inputTokens,
                  signal,
                  cancellation,
                  deadline,
                ),
              dispose: () => undefined,
            };
          }
          throw (
            lastUnavailable ?? new CopilotModelUnavailableError("no-model")
          );
        },
        dispose,
      };
    } catch (error: unknown) {
      dispose();
      throw error;
    }
  }

  private async sendPrepared(
    model: CopilotModelReference,
    prompt: string,
    maxOutputTokens: number,
    inputTokens: number,
    signal: AbortSignal,
    cancellation: VsCodeRequestCancellation,
    deadline: CopilotProviderDeadline,
  ): Promise<ModelResponse> {
    signal.throwIfAborted();
    deadline.throwIfExpired(false);
    const text = await this.callAndMapUnavailable(
      async () => {
        const stream = await deadline.waitFor(
          () =>
            this.api.sendRequest(
              model,
              prompt,
              cancellation,
              maxOutputTokens,
            ),
          true,
        );
        signal.throwIfAborted();
        let streamedText = "";
        let observedOutputTokens = 0;
        let bufferedHighSurrogate: string | undefined;
        const iterator = stream[Symbol.asyncIterator]();
        let streamCompleted = false;
        try {
          for (;;) {
            const iteration = await deadline.waitFor(
              () => iterator.next(),
              true,
            );
            signal.throwIfAborted();
            if (iteration.done === true) {
              streamCompleted = true;
              break;
            }
            const streamedFragment = iteration.value;
            if (streamedFragment.length === 0) {
              continue;
            }
            let fragment = streamedFragment;
            if (bufferedHighSurrogate !== undefined) {
              if (isLowSurrogate(fragment.charCodeAt(0))) {
                fragment = bufferedHighSurrogate + fragment;
              }
              bufferedHighSurrogate = undefined;
            }
            if (isHighSurrogate(fragment.charCodeAt(fragment.length - 1))) {
              bufferedHighSurrogate = fragment.slice(-1);
              fragment = fragment.slice(0, -1);
            }
            if (fragment.length === 0) {
              continue;
            }
            const candidate = streamedText + fragment;
            const countedCandidateTokens = await deadline.waitFor(
              () => this.api.countTokens(model, candidate, cancellation),
              true,
            );
            signal.throwIfAborted();
            const candidateTokens = normalizeTokenCount(
              countedCandidateTokens,
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

            streamedText += await this.longestFittingFragmentPrefix(
              model,
              streamedText,
              fragment,
              maxOutputTokens,
              signal,
              cancellation,
              deadline,
            );
            cancellation.cancel();
            break;
          }
        } finally {
          if (!streamCompleted && iterator.return !== undefined) {
            if (signal.aborted || deadline.isExpired()) {
              observeLateSettlement(() => iterator.return!());
            } else {
              await deadline.waitFor(() => iterator.return!(), true);
            }
          }
        }
        signal.throwIfAborted();
        return { streamedText, observedOutputTokens };
      },
      true,
      signal,
      deadline,
    );

    if (text.streamedText.trim().length === 0) {
      throw new CopilotModelResponseError();
    }

    signal.throwIfAborted();
    return {
      text: text.streamedText,
      inputTokens,
      outputTokens: text.observedOutputTokens,
    };
  }

  private async longestFittingFragmentPrefix(
    model: CopilotModelReference,
    streamedText: string,
    fragment: string,
    maxOutputTokens: number,
    signal: AbortSignal,
    cancellation: VsCodeRequestCancellation,
    deadline: CopilotProviderDeadline,
  ): Promise<string> {
    let fittingLength = 0;
    let failingLength = fragment.length;
    while (fittingLength < failingLength) {
      let probeLength = previousCodePointBoundary(
        fragment,
        Math.floor((fittingLength + failingLength) / 2),
      );
      if (probeLength <= fittingLength) {
        probeLength = nextCodePointBoundary(
          fragment,
          fittingLength + 1,
        );
      }
      if (probeLength >= failingLength) {
        break;
      }

      const countedPrefixTokens = await deadline.waitFor(
        () =>
          this.api.countTokens(
            model,
            streamedText + fragment.slice(0, probeLength),
            cancellation,
          ),
        true,
      );
      signal.throwIfAborted();
      const prefixTokens = normalizeTokenCount(countedPrefixTokens);
      if (prefixTokens <= maxOutputTokens) {
        fittingLength = probeLength;
      } else {
        failingLength = probeLength;
      }
    }
    return fragment.slice(0, fittingLength);
  }

  private async callAndMapUnavailable<T>(
    operation: () => PromiseLike<T>,
    requestMayHaveBeenSent: boolean,
    signal: AbortSignal,
    deadline: CopilotProviderDeadline,
  ): Promise<T> {
    let result: T;
    try {
      result = await deadline.waitFor(operation, requestMayHaveBeenSent);
    } catch (error: unknown) {
      signal.throwIfAborted();
      if (error instanceof ModelProviderTimeoutError) {
        throw error;
      }
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
    signal.throwIfAborted();
    return result;
  }
}

export const releaseUnusedCopilotReservation = (
  budget: TokenBudget,
  reservationId: TokenBudgetReservationId,
  error: unknown,
): boolean =>
  ((error instanceof CopilotModelUnavailableError &&
    !error.requestMayHaveBeenSent) ||
    (error instanceof ModelProviderTimeoutError &&
      !error.requestDispatched)) &&
  budget.release(reservationId);

const observeLateSettlement = (
  operation: () => unknown | PromiseLike<unknown>,
): void => {
  try {
    void Promise.resolve(operation()).catch(() => undefined);
  } catch {
    // Best-effort stream cleanup must not replace the primary failure.
  }
};

const normalizeTimeoutMs = (timeoutMs: number): number => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("GitHub Copilot provider timeout must be positive.");
  }
  return Math.ceil(timeoutMs);
};

const normalizeTokenCount = (tokens: number): number => {
  if (!Number.isFinite(tokens) || tokens < 0) {
    throw new Error("GitHub Copilot returned an invalid token count.");
  }
  return Math.max(1, Math.ceil(tokens));
};
