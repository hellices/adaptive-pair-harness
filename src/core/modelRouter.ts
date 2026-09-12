import type { Evidence, PairRange } from "./types";
import { requireSafeRemoteEndpoint } from "./remoteEndpoint";

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
  readonly maxOutputTokens?: number;
  readonly purpose?: "intervention" | "why" | "explain" | "trace";
}

export interface PreparedRemoteModelRequest {
  readonly request: ModelRequest;
  readonly sensitiveDataDetected: boolean;
}

export interface ModelResponse {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export class ModelOutputLimitError extends Error {
  public constructor(
    public readonly inputTokens: number,
    public readonly outputTokens: number,
    public readonly requestDispatched: boolean,
  ) {
    super("Model provider exceeded the output token limit.");
    this.name = "ModelOutputLimitError";
  }
}

export class ModelProviderTimeoutError extends Error {
  public constructor(
    public readonly providerId: string,
    public readonly requestDispatched: boolean,
  ) {
    super(`${providerId} provider request timed out.`);
    this.name = "ModelProviderTimeoutError";
  }
}

export interface ModelPreparationOptions {
  readonly userInitiated?: boolean;
}

export interface PreparedModelDispatch {
  readonly inputTokens: number;
  send(): Promise<ModelResponse>;
  dispose(): void;
}

export interface ModelProvider {
  readonly id: string;
  prepare(
    request: ModelRequest,
    signal: AbortSignal,
    options?: ModelPreparationOptions,
  ): Promise<PreparedModelDispatch>;
  generate(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
}

export interface OpenAICompatibleProviderConfig {
  readonly baseUrl: URL;
  readonly model: string;
  readonly fetch: typeof fetch;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
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
  readonly max_tokens: number;
}

interface OpenAICompatibleSuccessPayload {
  readonly choices: ReadonlyArray<{
    readonly message: {
      readonly content: string;
    };
  }>;
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
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
    const dispatch = await this.prepare(providerId, request, signal);
    try {
      return await dispatch.send();
    } finally {
      dispatch.dispose();
    }
  }

  public async prepare(
    providerId: string,
    request: ModelRequest,
    signal: AbortSignal,
    options?: ModelPreparationOptions,
  ): Promise<PreparedModelDispatch> {
    const provider = this.providersById.get(providerId);
    if (provider === undefined) {
      throw new Error(`Unknown model provider: ${providerId}`);
    }

    return provider.prepare(request, signal, options);
  }
}

export class LocalTemplateProvider implements ModelProvider {
  public readonly id = "local-template";

  public async prepare(
    request: ModelRequest,
    signal: AbortSignal,
  ): Promise<PreparedModelDispatch> {
    signal.throwIfAborted();
    return {
      inputTokens: 0,
      send: async () => {
        signal.throwIfAborted();
        return {
          text: createLocalResponse(request),
          inputTokens: 0,
          outputTokens: 0,
        };
      },
      dispose: () => undefined,
    };
  }

  public async generate(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    const dispatch = await this.prepare(request, signal);
    try {
      return await dispatch.send();
    } finally {
      dispatch.dispose();
    }
  }
}

export class OpenAICompatibleProvider implements ModelProvider {
  public readonly id = "openai-compatible";
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  public constructor(private readonly config: OpenAICompatibleProviderConfig) {
    this.endpoint = joinUrl(
      requireSafeRemoteEndpoint(config.baseUrl),
      "chat/completions",
    );
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.maxResponseBytes = config.maxResponseBytes ?? 65_536;
  }

  public async prepare(
    request: ModelRequest,
    signal: AbortSignal,
  ): Promise<PreparedModelDispatch> {
    signal.throwIfAborted();
    const requestBody = buildOpenAICompatibleRequestBody(this.config.model, request);
    return {
      inputTokens: estimateOpenAICompatibleInputTokens(requestBody),
      send: () => this.generatePrepared(requestBody, signal),
      dispose: () => undefined,
    };
  }

  public async generate(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    const dispatch = await this.prepare(request, signal);
    try {
      return await dispatch.send();
    } finally {
      dispatch.dispose();
    }
  }

  private async generatePrepared(
    requestBody: ChatCompletionRequestBody,
    signal: AbortSignal,
  ): Promise<ModelResponse> {
    signal.throwIfAborted();
    const requestController = new AbortController();
    let timedOut = false;
    const abortFromCaller = (): void => {
      requestController.abort(signal.reason);
    };
    signal.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      requestController.abort(
        new Error("OpenAI-compatible provider request timed out."),
      );
    }, this.timeoutMs);

    try {
      const response = await this.config.fetch(this.endpoint, {
        method: "POST",
        headers: buildHeaders(this.config.apiKey),
        body: JSON.stringify(requestBody),
        redirect: "error",
        signal: requestController.signal,
      });

      if (!response.ok) {
        const responseError = new Error(
          `OpenAI-compatible provider returned ${response.status} ${response.statusText}`.trim(),
        );
        await throwAfterResponseCleanup(
          responseError,
          async () => response.body?.cancel(),
        );
      }

      const payload = await parseSuccessPayload(
        response,
        this.maxResponseBytes,
      );
      const firstChoice = payload.choices[0];
      if (firstChoice === undefined) {
        throw new Error("OpenAI-compatible provider returned an invalid payload.");
      }
      if (firstChoice.message.content.trim().length === 0) {
        throw new Error("OpenAI-compatible provider returned an empty response.");
      }
      const outputTokens = Math.max(
        payload.usage?.completion_tokens ?? 0,
        conservativeTextTokenCount(firstChoice.message.content),
      );
      const inputTokens =
        payload.usage?.prompt_tokens ??
        estimateOpenAICompatibleInputTokens(requestBody);
      if (
        outputTokens > requestBody.max_tokens
      ) {
        throw new ModelOutputLimitError(
          inputTokens,
          outputTokens,
          true,
        );
      }

      return {
        text: firstChoice.message.content,
        inputTokens,
        outputTokens,
      };
    } catch (error: unknown) {
      if (timedOut && !signal.aborted) {
        throw new ModelProviderTimeoutError("openai-compatible", true);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abortFromCaller);
    }
  }
}

export const createLocalInterventionQuestion = (evidence: Evidence): string =>
  boundSingleLine(
    `${evidence.title}: ${evidence.detail} Did you intend this change?`,
    1_000,
  );

const createLocalResponse = (request: ModelRequest): string => {
  switch (request.purpose ?? "intervention") {
    case "why":
      return boundSingleLine(
        `Why it matters: ${request.evidence.title}. ${request.evidence.detail} Check whether this ${request.evidence.severity} change matches the intended contract and dependency boundary.`,
        1_000,
      );
    case "explain":
      return boundSingleLine(
        `Local explanation: ${request.evidence.title}. ${request.evidence.detail} This summary is based on ${request.evidence.source} evidence at ${formatRange(request.evidence.range)}; no deeper model analysis was performed.`,
        1_000,
      );
    case "trace": {
      const symbol = request.context?.symbol;
      const scope =
        symbol === undefined
          ? `the evidence range ${formatRange(request.evidence.range)}`
          : `${symbol.name} (${symbol.kind}) at ${formatRange(symbol.range)}`;
      return boundSingleLine(
        `Local trace scope: ${scope}. Adaptive Pair resolved only this symbol and range. A deeper control/data-flow trace requires a model; local mode has not performed that analysis.`,
        1_000,
      );
    }
    case "intervention":
      return createLocalInterventionQuestion(request.evidence);
  }
};

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
): ModelRequest => prepareRemoteModelRequest(request).request;

export const prepareRemoteModelRequest = (
  request: ModelRequest,
): PreparedRemoteModelRequest => {
  const goal = sanitizeRemoteText(request.goal, 600);
  const evidence = projectAutomaticEvidence(request.evidence);
  const context = sanitizeModelRequestContextWithResult(request.context);

  return {
    request: {
      goal: goal.value,
      evidence: evidence.value,
      interactionStyle: request.interactionStyle,
      ...(request.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: normalizeOutputTokenLimit(request.maxOutputTokens) }),
      ...(context.value === undefined ? {} : { context: context.value }),
      ...(request.purpose === undefined ? {} : { purpose: request.purpose }),
    },
    sensitiveDataDetected:
      goal.sensitiveDataDetected ||
      evidence.sensitiveDataDetected ||
      context.sensitiveDataDetected,
  };
};

export const sanitizeModelRequestContext = (
  context: ModelRequestContext | undefined,
): ModelRequestContext | undefined =>
  sanitizeModelRequestContextWithResult(context).value;

interface SanitizedValue<T> {
  readonly value: T;
  readonly sensitiveDataDetected: boolean;
}

const sanitizeModelRequestContextWithResult = (
  context: ModelRequestContext | undefined,
): SanitizedValue<ModelRequestContext | undefined> => {
  if (context === undefined) {
    return {
      value: undefined,
      sensitiveDataDetected: false,
    };
  }

  const userPrompt =
    context.userPrompt === undefined
      ? undefined
      : sanitizeRemoteText(context.userPrompt, 500);
  const symbol =
    context.symbol === undefined
      ? undefined
      : {
          name: sanitizeRemoteText(context.symbol.name, 120),
          kind: sanitizeRemoteText(context.symbol.kind, 60),
          range: context.symbol.range,
        };
  if (userPrompt === undefined && symbol === undefined) {
    return {
      value: undefined,
      sensitiveDataDetected: false,
    };
  }

  return {
    value: {
      ...(userPrompt === undefined ? {} : { userPrompt: userPrompt.value }),
      ...(symbol === undefined
        ? {}
        : {
            symbol: {
              name: symbol.name.value,
              kind: symbol.kind.value,
              range: symbol.range,
            },
          }),
    },
    sensitiveDataDetected:
      (userPrompt?.sensitiveDataDetected ?? false) ||
      (symbol?.name.sensitiveDataDetected ?? false) ||
      (symbol?.kind.sensitiveDataDetected ?? false),
  };
};

export const buildStructuredModelPrompt = (request: ModelRequest): string => {
  const lines = [
    `Goal: ${request.goal}`,
    `Interaction style: ${request.interactionStyle}`,
    `Purpose: ${request.purpose ?? "intervention"}`,
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
  max_tokens: normalizeOutputTokenLimit(request.maxOutputTokens ?? 180),
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
  Math.max(1, new TextEncoder().encode(serializedPayload).byteLength);

interface RemoteEvidenceSummary {
  readonly title: string;
  readonly detail: string;
  readonly source: string;
}

const REMOTE_EVIDENCE_SUMMARIES: Readonly<
  Record<Evidence["kind"], RemoteEvidenceSummary>
> = {
  "new-dependency": {
    title: "Dependency change detected",
    detail: "A new module dependency was detected at the evidence range.",
    source: "adaptive-pair-semantic-analysis",
  },
  "public-api-change": {
    title: "Public API change detected",
    detail: "A public API signature change was detected at the evidence range.",
    source: "adaptive-pair-semantic-analysis",
  },
  "complexity-growth": {
    title: "Complexity growth detected",
    detail: "Control-flow complexity growth was detected at the evidence range.",
    source: "adaptive-pair-semantic-analysis",
  },
  diagnostic: {
    title: "Editor diagnostic detected",
    detail: "VS Code reported a diagnostic at the evidence range.",
    source: "vscode-diagnostics",
  },
  "external-harness": {
    title: "External harness signal detected",
    detail: "An external harness reported evidence at the evidence range.",
    source: "adaptive-pair-external-harness",
  },
};

const projectAutomaticEvidence = (
  evidence: Evidence,
): SanitizedValue<Evidence> => {
  const summary = REMOTE_EVIDENCE_SUMMARIES[evidence.kind];

  return {
    value: {
      id: "remote-evidence",
      kind: evidence.kind,
      severity: evidence.severity,
      title: summary.title,
      detail: summary.detail,
      source: summary.source,
      confidence: evidence.confidence,
      range: evidence.range,
      references: [],
    },
    sensitiveDataDetected: false,
  };
};

const boundSingleLine = (value: string, maxLength: number): string =>
  value
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);

const SENSITIVE_KEY_ROOTS = [
  "authorization",
  "credential",
  "signature",
  "clientsecret",
  "apikey",
  "accesskeyid",
  "accesskey",
  "token",
  "password",
  "passwd",
  "privatekey",
  "secret",
  "sig",
] as const;
const normalizeSensitiveKey = (key: string): string =>
  key.replace(/[^A-Za-z0-9]/gu, "").toLowerCase();
const isSensitiveKey = (key: string): boolean => {
  const normalizedKey = normalizeSensitiveKey(key);
  return SENSITIVE_KEY_ROOTS.some(
    (root) => normalizedKey === root || normalizedKey.endsWith(root),
  );
};
const URI_PATTERN = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>"'`]+/gu;
const HEADER_LINE_PATTERN = /[^\r\n]+/gu;
const HEADER_KEY_PATTERN =
  /\b([A-Za-z][A-Za-z0-9_.-]*)([ \t]*:[ \t]*)/gu;
const SENSITIVE_KEY_SEPARATOR_PATTERN =
  /\b([A-Za-z][A-Za-z0-9_.-]*)\s*[:=]/gu;
const ASSIGNED_SECRET_PATTERN =
  /\b([A-Za-z][A-Za-z0-9_.-]*)(\s*[:=]\s*)([^\s,;"']+)/gu;
const QUOTED_ASSIGNED_SECRET_PATTERN =
  /\b([A-Za-z][A-Za-z0-9_.-]*)(\s*[:=]\s*)(?:"((?:\\.|[^"\\\r\n])*)"|'((?:\\.|[^'\\\r\n])*)')/gu;
const QUOTED_KEY_ASSIGNED_SECRET_PATTERN =
  /(["'])([A-Za-z][A-Za-z0-9_.-]*)\1(\s*:\s*)(?:"((?:\\.|[^"\\\r\n])*)"|'((?:\\.|[^'\\\r\n])*)'|([^\s,;}\]"']+))/gu;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;
const BASIC_PATTERN = /\bBasic\s+[A-Za-z0-9._~+/-]+=*/giu;
const KNOWN_TOKEN_PATTERN =
  /(?:sk-[A-Za-z0-9_-]{8,}|github_pat_[A-Za-z0-9_]{12,}|gh[pousr]_[A-Za-z0-9]{12,}|AKIA[A-Z0-9]{16})/gu;
const JWT_PATTERN =
  /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu;
const LONG_OPAQUE_PATTERN =
  /(?<![A-Za-z0-9_+/-])[A-Za-z0-9_+/-]{38,}={0,2}(?![A-Za-z0-9_+/=-])/gu;
const LOCAL_URI_PATTERN =
  /(?:^|[^A-Za-z0-9+.-])(?:file|vscode-remote):\/\/[^\s<>"'`]*/iu;
const WINDOWS_PATH_PATTERN =
  /(?:^|[^A-Za-z0-9_./:+-])[A-Za-z]:[\\/]/u;
const UNC_PATH_PATTERN =
  /(?:^|[^A-Za-z0-9_\\])\\\\[^\\/\s<>"'`]+[\\/][^\\/\s<>"'`]+/u;
const POSIX_LOCAL_ROOT_PATTERN =
  /(?:^|[^A-Za-z0-9_./:<+?-])\/(?:Applications|Library|Users|Volumes|etc|home|mnt|opt|private|srv|tmp|usr|var|workspace|workspaces)(?:\/|$|(?=[\s<>"'`(){};,]))/u;
const POSIX_MULTI_SEGMENT_PATTERN =
  /(?:^|[^A-Za-z0-9_./:<+?-])\/[^/\s<>"'`(){};,]+\/[^/\s<>"'`(){};,]+/u;

export const LOCAL_ONLY_MODEL_CONTENT_NOTICE =
  "[REDACTED] Sensitive content kept local.";

const sanitizeRemoteText = (
  value: string,
  maxLength: number,
): SanitizedValue<string> => {
  if (containsKnownLocalResource(value)) {
    return {
      value: LOCAL_ONLY_MODEL_CONTENT_NOTICE,
      sensitiveDataDetected: true,
    };
  }

  let sensitiveDataDetected = false;
  SENSITIVE_KEY_SEPARATOR_PATTERN.lastIndex = 0;
  let sensitiveKeyMatch = SENSITIVE_KEY_SEPARATOR_PATTERN.exec(value);
  while (sensitiveKeyMatch !== null) {
    const key = sensitiveKeyMatch[1];
    if (key !== undefined && isSensitiveKey(key)) {
      sensitiveDataDetected = true;
      break;
    }
    sensitiveKeyMatch = SENSITIVE_KEY_SEPARATOR_PATTERN.exec(value);
  }

  let sanitized = value.replace(
    URI_PATTERN,
    (candidate) => {
    try {
      const parsed = new URL(candidate);
      let changed = false;
      if (parsed.username.length > 0 || parsed.password.length > 0) {
        parsed.username = "";
        parsed.password = "";
        changed = true;
      }
      for (const [key, queryValue] of parsed.searchParams.entries()) {
        if (
          isSensitiveKey(key) ||
          looksLikeLongSecret(queryValue)
        ) {
          parsed.searchParams.set(key, "[REDACTED]");
          changed = true;
        }
      }
      if (changed) {
        sensitiveDataDetected = true;
      }
      return parsed.toString();
    } catch {
      return candidate;
    }
    },
  );

  const redact = (pattern: RegExp, replacement: string): void => {
    pattern.lastIndex = 0;
    if (pattern.test(sanitized)) {
      sensitiveDataDetected = true;
      pattern.lastIndex = 0;
      sanitized = sanitized.replace(pattern, replacement);
    }
  };
  redact(BEARER_PATTERN, "Bearer [REDACTED]");
  redact(BASIC_PATTERN, "[REDACTED]");
  redact(KNOWN_TOKEN_PATTERN, "[REDACTED]");
  redact(JWT_PATTERN, "[REDACTED]");
  const redactSensitiveKeyValue = (
    candidate: string,
    key: string,
    replacement: string,
  ): string => {
    if (!isSensitiveKey(key)) {
      return candidate;
    }
    sensitiveDataDetected = true;
    return replacement;
  };
  sanitized = sanitized.replace(HEADER_LINE_PATTERN, (line) => {
    HEADER_KEY_PATTERN.lastIndex = 0;
    let match = HEADER_KEY_PATTERN.exec(line);
    while (match !== null) {
      const key = match[1];
      const separator = match[2];
      if (
        key !== undefined &&
        separator !== undefined &&
        isSensitiveKey(key)
      ) {
        sensitiveDataDetected = true;
        return `${line.slice(0, match.index)}${key}${separator}[REDACTED]`;
      }
      match = HEADER_KEY_PATTERN.exec(line);
    }
    return line;
  });
  sanitized = sanitized.replace(
    QUOTED_KEY_ASSIGNED_SECRET_PATTERN,
    (
      candidate,
      keyQuote: string,
      key: string,
      separator: string,
      doubleQuotedValue: string | undefined,
      singleQuotedValue: string | undefined,
    ) => {
      const valueQuote =
        doubleQuotedValue === undefined
          ? singleQuotedValue === undefined
            ? ""
            : "'"
          : '"';
      return redactSensitiveKeyValue(
        candidate,
        key,
        `${keyQuote}${key}${keyQuote}${separator}${valueQuote}[REDACTED]${valueQuote}`,
      );
    },
  );
  sanitized = sanitized.replace(
    QUOTED_ASSIGNED_SECRET_PATTERN,
    (
      candidate,
      key: string,
      separator: string,
      doubleQuotedValue: string | undefined,
      singleQuotedValue: string | undefined,
    ) => {
      const quote =
        doubleQuotedValue === undefined && singleQuotedValue !== undefined
          ? "'"
          : '"';
      return redactSensitiveKeyValue(
        candidate,
        key,
        `${key}${separator}${quote}[REDACTED]${quote}`,
      );
    },
  );
  sanitized = sanitized.replace(
    ASSIGNED_SECRET_PATTERN,
    (
      candidate,
      key: string,
      separator: string,
    ) => {
      return redactSensitiveKeyValue(
        candidate,
        key,
        `${key}${separator}[REDACTED]`,
      );
    },
  );
  LONG_OPAQUE_PATTERN.lastIndex = 0;
  sanitized = sanitized.replace(LONG_OPAQUE_PATTERN, (candidate) => {
    if (!looksLikeLongSecret(candidate)) {
      return candidate;
    }
    sensitiveDataDetected = true;
    return "[REDACTED]";
  });

  return {
    value: sensitiveDataDetected
      ? LOCAL_ONLY_MODEL_CONTENT_NOTICE
      : boundSingleLine(sanitized, maxLength),
    sensitiveDataDetected,
  };
};

const containsKnownLocalResource = (value: string): boolean =>
  LOCAL_URI_PATTERN.test(value) ||
  WINDOWS_PATH_PATTERN.test(value) ||
  UNC_PATH_PATTERN.test(value) ||
  POSIX_LOCAL_ROOT_PATTERN.test(value) ||
  POSIX_MULTI_SEGMENT_PATTERN.test(value);

export const sanitizePersistentText = (
  value: string,
  maxLength: number,
): string => sanitizeRemoteText(value, maxLength).value;

const looksLikeLongSecret = (value: string): boolean => {
  if (
    value.length < 40 ||
    !/^[A-Za-z0-9_+/-]+={0,2}$/u.test(value)
  ) {
    return false;
  }
  if (/={1,2}$/u.test(value) && value.length % 4 === 0) {
    return true;
  }

  const token = value.replace(/=+$/u, "");
  const hasCredibleCharacterMix = [
    token.match(/[a-z]/gu)?.length ?? 0,
    token.match(/[A-Z]/gu)?.length ?? 0,
    token.match(/[0-9]/gu)?.length ?? 0,
  ].every((count) => count >= 2);
  return hasCredibleCharacterMix && calculateCharacterEntropy(token) >= 3.5;
};

const calculateCharacterEntropy = (value: string): number => {
  const frequencies = new Map<string, number>();
  for (const character of value) {
    frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of frequencies.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
};

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

const parseSuccessPayload = async (
  response: Response,
  maxResponseBytes: number,
): Promise<OpenAICompatibleSuccessPayload> => {
  let payload: unknown;
  const responseText = await readBoundedResponseText(
    response,
    maxResponseBytes,
  );

  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error("OpenAI-compatible provider returned an invalid payload.");
  }

  if (!isOpenAICompatibleSuccessPayload(payload)) {
    throw new Error("OpenAI-compatible provider returned an invalid payload.");
  }

  return payload;
};

const readBoundedResponseText = async (
  response: Response,
  maxResponseBytes: number,
): Promise<string> => {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > maxResponseBytes
  ) {
    await throwAfterResponseCleanup(
      new Error(
        "OpenAI-compatible provider exceeded the response size limit.",
      ),
      async () => response.body?.cancel(),
    );
  }
  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteCount = 0;
  let text = "";
  let chunk = await reader.read();
  while (!chunk.done) {
    byteCount += chunk.value.byteLength;
    if (byteCount > maxResponseBytes) {
      await throwAfterResponseCleanup(
        new Error(
          "OpenAI-compatible provider exceeded the response size limit.",
        ),
        async () => {
          try {
            await reader.cancel();
          } finally {
            reader.releaseLock();
          }
        },
      );
    }
    text += decoder.decode(chunk.value, { stream: true });
    chunk = await reader.read();
  }
  return text + decoder.decode();
};

const throwAfterResponseCleanup = async (
  primaryError: Error,
  cleanup: () => PromiseLike<unknown> | undefined,
): Promise<never> => {
  try {
    await cleanup();
  } catch (cleanupFailure: unknown) {
    try {
      Object.defineProperty(primaryError, "cause", {
        configurable: true,
        value: cleanupFailure,
      });
    } catch {
      throw new Error(primaryError.message, { cause: cleanupFailure });
    }
  }
  throw primaryError;
};

const isOpenAICompatibleSuccessPayload = (
  payload: unknown,
): payload is OpenAICompatibleSuccessPayload => {
  if (!isRecord(payload)) {
    return false;
  }

  const { choices, usage } = payload;
  if (
    !Array.isArray(choices) ||
    choices.length === 0 ||
    (usage !== undefined && !isRecord(usage))
  ) {
    return false;
  }

  const firstChoice = choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    return false;
  }

  return (
    typeof firstChoice.message.content === "string" &&
    (usage === undefined ||
      (isOptionalTokenCount(usage.prompt_tokens) &&
        isOptionalTokenCount(usage.completion_tokens)))
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isOptionalTokenCount = (value: unknown): boolean =>
  value === undefined ||
  (typeof value === "number" && Number.isFinite(value) && value >= 0);

const normalizeOutputTokenLimit = (tokens: number): number =>
  Number.isFinite(tokens) ? Math.max(1, Math.floor(tokens)) : 180;

const conservativeTextTokenCount = (text: string): number =>
  Math.max(1, new TextEncoder().encode(text).byteLength);
