import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { WriteStream } from "node:fs";
import type { ChildProcessWithoutNullStreams, SpawnOptions } from "node:child_process";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { launchPhase } from "../launch.js";
import type { ProbeEvidence } from "../contracts.js";

const io = vi.hoisted(() => ({
  spawn: vi.fn<(file: string, args: readonly string[], options: SpawnOptions) => ChildProcessWithoutNullStreams>(),
  createLog: vi.fn<() => WriteStream>(),
  readFile: vi.fn<() => Promise<string>>(),
}));

vi.mock("node:child_process", () => ({ spawn: io.spawn }));
vi.mock("node:fs", () => ({ createWriteStream: io.createLog }));
vi.mock("node:fs/promises", () => ({ readFile: io.readFile }));
vi.mock("node:net", () => ({
  createServer: () => ({
    once: vi.fn(),
    listen: (_port: number, _host: string, ready: () => void) => ready(),
    address: () => ({ port: 45001 }),
    close: (ready: () => void) => ready(),
  }),
}));

const run = {
  directory: "/owned/run", workspace: "/owned/run/workspace", userData: "/owned/run/user", windowToken: "owned-window",
};
const evidence: ProbeEvidence = {
  phase: "seed", hostVersion: "1.138.0", nodeVersion: "24.18.1", status: "passed",
  enabledApiProposals: [],
  state: { invocations: [], bootKey: "fixture", modelCalls: 0, tokenCountCalls: 0, disposalApi: "fixture", disposalEvents: [] },
};
let child: ChildProcessWithoutNullStreams;
let log: WriteStream;
const kill = vi.fn<(pid: number, signal?: string | number) => true>();

beforeEach(() => {
  vi.useFakeTimers();
  io.spawn.mockReset();
  io.createLog.mockReset();
  child = Object.assign(new EventEmitter(), {
    pid: 43210, stdout: new PassThrough(), stderr: new PassThrough(), unref: vi.fn(),
  }) as unknown as ChildProcessWithoutNullStreams;
  const output = new PassThrough();
  output.resume();
  log = output as unknown as WriteStream;
  io.spawn.mockReturnValue(child);
  io.createLog.mockImplementation(() => {
    queueMicrotask(() => log.emit("open", 42));
    return log;
  });
  io.readFile.mockResolvedValue(JSON.stringify(evidence));
  kill.mockReset().mockReturnValue(true);
  vi.spyOn(process, "kill").mockImplementation(kill);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  child.emit("close", 0);
  child.stdout.destroy();
  child.stderr.destroy();
  log.destroy();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const startHost = async () => {
  const outcome = launchPhase(run, "/owned/probe", "seed")
    .then(result => ({ result, error: undefined }), (error: unknown) => ({ result: undefined, error }));
  await vi.advanceTimersByTimeAsync(0);
  expect(io.spawn).toHaveBeenCalledTimes(1);
  return { outcome };
};

it("does not inherit profile overrides, bootstrap injection, or credentials", async () => {
  const excluded = [
    "VSCODE_APPDATA", "VSCODE_PORTABLE", "VSCODE_EXTENSIONS", "VSCODE_AGENT_PLUGINS",
    "VSCODE_IPC_HOOK", "ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "NODE_PATH", "SSH_AUTH_SOCK", "GITHUB_TOKEN",
  ];
  for (const key of excluded) vi.stubEnv(key, "unowned-fixture-value");
  vi.stubEnv("PATH", "fixture-bin");
  vi.stubEnv("DISPLAY", ":99");
  const { outcome } = await startHost();
  const environment = io.spawn.mock.calls[0]?.[2].env;
  expect(environment).toMatchObject({
    PATH: "fixture-bin", DISPLAY: ":99", HOME: "/owned/run/home", COPILOT_HOME: "/owned/run/home/.copilot",
  });
  for (const key of excluded) expect(environment).not.toHaveProperty(key);
  child.emit("close", 0);
  expect((await outcome).result).toEqual(evidence);
});

it("terminates and waits for its owned host when the log fails", async () => {
  const { outcome } = await startHost();
  const settled = vi.fn();
  void outcome.then(settled);
  const fault = Object.assign(new Error("Fixture disk full"), { code: "ENOSPC" });
  expect(() => log.emit("error", fault)).not.toThrow();
  expect(kill).toHaveBeenCalledExactlyOnceWith(-43210, "SIGKILL");
  await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();
  child.emit("close", null, "SIGKILL");
  expect((await outcome).error).toBe(fault);
  expect(vi.getTimerCount()).toBe(0);
});

it("waits for the log to open before spawning a detached host", async () => {
  io.createLog.mockReturnValue(log);
  const outcome = launchPhase(run, "/owned/probe", "seed");
  await vi.advanceTimersByTimeAsync(0);
  expect(io.spawn).not.toHaveBeenCalled();
  log.emit("open", 42);
  await vi.advanceTimersByTimeAsync(0);
  expect(io.spawn).toHaveBeenCalledTimes(1);
  child.emit("close", 0);
  await expect(outcome).resolves.toEqual(evidence);
});

it("does not spawn a host when opening its log fails", async () => {
  io.createLog.mockReturnValue(log);
  const outcome = launchPhase(run, "/owned/probe", "seed").catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(0);
  const fault = Object.assign(new Error("Fixture log cannot open"), { code: "EACCES" });
  expect(() => log.emit("error", fault)).not.toThrow();
  expect(io.spawn).not.toHaveBeenCalled();
  expect(await outcome).toBe(fault);
  expect(kill).not.toHaveBeenCalled();
});

it("handles an already exited process group without escaping the timeout", async () => {
  const { outcome } = await startHost();
  kill.mockImplementation(() => {
    throw Object.assign(new Error("Fixture group already exited"), { code: "ESRCH" });
  });
  await vi.advanceTimersByTimeAsync(60000);
  child.emit("close", 0);
  expect(String((await outcome).error)).toContain("exceeded 60000 ms");
  expect(vi.getTimerCount()).toBe(0);
});

it("reports a signal failure through the launch promise instead of throwing in a timer", async () => {
  const { outcome } = await startHost();
  const settled = vi.fn();
  void outcome.then(settled);
  const fault = Object.assign(new Error("Fixture signal denied"), { code: "EPERM" });
  kill.mockImplementation(() => { throw fault; });
  await vi.advanceTimersByTimeAsync(60000);
  expect(settled).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(4999);
  expect(settled).not.toHaveBeenCalled();
  child.emit("close", 0);
  const error = (await outcome).error;
  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).errors).toContain(fault);
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds the cleanup wait and reports an unconfirmed close after signal failure", async () => {
  const { outcome } = await startHost();
  kill.mockImplementation(() => { throw Object.assign(new Error("Fixture signal denied"), { code: "EPERM" }); });
  await vi.advanceTimersByTimeAsync(60000);
  await vi.advanceTimersByTimeAsync(5000);
  expect(String((await outcome).error)).toContain("did not close within 5000 ms");
  expect(child.stdout.destroyed).toBe(true);
  expect(child.stderr.destroyed).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([
  { label: "missing", proposals: undefined }, { label: "enabled", proposals: ["chatParticipantPrivate"] },
])("rejects $label proposal evidence", async ({ proposals }) => {
  io.readFile.mockResolvedValue(JSON.stringify({ ...evidence, enabledApiProposals: proposals }));
  const { outcome } = await startHost();
  child.emit("close", 0);
  expect(String((await outcome).error)).toContain("proposal evidence");
});
