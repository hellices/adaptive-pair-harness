import type { Evidence, PairRange } from "./types";

export interface ModelSymbolContext {
  readonly name: string;
  readonly kind: string;
  readonly range: PairRange;
}

export interface ModelRequestContext {
  readonly userPrompt?: string;
  readonly symbol?: ModelSymbolContext;
}

export interface ModelRequest {
  readonly goal: string;
  readonly evidence: Evidence;
  readonly interactionStyle: "ask-first";
  readonly context?: ModelRequestContext;
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
    const requestBody = buildOpenAICompatibleRequestBody(this.config.model, request);

    const response = await this.config.fetch(this.endpoint, {
      method: "POST",
      headers: buildHeaders(this.config.apiKey),
      body: JSON.stringify(requestBody),
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
): OpenAICompatiblePromptPayload => {
  const safeRequest = createRemoteSafeModelRequest(request);

  return {
    messages: [
      {
        role: "system",
        content:
          "You are an ask-first programming pair. Ask one concise question grounded only in the provided evidence.",
      },
      {
        role: "user",
        content: buildStructuredModelPrompt(safeRequest),
      },
    ],
    stream: false,
  };
};

export const createRemoteSafeModelRequest = (
  request: ModelRequest,
): ModelRequest => {
  const context = sanitizeModelRequestContext(request.context);
  return {
    goal: boundSingleLine(request.goal, 600),
    evidence:
      request.evidence.kind === "diagnostic"
        ? sanitizeDiagnosticEvidence(request.evidence)
        : sanitizeGeneralEvidence(request.evidence),
    interactionStyle: request.interactionStyle,
    ...(context === undefined ? {} : { context }),
  };
};

export const sanitizeModelRequestContext = (
  context: ModelRequestContext | undefined,
): ModelRequestContext | undefined => {
  if (context === undefined) {
    return undefined;
  }

  const userPrompt =
    context.userPrompt === undefined
      ? undefined
      : boundSingleLine(context.userPrompt, 500);
  const symbol =
    context.symbol === undefined
      ? undefined
      : {
          name: boundSingleLine(context.symbol.name, 120),
          kind: boundSingleLine(context.symbol.kind, 60),
          range: context.symbol.range,
        };
  if (userPrompt === undefined && symbol === undefined) {
    return undefined;
  }

  return {
    ...(userPrompt === undefined ? {} : { userPrompt }),
    ...(symbol === undefined ? {} : { symbol }),
  };
};

export const buildStructuredModelPrompt = (request: ModelRequest): string => {
  const lines = [
    `Goal: ${request.goal}`,
    `Interaction style: ${request.interactionStyle}`,
    `Evidence kind: ${request.evidence.kind}`,
    `Severity: ${request.evidence.severity}`,
    `Title: ${request.evidence.title}`,
    `Detail: ${request.evidence.detail}`,
    `Source: ${request.evidence.source}`,
    `Confidence: ${request.evidence.confidence.toFixed(2)}`,
    `Range: ${formatRange(request.evidence.range)}`,
    `References: ${request.evidence.references.join(", ") || "none"}`,
  ];
  if (request.evidence.kind === "diagnostic") {
    lines.push(
      `Diagnostic code: ${request.evidence.references.join(", ") || "none"}`,
    );
  }
  if (request.context?.userPrompt !== undefined) {
    lines.push(`User prompt: ${request.context.userPrompt}`);
  }
  if (request.context?.symbol !== undefined) {
    lines.push(
      `Current symbol: ${request.context.symbol.name} (${request.context.symbol.kind})`,
      `Symbol range: ${formatRange(request.context.symbol.range)}`,
    );
  }
  return lines.join("\n");
};

export const buildOpenAICompatibleRequestBody = (
  model: string,
  request: ModelRequest,
): ChatCompletionRequestBody => ({
  model,
  ...buildOpenAICompatiblePromptPayload(request),
});

export const estimateOpenAICompatibleInputTokens = (
  requestOrBody: ModelRequest | ChatCompletionRequestBody,
  model?: string,
): number => {
  const requestBody = isOpenAICompatibleRequestBody(requestOrBody)
    ? requestOrBody
    : model === undefined
      ? buildOpenAICompatiblePromptPayload(requestOrBody)
      : buildOpenAICompatibleRequestBody(model, requestOrBody);

  return estimateSerializedTokens(JSON.stringify(requestBody));
};

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

const estimateSerializedTokens = (serializedPayload: string): number =>
  Math.max(1, Math.ceil(serializedPayload.length / 4));

const sanitizeDiagnosticEvidence = (evidence: Evidence): Evidence => {
  const codes = evidence.references
    .map((reference) => boundSingleLine(reference, 40))
    .filter((reference) => /^[A-Za-z0-9_.-]+$/u.test(reference))
    .slice(0, 3);
  return {
    ...evidence,
    title: "Editor diagnostic",
    detail: "See VS Code Problems for the complete diagnostic message.",
    source: boundSingleLine(evidence.source, 80),
    references: codes,
  };
};

const sanitizeGeneralEvidence = (evidence: Evidence): Evidence => ({
  ...evidence,
  title: boundSingleLine(evidence.title, 160),
  detail: boundSingleLine(evidence.detail, 500),
  source: boundSingleLine(evidence.source, 80),
  references: evidence.references
    .map((reference) => boundSingleLine(reference, 120))
    .slice(0, 8),
});

const boundSingleLine = (value: string, maxLength: number): string =>
  value
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);

const formatRange = (range: PairRange): string =>
  `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;

const isOpenAICompatibleRequestBody = (
  request: ModelRequest | ChatCompletionRequestBody,
): request is ChatCompletionRequestBody =>
  "model" in request && "messages" in request && "stream" in request;

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
