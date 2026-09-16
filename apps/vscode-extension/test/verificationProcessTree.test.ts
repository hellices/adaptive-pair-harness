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

      expect(port.isAlive(child)).toBe(true);
      expect(port.signal(child, signal)).toBe(true);
      expect(port.isAlive(child)).toBe(true);
      expect(taskkill).toHaveBeenCalledWith(
        "taskkill",
        ["/PID", "43210", "/T", ...(signal === "SIGKILL" ? ["/F"] : [])],
        taskkillOptions,
      );
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

  it("bounds each taskkill invocation without treating its timeout as tree-exit evidence", () => {
    const port = new SystemProcessTreePort();
    const child = childProcess(43_210);
    taskkill.mockReturnValue({ status: null });

    expect(port.signal(child, "SIGKILL")).toBe(false);
    expect(taskkill).toHaveBeenCalledWith(
      "taskkill",
      ["/PID", "43210", "/T", "/F"],
      taskkillOptions,
    );
    expect(port.isAlive(child)).toBe(true);
  });

  it("does not infer descendant termination from a missing parent", () => {
    const port = new SystemProcessTreePort();
    const child = childProcess(43_210);
    killProcess.mockImplementation(() => {
      throw codedError("ESRCH");
    });

    expect(port.signal(child, "SIGKILL")).toBe(true);
    child.emit("close", null, "SIGKILL");
    expect(port.isAlive(child)).toBe(true);
    expect(killProcess).not.toHaveBeenCalled();
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
    "does not confirm either child lifetime from successful %s delivery to a reused PID",
    signal => {
      const port = new SystemProcessTreePort();
      const previousChild = childProcess(43_210);
      const replacementChild = childProcess(43_210);

      expect(port.signal(previousChild, signal)).toBe(true);
      expect(port.isAlive(previousChild)).toBe(true);
      expect(port.isAlive(replacementChild)).toBe(true);
    },
  );

  it("does not confirm either child lifetime after mixed taskkill results", () => {
    const port = new SystemProcessTreePort();
    const previousChild = childProcess(43_210);
    const replacementChild = childProcess(43_210);
    expect(port.signal(previousChild, "SIGKILL")).toBe(true);
    taskkill.mockReturnValue({ status: 1 });

    expect(port.signal(replacementChild, "SIGKILL")).toBe(false);
    expect(port.isAlive(replacementChild)).toBe(true);

    taskkill.mockReturnValue({ status: 0 });
    expect(port.signal(replacementChild, "SIGKILL")).toBe(true);
    expect(port.isAlive(replacementChild)).toBe(true);
    expect(port.isAlive(previousChild)).toBe(true);
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

describe("NodeProcessRunPort — Windows tree lifetime (mocked taskkill)", () => {
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
    const controller = new AbortController();
    const port = new NodeProcessRunPort("/repo", spawn, tree, windowsRuntime);
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
      taskkillOptions,
    );
    expect(taskkill).toHaveBeenNthCalledWith(
      3,
      "taskkill",
      ["/PID", "43210", "/T", "/F"],
      taskkillOptions,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([true, false].flatMap(parentClosed =>
    [0, 1, null].map(forceStatus => ({ parentClosed, forceStatus })),
  ))(
    "keeps successful delivery unconfirmed through escalation (parentClosed=$parentClosed, forceStatus=$forceStatus)",
    async ({ parentClosed, forceStatus }) => {
      const child = new FakeChild(43_210);
      const { spawn } = spawningInto(child);
      const controller = new AbortController();
      const port = new NodeProcessRunPort(
        "/repo", spawn, new SystemProcessTreePort(), windowsRuntime,
      );
      const pending = port.run({ script: "test" }, controller.signal);
      const onSettled = vi.fn();
      void pending.then(onSettled);
      taskkill.mockReturnValueOnce({ status: 0 }).mockReturnValue({ status: forceStatus });

      controller.abort();
      if (parentClosed) {
        child.emit("close", null, "SIGTERM");
      }
      await Promise.resolve();
      expect(onSettled).not.toHaveBeenCalled();
      expect(taskkill).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(onSettled).not.toHaveBeenCalled();
      expect(taskkill).toHaveBeenCalledTimes(2);
      expect(taskkill).toHaveBeenNthCalledWith(
        1, "taskkill", ["/PID", "43210", "/T"], taskkillOptions,
      );
      expect(taskkill).toHaveBeenNthCalledWith(
        2, "taskkill", ["/PID", "43210", "/T", "/F"], taskkillOptions,
      );

      await vi.advanceTimersByTimeAsync(249);
      expect(onSettled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      const result = await pending;
      expect(result.exitCode).toBeNull();
      expect(result.signal).toBe("SIGKILL");
      expect(result.terminationConfirmed).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      expect(killProcess).not.toHaveBeenCalled();

      child.emit("close", null, "SIGKILL");
      await vi.advanceTimersByTimeAsync(10_000);
      expect(onSettled).toHaveBeenCalledExactlyOnceWith(result);
      expect(taskkill).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
