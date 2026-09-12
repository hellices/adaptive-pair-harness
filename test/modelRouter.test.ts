import { describe, expect, it } from "vitest";
import { InterventionPolicy } from "../src/core/interventionPolicy";
import {
  LocalTemplateProvider,
  ModelRouter,
  OpenAICompatibleProvider,
} from "../src/core/modelRouter";
import { TokenBudget } from "../src/core/tokenBudget";
import type { Evidence, PairRange } from "../src/core/types";
import type { ModelProvider, ModelRequest, ModelResponse } from "../src/core/modelRouter";

interface ChatCompletionRequestBody {
  readonly model: string;
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

class RecordingProvider implements ModelProvider {
  public readonly calls: Array<{
    readonly request: ModelRequest;
    readonly signal: AbortSignal;
  }> = [];

  public constructor(
    public readonly id: string,
    private readonly response: ModelResponse,
  ) {}

  public async generate(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    this.calls.push({ request, signal });
    return this.response;
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
    const fetchImplementation: typeof fetch = async (input, init) => {
      receivedUrl = String(input);
      receivedBody = String(init?.body ?? "");

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
      outputTokens: 11,
    });

    const parsedBody = JSON.parse(receivedBody) as ChatCompletionRequestBody;
    expect(receivedUrl).toBe("http://localhost:11434/v1/chat/completions");
    expect(parsedBody.model).toBe("qwen2.5-coder:7b");
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

  it("does not call fetch when policy denies remote generation on token budget", async () => {
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
      model: "qwen2.5-coder:7b",
      fetch: fetchImplementation,
    });
    const policy = new InterventionPolicy({
      budget: new TokenBudget({
        windowMs: 60_000,
        maxCalls: 10,
        maxInputTokens: 190,
      }),
      cooldownMs: 1_000,
    });
    const deniedRequest: ModelRequest = {
      ...request,
      goal: longGoal,
    };
    const decision = policy.decide({
      evidence: [evidence],
      style: "balanced",
      now: 1_000,
      goal: deniedRequest.goal,
    });

    if (decision.kind === "intervene" && decision.useModel) {
      await provider.generate(deniedRequest, new AbortController().signal);
    }

    expect(decision).toMatchObject({
      kind: "intervene",
      evidenceId: evidence.id,
      useModel: false,
      localMessage: expect.stringContaining(evidence.title),
    });
    expect(fetchCalls).toBe(0);
  });
});
