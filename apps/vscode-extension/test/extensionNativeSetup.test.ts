import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { asExtensionContext, createContext, fakeVscode } from "./pairToolTestHarness.js";
import { WorkspaceContext } from "../src/workspaceContext.js";

const request = (command: string): vscode.ChatRequest => ({
  command, prompt: "", references: [], toolReferences: [],
}) as unknown as vscode.ChatRequest;

const token: vscode.CancellationToken = {
  isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }),
};

const response = () => {
  const text: string[] = [];
  const stream = { markdown: (value: string) => text.push(value) } as unknown as vscode.ChatResponseStream;
  return { stream, text };
};

describe("production native Growth participant wiring", () => {
  it("reaches setup and checkpoint through the actually registered participant", async () => {
    const { createExtensionRuntime } = await import("../src/extensionCore.js");
    const confirmations: string[] = [];
    const confirmCheckpoint = vi.fn((signal: AbortSignal) => Promise.resolve(!signal.aborted));
    const runtime = createExtensionRuntime(asExtensionContext(createContext()), {
      growthSetupUi: {
        collect: () => Promise.resolve({
          objective: "Repair retries", independentCheck: "Vary the limit",
          allowedPath: "src/retry.mjs", verificationPlan: "npm test",
        }),
        confirm: stage => { confirmations.push(stage); return Promise.resolve(true); },
      },
      confirmCheckpoint,
    });
    expect(runtime.ledger.isInactive()).toBe(true);
    const handler = fakeVscode.state.chatParticipants.find(item => item.id === "adaptivePair.chat")?.handler as vscode.ChatRequestHandler;
    expect(handler).toBeTypeOf("function");
    const disabled = response();
    await handler(request("setup"), { history: [] }, disabled.stream, token);
    expect(runtime.ledger.isInactive()).toBe(true);
    expect(disabled.text.join("\n")).toContain("Enable Presence");
    await fakeVscode.module.commands.executeCommand("adaptivePair.enablePresence");
    await fakeVscode.module.commands.executeCommand("adaptivePair.startSession");
    expect(runtime.sessionController.snapshotNow().session?.workUnit).toBeUndefined();
    vi.spyOn(WorkspaceContext.prototype, "capture").mockResolvedValue({
      workspaceId: "file:///workspace", dirtyPaths: [], openPaths: ["src/retry.mjs"],
      diagnostics: [], protectedPaths: [], capturedAt: 100,
    });
    const setup = response();
    await handler(request("setup"), { history: [] }, setup.stream, token);
    expect(confirmations).toEqual(["learning", "mode", "work-unit"]);
    expect(runtime.sessionController.snapshotNow().session?.workUnit).toMatchObject({ mode: "growth", owner: "human", status: "agreed" });
    expect(runtime.api.getState().contextKeys).toMatchObject({ "adaptivePair.mode": "growth", "adaptivePair.aiCanEdit": false });
    const checkpoint = await handler(request("checkpoint"), { history: [] }, response().stream, token);
    expect(confirmCheckpoint).toHaveBeenCalledOnce();
    expect(checkpoint?.metadata).toMatchObject({ adaptivePairCheckpoint: { format: "adaptive-pair-native-checkpoint", version: 1 } });
    expect(runtime.ledger.snapshot().modelRequests).toBe(0);
    expect(fakeVscode.state.settingsWrites).toEqual([]);
  });
});
