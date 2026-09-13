import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  PairSessionLifecycle,
  createPairSessionCommandHandlers,
} from "../src/vscode/pairRuntimeSupport";

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

interface PreparationContext {
  readonly signal: AbortSignal;
  isCurrent(): boolean;
}

describe("explicit pair session lifecycle", () => {
  it("stays dormant until start and clears every transient resource on stop", async () => {
    const listener = { dispose: vi.fn() };
    const ports = {
      prepare: vi.fn(async () => undefined),
      registerDocumentListeners: vi.fn(() => listener),
      cancelPendingWork: vi.fn(),
      clearTransientState: vi.fn(),
    };
    const lifecycle = new PairSessionLifecycle(() => true, ports);

    expect(lifecycle.active).toBe(false);
    expect(ports.prepare).not.toHaveBeenCalled();
    expect(ports.registerDocumentListeners).not.toHaveBeenCalled();

    await expect(lifecycle.start()).resolves.toMatchObject({
      kind: "started",
      active: true,
    });
    expect(ports.prepare).toHaveBeenCalledOnce();
    expect(ports.registerDocumentListeners).toHaveBeenCalledOnce();

    expect(lifecycle.stop()).toMatchObject({
      kind: "stopped",
      active: false,
    });
    expect(listener.dispose).toHaveBeenCalledOnce();
    expect(ports.cancelPendingWork).toHaveBeenCalledOnce();
    expect(ports.clearTransientState).toHaveBeenCalledOnce();
  });

  it("registers listeners before committing prepared session state", async () => {
    const order: string[] = [];
    const ports = {
      prepare: vi.fn(async () => {
        order.push("prepare");
        return {
          commit: () => {
            order.push("commit");
            return true;
          },
        };
      }),
      registerDocumentListeners: vi.fn(() => {
        order.push("listeners");
        return { dispose: vi.fn() };
      }),
      cancelPendingWork: vi.fn(),
      clearTransientState: vi.fn(),
    };
    const lifecycle = new PairSessionLifecycle(() => true, ports);

    await expect(lifecycle.start()).resolves.toMatchObject({
      kind: "started",
      active: true,
    });

    expect(order).toEqual(["prepare", "listeners", "commit"]);
    expect(lifecycle.ready).toBe(true);
    lifecycle.dispose();
  });

  it("attempts every stop cleanup in order and leaves the session stopped when cleanup fails", async () => {
    const order: string[] = [];
    const listenerFailure = new Error("listener disposal failed");
    const cancellationFailure = new Error("request cancellation failed");
    const listener = {
      dispose: vi.fn(() => {
        order.push("listener");
        throw listenerFailure;
      }),
    };
    const ports = {
      prepare: vi.fn(async () => undefined),
      registerDocumentListeners: vi.fn(() => listener),
      cancelPendingWork: vi.fn(() => {
        order.push("cancel");
        throw cancellationFailure;
      }),
      clearTransientState: vi.fn(() => {
        order.push("clear");
      }),
    };
    const lifecycle = new PairSessionLifecycle(() => true, ports);
    await lifecycle.start();

    let failure: unknown;
    try {
      lifecycle.stop();
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      listenerFailure,
      cancellationFailure,
    ]);
    expect(order).toEqual(["listener", "cancel", "clear"]);
    expect(lifecycle.active).toBe(false);
  });

  it("marks the lifecycle disposed before propagating stop cleanup failure", async () => {
    const listenerFailure = new Error("listener disposal failed");
    const ports = {
      prepare: vi.fn(async () => undefined),
      registerDocumentListeners: vi.fn(() => ({
        dispose: () => {
          throw listenerFailure;
        },
      })),
      cancelPendingWork: vi.fn(),
      clearTransientState: vi.fn(),
    };
    const lifecycle = new PairSessionLifecycle(() => true, ports);
    await lifecycle.start();

    expect(() => lifecycle.dispose()).toThrow(listenerFailure);
    expect(ports.cancelPendingWork).toHaveBeenCalledOnce();
    expect(ports.clearTransientState).toHaveBeenCalledOnce();
    expect(lifecycle.active).toBe(false);
    await expect(lifecycle.start()).resolves.toMatchObject({
      kind: "already-stopped",
      active: false,
      message: expect.stringContaining("disposed"),
    });
    expect(() => lifecycle.dispose()).not.toThrow();
  });

  it("reports the master permission and remains dormant when disabled", async () => {
    const ports = {
      prepare: vi.fn(async () => undefined),
      registerDocumentListeners: vi.fn(() => ({ dispose: vi.fn() })),
      cancelPendingWork: vi.fn(),
      clearTransientState: vi.fn(),
    };
    const lifecycle = new PairSessionLifecycle(() => false, ports);

    await expect(lifecycle.start()).resolves.toMatchObject({
      kind: "disabled",
      active: false,
      message: expect.stringContaining("adaptivePair.enabled"),
    });
    expect(lifecycle.active).toBe(false);
    expect(ports.prepare).not.toHaveBeenCalled();
    expect(ports.registerDocumentListeners).not.toHaveBeenCalled();
  });

  it("clears partially prepared state when session startup fails", async () => {
    const failure = new Error("memory unavailable");
    const ports = {
      prepare: vi.fn(async () => {
        throw failure;
      }),
      registerDocumentListeners: vi.fn(() => ({ dispose: vi.fn() })),
      cancelPendingWork: vi.fn(),
      clearTransientState: vi.fn(),
    };
    const lifecycle = new PairSessionLifecycle(() => true, ports);

    await expect(lifecycle.start()).rejects.toBe(failure);
    expect(lifecycle.active).toBe(false);
    expect(ports.registerDocumentListeners).not.toHaveBeenCalled();
    expect(ports.cancelPendingWork).toHaveBeenCalledOnce();
    expect(ports.clearTransientState).toHaveBeenCalledOnce();
  });

  it("reports startup and rollback failures after attempting every cleanup", async () => {
    const order: string[] = [];
    const startupFailure = new Error("memory unavailable");
    const cancellationFailure = new Error("cancellation failed");
    const ports = {
      prepare: vi.fn(async () => {
        throw startupFailure;
      }),
      registerDocumentListeners: vi.fn(() => ({ dispose: vi.fn() })),
      cancelPendingWork: vi.fn(() => {
        order.push("cancel");
        throw cancellationFailure;
      }),
      clearTransientState: vi.fn(() => {
        order.push("clear");
      }),
    };
    const lifecycle = new PairSessionLifecycle(() => true, ports);

    let failure: unknown;
    try {
      await lifecycle.start();
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      startupFailure,
      cancellationFailure,
    ]);
    expect(order).toEqual(["cancel", "clear"]);
    expect(lifecycle.active).toBe(false);
  });

  it("starts a new generation immediately after stopping a pending start", async () => {
    const firstPreparation = deferred<void>();
    const secondPreparation = deferred<void>();
    const listener = { dispose: vi.fn() };
    const ports = {
      prepare: vi
        .fn<() => Promise<void>>()
        .mockImplementationOnce(() => firstPreparation.promise)
        .mockImplementationOnce(() => secondPreparation.promise),
      registerDocumentListeners: vi.fn(() => listener),
      cancelPendingWork: vi.fn(),
      clearTransientState: vi.fn(),
    };
    const lifecycle = new PairSessionLifecycle(() => true, ports);

    const firstStart = lifecycle.start();
    lifecycle.stop();
    const secondStart = lifecycle.start();

    expect(ports.prepare).toHaveBeenCalledTimes(2);
    firstPreparation.resolve();
    await expect(firstStart).resolves.toMatchObject({
      kind: "already-stopped",
      active: false,
    });
    expect(lifecycle.active).toBe(false);

    secondPreparation.resolve();
    await expect(secondStart).resolves.toMatchObject({
      kind: "started",
      active: true,
    });
    expect(ports.registerDocumentListeners).toHaveBeenCalledOnce();
  });

  it("does not let an old start completion deactivate a newer active generation", async () => {
    const firstPreparation = deferred<void>();
    const secondPreparation = deferred<void>();
    const listener = { dispose: vi.fn() };
    const ports = {
      prepare: vi
        .fn<() => Promise<void>>()
        .mockImplementationOnce(() => firstPreparation.promise)
        .mockImplementationOnce(() => secondPreparation.promise),
      registerDocumentListeners: vi.fn(() => listener),
      cancelPendingWork: vi.fn(),
      clearTransientState: vi.fn(),
    };
    const lifecycle = new PairSessionLifecycle(() => true, ports);

    const firstStart = lifecycle.start();
    lifecycle.stop();
    const secondStart = lifecycle.start();
    expect(ports.prepare).toHaveBeenCalledTimes(2);

    secondPreparation.resolve();
    await expect(secondStart).resolves.toMatchObject({
      kind: "started",
      active: true,
    });
    firstPreparation.resolve();
    await expect(firstStart).resolves.toMatchObject({
      kind: "already-stopped",
      active: false,
    });

    expect(lifecycle.active).toBe(true);
    expect(listener.dispose).not.toHaveBeenCalled();
    expect(ports.cancelPendingWork).toHaveBeenCalledOnce();
    expect(ports.clearTransientState).toHaveBeenCalledOnce();
  });

  it("returns the stopped result when rejected preparation belongs to a replaced generation", async () => {
    const firstPreparation = deferred<void>();
    const secondPreparation = deferred<void>();
    const ports = {
      prepare: vi
        .fn<() => Promise<void>>()
        .mockImplementationOnce(() => firstPreparation.promise)
        .mockImplementationOnce(() => secondPreparation.promise),
      registerDocumentListeners: vi.fn(() => ({ dispose: vi.fn() })),
      cancelPendingWork: vi.fn(),
      clearTransientState: vi.fn(),
    };
    const lifecycle = new PairSessionLifecycle(() => true, ports);

    const staleStart = lifecycle.start();
    lifecycle.stop();
    const currentStart = lifecycle.start();
    secondPreparation.resolve();
    await expect(currentStart).resolves.toMatchObject({
      kind: "started",
      active: true,
    });

    firstPreparation.reject(new Error("cancelled stale preparation"));

    await expect(staleStart).resolves.toMatchObject({
      kind: "already-stopped",
      active: false,
    });
    expect(lifecycle.active).toBe(true);
    expect(ports.cancelPendingWork).toHaveBeenCalledOnce();
    expect(ports.clearTransientState).toHaveBeenCalledOnce();
  });

  it("suppresses listener registration failure from a replaced generation", async () => {
    const failure = new Error("stale listener registration");
    const lifecycleReference: {
      current: PairSessionLifecycle | undefined;
    } = { current: undefined };
    const ports = {
      prepare: vi.fn(async () => undefined),
      registerDocumentListeners: vi.fn(() => {
        lifecycleReference.current?.stop();
        throw failure;
      }),
      cancelPendingWork: vi.fn(),
      clearTransientState: vi.fn(),
    };
    const lifecycle = new PairSessionLifecycle(() => true, ports);
    lifecycleReference.current = lifecycle;

    await expect(lifecycle.start()).resolves.toMatchObject({
      kind: "already-stopped",
      active: false,
    });
    expect(lifecycle.active).toBe(false);
    expect(ports.cancelPendingWork).toHaveBeenCalledOnce();
    expect(ports.clearTransientState).toHaveBeenCalledOnce();
  });

  it("keeps startup state cleared when deferred preparation resolves after stop", async () => {
    const preparation = deferred<void>();
    const previousTexts = new Map<string, string>();
    const dismissedEvidenceIds = new Set<string>();
    let controlNotice: string | undefined;
    const ports = {
      prepare: vi.fn(async (context?: PreparationContext) => {
        const preparedTexts = new Map([["file:///old.ts", "old seed"]]);
        const preparedDismissals = new Set(["old-evidence"]);
        const preparedNotice = "old harness";
        await preparation.promise;
        if (context !== undefined && !context.isCurrent()) {
          return;
        }
        for (const [uri, text] of preparedTexts) {
          previousTexts.set(uri, text);
        }
        for (const evidenceId of preparedDismissals) {
          dismissedEvidenceIds.add(evidenceId);
        }
        controlNotice = preparedNotice;
      }),
      registerDocumentListeners: vi.fn(() => ({ dispose: vi.fn() })),
      cancelPendingWork: vi.fn(),
      clearTransientState: vi.fn(() => {
        previousTexts.clear();
        dismissedEvidenceIds.clear();
        controlNotice = undefined;
      }),
    };
    const lifecycle = new PairSessionLifecycle(() => true, ports);

    const pendingStart = lifecycle.start();
    lifecycle.stop();
    preparation.resolve();
    await pendingStart;

    expect(previousTexts.size).toBe(0);
    expect(dismissedEvidenceIds.size).toBe(0);
    expect(controlNotice).toBeUndefined();
    expect(ports.registerDocumentListeners).not.toHaveBeenCalled();
    expect(lifecycle.active).toBe(false);
  });

  it("commits only the new seed after stop and restart", async () => {
    const firstPreparation = deferred<void>();
    const secondPreparation = deferred<void>();
    const previousTexts = new Map<string, string>();
    let preparationNumber = 0;
    const ports = {
      prepare: vi.fn(async (context?: PreparationContext) => {
        preparationNumber += 1;
        const currentPreparation = preparationNumber;
        const seed = currentPreparation === 1 ? "old seed" : "new seed";
        await (
          currentPreparation === 1
            ? firstPreparation.promise
            : secondPreparation.promise
        );
        if (context !== undefined && !context.isCurrent()) {
          return;
        }
        previousTexts.clear();
        previousTexts.set("file:///pair.ts", seed);
      }),
      registerDocumentListeners: vi.fn(() => ({ dispose: vi.fn() })),
      cancelPendingWork: vi.fn(),
      clearTransientState: vi.fn(() => {
        previousTexts.clear();
      }),
    };
    const lifecycle = new PairSessionLifecycle(() => true, ports);

    const firstStart = lifecycle.start();
    lifecycle.stop();
    const secondStart = lifecycle.start();

    secondPreparation.resolve();
    await secondStart;
    expect(previousTexts.get("file:///pair.ts")).toBe("new seed");

    firstPreparation.resolve();
    await firstStart;

    expect(previousTexts).toEqual(
      new Map([["file:///pair.ts", "new seed"]]),
    );
    expect(ports.registerDocumentListeners).toHaveBeenCalledOnce();
    expect(lifecycle.active).toBe(true);
  });

  it("refreshes an active generation without disposing its listener and blocks active fences until preparation completes", async () => {
    const refreshPreparation = deferred<void>();
    let preparationCount = 0;
    const listener = { dispose: vi.fn() };
    const ports = {
      prepare: vi.fn(async () => {
        preparationCount += 1;
        if (preparationCount === 2) {
          await refreshPreparation.promise;
        }
      }),
      registerDocumentListeners: vi.fn(() => listener),
      cancelPendingWork: vi.fn(),
      clearTransientState: vi.fn(),
    };
    const lifecycle = new PairSessionLifecycle(() => true, ports);
    await lifecycle.start();
    const preRefreshFence = lifecycle.captureFence(true);

    const pendingRefresh = lifecycle.refresh();

    expect(lifecycle.active).toBe(true);
    expect(preRefreshFence.isCurrent()).toBe(false);
    expect(lifecycle.captureFence(true).isCurrent()).toBe(false);
    expect(ports.cancelPendingWork).toHaveBeenCalledOnce();
    expect(ports.clearTransientState).toHaveBeenCalledOnce();
    expect(listener.dispose).not.toHaveBeenCalled();

    refreshPreparation.resolve();

    await expect(pendingRefresh).resolves.toBe(true);
    expect(lifecycle.active).toBe(true);
    expect(lifecycle.captureFence(true).isCurrent()).toBe(true);
    expect(listener.dispose).not.toHaveBeenCalled();
  });

  it("coalesces overlapping active-session refreshes without replacing the in-flight generation", async () => {
    const refreshPreparation = deferred<void>();
    let refreshContext: PreparationContext | undefined;
    let committed = 0;
    let preparationCount = 0;
    const ports = {
      prepare: vi.fn(async (context: PreparationContext) => {
        preparationCount += 1;
        if (preparationCount === 1) {
          return;
        }
        refreshContext = context;
        await refreshPreparation.promise;
        return {
          commit: () => {
            committed += 1;
            return true;
          },
        };
      }),
      registerDocumentListeners: vi.fn(() => ({ dispose: vi.fn() })),
      cancelPendingWork: vi.fn(),
      clearTransientState: vi.fn(),
    };
    const lifecycle = new PairSessionLifecycle(() => true, ports);
    await lifecycle.start();

    const generation = lifecycle.sessionGeneration;
    const firstRefresh = lifecycle.refresh();
    const secondRefresh = lifecycle.refresh();

    expect(secondRefresh).toBe(firstRefresh);
    expect(lifecycle.sessionGeneration).toBe(generation + 1);
    expect(ports.prepare).toHaveBeenCalledTimes(2);
    expect(refreshContext?.signal.aborted).toBe(false);
    expect(ports.cancelPendingWork).toHaveBeenCalledOnce();
    expect(ports.clearTransientState).toHaveBeenCalledOnce();

    refreshPreparation.resolve();

    await expect(firstRefresh).resolves.toBe(true);
    await expect(secondRefresh).resolves.toBe(true);
    expect(committed).toBe(1);
    expect(lifecycle.active).toBe(true);
  });

  it("shares one bounded refresh attempt budget, stops on churn, and lets a later start retry", async () => {
    let failRefresh = true;
    let preparationCount = 0;
    const listeners: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
    const ports = {
      prepare: vi.fn(async () => {
        preparationCount += 1;
        return {
          commit: () => preparationCount === 1 || !failRefresh,
        };
      }),
      registerDocumentListeners: vi.fn(() => {
        const listener = { dispose: vi.fn() };
        listeners.push(listener);
        return listener;
      }),
      cancelPendingWork: vi.fn(),
      clearTransientState: vi.fn(),
    };
    const lifecycle = new PairSessionLifecycle(() => true, ports);
    await lifecycle.start();

    const refreshes = Array.from({ length: 4 }, () =>
      lifecycle.refresh(),
    );
    const results = await Promise.allSettled(refreshes);

    expect(new Set(refreshes)).toHaveLength(1);
    expect(results).toEqual(
      Array.from({ length: refreshes.length }, () =>
        expect.objectContaining({
          status: "rejected",
          reason: expect.objectContaining({
            message: expect.stringContaining(
              "workspace state kept changing",
            ),
          }),
        }),
      ),
    );
    expect(ports.prepare).toHaveBeenCalledTimes(4);
    expect(lifecycle.active).toBe(false);
    expect(lifecycle.ready).toBe(false);
    expect(listeners[0]?.dispose).toHaveBeenCalledOnce();

    failRefresh = false;
    await expect(lifecycle.start()).resolves.toMatchObject({
      kind: "started",
      active: true,
    });
    expect(ports.prepare).toHaveBeenCalledTimes(5);
    expect(ports.registerDocumentListeners).toHaveBeenCalledTimes(2);
    expect(lifecycle.active).toBe(true);
    lifecycle.dispose();
  });

  it("does not let a deferred refresh affect a rapidly stopped and restarted session", async () => {
    const refreshPreparation = deferred<void>();
    let refreshContext: PreparationContext | undefined;
    let preparationCount = 0;
    const listeners = [
      { dispose: vi.fn() },
      { dispose: vi.fn() },
    ];
    const ports = {
      prepare: vi.fn(async (context: PreparationContext) => {
        preparationCount += 1;
        if (preparationCount === 2) {
          refreshContext = context;
          await refreshPreparation.promise;
        }
      }),
      registerDocumentListeners: vi.fn(() => listeners.shift()!),
      cancelPendingWork: vi.fn(),
      clearTransientState: vi.fn(),
    };
    const lifecycle = new PairSessionLifecycle(() => true, ports);
    await lifecycle.start();

    const staleRefresh = lifecycle.refresh();
    lifecycle.stop();
    await expect(lifecycle.start()).resolves.toMatchObject({
      kind: "started",
      active: true,
    });

    expect(refreshContext?.signal.aborted).toBe(true);
    refreshPreparation.resolve();
    await expect(staleRefresh).resolves.toBe(false);
    expect(lifecycle.active).toBe(true);
    expect(ports.registerDocumentListeners).toHaveBeenCalledTimes(2);
  });

  it("stops safely when the extension becomes disabled during refresh", async () => {
    const refreshPreparation = deferred<void>();
    let enabled = true;
    let preparationCount = 0;
    const listener = { dispose: vi.fn() };
    const ports = {
      prepare: vi.fn(async () => {
        preparationCount += 1;
        if (preparationCount === 2) {
          await refreshPreparation.promise;
        }
      }),
      registerDocumentListeners: vi.fn(() => listener),
      cancelPendingWork: vi.fn(),
      clearTransientState: vi.fn(),
    };
    const lifecycle = new PairSessionLifecycle(() => enabled, ports);
    await lifecycle.start();

    const pendingRefresh = lifecycle.refresh();
    enabled = false;
    refreshPreparation.resolve();

    await expect(pendingRefresh).resolves.toBe(false);
    expect(lifecycle.active).toBe(false);
    expect(lifecycle.ready).toBe(false);
    expect(listener.dispose).toHaveBeenCalledOnce();
  });

  it("wires public start, stop, and toggle handlers to the active runtime", async () => {
    let active = false;
    const messages: string[] = [];
    const runtime = {
      isSessionActive: () => active,
      startSession: vi.fn(async () => {
        active = true;
        return { kind: "started" as const, active, message: "started" };
      }),
      stopSession: vi.fn(() => {
        active = false;
        return { kind: "stopped" as const, active, message: "stopped" };
      }),
    };
    const handlers = createPairSessionCommandHandlers(
      () => runtime,
      async (message) => {
        messages.push(message);
      },
    );

    await handlers.start();
    await handlers.toggle();
    await handlers.toggle();
    await handlers.stop();

    expect(runtime.startSession).toHaveBeenCalledTimes(2);
    expect(runtime.stopSession).toHaveBeenCalledTimes(2);
    expect(messages).toEqual(["started", "stopped", "started", "stopped"]);
  });

  it("contributes activation events, commands, Chat commands, and a toggle keybinding", () => {
    const manifest = JSON.parse(
      readFileSync("package.json", "utf8"),
    ) as {
      activationEvents: string[];
      engines: {
        vscode: string;
        node: string;
      };
      devDependencies: {
        "@types/vscode": string;
      };
      contributes: {
        commands: Array<{ command: string }>;
        configuration: {
          properties: Record<string, { scope?: string }>;
        };
        chatParticipants: Array<{
          commands: Array<{ name: string }>;
        }>;
        keybindings: Array<{ command: string; key: string; mac?: string }>;
      };
    };
    const commands = manifest.contributes.commands.map(
      (command) => command.command,
    );
    const chatCommands = manifest.contributes.chatParticipants[0]?.commands.map(
      (command) => command.name,
    );

    expect(manifest.activationEvents).toEqual(
      expect.arrayContaining([
        "onCommand:adaptivePair.startSession",
        "onCommand:adaptivePair.stopSession",
        "onCommand:adaptivePair.dismissCurrentEvidence",
        "onCommand:adaptivePair.approveCurrentEvidence",
        "onCommand:adaptivePair.setInterventionStyle",
      ]),
    );
    expect(commands).toEqual(
      expect.arrayContaining([
        "adaptivePair.startSession",
        "adaptivePair.stopSession",
        "adaptivePair.toggle",
        "adaptivePair.resetMemory",
        "adaptivePair.dismissCurrentEvidence",
        "adaptivePair.approveCurrentEvidence",
        "adaptivePair.setInterventionStyle",
      ]),
    );
    expect(chatCommands).toEqual(expect.arrayContaining(["start", "stop"]));
    expect(manifest.contributes.keybindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "adaptivePair.toggle",
          key: "ctrl+shift+alt+p",
          mac: "cmd+shift+alt+p",
        }),
      ]),
    );
    for (const setting of [
      "adaptivePair.model.provider",
      "adaptivePair.model.baseUrl",
      "adaptivePair.model.name",
    ]) {
      expect(
        manifest.contributes.configuration.properties[setting]?.scope,
      ).toBe("application");
    }
    expect(manifest.engines.vscode).toBe("^1.136.0");
    expect(manifest.engines.node).toBe(">=22.13.0");
    expect(manifest.devDependencies["@types/vscode"]).toBe("^1.136.0");
  });
});
