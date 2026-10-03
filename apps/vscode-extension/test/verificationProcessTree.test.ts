import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { codedError, FakeChild, spawningInto } from "./verificationPortFixtures.js";
import type { ProcessRuntime } from "../src/verificationProcessInvocation.js";

const taskkill = vi.hoisted(() =>
  vi.fn<() => { readonly status: number | null }>(),
);

vi.mock("node:child_process", async importOriginal => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawnSync: taskkill,
}));

const { SystemProcessTreePort } = await import("../src/verificationProcessTree.js");
const { NodeProcessRunPort } = await import("../src/verificationProcess.js");

const originalPlatform = process.platform;
const childProcess = (pid?: number): ChildProcessWithoutNullStreams =>
  new FakeChild(pid) as unknown as ChildProcessWithoutNullStreams;
const taskkillOptions = {
  stdio: "ignore",
  windowsHide: true,
  timeout: 1_000,
  killSignal: "SIGKILL",
};
const windowsRuntime: ProcessRuntime = {
  platform: "win32",
  execPath: "C:\\nodejs\\node.exe",
  path: undefined,
  npmExecPath: undefined,
  npmNodeExecPath: undefined,
  exists: path => path === "C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
};
let killProcess: MockInstance<typeof process.kill>;

beforeEach(() => {
  Object.defineProperty(process, "platform", { value: "win32" });
  taskkill.mockReset();
  taskkill.mockReturnValue({ status: 0 });
  killProcess = vi.spyOn(process, "kill").mockReturnValue(true);
});

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform });
  vi.restoreAllMocks();
});

describe("SystemProcessTreePort — Windows taskkill (mocked)", () => {
  it.each(["SIGTERM", "SIGKILL"] as const)(
    "does not treat successful %s taskkill delivery as tree-exit evidence",
    signal => {
      const port = new SystemProcessTreePort();
      const child = childProcess(43_210);

      expect(port.isAlive(child)).toBeUndefined();
      port.signal(child, signal);
      expect(port.isAlive(child)).toBeUndefined();
      expect(taskkill).toHaveBeenCalledWith(
        "taskkill",
        ["/PID", "43210", "/T", ...(signal === "SIGKILL" ? ["/F"] : [])],
        taskkillOptions,
      );
      expect(killProcess).not.toHaveBeenCalled();
    },
  );

  it("falls back to the child signal without confirming a tree when no PID is available", () => {
    const port = new SystemProcessTreePort();
    const child = childProcess();
    const kill = vi.spyOn(child, "kill");

    port.signal(child, "SIGTERM");
    expect(kill).toHaveBeenCalledWith("SIGTERM");
    expect(taskkill).not.toHaveBeenCalled();
    expect(port.isAlive(child)).toBeUndefined();
  });
});

describe("SystemProcessTreePort — POSIX process groups", () => {
  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "linux" });
  });

  it("signals and probes the whole detached process group", () => {
    const port = new SystemProcessTreePort();
    const child = childProcess(43_210);

    port.signal(child, "SIGTERM");
    expect(killProcess).toHaveBeenCalledWith(-43_210, "SIGTERM");
    expect(port.isAlive(child)).toBe(true);
    expect(killProcess).toHaveBeenCalledWith(-43_210, 0);
    expect(taskkill).not.toHaveBeenCalled();
  });

  it.each(["ESRCH", "EPERM", "EACCES", "EIO"])(
    "does not confirm a missing process group unless %s is ESRCH",
    code => {
      const port = new SystemProcessTreePort();
      const child = childProcess(43_210);
      killProcess.mockImplementation(() => {
        throw codedError(code);
      });

      expect(() => port.signal(child, "SIGKILL")).not.toThrow();
      expect(port.isAlive(child)).toBe(code === "ESRCH" ? false : undefined);
    },
  );
});

describe("NodeProcessRunPort — Windows cancellation lifecycle (mocked taskkill)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await vi.runAllTimersAsync();
    vi.useRealTimers();
  });

  const startRun = () => {
    const child = new FakeChild(43_210);
    const { spawn } = spawningInto(child);
    const controller = new AbortController();
    const port = new NodeProcessRunPort("/repo", spawn, new SystemProcessTreePort(), windowsRuntime);
    const pending = port.run({ script: "test" }, controller.signal);
    const settled = vi.fn();
    void pending.then(settled);
    return { child, controller, pending, settled };
  };

  it("escalates after the grace period and keeps forced delivery unconfirmed", async () => {
    const { child, controller, pending, settled } = startRun();

    controller.abort();
    await Promise.resolve();
    expect(taskkill).toHaveBeenCalledExactlyOnceWith(
      "taskkill", ["/PID", "43210", "/T"], taskkillOptions,
    );
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(settled).not.toHaveBeenCalled();
    expect(taskkill).toHaveBeenCalledTimes(2);
    expect(taskkill).toHaveBeenNthCalledWith(
      2, "taskkill", ["/PID", "43210", "/T", "/F"], taskkillOptions,
    );
    await vi.advanceTimersByTimeAsync(249);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    const result = await pending;
    expect(result.exitCode).toBeNull();
    expect(result.signal).toBe("SIGKILL");
    expect(result.terminationConfirmed).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(killProcess).not.toHaveBeenCalled();

    child.emit("close", null, "SIGKILL");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(settled).toHaveBeenCalledExactlyOnceWith(result);
    expect(taskkill).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { closeDelay: 0, terminationSignal: "SIGTERM" },
    { closeDelay: 5_249, terminationSignal: "SIGKILL" },
  ])(
    "settles unknown tree exit at child close after $closeDelay ms",
    async ({ closeDelay, terminationSignal }) => {
      const { child, controller, settled } = startRun();
      child.stdout.emit("data", Buffer.from("partial output"));

      controller.abort();
      await vi.advanceTimersByTimeAsync(closeDelay);
      expect(settled).not.toHaveBeenCalled();
      const requestsBeforeClose = taskkill.mock.calls.length;
      child.emit("close", null, terminationSignal);
      await Promise.resolve();

      expect(settled).toHaveBeenCalledExactlyOnceWith({
        exitCode: null,
        signal: terminationSignal,
        output: "partial output",
        outputTruncated: false,
        terminationConfirmed: false,
      });
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(taskkill).toHaveBeenCalledTimes(requestsBeforeClose);
      child.emit("close", 0, null);
      await Promise.resolve();
      expect(settled).toHaveBeenCalledTimes(1);
    },
  );

  it("does not turn a clean child exit after abort into confirmed tree termination", async () => {
    const { child, controller, settled } = startRun();

    controller.abort();
    child.emit("close", 0, null);
    await Promise.resolve();

    expect(settled).toHaveBeenCalledExactlyOnceWith({
      exitCode: null, signal: null, output: "", outputTruncated: false, terminationConfirmed: false,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["SIGTERM", "SIGKILL"] as const)(
    "does not install another cancellation timer after synchronous %s close",
    async closeSignal => {
      const { child, controller, settled } = startRun();
      taskkill.mockImplementation(() => {
        const requestedSignal = taskkill.mock.calls.length === 1 ? "SIGTERM" : "SIGKILL";
        if (requestedSignal === closeSignal) child.emit("close", null, requestedSignal);
        return { status: 0 };
      });

      controller.abort();
      await vi.advanceTimersByTimeAsync(closeSignal === "SIGTERM" ? 0 : 5_000);

      expect(settled).toHaveBeenCalledExactlyOnceWith({
        exitCode: null, signal: closeSignal, output: "", outputTruncated: false, terminationConfirmed: false,
      });
      expect(vi.getTimerCount()).toBe(0);
      const requestsAtSettlement = taskkill.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(taskkill).toHaveBeenCalledTimes(requestsAtSettlement);
    },
  );
});
