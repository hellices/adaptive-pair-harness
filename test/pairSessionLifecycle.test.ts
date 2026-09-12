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
      };
      devDependencies: {
        "@types/vscode": string;
      };
      contributes: {
        commands: Array<{ command: string }>;
        chatParticipants: Array<{
          commands: Array<{ name: string }>;
        }>;
        keybindings: Array<{ command: string; key: string }>;
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
      ]),
    );
    expect(commands).toEqual(
      expect.arrayContaining([
        "adaptivePair.startSession",
        "adaptivePair.stopSession",
        "adaptivePair.toggle",
      ]),
    );
    expect(chatCommands).toEqual(expect.arrayContaining(["start", "stop"]));
    expect(manifest.contributes.keybindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: "adaptivePair.toggle" }),
      ]),
    );
    expect(manifest.engines.vscode).toBe("^1.136.0");
    expect(manifest.devDependencies["@types/vscode"]).toBe("^1.136.0");
  });
});
