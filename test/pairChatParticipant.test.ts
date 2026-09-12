import { describe, expect, it, vi } from "vitest";
import {
  PairSharedContext,
  buildPairChatPlan,
  registerPairChatParticipant,
} from "../src/vscode/pairChatParticipant";
import type { Evidence } from "../src/core/types";
import type * as vscode from "vscode";

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const evidence: Evidence = {
  id: "dependency:repository",
  kind: "new-dependency",
  severity: "warning",
  title: "New dependency introduced",
  detail: "Imported a new module dependency: ./repository.",
  source: "typescript-semantic-analyzer",
  confidence: 0.94,
  range: {
    start: { line: 2, character: 18 },
    end: { line: 2, character: 32 },
  },
  references: ["./repository"],
};

describe("pair chat planning", () => {
  it("asks for active code when no evidence is shared", () => {
    const context = new PairSharedContext({
      enabled: true,
      active: true,
      goal: "Navigate with evidence-backed questions.",
      role: "navigator",
      provider: "local-template",
      remainingCalls: 4,
      remainingInputTokens: 6_000,
      controlNotice: undefined,
      configurationWarning: undefined,
    });

    expect(buildPairChatPlan("why", context.snapshot())).toEqual({
      kind: "message",
      markdown:
        "No active evidence yet. Select code or run **Adaptive Pair: Review Current Block**.",
    });
  });

  it("reports the shared session without creating separate chat state", () => {
    const context = new PairSharedContext({
      enabled: true,
      active: true,
      goal: "Navigate with evidence-backed questions.",
      role: "navigator",
      provider: "vscode-copilot",
      remainingCalls: 3,
      remainingInputTokens: 5_700,
      remainingOutputTokens: 690,
      controlNotice: "Cline detected; observing only.",
      configurationWarning: undefined,
    });
    context.publishEvidence({
      uri: "file:///workspace/pair.ts",
      evidence,
      question: "Did you intend this dependency?",
    });

    expect(buildPairChatPlan("session", context.snapshot())).toEqual({
      kind: "message",
      markdown: [
        "**Goal:** Navigate with evidence-backed questions.",
        "**Role:** navigator (you remain the driver)",
        "**Provider:** vscode-copilot",
        "**Remaining budget:** 3 calls / 5700 input tokens / 690 output tokens",
        "**Coexistence:** Cline detected; observing only.",
      ].join("\n\n"),
    });
  });

  it("expands the most recent inline question from the same evidence", () => {
    const context = new PairSharedContext({
      enabled: true,
      active: true,
      goal: "Navigate with evidence-backed questions.",
      role: "navigator",
      provider: "local-template",
      remainingCalls: 4,
      remainingInputTokens: 6_000,
      controlNotice: undefined,
      configurationWarning: undefined,
    });
    context.publishEvidence({
      uri: "file:///workspace/pair.ts",
      evidence,
      question: "Did you intend this dependency?",
    });

    expect(buildPairChatPlan("why", context.snapshot())).toMatchObject({
      kind: "generate",
      uri: "file:///workspace/pair.ts",
      evidence,
      purpose: "why",
      goal: expect.not.stringContaining("Did you intend this dependency?"),
    });
  });

  it("does not invoke Chat generation while Pair is disabled", async () => {
    const context = new PairSharedContext({
      enabled: false,
      active: false,
      goal: "Navigate with evidence-backed questions.",
      role: "navigator",
      provider: "vscode-copilot",
      remainingCalls: 4,
      remainingInputTokens: 6_000,
      controlNotice: undefined,
      configurationWarning: undefined,
    });
    context.publishEvidence({
      uri: "file:///workspace/pair.ts",
      evidence,
      question: "Did you intend this dependency?",
    });
    let handler: vscode.ChatRequestHandler | undefined;
    let generateCalls = 0;
    const markdown: string[] = [];
    registerPairChatParticipant(
      (_id, registeredHandler) => {
        handler = registeredHandler;
        return { dispose: () => undefined } as vscode.ChatParticipant;
      },
      context,
      {
        generate: async () => {
          generateCalls += 1;
          return { text: "remote", inputTokens: 1, outputTokens: 1 };
        },
      },
    );

    expect(handler).toBeTypeOf("function");
    await handler!(
      { command: "explain", prompt: "Explain this." } as vscode.ChatRequest,
      {} as vscode.ChatContext,
      {
        markdown: (value: string) => {
          markdown.push(value);
        },
      } as unknown as vscode.ChatResponseStream,
      {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => undefined }),
      } as vscode.CancellationToken,
    );

    expect(generateCalls).toBe(0);
    expect(markdown.join("\n")).toContain("disabled");
  });

  it("includes a bounded explicit prompt and current symbol identity for trace", () => {
    const context = new PairSharedContext({
      enabled: true,
      active: true,
      goal: "Navigate with evidence-backed questions.",
      role: "navigator",
      provider: "vscode-copilot",
      remainingCalls: 4,
      remainingInputTokens: 6_000,
      controlNotice: undefined,
      configurationWarning: undefined,
    });
    context.publishEvidence({
      uri: "file:///workspace/pair.ts",
      evidence,
      question: "Did you intend this dependency?",
    });
    const longPrompt = `Why this path? ${"x".repeat(1_000)}`;
    const plan = buildPairChatPlan("trace", context.snapshot(), {
      prompt: longPrompt,
      symbol: {
        name: "handleRequest",
        kind: "Function",
        range: {
          start: { line: 10, character: 2 },
          end: { line: 20, character: 3 },
        },
      },
    });

    expect(plan).toMatchObject({
      kind: "generate",
      purpose: "trace",
      context: {
        userPrompt: expect.stringContaining("Why this path?"),
        symbol: {
          name: "handleRequest",
          kind: "Function",
          range: {
            start: { line: 10, character: 2 },
            end: { line: 20, character: 3 },
          },
        },
      },
    });
    if (plan.kind !== "generate") {
      throw new Error("Expected generation plan.");
    }
    expect(plan.context.userPrompt?.length).toBeLessThanOrEqual(500);
  });

  it("does not call a model for trace when no public symbol context is available", () => {
    const context = new PairSharedContext({
      enabled: true,
      active: true,
      goal: "Navigate with evidence-backed questions.",
      role: "navigator",
      provider: "vscode-copilot",
      remainingCalls: 4,
      remainingInputTokens: 6_000,
      controlNotice: undefined,
      configurationWarning: undefined,
    });
    context.publishEvidence({
      uri: "file:///workspace/pair.ts",
      evidence,
      question: "Did you intend this dependency?",
    });

    expect(
      buildPairChatPlan("trace", context.snapshot(), {
        prompt: "Trace this.",
      }),
    ).toEqual({
      kind: "message",
      markdown:
        "No current symbol could be resolved through VS Code's document symbol providers.",
    });
  });

  it("clears latest evidence only when its document closes", () => {
    const context = new PairSharedContext({
      enabled: true,
      active: true,
      goal: "Navigate with evidence-backed questions.",
      role: "navigator",
      provider: "local-template",
      remainingCalls: 4,
      remainingInputTokens: 6_000,
      controlNotice: undefined,
      configurationWarning: undefined,
    });
    context.publishEvidence({
      uri: "file:///workspace/pair.ts",
      evidence,
      question: "Did you intend this dependency?",
    });
    const clearEvidence = (
      context as PairSharedContext & { clearEvidence(uri: string): void }
    ).clearEvidence;
    expect(clearEvidence).toBeTypeOf("function");

    clearEvidence.call(context, "file:///workspace/other.ts");
    expect(context.snapshot().latest).toBeDefined();
    clearEvidence.call(context, "file:///workspace/pair.ts");
    expect(context.snapshot().latest).toBeUndefined();
  });

  it("clears all latest evidence when the runtime session is disposed", () => {
    const context = new PairSharedContext({
      enabled: true,
      active: true,
      goal: "Navigate with evidence-backed questions.",
      role: "navigator",
      provider: "local-template",
      remainingCalls: 4,
      remainingInputTokens: 6_000,
      controlNotice: undefined,
      configurationWarning: undefined,
    });
    context.publishEvidence({
      uri: "file:///workspace/pair.ts",
      evidence,
      question: "Did you intend this dependency?",
    });

    (
      context as PairSharedContext & {
        clearEvidence(uri?: string): void;
      }
    ).clearEvidence();

    expect(context.snapshot().latest).toBeUndefined();
  });

  it("reports configuration warnings in shared session output", () => {
    const context = new PairSharedContext({
      enabled: true,
      active: true,
      goal: "Navigate with evidence-backed questions.",
      role: "navigator",
      provider: "local-template",
      remainingCalls: 4,
      remainingInputTokens: 6_000,
      controlNotice: undefined,
      configurationWarning: "Invalid provider; using local-template.",
    });

    expect(buildPairChatPlan("session", context.snapshot())).toMatchObject({
      kind: "message",
      markdown: expect.stringContaining(
        "**Configuration:** Invalid provider; using local-template.",
      ),
    });
  });

  it("blocks ordinary Chat generation while permission is enabled but the session is inactive", async () => {
    const context = new PairSharedContext({
      enabled: true,
      active: false,
      goal: "Navigate with evidence-backed questions.",
      role: "navigator",
      provider: "vscode-copilot",
      remainingCalls: 4,
      remainingInputTokens: 6_000,
      controlNotice: undefined,
      configurationWarning: undefined,
    });
    context.publishEvidence({
      uri: "file:///workspace/pair.ts",
      evidence,
      question: "Did you intend this dependency?",
    });
    let handler: vscode.ChatRequestHandler | undefined;
    const generate = vi.fn(async () => ({
      text: "remote",
      inputTokens: 1,
      outputTokens: 1,
    }));
    const markdown: string[] = [];
    registerPairChatParticipant(
      (_id, registeredHandler) => {
        handler = registeredHandler;
        return { dispose: () => undefined } as vscode.ChatParticipant;
      },
      context,
      { generate },
    );

    await handler!(
      { command: "why", prompt: "" } as vscode.ChatRequest,
      {} as vscode.ChatContext,
      {
        markdown: (value: string) => {
          markdown.push(value);
        },
      } as unknown as vscode.ChatResponseStream,
      {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => undefined }),
      } as vscode.CancellationToken,
    );

    expect(generate).not.toHaveBeenCalled();
    expect(markdown.join("\n")).toContain("off");
    expect(markdown.join("\n")).toContain("/start");
  });

  it("handles Chat start and stop while inactive without invoking a model", async () => {
    const context = new PairSharedContext({
      enabled: true,
      active: false,
      goal: "Navigate with evidence-backed questions.",
      role: "navigator",
      provider: "local-template",
      remainingCalls: 4,
      remainingInputTokens: 6_000,
      controlNotice: undefined,
      configurationWarning: undefined,
    });
    let handler: vscode.ChatRequestHandler | undefined;
    const generate = vi.fn(async () => ({
      text: "remote",
      inputTokens: 1,
      outputTokens: 1,
    }));
    const startSession = vi.fn(async () => ({
      kind: "started" as const,
      active: true,
      message: "session started",
    }));
    const stopSession = vi.fn(() => ({
      kind: "stopped" as const,
      active: false,
      message: "session stopped",
    }));
    registerPairChatParticipant(
      (_id, registeredHandler) => {
        handler = registeredHandler;
        return { dispose: () => undefined } as vscode.ChatParticipant;
      },
      context,
      { generate },
      {
        sessionControl: {
          isSessionActive: () => false,
          startSession,
          stopSession,
        },
      },
    );
    const markdown: string[] = [];
    const response = {
      markdown: (value: string) => {
        markdown.push(value);
      },
    } as unknown as vscode.ChatResponseStream;
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => undefined }),
    } as vscode.CancellationToken;

    await handler!(
      { command: "start", prompt: "" } as vscode.ChatRequest,
      {} as vscode.ChatContext,
      response,
      token,
    );
    await handler!(
      { command: "stop", prompt: "" } as vscode.ChatRequest,
      {} as vscode.ChatContext,
      response,
      token,
    );

    expect(startSession).toHaveBeenCalledOnce();
    expect(stopSession).toHaveBeenCalledOnce();
    expect(generate).not.toHaveBeenCalled();
    expect(markdown).toEqual(["session started", "session stopped"]);
  });

  it("resolves trace context from the latest evidence URI and range", async () => {
    const context = new PairSharedContext({
      enabled: true,
      active: true,
      goal: "Navigate with evidence-backed questions.",
      role: "navigator",
      provider: "vscode-copilot",
      remainingCalls: 4,
      remainingInputTokens: 6_000,
      controlNotice: undefined,
      configurationWarning: undefined,
    });
    context.publishEvidence({
      uri: "file:///workspace/evidence.ts",
      evidence,
      question: "Did you intend this dependency?",
    });
    let handler: vscode.ChatRequestHandler | undefined;
    const forEvidence = vi.fn(async () => ({
      name: "loadRepository",
      kind: "Function",
      range: evidence.range,
    }));
    const generate = vi.fn(async () => ({
      text: "trace",
      inputTokens: 1,
      outputTokens: 1,
    }));
    registerPairChatParticipant(
      (_id, registeredHandler) => {
        handler = registeredHandler;
        return { dispose: () => undefined } as vscode.ChatParticipant;
      },
      context,
      { generate },
      {
        symbolContextProvider: { forEvidence },
      },
    );

    await handler!(
      { command: "trace", prompt: "" } as vscode.ChatRequest,
      {} as vscode.ChatContext,
      { markdown: () => undefined } as unknown as vscode.ChatResponseStream,
      {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => undefined }),
      } as vscode.CancellationToken,
    );

    expect(forEvidence).toHaveBeenCalledWith(
      "file:///workspace/evidence.ts",
      evidence.range,
      expect.any(AbortSignal),
    );
    expect(generate).toHaveBeenCalledOnce();
  });

  it("invalidates deferred trace resolution across stop and restart", async () => {
    const context = new PairSharedContext({
      enabled: true,
      active: true,
      generation: 1,
      goal: "Navigate with evidence-backed questions.",
      role: "navigator",
      provider: "vscode-copilot",
      remainingCalls: 4,
      remainingInputTokens: 6_000,
      controlNotice: undefined,
      configurationWarning: undefined,
    });
    context.publishEvidence({
      uri: "file:///workspace/evidence.ts",
      evidence,
      question: "Did you intend this dependency?",
    });
    const symbolResolution = deferred<{
      name: string;
      kind: string;
      range: Evidence["range"];
    }>();
    const registered = new Map<string, AbortController>();
    const register = vi.fn((uri: string, request: AbortController) => {
      registered.set(uri, request);
      return {
        dispose: () => {
          if (registered.get(uri) === request) {
            registered.delete(uri);
          }
        },
      };
    });
    let handler: vscode.ChatRequestHandler | undefined;
    const generate = vi.fn(async () => ({
      text: "stale trace",
      inputTokens: 1,
      outputTokens: 1,
    }));
    registerPairChatParticipant(
      (_id, registeredHandler) => {
        handler = registeredHandler;
        return { dispose: () => undefined } as vscode.ChatParticipant;
      },
      context,
      { generate },
      {
        symbolContextProvider: {
          forEvidence: vi.fn(() => symbolResolution.promise),
        },
        requestLifecycle: { register },
      },
    );

    const pendingTrace = handler!(
      { command: "trace", prompt: "" } as vscode.ChatRequest,
      {} as vscode.ChatContext,
      { markdown: () => undefined } as unknown as vscode.ChatResponseStream,
      {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => undefined }),
      } as vscode.CancellationToken,
    );
    expect(register).toHaveBeenCalledWith(
      "file:///workspace/evidence.ts",
      expect.any(AbortController),
    );

    for (const request of registered.values()) {
      request.abort();
    }
    context.clearEvidence();
    context.updateSession({
      ...context.snapshot().session,
      active: false,
      generation: 2,
    });
    context.updateSession({
      ...context.snapshot().session,
      active: true,
      generation: 3,
    });
    context.publishEvidence({
      uri: "file:///workspace/evidence.ts",
      evidence,
      question: "New session evidence",
    });
    symbolResolution.resolve({
      name: "loadRepository",
      kind: "Function",
      range: evidence.range,
    });
    await pendingTrace;

    expect(generate).not.toHaveBeenCalled();
    expect(registered.size).toBe(0);
  });

  it("does not write deferred model output after stop", async () => {
    const context = new PairSharedContext({
      enabled: true,
      active: true,
      generation: 1,
      goal: "Navigate with evidence-backed questions.",
      role: "navigator",
      provider: "vscode-copilot",
      remainingCalls: 4,
      remainingInputTokens: 6_000,
      controlNotice: undefined,
      configurationWarning: undefined,
    });
    context.publishEvidence({
      uri: "file:///workspace/evidence.ts",
      evidence,
      question: "Did you intend this dependency?",
    });
    const modelCompletion = deferred<{
      text: string;
      inputTokens: number;
      outputTokens: number;
    }>();
    let handler: vscode.ChatRequestHandler | undefined;
    const markdown = vi.fn();
    const registered = new Set<AbortController>();
    let providerSignal: AbortSignal | undefined;
    registerPairChatParticipant(
      (_id, registeredHandler) => {
        handler = registeredHandler;
        return { dispose: () => undefined } as vscode.ChatParticipant;
      },
      context,
      {
        generate: vi.fn(
          (
            _uri: string,
            _goal: string,
            _evidence: Evidence,
            signal: AbortSignal,
          ) => {
            providerSignal = signal;
            return modelCompletion.promise;
          },
        ),
      },
      {
        requestLifecycle: {
          register: (_uri, request) => {
            registered.add(request);
            return {
              dispose: () => {
                registered.delete(request);
              },
            };
          },
        },
      },
    );

    const pendingResponse = handler!(
      { command: "why", prompt: "" } as vscode.ChatRequest,
      {} as vscode.ChatContext,
      { markdown } as unknown as vscode.ChatResponseStream,
      {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => undefined }),
      } as vscode.CancellationToken,
    );
    for (const request of registered) {
      request.abort();
    }
    context.clearEvidence();
    context.updateSession({
      ...context.snapshot().session,
      active: false,
      generation: 2,
    });
    modelCompletion.resolve({
      text: "stale output",
      inputTokens: 1,
      outputTokens: 1,
    });
    await pendingResponse;

    expect(providerSignal?.aborted).toBe(true);
    expect(markdown).not.toHaveBeenCalled();
    expect(registered.size).toBe(0);
  });

  it("does not write old model output after stop and restart", async () => {
    const context = new PairSharedContext({
      enabled: true,
      active: true,
      generation: 1,
      goal: "Navigate with evidence-backed questions.",
      role: "navigator",
      provider: "vscode-copilot",
      remainingCalls: 4,
      remainingInputTokens: 6_000,
      controlNotice: undefined,
      configurationWarning: undefined,
    });
    const latest = {
      uri: "file:///workspace/evidence.ts",
      evidence,
      question: "Did you intend this dependency?",
    };
    context.publishEvidence(latest);
    const modelCompletion = deferred<{
      text: string;
      inputTokens: number;
      outputTokens: number;
    }>();
    let handler: vscode.ChatRequestHandler | undefined;
    const markdown = vi.fn();
    const registered = new Set<AbortController>();
    let providerSignal: AbortSignal | undefined;
    registerPairChatParticipant(
      (_id, registeredHandler) => {
        handler = registeredHandler;
        return { dispose: () => undefined } as vscode.ChatParticipant;
      },
      context,
      {
        generate: vi.fn(
          (
            _uri: string,
            _goal: string,
            _evidence: Evidence,
            signal: AbortSignal,
          ) => {
            providerSignal = signal;
            return modelCompletion.promise;
          },
        ),
      },
      {
        requestLifecycle: {
          register: (_uri, request) => {
            registered.add(request);
            return {
              dispose: () => {
                registered.delete(request);
              },
            };
          },
        },
      },
    );

    const pendingResponse = handler!(
      { command: "why", prompt: "" } as vscode.ChatRequest,
      {} as vscode.ChatContext,
      { markdown } as unknown as vscode.ChatResponseStream,
      {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => undefined }),
      } as vscode.CancellationToken,
    );
    for (const request of registered) {
      request.abort();
    }
    context.clearEvidence();
    context.updateSession({
      ...context.snapshot().session,
      active: false,
      generation: 2,
    });
    context.updateSession({
      ...context.snapshot().session,
      active: true,
      generation: 3,
    });
    context.publishEvidence(latest);
    modelCompletion.resolve({
      text: "old generation output",
      inputTokens: 1,
      outputTokens: 1,
    });
    await pendingResponse;

    expect(providerSignal?.aborted).toBe(true);
    expect(markdown).not.toHaveBeenCalled();
    expect(registered.size).toBe(0);
  });

  it.each(["AbortError", "Canceled", "CancellationError"])(
    "surfaces a random %s-named error when the Chat token is not cancelled",
    async (name) => {
      const context = new PairSharedContext({
        enabled: true,
        active: true,
        goal: "Navigate with evidence-backed questions.",
        role: "navigator",
        provider: "vscode-copilot",
        remainingCalls: 4,
        remainingInputTokens: 6_000,
        controlNotice: undefined,
        configurationWarning: undefined,
      });
      context.publishEvidence({
        uri: "file:///workspace/pair.ts",
        evidence,
        question: "Did you intend this dependency?",
      });
      let handler: vscode.ChatRequestHandler | undefined;
      const failure = new Error("must surface");
      failure.name = name;
      registerPairChatParticipant(
        (_id, registeredHandler) => {
          handler = registeredHandler;
          return { dispose: () => undefined } as vscode.ChatParticipant;
        },
        context,
        {
          generate: async () => {
            throw failure;
          },
        },
      );

      const result = await handler!(
        { command: "why", prompt: "" } as vscode.ChatRequest,
        {} as vscode.ChatContext,
        { markdown: () => undefined } as unknown as vscode.ChatResponseStream,
        {
          isCancellationRequested: false,
          onCancellationRequested: () => ({ dispose: () => undefined }),
        } as vscode.CancellationToken,
      );

      expect(result).toEqual({
        errorDetails: {
          message: "Adaptive Pair could not answer: must surface",
        },
      });
    },
  );
});
