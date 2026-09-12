import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
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
  sendRequest(
    model: CopilotModelReference,
    prompt: string,
    cancellation: VsCodeRequestCancellation,
  ): PromiseLike<AsyncIterable<string>>;
}

export type CopilotUnavailableReason =
  | "no-model"
  | "consent-required"
  | "access-denied";

export class CopilotModelUnavailableError extends Error {
  public constructor(public readonly reason: CopilotUnavailableReason) {
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
    `Goal: ${request.goal}`,
    `Interaction style: ${request.interactionStyle}`,
    `Evidence kind: ${request.evidence.kind}`,
    `Severity: ${request.evidence.severity}`,
    `Title: ${request.evidence.title}`,
    `Detail: ${request.evidence.detail}`,
    `Source: ${request.evidence.source}`,
    `Confidence: ${request.evidence.confidence.toFixed(2)}`,
    `References: ${request.evidence.references.join(", ") || "none"}`,
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

      const models = await this.api.selectChatModels({ vendor: "copilot" });
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
      const stream = await this.api.sendRequest(model, prompt, cancellation);
      let text = "";
      for await (const fragment of stream) {
        signal.throwIfAborted();
        text += fragment;
      }

      if (text.trim().length === 0) {
        throw new CopilotModelResponseError();
      }

      return {
        text,
        inputTokens: estimateTokens(prompt),
        outputTokens: estimateTokens(text),
      };
    } finally {
      signal.removeEventListener("abort", cancelRequest);
      cancellation.dispose();
    }
  }
}

const estimateTokens = (text: string): number =>
  Math.max(1, Math.ceil(text.length / 4));
