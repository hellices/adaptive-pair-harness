import type { Evidence } from "./types";

export interface ModelRequest {
  readonly goal: string;
  readonly evidence: Evidence;
  readonly interactionStyle: "ask-first";
}

export interface ModelResponse {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ModelProvider {
  readonly id: string;
  generate(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
}

export interface OpenAICompatibleProviderConfig {
  readonly baseUrl: URL;
  readonly model: string;
  readonly fetch: typeof fetch;
  readonly apiKey?: string;
}

interface OpenAICompatiblePromptPayload {
  readonly messages: ReadonlyArray<{
    readonly role: "system" | "user";
    readonly content: string;
  }>;
  readonly stream: false;
}

interface ChatCompletionRequestBody extends OpenAICompatiblePromptPayload {
  readonly model: string;
}

interface OpenAICompatibleSuccessPayload {
  readonly choices: ReadonlyArray<{
    readonly message: {
      readonly content: string;
    };
  }>;
  readonly usage: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
  };
}

export class ModelRouter {
  private readonly providersById: ReadonlyMap<string, ModelProvider>;

  public constructor(providers: readonly ModelProvider[]) {
    this.providersById = new Map(providers.map((provider) => [provider.id, provider]));
  }

  public async generate(
    providerId: string,
    request: ModelRequest,
    signal: AbortSignal,
  ): Promise<ModelResponse> {
    const provider = this.providersById.get(providerId);
    if (provider === undefined) {
      throw new Error(`Unknown model provider: ${providerId}`);
    }

    return provider.generate(request, signal);
  }
}

export class LocalTemplateProvider implements ModelProvider {
  public readonly id = "local-template";

  public async generate(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    signal.throwIfAborted();

    return {
      text: createLocalInterventionQuestion(request.evidence),
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}

export class OpenAICompatibleProvider implements ModelProvider {
  public readonly id = "openai-compatible";
  private readonly endpoint: string;

  public constructor(private readonly config: OpenAICompatibleProviderConfig) {
    this.endpoint = joinUrl(config.baseUrl, "chat/completions");
  }

  public async generate(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    signal.throwIfAborted();

    const response = await this.config.fetch(this.endpoint, {
      method: "POST",
      headers: buildHeaders(this.config.apiKey),
      body: JSON.stringify(buildRequestBody(this.config.model, request)),
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI-compatible provider returned ${response.status} ${response.statusText}`.trim(),
      );
    }

    const payload = await parseSuccessPayload(response);

    const firstChoice = payload.choices[0];
    if (firstChoice === undefined) {
      throw new Error("OpenAI-compatible provider returned an invalid payload.");
    }

    return {
      text: firstChoice.message.content,
      inputTokens: payload.usage.prompt_tokens,
      outputTokens: payload.usage.completion_tokens,
    };
  }
}

export const createLocalInterventionQuestion = (evidence: Evidence): string =>
  `${evidence.title}: ${evidence.detail} Did you intend this change?`;

export const buildOpenAICompatiblePromptPayload = (
  request: ModelRequest,
): OpenAICompatiblePromptPayload => ({
  messages: [
    {
      role: "system",
      content:
        "You are an ask-first programming pair. Ask one concise question grounded only in the provided evidence.",
    },
    {
      role: "user",
      content: [
        `Goal: ${request.goal}`,
        `Interaction style: ${request.interactionStyle}`,
        `Evidence kind: ${request.evidence.kind}`,
        `Severity: ${request.evidence.severity}`,
        `Title: ${request.evidence.title}`,
        `Detail: ${request.evidence.detail}`,
        `Source: ${request.evidence.source}`,
        `Confidence: ${request.evidence.confidence.toFixed(2)}`,
        `References: ${request.evidence.references.join(", ") || "none"}`,
      ].join("\n"),
    },
  ],
  stream: false,
});

export const estimateOpenAICompatibleInputTokens = (request: ModelRequest): number =>
  estimateSerializedTokens(JSON.stringify(buildOpenAICompatiblePromptPayload(request)));

const buildHeaders = (apiKey: string | undefined): HeadersInit => {
  if (apiKey === undefined) {
    return {
      "content-type": "application/json",
    };
  }

  return {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };
};

const buildRequestBody = (model: string, request: ModelRequest): ChatCompletionRequestBody => ({
  model,
  ...buildOpenAICompatiblePromptPayload(request),
});

const estimateSerializedTokens = (serializedPayload: string): number =>
  Math.max(1, Math.ceil(serializedPayload.length / 4));

const joinUrl = (baseUrl: URL, path: string): string => {
  const baseHref = baseUrl.href.endsWith("/") ? baseUrl.href : `${baseUrl.href}/`;
  return new URL(path, baseHref).toString();
};

const parseSuccessPayload = async (response: Response): Promise<OpenAICompatibleSuccessPayload> => {
  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new Error("OpenAI-compatible provider returned an invalid payload.");
  }

  if (!isOpenAICompatibleSuccessPayload(payload)) {
    throw new Error("OpenAI-compatible provider returned an invalid payload.");
  }

  return payload;
};

const isOpenAICompatibleSuccessPayload = (
  payload: unknown,
): payload is OpenAICompatibleSuccessPayload => {
  if (!isRecord(payload)) {
    return false;
  }

  const { choices, usage } = payload;
  if (!Array.isArray(choices) || choices.length === 0 || !isRecord(usage)) {
    return false;
  }

  const firstChoice = choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    return false;
  }

  return (
    typeof firstChoice.message.content === "string" &&
    typeof usage.prompt_tokens === "number" &&
    typeof usage.completion_tokens === "number"
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
