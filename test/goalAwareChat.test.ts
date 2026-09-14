import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { buildPairChatPlan, PairSharedContext, registerPairChatParticipant } from "../src/vscode/pairChatParticipant";
import type { PairChatRequestHandler } from "../src/vscode/pairChatParticipant";
import { buildProjectContext, confirmWorkingGoal, createWorkingAgreement } from "../src/core/projectContext";
import type { Evidence } from "../src/core/types";

const currentEvidence: Evidence = {
  id: "dependency:checkout", kind: "new-dependency", severity: "warning",
  title: "New dependency", detail: "Check the checkout boundary.",
  source: "typescript-semantic-analyzer", confidence: 0.94,
  range: { start: { line: 95, character: 0 }, end: { line: 95, character: 20 } },
  references: [],
};

const makeContext = () => {
  const working = confirmWorkingGoal(
    createWorkingAgreement(buildProjectContext("file:///workspace", []), "initial"),
    "Prevent duplicate charges during retries.",
    "confirmed",
  );
  return new PairSharedContext({
    enabled: true, active: true, generation: 1,
    goal: working.goal!, working,
    role: "navigator", provider: "local-template", remainingCalls: 4,
    remainingInputTokens: 6_000, controlNotice: undefined, configurationWarning: undefined,
  });
};

describe("goal-aware chat planning", () => {
  it("plans before any code evidence exists", () => {
    const plan = buildPairChatPlan("plan", makeContext().snapshot(), { prompt: "Help me choose the first acceptance test." });
    expect(plan).toMatchObject({
      kind: "generate", purpose: "plan", goal: "Prevent duplicate charges during retries.",
      context: { userPrompt: "Help me choose the first acceptance test." },
    });
    expect("evidence" in plan && plan.evidence).toBeFalsy();
  });

  it("routes ordinary pre-edit dialogue to planning rather than asking for a warning", () => {
    expect(buildPairChatPlan(undefined, makeContext().snapshot(), { prompt: "The network can fail after a payment succeeds." })).toMatchObject({ kind: "generate", purpose: "plan" });
  });

  it("can checkpoint with a reported test result but no warning", () => {
    expect(buildPairChatPlan("checkpoint", makeContext().snapshot(), { prompt: "The retry test passes; timeout coverage is missing." })).toMatchObject({ kind: "generate", purpose: "checkpoint" });
  });

  it("keeps why evidence-backed instead of fabricating a warning", () => {
    expect(buildPairChatPlan("why", makeContext().snapshot()).kind).toBe("message");
  });

  it("shows working phase and context sharing in the session view", () => {
    const plan = buildPairChatPlan("session", makeContext().snapshot());
    expect(plan.kind).toBe("message");
    if (plan.kind === "message") {
      const text = plan.parts.map((part) => part.value).join("");
      expect(text).toContain("plan");
      expect(text).toContain("local only");
      expect(text).toContain("Prevent duplicate charges");
    }
  });

  it("invalidates request fences when the working agreement changes", () => {
    const context = makeContext();
    const fence = context.captureRevisionFence();
    const snapshot = context.snapshot();
    context.updateSession({ ...snapshot.session, working: { ...snapshot.session.working!, shareWorkspaceContext: true } });
    expect(context.isRevisionFenceCurrent(fence)).toBe(false);
  });

  it("uses a clarification goal rather than an evidence explanation when no goal is confirmed", () => {
    const context = makeContext();
    context.updateSession({ ...context.snapshot().session, working: createWorkingAgreement(buildProjectContext(undefined, []), "empty") });
    const plan = buildPairChatPlan("plan", context.snapshot());
    expect(plan).toMatchObject({ kind: "generate", goal: expect.stringContaining("acceptance criteria") });
  });

  it.each(["file:///sibling", undefined])("omits evidence without matching working-root ownership: %s", (rootUri) => {
    const context = makeContext();
    context.publishEvidence({ uri: "file:///sibling/current.ts", ...(rootUri === undefined ? {} : { rootUri }), evidence: currentEvidence, question: "Review this dependency." });
    const plan = buildPairChatPlan("plan", context.snapshot());
    expect(plan).toMatchObject({ kind: "generate", uri: "file:///workspace", purpose: "plan" });
    expect("evidence" in plan && plan.evidence).toBeFalsy();
  });

  it("keeps evidence with verified ownership in the working root", () => {
    const context = makeContext();
    context.publishEvidence({ uri: "file:///workspace/current.ts", rootUri: "file:///workspace", evidence: currentEvidence, question: "Review this dependency." });
    expect(buildPairChatPlan("plan", context.snapshot())).toMatchObject({ evidence: currentEvidence });
  });

  it("does not attach another root's working goal or dialogue to an evidence explanation", () => {
    const context = makeContext();
    context.publishEvidence({ uri: "file:///sibling/current.ts", rootUri: "file:///sibling", evidence: currentEvidence, question: "Review this dependency." });
    const plan = buildPairChatPlan("why", context.snapshot(), { prompt: "Explain the warning.", conversation: [{ role: "user", content: "Workspace-only decision." }] });
    expect(plan).toMatchObject({ kind: "generate", uri: "file:///sibling/current.ts", evidence: currentEvidence, context: { userPrompt: "Explain the warning." } });
    expect(JSON.stringify(plan)).not.toContain("Prevent duplicate charges");
    expect(JSON.stringify(plan)).not.toContain("Workspace-only decision");
  });
});

describe("goal-aware chat handler", () => {
  const setup = () => {
    const context = makeContext();
    const generate = vi.fn(async () => ({ text: "First test the lost response.", inputTokens: 0, outputTokens: 0 }));
    const setGoal = vi.fn(async () => "Goal confirmed.");
    let handler!: PairChatRequestHandler;
    registerPairChatParticipant((_id, registered) => {
      handler = registered;
      return { dispose: () => undefined } as vscode.ChatParticipant;
    }, context, { generate }, { workingControl: {
      setGoal,
      refreshContext: async () => "Documents refreshed.",
      draftBrief: async () => "Draft opened unsaved.",
    } });
    const text = vi.fn();
    const response = { text, markdown: vi.fn() };
    const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }) } as unknown as vscode.CancellationToken;
    return { context, handler, generate, setGoal, text, response, token };
  };

  it("routes goal confirmation to the working control without a model call", async () => {
    const harness = setup();
    await harness.handler({ command: "goal", prompt: "Ship a prototype." } as vscode.ChatRequest, { history: [] }, harness.response, harness.token);
    expect(harness.setGoal).toHaveBeenCalledWith("Ship a prototype.", expect.any(AbortSignal));
    expect(harness.generate).not.toHaveBeenCalled();
    expect(harness.text).toHaveBeenCalledWith("Goal confirmed.");
  });

  it("supplies previous user replies and returns scope metadata", async () => {
    const harness = setup();
    const history = [
      { prompt: "We cannot replace the payment provider.", participant: "adaptivePair.chat" },
      { participant: "adaptivePair.chat", result: { metadata: { pairConversationId: "confirmed" } }, response: [{ value: { value: "Keep the provider." } }] },
    ] as unknown as vscode.ChatContext["history"];
    const result = await harness.handler({ command: "plan", prompt: "What is next?" } as vscode.ChatRequest, { history }, harness.response, harness.token);
    expect(harness.generate).toHaveBeenCalledWith(expect.any(String), expect.any(String), undefined, expect.any(AbortSignal), expect.objectContaining({
      conversation: [{ role: "user", content: "We cannot replace the payment provider." }],
    }), "plan", expect.any(Object));
    expect(result).toMatchObject({ metadata: { pairConversationId: "confirmed" } });
  });

  it("does not forward an out-of-root local reply under the working root's consent", async () => {
    const harness = setup();
    harness.context.updateSession({ ...harness.context.snapshot().session, working: { ...harness.context.snapshot().session.working!, shareWorkspaceContext: true } });
    harness.context.publishEvidence({ uri: "file:///sibling/current.ts", rootUri: "file:///sibling", evidence: currentEvidence, question: "Review this dependency." });
    const siblingText = "Only the sibling root contains this business rule.";
    harness.generate.mockResolvedValueOnce({ text: siblingText, inputTokens: 0, outputTokens: 0 });
    const result = await harness.handler({ command: "why", prompt: "Why?" } as vscode.ChatRequest, { history: [] }, harness.response, harness.token);
    expect(harness.text).toHaveBeenCalledWith(siblingText);
    expect(result?.metadata?.pairConversationId).toBeUndefined();
    const history = [
      { command: "why", prompt: "Why?", participant: "adaptivePair.chat" },
      { participant: "adaptivePair.chat", result: result ?? {}, response: [{ value: { value: siblingText } }] },
    ] as unknown as vscode.ChatContext["history"];
    await harness.handler({ command: "plan", prompt: "What is next?" } as vscode.ChatRequest, { history }, harness.response, harness.token);
    expect(JSON.stringify(harness.generate.mock.calls.at(-1))).not.toContain(siblingText);
  });
});
