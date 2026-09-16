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

describe("SystemProcessTreePort — Windows taskkill", () => {
  it.each(["SIGTERM", "SIGKILL"] as const)(
    "confirms the whole child tree after successful %s taskkill",
    signal => {
      const port = new SystemProcessTreePort();
      const child = childProcess(43_210);

      expect(port.isAlive(child)).toBe(true);
      expect(port.signal(child, signal)).toBe(true);
      expect(taskkill).toHaveBeenCalledWith(
        "taskkill",
        ["/PID", "43210", "/T", ...(signal === "SIGKILL" ? ["/F"] : [])],
        { stdio: "ignore", windowsHide: true },
      );
      expect(port.isAlive(child)).toBe(false);
      expect(killProcess).not.toHaveBeenCalled();
    },
  );

  it.each([1, null])("does not confirm termination when taskkill returns %s", status => {
    const port = new SystemProcessTreePort();
    const child = childProcess(43_210);
    taskkill.mockReturnValue({ status });

    expect(port.signal(child, "SIGKILL")).toBe(false);
    expect(port.isAlive(child)).toBe(true);
  });

  it("falls back to the child signal without confirming a tree when no PID is available", () => {
    const port = new SystemProcessTreePort();
    const child = childProcess();
    const kill = vi.spyOn(child, "kill");

    expect(port.signal(child, "SIGTERM")).toBe(true);
    expect(kill).toHaveBeenCalledWith("SIGTERM");
    expect(taskkill).not.toHaveBeenCalled();
    expect(port.isAlive(child)).toBe(true);
  });
});

describe("SystemProcessTreePort — child lifetime", () => {
  it.each(["SIGTERM", "SIGKILL"] as const)(
    "does not transfer a successful %s confirmation to a new child with the same PID",
    signal => {
      const port = new SystemProcessTreePort();
      const previousChild = childProcess(43_210);
      const replacementChild = childProcess(43_210);

      expect(port.signal(previousChild, signal)).toBe(true);
      expect(port.isAlive(previousChild)).toBe(false);
      expect(port.isAlive(replacementChild)).toBe(true);
    },
  );

  it("requires a replacement child's own taskkill to succeed before confirming its tree", () => {
    const port = new SystemProcessTreePort();
    const previousChild = childProcess(43_210);
    const replacementChild = childProcess(43_210);
    expect(port.signal(previousChild, "SIGKILL")).toBe(true);
    taskkill.mockReturnValue({ status: 1 });

    expect(port.signal(replacementChild, "SIGKILL")).toBe(false);
    expect(port.isAlive(replacementChild)).toBe(true);

    taskkill.mockReturnValue({ status: 0 });
    expect(port.signal(replacementChild, "SIGKILL")).toBe(true);
    expect(port.isAlive(replacementChild)).toBe(false);
    expect(port.isAlive(previousChild)).toBe(false);
  });
});

describe("SystemProcessTreePort — POSIX process groups", () => {
  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "linux" });
  });

  it("signals and probes the whole detached process group", () => {
    const port = new SystemProcessTreePort();
    const child = childProcess(43_210);

    expect(port.signal(child, "SIGTERM")).toBe(true);
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

      expect(port.signal(child, "SIGKILL")).toBe(false);
      expect(port.isAlive(child)).toBe(code !== "ESRCH");
    },
  );
});

describe("NodeProcessRunPort — Windows tree lifetime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not confirm a reused PID while the replacement tree survives parent close and escalation", async () => {
    const tree = new SystemProcessTreePort();
    expect(tree.signal(childProcess(43_210), "SIGKILL")).toBe(true);
    taskkill.mockReturnValue({ status: 1 });

    const child = new FakeChild(43_210);
    const { spawn } = spawningInto(child);
    const runtime: ProcessRuntime = {
      platform: "win32",
      execPath: "C:\\nodejs\\node.exe",
      path: undefined,
      npmExecPath: undefined,
      npmNodeExecPath: undefined,
      exists: path => path === "C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
    };
    const controller = new AbortController();
    const port = new NodeProcessRunPort("/repo", spawn, tree, runtime);
    const pending = port.run({ script: "test" }, controller.signal);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    controller.abort();
    child.emit("close", null, "SIGTERM");
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(5_250);
    const result = await pending;
    expect(result.exitCode).toBeNull();
    expect(result.signal).toBe("SIGKILL");
    expect(result.terminationConfirmed).toBe(false);
    expect(taskkill).toHaveBeenNthCalledWith(
      2,
      "taskkill",
      ["/PID", "43210", "/T"],
      { stdio: "ignore", windowsHide: true },
    );
    expect(taskkill).toHaveBeenNthCalledWith(
      3,
      "taskkill",
      ["/PID", "43210", "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
