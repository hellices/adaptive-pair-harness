import { describe, expect, it, vi } from "vitest";
import {
  LocalTemplateProvider,
  ModelOutputLimitError,
  ModelRouter,
  OpenAICompatibleProvider,
  buildOpenAICompatibleRequestBody,
  createLocalInterventionQuestion,
  estimateOpenAICompatibleInputTokens,
} from "../src/core/modelRouter";
import { TokenBudget } from "../src/core/tokenBudget";
import type { Evidence, PairRange } from "../src/core/types";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  PreparedModelDispatch,
} from "../src/core/modelRouter";

interface ChatCompletionRequestBody {
  readonly model: string;
  readonly max_tokens: number;
  readonly messages: ReadonlyArray<{
    readonly role: string;
    readonly content: string;
  }>;
  readonly stream: boolean;
}

const sharedRange: PairRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 1 },
};

const evidence: Evidence = {
  id: "evidence-1",
  kind: "new-dependency",
  severity: "warning",
  title: "New dependency introduced",
  detail: "Imported a new module dependency: ./repository.",
  source: "typescript-semantic-analyzer",
  confidence: 0.94,
  range: sharedRange,
  references: ["./repository"],
};

const request: ModelRequest = {
  goal: "Ask a concise, evidence-backed question.",
  evidence,
  interactionStyle: "ask-first",
};

const longGoal = "Ask a concise, evidence-backed question. ".repeat(8).trim();
const longModel = "ultra-long-model-id-".repeat(10).slice(0, 120);

class RecordingProvider implements ModelProvider {
  public readonly calls: Array<{
    readonly request: ModelRequest;
    readonly signal: AbortSignal;
  }> = [];

  public constructor(
    public readonly id: string,
    private readonly response: ModelResponse,
  ) {}

  public async prepare(
    request: ModelRequest,
    signal: AbortSignal,
  ): Promise<PreparedModelDispatch> {
    return {
      inputTokens: this.response.inputTokens,
      send: async () => {
        this.calls.push({ request, signal });
        return this.response;
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

describe("model routing", () => {
  it("local provider produces a question containing the evidence title", async () => {
    const provider = new LocalTemplateProvider();

    await expect(provider.generate(request, new AbortController().signal)).resolves.toEqual({
      text: expect.stringContaining(evidence.title),
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it("bounds the complete local intervention question after composing evidence", () => {
    const question = createLocalInterventionQuestion({
      ...evidence,
      title: `Long title ${"title ".repeat(120)}`,
      detail: `Long detail ${"detail ".repeat(220)}`,
    });

    expect(question.length).toBeLessThanOrEqual(1_000);
    expect(question).not.toMatch(/[\r\n]/u);
    expect(question).toContain("Long title");
  });

  it("provides distinct, honest local Chat responses by command", async () => {
    const provider = new LocalTemplateProvider();
    const signal = new AbortController().signal;
    const symbol = {
      name: "loadRepository",
      kind: "Function",
      range: {
        start: { line: 4, character: 2 },
        end: { line: 8, character: 1 },
      },
    };

    const why = await provider.generate(
      { ...request, purpose: "why" },
      signal,
    );
    const explain = await provider.generate(
      { ...request, purpose: "explain" },
      signal,
    );
    const trace = await provider.generate(
      {
        ...request,
        purpose: "trace",
        context: { symbol },
      },
      signal,
    );

    expect(new Set([why.text, explain.text, trace.text]).size).toBe(3);
    expect(why.text).toContain("Why it matters");
    expect(explain.text).toContain("Local explanation");
    expect(trace.text).toContain("loadRepository");
    expect(trace.text).toContain("4:2-8:1");
    expect(trace.text).toContain("requires a model");
    expect(trace.text).not.toMatch(/flows? (?:to|through)/iu);
    expect(Math.max(why.text.length, explain.text.length, trace.text.length))
      .toBeLessThanOrEqual(1_000);
  });

  it("router invokes the selected provider and forwards the abort signal", async () => {
    const response: ModelResponse = {
      text: "Did you intend to introduce this dependency?",
      inputTokens: 42,
      outputTokens: 11,
    };
    const provider = new RecordingProvider("test-provider", response);
    const router = new ModelRouter([provider]);
    const controller = new AbortController();

    await expect(
      router.generate(provider.id, request, controller.signal),
    ).resolves.toEqual(response);
    expect(provider.calls).toEqual([
      {
        request,
        signal: controller.signal,
      },
    ]);
  });

  it("fails explicitly when the selected provider is missing", async () => {
    const router = new ModelRouter([]);

    await expect(
      router.generate("missing-provider", request, new AbortController().signal),
    ).rejects.toThrow("Unknown model provider: missing-provider");
  });

  it("parses an OpenAI-compatible response and sends only structured evidence", async () => {
    let receivedUrl = "";
    let receivedBody = "";
    let receivedRedirect: RequestRedirect | undefined;
    const fetchImplementation: typeof fetch = async (input, init) => {
      receivedUrl = String(input);
      receivedBody = String(init?.body ?? "");
      receivedRedirect = init?.redirect;

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "Did you intend to introduce this dependency?",
              },
            },
          ],
          usage: {
            prompt_tokens: 42,
            completion_tokens: 11,
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    };
    const provider = new OpenAICompatibleProvider({
      baseUrl: new URL("http://localhost:11434/v1"),
      model: "qwen2.5-coder:7b",
      fetch: fetchImplementation,
    });

    await expect(provider.generate(request, new AbortController().signal)).resolves.toEqual({
      text: "Did you intend to introduce this dependency?",
      inputTokens: 42,
      outputTokens: 44,
    });

    const parsedBody = JSON.parse(receivedBody) as ChatCompletionRequestBody;
    expect(receivedUrl).toBe("http://localhost:11434/v1/chat/completions");
    expect(receivedRedirect).toBe("error");
    expect(parsedBody.model).toBe("qwen2.5-coder:7b");
    expect(parsedBody.max_tokens).toBe(180);
    expect(parsedBody.stream).toBe(false);
    expect(parsedBody.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining(evidence.title),
        }),
      ]),
    );
    expect(receivedBody).not.toContain("previousText");
    expect(receivedBody).not.toContain("currentText");
  });

  it("surfaces non-2xx responses explicitly", async () => {
    const fetchImplementation: typeof fetch = async () =>
      new Response("service unavailable", {
        status: 503,
        statusText: "Service Unavailable",
      });

    const provider = new OpenAICompatibleProvider({
      baseUrl: new URL("http://localhost:11434/v1"),
      model: "qwen2.5-coder:7b",
      fetch: fetchImplementation,
    });

    await expect(provider.generate(request, new AbortController().signal)).rejects.toThrow(
      "OpenAI-compatible provider returned 503 Service Unavailable",
    );
  });

  it("rejects unsafe endpoints at the provider boundary", () => {
    const fetchImplementation = vi.fn<typeof fetch>();

    expect(
      () =>
        new OpenAICompatibleProvider({
          baseUrl: new URL("http://models.example/v1"),
          model: "qwen2.5-coder:7b",
          fetch: fetchImplementation,
          apiKey: "must-not-be-sent",
        }),
    ).toThrow("unsafe");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("surfaces invalid payloads explicitly", async () => {
    const fetchImplementation: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 123,
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    const provider = new OpenAICompatibleProvider({
      baseUrl: new URL("http://localhost:11434/v1"),
      model: "qwen2.5-coder:7b",
      fetch: fetchImplementation,
    });

    await expect(provider.generate(request, new AbortController().signal)).rejects.toThrow(
      "OpenAI-compatible provider returned an invalid payload.",
    );
  });

  it("aborts an OpenAI-compatible request after its deadline", async () => {
    const fetchImplementation: typeof fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            reject(init.signal?.reason);
          },
          { once: true },
        );
      });
    const provider = new OpenAICompatibleProvider({
      baseUrl: new URL("http://localhost:11434/v1"),
      model: "qwen2.5-coder:7b",
      fetch: fetchImplementation,
      timeoutMs: 5,
    });

    await expect(
      provider.generate(request, new AbortController().signal),
    ).rejects.toThrow("timed out");
  });

  it("rejects an oversized OpenAI-compatible response body", async () => {
    const fetchImplementation: typeof fetch = async () =>
      new Response("x".repeat(200), {
        status: 200,
      });
    const provider = new OpenAICompatibleProvider({
      baseUrl: new URL("http://localhost:11434/v1"),
      model: "qwen2.5-coder:7b",
      fetch: fetchImplementation,
      maxResponseBytes: 100,
    });

    await expect(
      provider.generate(request, new AbortController().signal),
    ).rejects.toThrow("response size limit");
  });

  it("reports observed usage when completion usage exceeds the requested output cap", async () => {
    const fetchImplementation: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "too much output" } }],
          usage: {
            prompt_tokens: 37,
            completion_tokens: 500,
          },
        }),
        { status: 200 },
      );
    const provider = new OpenAICompatibleProvider({
      baseUrl: new URL("http://localhost:11434/v1"),
      model: "qwen2.5-coder:7b",
      fetch: fetchImplementation,
    });

    const error: unknown = await provider
      .generate(
        { ...request, maxOutputTokens: 180 },
        new AbortController().signal,
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ModelOutputLimitError);
    expect(error).toMatchObject({
      name: "ModelOutputLimitError",
      inputTokens: 37,
      outputTokens: 500,
      requestDispatched: true,
    });
  });

  it.each([
    ["absent", "你好世界", undefined],
    ["under-reported", "const result=value?.map(x=>x+1)??[];", 1],
  ])(
    "conservatively accounts for %s OpenAI-compatible completion usage",
    async (_label, content, completionTokens) => {
      const fetchImplementation: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content } }],
            usage: {
              prompt_tokens: 10,
              ...(completionTokens === undefined
                ? {}
                : { completion_tokens: completionTokens }),
            },
          }),
          { status: 200 },
        );
      const provider = new OpenAICompatibleProvider({
        baseUrl: new URL("http://localhost:11434/v1"),
        model: "qwen2.5-coder:7b",
        fetch: fetchImplementation,
      });

      await expect(
        provider.generate(request, new AbortController().signal),
      ).resolves.toMatchObject({
        text: content,
        outputTokens: new TextEncoder().encode(content).byteLength,
      });
    },
  );

  it("conservatively accounts when OpenAI-compatible usage is omitted", async () => {
    const content = "fallback accounting";
    const fetchImplementation: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content } }],
        }),
        { status: 200 },
      );
    const provider = new OpenAICompatibleProvider({
      baseUrl: new URL("http://localhost:11434/v1"),
      model: "qwen2.5-coder:7b",
      fetch: fetchImplementation,
    });

    await expect(
      provider.generate(request, new AbortController().signal),
    ).resolves.toMatchObject({
      text: content,
      inputTokens: expect.any(Number),
      outputTokens: new TextEncoder().encode(content).byteLength,
    });
  });

  it.each([
    ["CJK", "你好世界".repeat(40)],
    ["code-dense", "()=>{value?.map(x=>x+1)??=[];}".repeat(12)],
  ])(
    "uses a conservative UTF-8 body estimate for %s OpenAI-compatible input",
    (_label, goal) => {
      const body = buildOpenAICompatibleRequestBody("pair-model", {
        ...request,
        goal,
      });
      const serializedBody = JSON.stringify(body);

      expect(estimateOpenAICompatibleInputTokens(body)).toBeGreaterThanOrEqual(
        new TextEncoder().encode(serializedBody).byteLength,
      );
      expect(estimateOpenAICompatibleInputTokens(body)).toBeGreaterThanOrEqual(
        Math.ceil(serializedBody.length / 4),
      );
    },
  );

  it("rejects blank OpenAI-compatible output", async () => {
    const fetchImplementation: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: " \n\t " } }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 0,
          },
        }),
        { status: 200 },
      );
    const provider = new OpenAICompatibleProvider({
      baseUrl: new URL("http://localhost:11434/v1"),
      model: "qwen2.5-coder:7b",
      fetch: fetchImplementation,
    });

    await expect(
      provider.generate(request, new AbortController().signal),
    ).rejects.toThrow("empty response");
  });

  it("denies remote generation when a long model identifier pushes the serialized request over budget and prevents fetch", async () => {
    let fetchCalls = 0;
    const fetchImplementation: typeof fetch = async () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "Did you intend to introduce this dependency?",
              },
            },
          ],
          usage: {
            prompt_tokens: 42,
            completion_tokens: 11,
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    };
    const provider = new OpenAICompatibleProvider({
      baseUrl: new URL("http://localhost:11434/v1"),
      model: longModel,
      fetch: fetchImplementation,
    });
    const budget = new TokenBudget({
      windowMs: 60_000,
      maxCalls: 10,
      maxInputTokens: 200,
      maxOutputTokens: 180,
      maxOutputTokensPerCall: 180,
    });
    const deniedRequest: ModelRequest = {
      ...request,
      goal: longGoal,
      maxOutputTokens: 180,
    };
    const body = buildOpenAICompatibleRequestBody(longModel, deniedRequest);
    const decision = budget.tryReserve(
      estimateOpenAICompatibleInputTokens(body),
      180,
      1_000,
    );

    if (decision.allowed) {
      await provider.generate(deniedRequest, new AbortController().signal);
    }

    expect(decision).toMatchObject({
      allowed: false,
      reason: "input-token-limit",
    });
    expect(fetchCalls).toBe(0);
  });
});
