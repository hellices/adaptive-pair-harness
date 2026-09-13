import { describe, expect, it, vi } from "vitest";
import {
  PAIR_CHAT_RESPONSE_DISPLAY_LIMIT,
  formatChatResponseForDisplay,
} from "../src/vscode/chatResponseDisplay";
import {
  PAIR_SHARED_CONTEXT_URI_REVISION_LIMIT,
  PairSharedContext,
  buildPairChatPlan,
  registerPairChatParticipant,
} from "../src/vscode/pairChatParticipant";
import type {
  PairChatRequestHandler,
  PairSessionSnapshot,
} from "../src/vscode/pairChatParticipant";
import type { PairChatResponse } from "../src/vscode/vsCodeChatResponse";
import type { Evidence } from "../src/core/types";
import type * as vscode from "vscode";

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

class RecordingChatResponse implements PairChatResponse {
  public readonly markdownValues: string[] = [];
  public readonly textValues: string[] = [];

  public markdown(value: string): void {
    this.markdownValues.push(value);
  }

  public text(value: string): void {
    this.textValues.push(value);
  }
}

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

const sessionFieldMutations: ReadonlyArray<{
  readonly label: string;
  readonly mutate: (session: PairSessionSnapshot) => PairSessionSnapshot;
}> = [
  {
    label: "enabled",
    mutate: (session) => ({ ...session, enabled: false }),
  },
  {
    label: "active",
    mutate: (session) => ({ ...session, active: false }),
  },
  {
    label: "generation",
    mutate: (session) => ({ ...session, generation: session.generation + 1 }),
  },
  {
    label: "goal",
    mutate: (session) => ({ ...session, goal: `${session.goal} Updated.` }),
  },
  {
    label: "provider",
    mutate: (session) => ({ ...session, provider: "local-template" }),
  },
  {
    label: "remaining calls",
    mutate: (session) => ({
      ...session,
      remainingCalls: session.remainingCalls - 1,
    }),
  },
  {
    label: "remaining input budget",
    mutate: (session) => ({
      ...session,
      remainingInputTokens: session.remainingInputTokens - 1,
    }),
  },
  {
    label: "remaining output budget",
    mutate: (session) => ({
      ...session,
      remainingOutputTokens: (session.remainingOutputTokens ?? 1) - 1,
    }),
  },
  {
    label: "control notice",
    mutate: (session) => ({
      ...session,
      controlNotice: "Another agent is active.",
    }),
  },
  {
    label: "configuration warning",
    mutate: (session) => ({
      ...session,
      configurationWarning: "Provider configuration changed.",
    }),
  },
];

const deferredResponseMutations = sessionFieldMutations.filter(
  ({ label }) =>
    label === "provider" ||
    label === "remaining calls" ||
    label === "remaining input budget" ||
    label === "remaining output budget" ||
    label === "control notice" ||
    label === "configuration warning",
);

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
      parts: [
        {
          kind: "markdown",
          value:
            "No active evidence yet. Select code or run **Adaptive Pair: Review Current Block**.",
        },
      ],
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
      parts: [
        { kind: "markdown", value: "**Goal:** " },
        { kind: "text", value: "Navigate with evidence-backed questions." },
        { kind: "markdown", value: "\n\n**Role:** " },
        { kind: "text", value: "navigator" },
        {
          kind: "markdown",
          value: " (you remain the driver)\n\n**Provider:** ",
        },
        { kind: "text", value: "vscode-copilot" },
        { kind: "markdown", value: "\n\n**Remaining budget:** " },
        {
          kind: "text",
          value: "3 calls / 5700 input tokens / 690 output tokens",
        },
        { kind: "markdown", value: "\n\n**Coexistence:** " },
        { kind: "text", value: "Cline detected; observing only." },
      ],
    });
  });

  it.each(sessionFieldMutations)(
    "advances the shared revision when the $label session field changes",
    ({ mutate }) => {
      const context = new PairSharedContext({
        enabled: true,
        active: true,
        generation: 1,
        goal: "Navigate with evidence-backed questions.",
        role: "navigator",
        provider: "vscode-copilot",
        remainingCalls: 4,
        remainingInputTokens: 6_000,
        remainingOutputTokens: 700,
        controlNotice: undefined,
        configurationWarning: undefined,
      });
      const before = context.snapshot().revision;

      context.updateSession(mutate(context.snapshot().session));

      expect(context.snapshot().revision).toBe(before + 1);
    },
  );

  it("keeps the shared revision stable for a semantically identical complete session snapshot", () => {
    const context = new PairSharedContext({
      enabled: true,
      active: true,
      generation: 1,
      goal: "Navigate with evidence-backed questions.",
      role: "navigator",
      provider: "vscode-copilot",
      remainingCalls: 4,
      remainingInputTokens: 6_000,
      remainingOutputTokens: 700,
      controlNotice: "Another agent is active.",
      configurationWarning: "Provider configuration changed.",
    });
    const before = context.snapshot().revision;

    context.updateSession({ ...context.snapshot().session });

    expect(context.snapshot().revision).toBe(before);
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
    let handler: PairChatRequestHandler | undefined;
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
      } as PairChatResponse,
      {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => undefined }),
      } as vscode.CancellationToken,
    );

    expect(generateCalls).toBe(0);
    expect(markdown.join("\n")).toContain("disabled");
  });

  it.each([
    ["disabled", false, false, "disabled"],
    ["inactive", true, false, "off"],
  ])(
    "shows %s guidance for /trace without starting symbol resolution",
    async (_label, enabled, active, guidance) => {
      const context = new PairSharedContext({
        enabled,
        active,
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
      const forEvidence = vi.fn(async () => undefined);
      const generate = vi.fn(async () => ({
        text: "remote",
        inputTokens: 1,
        outputTokens: 1,
      }));
      const markdown: string[] = [];
      let handler: PairChatRequestHandler | undefined;
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
        {
          markdown: (value: string) => {
            markdown.push(value);
          },
        } as PairChatResponse,
        {
          isCancellationRequested: false,
          onCancellationRequested: () => ({ dispose: () => undefined }),
        } as vscode.CancellationToken,
      );

      expect(markdown.join("\n")).toContain(guidance);
      expect(forEvidence).not.toHaveBeenCalled();
      expect(generate).not.toHaveBeenCalled();
    },
  );

  it("preserves explicit prompt and symbol detail until the remote boundary", () => {
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
    expect(plan.context.userPrompt).toBe(longPrompt);
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
      parts: [
        {
          kind: "markdown",
          value:
            "No current symbol could be resolved through VS Code's document symbol providers.",
        },
      ],
    });
  });

  it("invalidates captured context fences only when clearing latest evidence", () => {
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
    const originalRevision = context.snapshot().revision;
    const firstFence = context.captureRevisionFence();
    const secondFence = context.captureRevisionFence();

    context.clearEvidence("file:///workspace/other.ts");
    expect(context.snapshot().latest).toBeDefined();
    expect(context.snapshot().revision).toBe(originalRevision);
    expect(context.isRevisionFenceCurrent(firstFence)).toBe(true);
    expect(context.isRevisionFenceCurrent(secondFence)).toBe(true);

    context.clearEvidence("file:///workspace/pair.ts");
    expect(context.snapshot().latest).toBeUndefined();
    expect(context.snapshot().revision).toBe(originalRevision + 1);
    expect(context.isRevisionFenceCurrent(firstFence)).toBe(false);
    expect(context.isRevisionFenceCurrent(secondFence)).toBe(false);

    const clearedFence = context.captureRevisionFence();
    context.clearEvidence("file:///workspace/pair.ts");
    expect(context.snapshot().revision).toBe(originalRevision + 1);
    expect(context.isRevisionFenceCurrent(clearedFence)).toBe(true);
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

  it("retires a closed URI revision and assigns a newer revision when reused", () => {
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
    const uri = "file:///workspace/reused.ts";
    context.publishEvidence({
      uri,
      evidence,
      question: "Original evidence",
    });
    const originalRevision =
      context.captureEvidenceRevisionForUri(uri);

    context.releaseEvidenceUri(uri);

    expect(context.evidenceRevisionForUri(uri)).toBeUndefined();
    expect(context.snapshot().latest).toBeUndefined();

    context.publishEvidence({
      uri,
      evidence: { ...evidence, id: "dependency:reused" },
      question: "Reused URI evidence",
    });

    expect(context.evidenceRevisionForUri(uri)).toBeGreaterThan(
      originalRevision,
    );
  });

  it("captures a unique monotonic fence when a URI has no evidence revision", () => {
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
    const firstUri = "file:///workspace/absent-first.ts";
    const secondUri = "file:///workspace/absent-second.ts";

    expect(context.evidenceRevisionForUri(firstUri)).toBeUndefined();
    const firstFence = context.captureEvidenceRevisionForUri(firstUri);
    const secondFence = context.captureEvidenceRevisionForUri(secondUri);

    expect(context.evidenceRevisionForUri(firstUri)).toBe(firstFence);
    expect(context.evidenceRevisionForUri(secondUri)).toBe(secondFence);
    expect(secondFence).toBeGreaterThan(firstFence);
  });

  it("bounds URI revisions with least-recently-used eviction", () => {
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
    const firstUri = "file:///workspace/revision-0.ts";
    const secondUri = "file:///workspace/revision-1.ts";
    const revisions = new Map<string, number>();
    for (
      let index = 0;
      index < PAIR_SHARED_CONTEXT_URI_REVISION_LIMIT;
      index += 1
    ) {
      const uri = `file:///workspace/revision-${index}.ts`;
      context.publishEvidence({
        uri,
        evidence: { ...evidence, id: `dependency:${index}` },
        question: `Evidence ${index}`,
      });
      revisions.set(
        uri,
        context.captureEvidenceRevisionForUri(uri),
      );
    }

    expect(context.evidenceRevisionForUri(firstUri)).toBe(
      revisions.get(firstUri),
    );
    context.publishEvidence({
      uri: "file:///workspace/revision-overflow.ts",
      evidence: { ...evidence, id: "dependency:overflow" },
      question: "Overflow evidence",
    });

    expect(context.evidenceRevisionForUri(firstUri)).toBe(
      revisions.get(firstUri),
    );
    expect(context.evidenceRevisionForUri(secondUri)).toBeUndefined();

    context.publishEvidence({
      uri: secondUri,
      evidence: { ...evidence, id: "dependency:reused-after-eviction" },
      question: "Reused evicted URI evidence",
    });
    expect(context.evidenceRevisionForUri(secondUri)).toBeGreaterThan(
      revisions.get(secondUri)!,
    );
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
      parts: expect.arrayContaining([
        { kind: "markdown", value: "\n\n**Configuration:** " },
        {
          kind: "text",
          value: "Invalid provider; using local-template.",
        },
      ]),
    });
  });

  it("keeps trusted session Markdown separate from workspace and configuration text", () => {
    const context = new PairSharedContext({
      enabled: true,
      active: true,
      goal: "# [close](command:adaptivePair.stop) 목표 😀",
      role: "navigator",
      provider: "local-template",
      remainingCalls: 4,
      remainingInputTokens: 6_000,
      controlNotice:
        "![workspace](vscode://file/workspace/secret.ts) **observing**",
      configurationWarning:
        "<img src=x onerror=alert(1)> `unsafe` [start](command:adaptivePair.start)",
    });

    const plan = buildPairChatPlan("session", context.snapshot());

    expect(plan).toMatchObject({ kind: "message" });
    if (plan.kind !== "message") {
      throw new Error("Expected session message plan.");
    }
    expect(plan.parts).toEqual([
      { kind: "markdown", value: "**Goal:** " },
      {
        kind: "text",
        value: "# [close](command:adaptivePair.stop) 목표 😀",
      },
      { kind: "markdown", value: "\n\n**Role:** " },
      { kind: "text", value: "navigator" },
      {
        kind: "markdown",
        value: " (you remain the driver)\n\n**Provider:** ",
      },
      { kind: "text", value: "local-template" },
      { kind: "markdown", value: "\n\n**Remaining budget:** " },
      { kind: "text", value: "4 calls / 6000 input tokens" },
      { kind: "markdown", value: "\n\n**Coexistence:** " },
      {
        kind: "text",
        value:
          "![workspace](vscode://file/workspace/secret.ts) **observing**",
      },
      { kind: "markdown", value: "\n\n**Configuration:** " },
      {
        kind: "text",
        value:
          "<img src=x onerror=alert(1)> `unsafe` [start](command:adaptivePair.start)",
      },
    ]);
  });

  it("separates trusted session formatting from dynamic text at the response boundary", async () => {
    const goal = "# [stop](command:adaptivePair.stop) 목표 😀";
    const controlNotice =
      "![workspace](vscode://file/workspace/secret.ts) **observing**";
    const configurationWarning =
      "<img src=x onerror=alert(1)> `unsafe` [start](command:adaptivePair.start)";
    const context = new PairSharedContext({
      enabled: true,
      active: true,
      goal,
      role: "navigator",
      provider: "local-template",
      remainingCalls: 4,
      remainingInputTokens: 6_000,
      controlNotice,
      configurationWarning,
    });
    let handler: PairChatRequestHandler | undefined;
    const response = new RecordingChatResponse();
    registerPairChatParticipant(
      (_id, registeredHandler) => {
        handler = registeredHandler;
        return { dispose: () => undefined } as vscode.ChatParticipant;
      },
      context,
      {
        generate: async () => ({
          text: "unused",
          inputTokens: 1,
          outputTokens: 1,
        }),
      },
    );

    await handler!(
      { command: "session", prompt: "" } as vscode.ChatRequest,
      {} as vscode.ChatContext,
      response,
      {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => undefined }),
      } as vscode.CancellationToken,
    );

    expect(response.markdownValues.join("")).toContain("**Goal:**");
    expect(response.markdownValues.join("")).toContain("**Configuration:**");
    expect(response.markdownValues.join("")).not.toContain(goal);
    expect(response.markdownValues.join("")).not.toContain(controlNotice);
    expect(response.markdownValues.join("")).not.toContain(
      configurationWarning,
    );
    expect(response.textValues).toContain(goal);
    expect(response.textValues).toContain("local-template");
    expect(response.textValues).toContain(controlNotice);
    expect(response.textValues).toContain(configurationWarning);
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
    let handler: PairChatRequestHandler | undefined;
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
      } as PairChatResponse,
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
    let handler: PairChatRequestHandler | undefined;
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
    const text: string[] = [];
    const response = {
      markdown: (value: string) => {
        markdown.push(value);
      },
      text: (value: string) => {
        text.push(value);
      },
    } as PairChatResponse;
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
    expect(markdown).toEqual([]);
    expect(text).toEqual(["session started", "session stopped"]);
  });

  it("renders an untrusted session-control result through the text sink", async () => {
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
    const message = [
      "[close](command:adaptivePair.stop)",
      "![open](vscode://file/workspace/secret.ts)",
      "<img src=x onerror=alert(1)>",
      "``` **상태 😀**",
    ].join("\n");
    let handler: PairChatRequestHandler | undefined;
    const response = new RecordingChatResponse();
    registerPairChatParticipant(
      (_id, registeredHandler) => {
        handler = registeredHandler;
        return { dispose: () => undefined } as vscode.ChatParticipant;
      },
      context,
      {
        generate: async () => ({
          text: "unused",
          inputTokens: 1,
          outputTokens: 1,
        }),
      },
      {
        sessionControl: {
          isSessionActive: () => false,
          startSession: async () => ({
            kind: "started",
            active: true,
            message,
          }),
          stopSession: () => ({
            kind: "stopped",
            active: false,
            message: "unused",
          }),
        },
      },
    );

    await handler!(
      { command: "start", prompt: "" } as vscode.ChatRequest,
      {} as vscode.ChatContext,
      response,
      {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => undefined }),
      } as vscode.CancellationToken,
    );

    expect(response.textValues).toEqual([message]);
    expect(response.markdownValues).toEqual([]);
  });

  it("bounds a dynamic session-control response before display", async () => {
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
    const message =
      `Session started.\r\n${"😀".repeat(PAIR_CHAT_RESPONSE_DISPLAY_LIMIT)}`;
    let handler: PairChatRequestHandler | undefined;
    const response = new RecordingChatResponse();
    registerPairChatParticipant(
      (_id, registeredHandler) => {
        handler = registeredHandler;
        return { dispose: () => undefined } as vscode.ChatParticipant;
      },
      context,
      {
        generate: async () => ({
          text: "unused",
          inputTokens: 1,
          outputTokens: 1,
        }),
      },
      {
        sessionControl: {
          isSessionActive: () => false,
          startSession: async () => ({
            kind: "started",
            active: true,
            message,
          }),
          stopSession: () => ({
            kind: "stopped",
            active: false,
            message: "unused",
          }),
        },
      },
    );

    await handler!(
      { command: "start", prompt: "" } as vscode.ChatRequest,
      {} as vscode.ChatContext,
      response,
      {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => undefined }),
      } as vscode.CancellationToken,
    );

    expect(response.textValues).toEqual([
      formatChatResponseForDisplay(message),
    ]);
    expect(response.markdownValues).toEqual([]);
  });

  it("bounds dynamic session-plan fields while preserving fixed Markdown", async () => {
    const context = new PairSharedContext({
      enabled: true,
      active: true,
      goal: `Review\r\n${"界".repeat(PAIR_CHAT_RESPONSE_DISPLAY_LIMIT)}`,
      role: "navigator",
      provider: "local-template",
      remainingCalls: 4,
      remainingInputTokens: 6_000,
      controlNotice: undefined,
      configurationWarning: undefined,
    });
    let handler: PairChatRequestHandler | undefined;
    const writes: Array<{ readonly kind: "markdown" | "text"; value: string }> =
      [];
    registerPairChatParticipant(
      (_id, registeredHandler) => {
        handler = registeredHandler;
        return { dispose: () => undefined } as vscode.ChatParticipant;
      },
      context,
      {
        generate: async () => ({
          text: "unused",
          inputTokens: 1,
          outputTokens: 1,
        }),
      },
    );

    await handler!(
      { command: "session", prompt: "" } as vscode.ChatRequest,
      {} as vscode.ChatContext,
      {
        markdown: (value) => writes.push({ kind: "markdown", value }),
        text: (value) => writes.push({ kind: "text", value }),
      },
      {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => undefined }),
      } as vscode.CancellationToken,
    );

    expect(writes[0]).toEqual({ kind: "markdown", value: "**Goal:** " });
    expect(writes[1]).toMatchObject({
      kind: "text",
      value: expect.stringMatching(/^Review\n界+$/u),
    });
    expect(writes.at(-1)).toEqual({ kind: "text", value: "…" });
    const displayed = writes.map(({ value }) => value).join("");
    expect([...displayed]).toHaveLength(PAIR_CHAT_RESPONSE_DISPLAY_LIMIT);
    expect(displayed).not.toContain("\r");
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
    let handler: PairChatRequestHandler | undefined;
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
      {
        markdown: () => undefined,
        text: () => undefined,
      },
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
    let handler: PairChatRequestHandler | undefined;
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
      {
        markdown: () => undefined,
        text: () => undefined,
      },
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

  it("preserves local evidence identity and accepts a current response", async () => {
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
    const sensitiveIdEvidence = {
      ...evidence,
      id: "authorization=Bearer secret-value",
    };
    context.publishEvidence({
      uri: "file:///workspace/evidence.ts",
      evidence: sensitiveIdEvidence,
      question: "Did you intend this dependency?",
    });
    const plan = buildPairChatPlan("why", context.snapshot());
    expect(plan).toMatchObject({ kind: "generate" });
    if (plan.kind !== "generate") {
      throw new Error("Expected generation plan.");
    }
    expect(plan.evidence.id).toBe(sensitiveIdEvidence.id);

    let handler: PairChatRequestHandler | undefined;
    const markdown = vi.fn();
    const text = vi.fn();
    registerPairChatParticipant(
      (_id, registeredHandler) => {
        handler = registeredHandler;
        return { dispose: () => undefined } as vscode.ChatParticipant;
      },
      context,
      {
        generate: async () => ({
          text: "current sanitized response",
          inputTokens: 1,
          outputTokens: 1,
        }),
      },
    );

    await handler!(
      { command: "why", prompt: "" } as vscode.ChatRequest,
      {} as vscode.ChatContext,
      { markdown, text },
      {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => undefined }),
      } as vscode.CancellationToken,
    );

    expect(text).toHaveBeenCalledWith("current sanitized response");
    expect(markdown).not.toHaveBeenCalled();
  });

  it.each([
    [
      "local fallback",
      "local-template" as const,
      `**Local fallback**\r\n${"l".repeat(
        PAIR_CHAT_RESPONSE_DISPLAY_LIMIT,
      )}`,
    ],
    [
      "OpenAI-compatible",
      "openai-compatible" as const,
      "o".repeat(64 * 1_024),
    ],
    [
      "Copilot CJK and emoji",
      "vscode-copilot" as const,
      `## 분석\r\n\r\n${"界😀".repeat(PAIR_CHAT_RESPONSE_DISPLAY_LIMIT)}`,
    ],
  ])(
    "bounds and normalizes a successful %s Chat response immediately before display",
    async (_label, provider, generatedText) => {
      const context = new PairSharedContext({
        enabled: true,
        active: true,
        goal: "Navigate with evidence-backed questions.",
        role: "navigator",
        provider,
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
      let handler: PairChatRequestHandler | undefined;
      const response = new RecordingChatResponse();
      registerPairChatParticipant(
        (_id, registeredHandler) => {
          handler = registeredHandler;
          return { dispose: () => undefined } as vscode.ChatParticipant;
        },
        context,
        {
          generate: async () => ({
            text: generatedText,
            inputTokens: 1,
            outputTokens: 1,
          }),
        },
      );

      await handler!(
        { command: "why", prompt: "" } as vscode.ChatRequest,
        {} as vscode.ChatContext,
        response,
        {
          isCancellationRequested: false,
          onCancellationRequested: () => ({ dispose: () => undefined }),
        } as vscode.CancellationToken,
      );

      expect(response.textValues).toEqual([
        formatChatResponseForDisplay(generatedText),
      ]);
      expect(response.markdownValues).toEqual([]);
    },
  );

  it.each(["why", "explain", "trace"] as const)(
    "renders remote /%s output only through the inert text sink",
    async (command) => {
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
      const generatedText = [
        "ordinary Unicode: 분석 😀",
        "nested URL: https://example.test/a(https://nested.example/path?q=1)",
        "Unicode email: 사용자@예시.한국",
        "`inline [link](https://inline.example)`",
        "```ts",
        "const value = '[code](https://code.example)';",
        "```",
        "[close](command:adaptivePair.stop)",
        "![open](vscode://file/workspace/secret.ts)",
        "[payload](data:text/html,<svg/onload=alert(1)>)",
        "[local](file:///workspace/secret.ts)",
        "[one](https://one.example) and [two](https://two.example)",
        "<img src=x onerror=alert(1)>",
      ].join("\n");
      let handler: PairChatRequestHandler | undefined;
      const response = new RecordingChatResponse();
      registerPairChatParticipant(
        (_id, registeredHandler) => {
          handler = registeredHandler;
          return { dispose: () => undefined } as vscode.ChatParticipant;
        },
        context,
        {
          generate: async () => ({
            text: generatedText,
            inputTokens: 1,
            outputTokens: 1,
          }),
        },
        {
          symbolContextProvider: {
            forEvidence: async () => ({
              name: "handler",
              kind: "Function",
              range: evidence.range,
            }),
          },
        },
      );

      await handler!(
        { command, prompt: "" } as vscode.ChatRequest,
        {} as vscode.ChatContext,
        response,
        {
          isCancellationRequested: false,
          onCancellationRequested: () => ({ dispose: () => undefined }),
        } as vscode.CancellationToken,
      );

      expect(response.textValues).toEqual([generatedText]);
      expect(response.markdownValues).toEqual([]);
    },
  );

  it.each(deferredResponseMutations)(
    "rejects deferred model output after a $label session update",
    async ({ mutate }) => {
      const context = new PairSharedContext({
        enabled: true,
        active: true,
        generation: 1,
        goal: "Navigate with evidence-backed questions.",
        role: "navigator",
        provider: "vscode-copilot",
        remainingCalls: 4,
        remainingInputTokens: 6_000,
        remainingOutputTokens: 700,
        controlNotice: undefined,
        configurationWarning: undefined,
      });
      context.publishEvidence({
        uri: "file:///workspace/evidence.ts",
        evidence,
        question: "Did you intend this dependency?",
      });
      const modelStarted = deferred<void>();
      const modelCompletion = deferred<{
        text: string;
        inputTokens: number;
        outputTokens: number;
      }>();
      let handler: PairChatRequestHandler | undefined;
      const markdown = vi.fn();
      registerPairChatParticipant(
        (_id, registeredHandler) => {
          handler = registeredHandler;
          return { dispose: () => undefined } as vscode.ChatParticipant;
        },
        context,
        {
          generate: () => {
            modelStarted.resolve();
            return modelCompletion.promise;
          },
        },
      );

      const pendingResponse = handler!(
        { command: "why", prompt: "" } as vscode.ChatRequest,
        {} as vscode.ChatContext,
        { markdown } as unknown as PairChatResponse,
        {
          isCancellationRequested: false,
          onCancellationRequested: () => ({ dispose: () => undefined }),
        } as vscode.CancellationToken,
      );
      await modelStarted.promise;
      context.updateSession(mutate(context.snapshot().session));
      modelCompletion.resolve({
        text: "stale session output",
        inputTokens: 1,
        outputTokens: 1,
      });
      await pendingResponse;

      expect(markdown).not.toHaveBeenCalled();
    },
  );

  it("rejects stale model output across a runtime rebuild with identical visible state", async () => {
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
    let handler: PairChatRequestHandler | undefined;
    const markdown = vi.fn();
    registerPairChatParticipant(
      (_id, registeredHandler) => {
        handler = registeredHandler;
        return { dispose: () => undefined } as vscode.ChatParticipant;
      },
      context,
      {
        generate: () => modelCompletion.promise,
      },
    );

    const pendingResponse = handler!(
      { command: "why", prompt: "" } as vscode.ChatRequest,
      {} as vscode.ChatContext,
      { markdown } as unknown as PairChatResponse,
      {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => undefined }),
      } as vscode.CancellationToken,
    );
    context.beginRuntime();
    context.updateSession({ ...context.snapshot().session, generation: 1 });
    context.publishEvidence(latest);
    modelCompletion.resolve({
      text: "stale rebuilt-runtime output",
      inputTokens: 1,
      outputTokens: 1,
    });
    await pendingResponse;

    expect(markdown).not.toHaveBeenCalled();
  });

  it("rejects stale trace resolution across a runtime rebuild with identical visible state", async () => {
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
    const symbolResolution = deferred<{
      name: string;
      kind: string;
      range: Evidence["range"];
    }>();
    let handler: PairChatRequestHandler | undefined;
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
          forEvidence: () => symbolResolution.promise,
        },
      },
    );

    const pendingTrace = handler!(
      { command: "trace", prompt: "" } as vscode.ChatRequest,
      {} as vscode.ChatContext,
      { markdown: vi.fn() } as unknown as PairChatResponse,
      {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => undefined }),
      } as vscode.CancellationToken,
    );
    context.beginRuntime();
    context.updateSession({ ...context.snapshot().session, generation: 1 });
    context.publishEvidence(latest);
    symbolResolution.resolve({
      name: "loadRepository",
      kind: "Function",
      range: evidence.range,
    });
    await pendingTrace;

    expect(generate).not.toHaveBeenCalled();
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
    let handler: PairChatRequestHandler | undefined;
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
      { markdown } as unknown as PairChatResponse,
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
    let handler: PairChatRequestHandler | undefined;
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
      { markdown } as unknown as PairChatResponse,
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
      let handler: PairChatRequestHandler | undefined;
      const failure = new Error("must surface");
      failure.name = name;
      const text = vi.fn();
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
        { markdown: () => undefined, text },
        {
          isCancellationRequested: false,
          onCancellationRequested: () => ({ dispose: () => undefined }),
        } as vscode.CancellationToken,
      );

      expect(result).toEqual({
        errorDetails: {
          message: "Adaptive Pair could not answer.",
        },
      });
      expect(text).toHaveBeenCalledWith(
        "Adaptive Pair could not answer: must surface",
      );
    },
  );

  it("bounds and normalizes dynamic provider error detail", async () => {
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
    const errorMessage =
      `provider\r\nfailed\u0000${"x".repeat(PAIR_CHAT_RESPONSE_DISPLAY_LIMIT)}`;
    let handler: PairChatRequestHandler | undefined;
    const text = vi.fn();
    registerPairChatParticipant(
      (_id, registeredHandler) => {
        handler = registeredHandler;
        return { dispose: () => undefined } as vscode.ChatParticipant;
      },
      context,
      {
        generate: async () => {
          throw new Error(errorMessage);
        },
      },
    );

    const result = await handler!(
      { command: "why", prompt: "" } as vscode.ChatRequest,
      {} as vscode.ChatContext,
      { markdown: () => undefined, text },
      {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => undefined }),
      } as vscode.CancellationToken,
    );

    expect(result).toEqual({
      errorDetails: {
        message: "Adaptive Pair could not answer.",
      },
    });
    expect(text).toHaveBeenCalledWith(
      formatChatResponseForDisplay(
        `Adaptive Pair could not answer: ${errorMessage}`,
      ),
    );
  });

  it("renders malicious provider error detail through text and returns a fixed error result", async () => {
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
    const errorMessage = [
      "[retry](command:adaptivePair.start)",
      "![open](vscode://file/workspace/secret.ts)",
      "<script>alert(1)</script>",
      "``` **오류 😀**",
    ].join("\n");
    let handler: PairChatRequestHandler | undefined;
    const markdown = vi.fn();
    const text = vi.fn();
    registerPairChatParticipant(
      (_id, registeredHandler) => {
        handler = registeredHandler;
        return { dispose: () => undefined } as vscode.ChatParticipant;
      },
      context,
      {
        generate: async () => {
          throw new Error(errorMessage);
        },
      },
    );

    const result = await handler!(
      { command: "why", prompt: "" } as vscode.ChatRequest,
      {} as vscode.ChatContext,
      { markdown, text } as PairChatResponse,
      {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => undefined }),
      } as vscode.CancellationToken,
    );

    expect(result).toEqual({
      errorDetails: {
        message: "Adaptive Pair could not answer.",
      },
    });
    expect(text).toHaveBeenCalledWith(
      `Adaptive Pair could not answer: ${errorMessage}`,
    );
    expect(markdown).not.toHaveBeenCalled();
  });
});
