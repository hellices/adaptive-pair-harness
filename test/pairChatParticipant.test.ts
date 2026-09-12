import { describe, expect, it } from "vitest";
import {
  PairSharedContext,
  buildPairChatPlan,
} from "../src/vscode/pairChatParticipant";
import type { Evidence } from "../src/core/types";

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
      goal: "Navigate with evidence-backed questions.",
      role: "navigator",
      provider: "local-template",
      remainingCalls: 4,
      remainingInputTokens: 6_000,
      controlNotice: undefined,
    });

    expect(buildPairChatPlan("why", context.snapshot())).toEqual({
      kind: "message",
      markdown:
        "No active evidence yet. Select code or run **Adaptive Pair: Review Current Block**.",
    });
  });

  it("reports the shared session without creating separate chat state", () => {
    const context = new PairSharedContext({
      goal: "Navigate with evidence-backed questions.",
      role: "navigator",
      provider: "vscode-copilot",
      remainingCalls: 3,
      remainingInputTokens: 5_700,
      controlNotice: "Cline detected; observing only.",
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
      goal: "Navigate with evidence-backed questions.",
      role: "navigator",
      provider: "local-template",
      remainingCalls: 4,
      remainingInputTokens: 6_000,
      controlNotice: undefined,
    });
    context.publishEvidence({
      uri: "file:///workspace/pair.ts",
      evidence,
      question: "Did you intend this dependency?",
    });

    expect(buildPairChatPlan("why", context.snapshot())).toMatchObject({
      kind: "generate",
      evidence,
      goal: expect.stringContaining("Did you intend this dependency?"),
    });
  });
});
