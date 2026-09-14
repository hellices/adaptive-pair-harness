import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { PairSharedContext, registerPairChatParticipant, type PairChatParticipantOptions, type PairChatRequestHandler } from "../src/vscode/pairChatParticipant";

const setup = (active = true, enabled = true) => {
  const context = new PairSharedContext({ enabled, active, generation: 1, goal: "Pair on the task.", role: "navigator", provider: "local-template", remainingCalls: 4, remainingInputTokens: 24_000, controlNotice: undefined, configurationWarning: undefined });
  const run = vi.fn<(request: vscode.ChatRequest, history: vscode.ChatContext, response: unknown, signal: AbortSignal) => Promise<vscode.ChatResult>>(async () => ({ metadata: { agent: true } }));
  const generate = vi.fn(async () => ({ text: "Local template", inputTokens: 0, outputTokens: 0 }));
  let agentEnabled = true;
  const startSession = vi.fn<NonNullable<PairChatParticipantOptions["sessionControl"]>["startSession"]>(async () => {
    context.updateSession({ ...context.snapshot().session, active: true, generation: 2 });
    return { kind: "started" as const, active: true, message: "Pair started." };
  });
  let handler!: PairChatRequestHandler;
  registerPairChatParticipant((_id, registered) => { handler = registered; return { dispose: () => undefined } as vscode.ChatParticipant; }, context, { generate }, {
    workspaceAgent: { enabled: () => agentEnabled, run },
    sessionControl: { startSession, stopSession: () => ({ kind: "stopped", active: false, message: "Stopped." }), isSessionActive: () => context.snapshot().session.active },
  });
  const response = { markdown: vi.fn(), text: vi.fn() };
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }) } as vscode.CancellationToken;
  const request = { prompt: "Read the requirements and work with me.", model: { id: "selected" } } as unknown as vscode.ChatRequest;
  return { context, run, generate, startSession, handler, response, token, request, disableAgent: () => { agentEnabled = false; } };
};

describe("workspace agent Chat entry", () => {
  it("dispatches ordinary Chat to the real agent instead of the configured template", async () => {
    const harness = setup();
    const result = await harness.handler(harness.request, { history: [] }, harness.response, harness.token);
    expect(harness.run).toHaveBeenCalledWith(harness.request, { history: [] }, harness.response, expect.any(AbortSignal));
    expect(harness.generate).not.toHaveBeenCalled();
    expect(result).toEqual({ metadata: { agent: true } });
  });

  it("starts the session on the first actual pairing request", async () => {
    const harness = setup(false);
    await harness.handler(harness.request, { history: [] }, harness.response, harness.token);
    expect(harness.startSession).toHaveBeenCalledTimes(1);
    expect(harness.run).toHaveBeenCalledTimes(1);
    expect(harness.generate).not.toHaveBeenCalled();
  });

  it("does not let an old startup enter a replacement local-only runtime", async () => {
    const harness = setup(false);
    harness.startSession.mockImplementationOnce(async () => {
      harness.context.beginRuntime();
      harness.context.updateSession({ ...harness.context.snapshot().session, active: true, generation: 3, chatMode: "local-only" });
      harness.disableAgent();
      return { kind: "already-stopped", active: false, message: "Old startup was cancelled." };
    });
    await harness.handler(harness.request, { history: [] }, harness.response, harness.token);
    expect(harness.run).not.toHaveBeenCalled();
    expect(harness.generate).not.toHaveBeenCalled();
  });

  it("does not move an old startup into a different workspace-agent runtime", async () => {
    const harness = setup(false);
    harness.startSession.mockImplementationOnce(async () => {
      harness.context.beginRuntime();
      harness.context.updateSession({ ...harness.context.snapshot().session, active: true, generation: 3 });
      return { kind: "started", active: true, message: "A different runtime is now active." };
    });
    await harness.handler(harness.request, { history: [] }, harness.response, harness.token);
    expect(harness.run).not.toHaveBeenCalled();
  });

  it("does not start or invoke models when Pair is disabled", async () => {
    const harness = setup(false, false);
    await harness.handler(harness.request, { history: [] }, harness.response, harness.token);
    expect(harness.startSession).not.toHaveBeenCalled();
    expect(harness.run).not.toHaveBeenCalled();
    expect(harness.generate).not.toHaveBeenCalled();
  });

  it("routes document work through the agent instead of opening a static brief", async () => {
    const harness = setup();
    await harness.handler({ ...harness.request, command: "brief" }, { history: [] }, harness.response, harness.token);
    expect(harness.run).toHaveBeenCalledTimes(1);
  });
});
