import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { PairAgentSession, type PairAgentSessionOptions } from "../src/vscode/pairAgentSession";
import { PairSharedContext, type PairPublishedEvidence } from "../src/vscode/pairChatParticipant";
import { buildProjectContext, confirmWorkingGoal, createWorkingAgreement } from "../src/core/projectContext";
import type { PairAgentMessage, PairAgentModel, PairAgentToolbox } from "../src/core/pairAgent";

const setup = (approved = true) => {
  const working = confirmWorkingGoal(createWorkingAgreement(buildProjectContext("file:///workspace", [{
    uri: "file:///workspace/README.md", label: "README.md", text: "# Goal\nPrevent duplicate charges.\n# Acceptance criteria\n- Survive a lost payment response.",
  }]), "initial"), "Make payment retries idempotent.", "working");
  const context = new PairSharedContext({
    enabled: true, active: true, generation: 1, working, goal: working.goal!, role: "navigator", provider: "local-template",
    remainingCalls: 4, remainingInputTokens: 24_000, controlNotice: undefined, configurationWarning: undefined,
  });
  const messages: PairAgentMessage[][] = [];
  const offeredTools: string[][] = [];
  const model: PairAgentModel = {
    countTokens: async () => 20,
    stream: async (input, tools) => {
      messages.push([...input]);
      offeredTools.push(tools.map((tool) => tool.name));
      return (async function* () {
        if (input.length === 1 && tools.some((tool) => tool.name === "read_file")) {
          yield { kind: "tool-call" as const, callId: "read-first", name: "read_file", input: { path: "README.md" } };
        } else {
          yield { kind: "text" as const, text: "First test the lost response, then implement identity reuse." };
        }
      })();
    },
  };
  const toolbox: PairAgentToolbox = {
    definitions: [
      { name: "read_file", kind: "read", description: "Read", inputSchema: {} },
      { name: "edit_file", kind: "edit", description: "Edit", inputSchema: {} },
      { name: "run_check", kind: "check", description: "Check", inputSchema: {} },
    ],
    invoke: vi.fn(async () => ({ status: "ok" as const, text: "Observed", summary: "Observed" })),
  };
  const approveWorkspace = vi.fn<PairAgentSessionOptions["approveWorkspace"]>(async () => approved);
  const createModel = vi.fn<PairAgentSessionOptions["createModel"]>(() => model);
  const createTools = vi.fn<PairAgentSessionOptions["createTools"]>(() => toolbox);
  const complete = vi.fn();
  const response = { text: vi.fn(), markdown: vi.fn(), progress: vi.fn(), code: vi.fn() };
  const session = new PairAgentSession({
    snapshot: () => context.snapshot(), approveWorkspace, createModel, createTools,
    isTrusted: () => true, onComplete: complete,
    focusedFiles: () => [{ path: "src/checkout.ts", startLine: 15, endLine: 22 }],
  });
  const request = { prompt: "Help implement safe retries.", model: { id: "chosen", vendor: "vendor", name: "Chosen model" }, references: [] } as unknown as vscode.ChatRequest;
  return { context, messages, offeredTools, model, toolbox, approveWorkspace, createModel, createTools, complete, response, session, request };
};

const inlineObservation: PairPublishedEvidence = {
  uri: "file:///workspace/src/retryPolicy.ts",
  rootUri: "file:///workspace",
  question: "Does this retry preserve the original payment identity?",
  evidence: {
    id: "retry-identity", kind: "public-api-change", severity: "warning", source: "semantic", confidence: 0.9,
    title: "Retry identity changed", detail: "The earlier edit created a new identity after a lost response.", references: [],
    range: { start: { line: 12, character: 0 }, end: { line: 16, character: 1 } },
  },
};

describe("interactive pairing session", () => {
  it("refuses direct agent entry when the current runtime is local-only", async () => {
    const harness = setup();
    harness.context.updateSession({ ...harness.context.snapshot().session, chatMode: "local-only" });
    await expect(harness.session.run(harness.request, { history: [] }, harness.response, new AbortController().signal)).rejects.toThrow(/current|changed/i);
    expect(harness.createModel).not.toHaveBeenCalled();
    expect(harness.approveWorkspace).not.toHaveBeenCalled();
  });

  it("uses the Chat model even when the background provider is local-template", async () => {
    const harness = setup();
    const result = await harness.session.run(harness.request, { history: [] }, harness.response, new AbortController().signal);
    expect(harness.createModel).toHaveBeenCalledWith(harness.request.model);
    expect(harness.messages).toHaveLength(2);
    expect(harness.offeredTools[0]).toEqual(["read_file"]);
    expect(JSON.stringify(harness.messages)).toContain("Survive a lost payment response");
    expect(JSON.stringify(harness.messages)).toContain("src/checkout.ts");
    expect(harness.approveWorkspace).toHaveBeenCalledWith(expect.stringContaining("Chosen model"), "file:///workspace", expect.any(AbortSignal));
    expect(result).toMatchObject({ metadata: { pairConversationId: "working" } });
    expect(harness.complete).toHaveBeenCalledWith("working", harness.request.prompt, "implement");
    expect(harness.context.snapshot().session.working?.shareWorkspaceContext).toBe(false);
  });

  it("does not expose project documents, file references, or tools without approval", async () => {
    const harness = setup(false);
    await harness.session.run(harness.request, { history: [] }, harness.response, new AbortController().signal);
    expect(harness.createTools).not.toHaveBeenCalled();
    expect(harness.offeredTools).toEqual([[]]);
    expect(JSON.stringify(harness.messages)).not.toContain("Survive a lost payment response");
    expect(JSON.stringify(harness.messages)).not.toContain("src/checkout.ts");
    expect(JSON.stringify(harness.messages)).toContain("Make payment retries idempotent");
    await harness.session.run(harness.request, { history: [] }, harness.response, new AbortController().signal);
    expect(harness.approveWorkspace).toHaveBeenCalledTimes(1);
  });

  it("provides a root-file brief path when no docs directory exists", async () => {
    const harness = setup();
    await harness.session.run({ ...harness.request, command: "brief", prompt: "" }, { history: [] }, harness.response, new AbortController().signal);
    expect(JSON.stringify(harness.messages)).toContain("WORKING-AGREEMENT.md");
  });

  it("grounds /why in the latest inline observation rather than a different focused file", async () => {
    const harness = setup();
    harness.context.publishEvidence(inlineObservation);
    await harness.session.run({ ...harness.request, command: "why", prompt: "" }, { history: [] }, harness.response, new AbortController().signal);
    const sent = JSON.stringify(harness.messages);
    expect(sent).toContain("src/retryPolicy.ts");
    expect(sent).toContain(inlineObservation.question);
    expect(sent).toContain(inlineObservation.evidence.detail);
    expect(sent).toMatch(/startLine\\+":13/u);
    expect(sent).toContain("Re-read the observed source");
    expect(harness.offeredTools.at(-1)).toEqual(["read_file"]);
  });

  it("does not share inline observations when workspace access is declined", async () => {
    const harness = setup(false);
    harness.context.publishEvidence(inlineObservation);
    await harness.session.run({ ...harness.request, command: "why", prompt: "" }, { history: [] }, harness.response, new AbortController().signal);
    expect(JSON.stringify(harness.messages)).not.toContain(inlineObservation.question);
    expect(JSON.stringify(harness.messages)).not.toContain("src/retryPolicy.ts");
  });

  it.each([
    ["file:///other", "file:///other/src/retryPolicy.ts"],
    ["file:///workspace", "file:///workspace-other/src/retryPolicy.ts"],
    ["file:///workspace", "file:///workspace/%2e%2e/other/retryPolicy.ts"],
    ["file:///workspace", "file:///workspace/src%2f..%2f..%2fother/retryPolicy.ts"],
  ])("does not send a cross-root observation tagged %s at %s", async (rootUri, uri) => {
    const harness = setup();
    harness.context.publishEvidence({ ...inlineObservation, rootUri, uri });
    await harness.session.run({ ...harness.request, command: "why", prompt: "" }, { history: [] }, harness.response, new AbortController().signal);
    expect(JSON.stringify(harness.messages)).not.toContain(inlineObservation.question);
  });

  it("states when /why has no approved inline observation instead of inventing one", async () => {
    const harness = setup();
    await harness.session.run({ ...harness.request, command: "why", prompt: "" }, { history: [] }, harness.response, new AbortController().signal);
    expect(JSON.stringify(harness.messages)).toContain("No approved inline observation is available");
  });

  it("requires separate approval for a different selected model", async () => {
    const harness = setup();
    await harness.session.run(harness.request, { history: [] }, harness.response, new AbortController().signal);
    await harness.session.run({ ...harness.request, model: { ...harness.request.model, id: "different", name: "Different model" } }, { history: [] }, harness.response, new AbortController().signal);
    expect(harness.approveWorkspace).toHaveBeenCalledTimes(2);
  });

  it("drops a pending approval when the working scope changes", async () => {
    const harness = setup();
    harness.approveWorkspace.mockImplementationOnce(async () => {
      const snapshot = harness.context.snapshot();
      harness.context.updateSession({ ...snapshot.session, working: { ...snapshot.session.working!, conversationId: "replacement" } });
      return true;
    });
    await expect(harness.session.run(harness.request, { history: [] }, harness.response, new AbortController().signal)).rejects.toThrow(/changed|current/i);
    expect(harness.messages).toHaveLength(0);
    expect(harness.createTools).not.toHaveBeenCalled();
    expect(harness.complete).not.toHaveBeenCalled();
  });

  it.each([
    ["plan", ["read_file"]],
    ["why", ["read_file"]],
    ["explain", ["read_file"]],
    ["trace", ["read_file"]],
    ["checkpoint", ["read_file", "run_check"]],
    ["brief", ["read_file", "edit_file"]],
    ["work", ["read_file", "edit_file", "run_check"]],
  ])("restricts tools for /%s", async (command, names) => {
    const harness = setup();
    await harness.session.run({ ...harness.request, command }, { history: [] }, harness.response, new AbortController().signal);
    expect(harness.offeredTools[0]).toEqual(["read_file"]);
    expect(harness.offeredTools.at(-1)).toEqual(names);
  });

  it("does not send a task whose sensitivity survived parsing", async () => {
    const harness = setup();
    const snapshot = harness.context.snapshot();
    harness.context.updateSession({ ...snapshot.session, working: { ...snapshot.session.working!, taskSensitiveDataDetected: true } });
    await expect(harness.session.run(harness.request, { history: [] }, harness.response, new AbortController().signal)).rejects.toThrow(/sensitive/i);
    expect(harness.messages).toHaveLength(0);
  });

  it("checks raw decision text before JSON escaping can hide multiline credentials", async () => {
    const harness = setup();
    const snapshot = harness.context.snapshot();
    harness.context.updateSession({ ...snapshot.session, working: { ...snapshot.session.working!, decisions: ["api_key\n=\n'never_forward_multiline_credential'"] } });
    await expect(harness.session.run(harness.request, { history: [] }, harness.response, new AbortController().signal)).rejects.toThrow(/sensitive/i);
    expect(harness.messages).toHaveLength(0);
  });

  it("can revoke model-specific workspace access without calling the model", async () => {
    const harness = setup();
    await harness.session.run(harness.request, { history: [] }, harness.response, new AbortController().signal);
    await harness.session.run({ ...harness.request, command: "access", prompt: "" }, { history: [] }, harness.response, new AbortController().signal);
    expect(harness.messages).toHaveLength(2);
    expect(harness.response.text).toHaveBeenCalledWith(expect.stringMatching(/revoked/i));
    await harness.session.run(harness.request, { history: [] }, harness.response, new AbortController().signal);
    expect(harness.offeredTools.at(-1)).toEqual([]);
  });
});
