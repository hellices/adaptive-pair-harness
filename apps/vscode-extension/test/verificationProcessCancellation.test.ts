import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeChild, spawningInto } from "./verificationPortFixtures.js";

const { NodeProcessRunPort } = await import("../src/verificationAdapter.js");
import type { ProcessRuntime, ProcessTreePort } from "../src/verificationAdapter.js";

describe("NodeProcessRunPort — cancellation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends SIGTERM then escalates to SIGKILL with unconfirmed termination", async () => {
    const child = new FakeChild();
    const { spawn } = spawningInto(child);
    const controller = new AbortController();
    const port = new NodeProcessRunPort("/repo", spawn);
    const pending = port.run({ script: "test" }, controller.signal);
    controller.abort();
    expect(child.signals).toEqual(["SIGTERM"]);
    // The unresponsive process never emits close; the grace timer escalates.
    await vi.advanceTimersByTimeAsync(5_250);
    const result = await pending;
    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(result.signal).toBe("SIGKILL");
    expect(result.exitCode).toBeNull();
    expect(result.terminationConfirmed).toBe(false);
  });

  it("clears the grace timer when the process closes within the grace window", async () => {
    const child = new FakeChild();
    const { spawn } = spawningInto(child);
    const controller = new AbortController();
    const port = new NodeProcessRunPort("/repo", spawn);
    const pending = port.run({ script: "test" }, controller.signal);
    controller.abort();
    expect(child.signals).toEqual(["SIGTERM"]);
    // The process terminates in response to SIGTERM before the grace elapses.
    child.emit("close", null, "SIGTERM");
    const result = await pending;
    // Advancing past the grace window must not fire a second (SIGKILL) kill.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(child.signals).toEqual(["SIGTERM"]);
    expect(result.terminationConfirmed).toBe(true);
    expect(result.signal).toBe("SIGTERM");
  });

  it("terminates the whole detached process tree before confirming cancellation", async () => {
    const child = new FakeChild(43_210);
    const { spawn, state } = spawningInto(child);
    let alive = true;
    const signals: string[] = [];
    const tree: ProcessTreePort = {
      signal: (_child, signal) => {
        signals.push(signal);
        if (signal === "SIGKILL") {
          alive = false;
        }
        return true;
      },
      isAlive: () => alive,
    };
    const runtime: ProcessRuntime = {
      platform: "linux",
      execPath: "/usr/bin/node",
      path: "/usr/bin",
      npmExecPath: undefined,
      npmNodeExecPath: undefined,
      exists: () => false,
    };
    const controller = new AbortController();
    const port = new NodeProcessRunPort("/repo", spawn, tree, runtime);
    const pending = port.run({ script: "test" }, controller.signal);

    expect(state.command).toBe("npm");
    expect(state.args).toEqual(["run", "test"]);
    expect(state.options).toMatchObject({
      cwd: "/repo",
      shell: false,
      detached: true,
    });

    controller.abort();
    expect(signals).toEqual(["SIGTERM"]);
    expect(child.signals).toEqual([]);

    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    child.emit("close", null, "SIGTERM");
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(5_000);
    const result = await pending;
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(result.terminationConfirmed).toBe(true);
    expect(result.signal).toBe("SIGKILL");
  });

  it("handles an already-aborted signal after synchronous spawn and listener registration", async () => {
    const child = new FakeChild();
    const { spawn, state } = spawningInto(child);
    const port = new NodeProcessRunPort("/repo", spawn);

    const pending = port.run({ script: "test" }, AbortSignal.abort());
    expect(state.calls).toBe(1);
    expect(child.signals).toEqual(["SIGTERM"]);
    child.emit("close", null, "SIGTERM");

    const result = await pending;
    expect(result.terminationConfirmed).toBe(true);
    expect(result.signal).toBe("SIGTERM");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("observes process-tree termination during the final confirmation window", async () => {
    const child = new FakeChild(43_210);
    const { spawn } = spawningInto(child);
    const controller = new AbortController();
    let alive = true;
    const signals: string[] = [];
    const tree: ProcessTreePort = {
      signal: (_child, signal) => {
        signals.push(signal);
        return true;
      },
      isAlive: () => alive,
    };
    const port = new NodeProcessRunPort("/repo", spawn, tree);
    const pending = port.run({ script: "test" }, controller.signal);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    controller.abort();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(settled).toBe(false);

    alive = false;
    await vi.advanceTimersByTimeAsync(250);
    const result = await pending;
    expect(result.terminationConfirmed).toBe(true);
    expect(result.signal).toBe("SIGKILL");
    expect(vi.getTimerCount()).toBe(0);
  });
});
