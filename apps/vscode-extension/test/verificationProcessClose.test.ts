import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProcessRuntime } from "../src/verificationProcessInvocation.js";
import { FakeChild, spawningInto } from "./verificationPortFixtures.js";

const taskkill = vi.hoisted(() => vi.fn<() => { readonly status: number | null }>());

vi.mock("node:child_process", async importOriginal => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawnSync: taskkill,
}));

const { NodeProcessRunPort } = await import("../src/verificationProcess.js");
const { SystemProcessTreePort } = await import("../src/verificationProcessTree.js");
const originalPlatform = process.platform;
const windowsRuntime: ProcessRuntime = {
  platform: "win32",
  execPath: "C:\\nodejs\\node.exe",
  path: undefined,
  npmExecPath: undefined,
  npmNodeExecPath: undefined,
  exists: path => path === "C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
};

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(process, "platform", { value: "win32" });
  taskkill.mockReset();
  taskkill.mockReturnValue({ status: 0 });
  vi.spyOn(process, "kill").mockReturnValue(true);
});

afterEach(async () => {
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  Object.defineProperty(process, "platform", { value: originalPlatform });
  vi.restoreAllMocks();
});

const closeCases = [0, 4_999, 5_000, 5_249].flatMap(closeDelay =>
  [0, 1, null].map(status => ({ closeDelay, status })),
);

it.each(closeCases)(
  "settles unknown tree exit at child close after $closeDelay ms (taskkill=$status)",
  async ({ closeDelay, status }) => {
    taskkill.mockReturnValue({ status });
    const child = new FakeChild(43_210);
    const { spawn } = spawningInto(child);
    const controller = new AbortController();
    const port = new NodeProcessRunPort("/repo", spawn, new SystemProcessTreePort(), windowsRuntime);
    const pending = port.run({ script: "test" }, controller.signal);
    const settled = vi.fn();
    void pending.then(settled);
    child.stdout.emit("data", Buffer.from("partial output"));

    controller.abort();
    await vi.advanceTimersByTimeAsync(closeDelay);
    expect(settled).not.toHaveBeenCalled();
    const terminationSignal = closeDelay < 5_000 ? "SIGTERM" : "SIGKILL";
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
  const child = new FakeChild(43_210);
  const { spawn } = spawningInto(child);
  const controller = new AbortController();
  const port = new NodeProcessRunPort("/repo", spawn, new SystemProcessTreePort(), windowsRuntime);
  const pending = port.run({ script: "test" }, controller.signal);
  const settled = vi.fn();
  void pending.then(settled);

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
    const child = new FakeChild(43_210);
    const { spawn } = spawningInto(child);
    const controller = new AbortController();
    taskkill.mockImplementation(() => {
      const requestedSignal = taskkill.mock.calls.length === 1 ? "SIGTERM" : "SIGKILL";
      if (requestedSignal === closeSignal) child.emit("close", null, requestedSignal);
      return { status: 0 };
    });
    const port = new NodeProcessRunPort("/repo", spawn, new SystemProcessTreePort(), windowsRuntime);
    const pending = port.run({ script: "test" }, controller.signal);
    const settled = vi.fn();
    void pending.then(settled);

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
