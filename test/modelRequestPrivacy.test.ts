import { describe, expect, it } from "vitest";
import {
  buildOpenAICompatiblePromptPayload,
} from "../src/core/modelRouter";
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
});
