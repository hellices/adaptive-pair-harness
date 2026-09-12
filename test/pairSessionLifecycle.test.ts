import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  PairSessionLifecycle,
  createPairSessionCommandHandlers,
} from "../src/vscode/pairRuntimeSupport";

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
  });
});
