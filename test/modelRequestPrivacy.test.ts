import { describe, expect, it } from "vitest";
import {
  buildOpenAICompatiblePromptPayload,
  prepareRemoteModelRequest,
} from "../src/core/modelRouter";
import {
  PairSharedContext,
  buildPairChatPlan,
} from "../src/vscode/pairChatParticipant";
import { buildCopilotPrompt } from "../src/vscode/vsCodeLanguageModelProvider";
import type { ModelRequest } from "../src/core/modelRouter";

describe("remote model request privacy", () => {
  it("removes unbounded third-party diagnostic text and preserves safe metadata", () => {
    const secret = "sk-do-not-forward-this-secret";
    const sourceSnippet = "const privateToken = process.env.PRODUCTION_TOKEN;";
    const unboundedCode = `TS${"9".repeat(500)}`;
    const request: ModelRequest = {
      goal: "Explain the current diagnostic.",
      interactionStyle: "ask-first",
      evidence: {
        id: "diagnostic:file:///workspace/private.ts:10:2",
        kind: "diagnostic",
        severity: "error",
        title: "Editor diagnostic",
        detail: `${sourceSnippet} ${secret} ${"long-message ".repeat(200)}`,
        source: "typescript",
        confidence: 0.97,
        range: {
          start: { line: 10, character: 2 },
          end: { line: 10, character: 22 },
        },
        references: ["TS2322", unboundedCode],
      },
    };

    for (const payload of [
      JSON.stringify(buildOpenAICompatiblePromptPayload(request)),
      buildCopilotPrompt(request),
    ]) {
      expect(payload).not.toContain(secret);
      expect(payload).not.toContain(sourceSnippet);
      expect(payload).not.toContain(unboundedCode);
      expect(payload.length).toBeLessThan(2_000);
      expect(payload).toContain("typescript");
      expect(payload).toContain("Diagnostic code: TS2322");
      expect(payload).toContain("error");
      expect(payload).toContain("10:2-10:22");
      expect(payload).toContain("Problems");
    }
  });

  it("serializes bounded explicit Chat prompt and symbol fields without source text", () => {
    const request: ModelRequest = {
      goal: "Trace the current evidence.",
      interactionStyle: "ask-first",
      evidence: {
        id: "complexity:handleRequest",
        kind: "complexity-growth",
        severity: "warning",
        title: "Control-flow complexity increased",
        detail: "Added two branch points.",
        source: "typescript-semantic-analyzer",
        confidence: 0.89,
        range: {
          start: { line: 10, character: 2 },
          end: { line: 20, character: 3 },
        },
        references: ["handleRequest"],
      },
      context: {
        userPrompt: `Why is this risky? ${"p".repeat(1_000)}`,
        symbol: {
          name: "handleRequest",
          kind: "Function",
          range: {
            start: { line: 10, character: 2 },
            end: { line: 20, character: 3 },
          },
        },
      },
    };

    for (const payload of [
      JSON.stringify(buildOpenAICompatiblePromptPayload(request)),
      buildCopilotPrompt(request),
    ]) {
      expect(payload).toContain("User prompt: Why is this risky?");
      expect(payload).toContain("Current symbol: handleRequest (Function)");
      expect(payload).toContain("Symbol range: 10:2-20:3");
      expect(payload).not.toContain("p".repeat(501));
      expect(payload).not.toContain("selectionText");
      expect(payload).not.toContain("sourceText");
    }
  });

  it("never promotes tainted diagnostic text or the latest local question into remote Chat fields", () => {
    const secret = "prod-secret-should-never-leave";
    const sourceCode = "const adminToken = readSecretFromDisk();";
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
      uri: "file:///workspace/private.ts",
      evidence: {
        id: "diagnostic:file:///workspace/private.ts:3:1",
        kind: "diagnostic",
        severity: "error",
        title: "Editor diagnostic",
        detail: `${sourceCode} // ${secret}`,
        source: "typescript",
        confidence: 0.97,
        range: {
          start: { line: 3, character: 1 },
          end: { line: 3, character: 12 },
        },
        references: ["TS2322"],
      },
      question: `Why does ${sourceCode} contain ${secret}?`,
    });

    const plan = buildPairChatPlan("why", context.snapshot(), {
      prompt: "Please explain this diagnostic.",
    });
    expect(plan.kind).toBe("generate");
    const serialized = JSON.stringify(plan);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(sourceCode);
    expect(serialized).toContain(
      "See VS Code Problems for the complete diagnostic message.",
    );
    expect(serialized).toContain("Please explain this diagnostic.");
  });

  it("centrally redacts credentials from every semantic and Chat text field", () => {
    const apiKey = "sk-1234567890abcdefghijklmnop";
    const bearer = "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature";
    const userInfoUrl =
      "https://alice:password123@example.test/path?token=query-secret&safe=value";
    const longSecret = "AbCdEf0123456789_".repeat(5);
    const request: ModelRequest = {
      goal: `Explain api_key=${apiKey}`,
      interactionStyle: "ask-first",
      evidence: {
        id: `semantic:${apiKey}`,
        kind: "new-dependency",
        severity: "warning",
        title: `Imported ${bearer}`,
        detail: `Dependency URL ${userInfoUrl}`,
        source: `credential=${longSecret}`,
        confidence: 0.94,
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 8 },
        },
        references: [
          `https://example.test/pkg?access_token=${apiKey}`,
          longSecret,
        ],
      },
      context: {
        userPrompt: `password: ${longSecret}`,
        symbol: {
          name: `handler_${apiKey}`,
          kind: `Function ${bearer}`,
          range: {
            start: { line: 1, character: 0 },
            end: { line: 3, character: 1 },
          },
        },
      },
    };

    const prepared = prepareRemoteModelRequest(request);
    const serialized = JSON.stringify(prepared.request);

    expect(prepared.sensitiveDataDetected).toBe(true);
    for (const secret of [
      apiKey,
      bearer,
      "alice",
      "password123",
      "query-secret",
      longSecret,
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("[REDACTED]");
  });

  it("marks sensitive automatic evidence for local-only handling", () => {
    const prepared = prepareRemoteModelRequest({
      goal: "Ask about this edit.",
      interactionStyle: "ask-first",
      evidence: {
        id: "dependency:sensitive",
        kind: "new-dependency",
        severity: "warning",
        title: "New dependency introduced",
        detail:
          "Imported https://packages.example/module?api_key=workspace-secret.",
        source: "typescript-semantic-analyzer",
        confidence: 0.94,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 10 },
        },
        references: [
          "https://packages.example/module?api_key=workspace-secret",
        ],
      },
    });

    expect(prepared.sensitiveDataDetected).toBe(true);
    expect(prepared.request.evidence.detail).not.toContain("workspace-secret");
  });
});
