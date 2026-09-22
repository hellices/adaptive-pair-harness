import { afterEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { asExtensionContext, createContext, fakeVscode } from "./pairToolTestHarness.js";
import { WorkspaceContext } from "../src/workspaceContext.js";

const request = (command: string): vscode.ChatRequest => ({
  command, prompt: "", references: [], toolReferences: [],
  get model() { throw new Error("A local route accessed the model"); },
}) as unknown as vscode.ChatRequest;

const token: vscode.CancellationToken = {
  isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }),
};

const response = () => {
  const text: string[] = [];
  const stream = { markdown: (value: string) => text.push(value) } as unknown as vscode.ChatResponseStream;
  return { stream, text };
};

const deferred = () => {
  let resolve = (): void => undefined;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
};

const createSetupHarness = async () => {
  const { createExtensionRuntime } = await import("../src/extensionCore.js");
  const { WorkspaceContext: SetupWorkspaceContext } = await import("../src/workspaceContext.js");
  const runtime = createExtensionRuntime(asExtensionContext(createContext()), {
    growthSetupUi: {
      collect: () => Promise.resolve({
        objective: "Repair retries", independentCheck: "Vary the limit",
        allowedPath: "src/retry.mjs", verificationPlan: "npm test",
      }),
      confirm: () => Promise.resolve(true),
    },
  });
  await fakeVscode.module.commands.executeCommand("adaptivePair.enablePresence");
  await fakeVscode.module.commands.executeCommand("adaptivePair.startSession");
  vi.spyOn(SetupWorkspaceContext.prototype, "capture").mockResolvedValue({
    workspaceId: "file:///workspace", dirtyPaths: [], openPaths: ["src/retry.mjs"],
    diagnostics: [], protectedPaths: [], capturedAt: 100,
  });
  const handler = fakeVscode.state.chatParticipants.find(item => item.id === "adaptivePair.chat")?.handler as vscode.ChatRequestHandler;
  expect(handler).toBeTypeOf("function");
  return { runtime, handler };
};

afterEach(() => { vi.restoreAllMocks(); });

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

  it.each(["disable", "pause", "replacement", "revision", "workspace", "trust", "cancellation"])(
    "does not report setup complete after %s during final context publication", async invalidation => {
    const { runtime, handler } = await createSetupHarness();
    const publicationStarted = deferred();
    const publication = deferred();
    const executeCommand = fakeVscode.module.commands.executeCommand;
    let held = false;
    vi.spyOn(fakeVscode.module.commands, "executeCommand").mockImplementation(async (name, ...args) => {
      const result = await executeCommand(name, ...args);
      if (!held && name === "setContext" && args[0] === "adaptivePair.mode" && args[1] === "growth") {
        held = true;
        publicationStarted.resolve();
        await publication.promise;
      }
      return result;
    });
    let cancel = (): void => undefined;
    const cancellationToken: vscode.CancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: listener => {
        cancel = () => { listener(undefined); };
        return { dispose: () => undefined };
      },
    };
    const setup = response();
    const pending = handler(request("setup"), { history: [] }, setup.stream, cancellationToken);
    await publicationStarted.promise;
    const agreed = runtime.sessionController.snapshotNow();
    try {
      expect(agreed.session?.workUnit?.status).toBe("agreed");
      if (invalidation === "disable" || invalidation === "replacement") {
        await runtime.presenceController.performDisable();
        expect(runtime.sessionController.snapshotNow().presence.status).toBe("off");
        expect(runtime.sessionController.snapshotNow().session).toBeUndefined();
      }
      if (invalidation === "replacement") {
        await fakeVscode.module.commands.executeCommand("adaptivePair.startSession");
        const replacement = response();
        await handler(request("setup"), { history: [] }, replacement.stream, token);
        expect(replacement.text.join("\n")).toContain("Growth setup is complete");
        expect(runtime.sessionController.snapshotNow().session?.sessionId).not.toBe(agreed.session?.sessionId);
      }
      if (invalidation === "pause") { await fakeVscode.module.commands.executeCommand("adaptivePair.pausePresence"); }
      if (invalidation === "revision") { await runtime.sessionController.bumpObservationRevision(); }
      if (invalidation === "workspace") { fakeVscode.state.workspaceFolders = []; }
      if (invalidation === "trust") { fakeVscode.state.workspaceTrusted = false; }
      if (invalidation === "cancellation") { cancel(); }
    } finally {
      publication.resolve();
    }
    const current = runtime.sessionController.snapshotNow();
    await pending;
    expect(setup.text.join("\n")).not.toContain("Growth setup is complete");
    expect(runtime.sessionController.snapshotNow()).toEqual(current);
    if (invalidation === "cancellation") {
      expect(setup.text).toEqual([]);
    } else {
      expect(setup.text.join("\n")).toContain("current workspace or session changed");
    }
    if (invalidation === "disable") {
      expect(Object.fromEntries(fakeVscode.state.contextKeys)).toEqual({
        "adaptivePair.presenceEnabled": false, "adaptivePair.sessionActive": false,
        "adaptivePair.mode": "", "adaptivePair.aiCanEdit": false,
      });
    }
    expect(runtime.ledger.snapshot().modelRequests).toBe(0);
  });
});

describe("setup transaction resolution boundary", () => {
  it("rejects a replaced agreement between transaction resolution and context publication", async () => {
    const { runtime, handler } = await createSetupHarness();
    const setupFlow = await import("../src/growthSetup.js");
    const runGrowthSetup = setupFlow.runGrowthSetup;
    let replaced = false;
    vi.spyOn(setupFlow, "runGrowthSetup").mockImplementation(async (deps, signal) => {
      const outcome = await runGrowthSetup(deps, signal);
      if (!replaced) {
        replaced = true;
        const agreed = runtime.sessionController.snapshotNow();
        expect(outcome).toBe("completed");
        await runtime.presenceController.performDisable();
        await fakeVscode.module.commands.executeCommand("adaptivePair.startSession");
        const replacement = response();
        await handler(request("setup"), { history: [] }, replacement.stream, token);
        expect(replacement.text.join("\n")).toContain("Growth setup is complete");
        expect(runtime.sessionController.snapshotNow().session?.sessionId).not.toBe(agreed.session?.sessionId);
      }
      return outcome;
    });
    const setup = response();
    await handler(request("setup"), { history: [] }, setup.stream, token);
    expect(setup.text.join("\n")).not.toContain("Growth setup is complete");
    expect(setup.text.join("\n")).toContain("current workspace or session changed");
    expect(runtime.sessionController.snapshotNow().session?.workUnit?.status).toBe("agreed");
    expect(runtime.ledger.snapshot().modelRequests).toBe(0);
  });
});

describe("setup response publication", () => {
  it("rejects completion when disable commits after the adapter check but before the message", async () => {
    const { runtime, handler } = await createSetupHarness();
    const executeCommand = fakeVscode.module.commands.executeCommand;
    let started = false;
    let disabling: Promise<void> | undefined;
    vi.spyOn(fakeVscode.module.commands, "executeCommand").mockImplementation(async (name, ...args) => {
      const result = await executeCommand(name, ...args);
      if (!started && name === "setContext" && args[0] === "adaptivePair.mode" && args[1] === "growth") {
        started = true;
        disabling = runtime.presenceController.performDisable();
        await Promise.resolve();
      }
      return result;
    });
    const publications: { text: string; state: ReturnType<typeof runtime.sessionController.snapshotNow> }[] = [];
    const stream = { markdown: (text: string) => {
      publications.push({ text, state: runtime.sessionController.snapshotNow() });
    } } as unknown as vscode.ChatResponseStream;
    await handler(request("setup"), { history: [] }, stream, token);
    await disabling;
    expect(started).toBe(true);
    expect(publications).toHaveLength(1);
    expect(publications[0]?.state.presence.status).toBe("off");
    expect(publications[0]?.state.session).toBeUndefined();
    expect(publications[0]?.text).not.toContain("Growth setup is complete");
    expect(publications[0]?.text).toContain("current workspace or session changed");
    expect(runtime.ledger.snapshot().modelRequests).toBe(0);
    expect(Object.fromEntries(fakeVscode.state.contextKeys)).toEqual({
      "adaptivePair.presenceEnabled": false, "adaptivePair.sessionActive": false,
      "adaptivePair.mode": "", "adaptivePair.aiCanEdit": false,
    });
  });
});
