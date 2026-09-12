import { describe, expect, it } from "vitest";
import {
  PairSharedContext,
  buildPairChatPlan,
  registerPairChatParticipant,
} from "../src/vscode/pairChatParticipant";
import type { Evidence } from "../src/core/types";
import type * as vscode from "vscode";

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
      goal: "Navigate with evidence-backed questions.",
      role: "navigator",
      provider: "vscode-copilot",
      remainingCalls: 3,
      remainingInputTokens: 5_700,
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
        "**Remaining budget:** 3 calls / 5700 input tokens",
        "**Coexistence:** Cline detected; observing only.",
      ].join("\n\n"),
    });
  });

  it("expands the most recent inline question from the same evidence", () => {
    const context = new PairSharedContext({
      enabled: true,
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
      goal: expect.stringContaining("Did you intend this dependency?"),
    });
  });

  it("does not invoke Chat generation while Pair is disabled", async () => {
    const context = new PairSharedContext({
      enabled: false,
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
});
