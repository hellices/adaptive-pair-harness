import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  workspace: { textDocuments: [] as unknown[] },
  window: {},
  tests: {},
}));

const { NodePackageScriptPort, NodeProcessRunPort, MAX_OUTPUT_BYTES } =
  await import("../src/verificationAdapter.js");
import type {
  ProcessTreePort,
  ReadTextFile,
  RunOutcome,
  SpawnProcess,
} from "../src/verificationAdapter.js";

const codedError = (code: string): NodeJS.ErrnoException => {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
};

describe("NodePackageScriptPort", () => {
  const port = (read: ReadTextFile): InstanceType<typeof NodePackageScriptPort> =>
    new NodePackageScriptPort("/repo", read);

  it("reads scripts from a valid manifest", () => {
    const manifest = port(() =>
      JSON.stringify({ scripts: { test: "vitest run", build: "esbuild" } }),
    ).scripts();
    expect(manifest).toEqual({
      status: "ok",
      scripts: { test: "vitest run", build: "esbuild" },
    });
  });

  it("reports a genuinely absent manifest distinctly", () => {
    const manifest = port(() => {
      throw codedError("ENOENT");
    }).scripts();
    expect(manifest.status).toBe("absent");
  });

  it("reports an unreadable manifest as a typed failure, not absent", () => {
    const manifest = port(() => {
      throw codedError("EACCES");
    }).scripts();
    expect(manifest.status).toBe("unreadable");
  });

  it("reports a malformed manifest as unreadable rather than throwing", () => {
    const manifest = port(() => "{ this is not json ").scripts();
    expect(manifest.status).toBe("unreadable");
  });

  it("reports a non-object manifest as unreadable", () => {
    const manifest = port(() => JSON.stringify("just a string")).scripts();
    expect(manifest.status).toBe("unreadable");
  });

  it("treats a manifest without a scripts field as an empty ok result", () => {
    const manifest = port(() => JSON.stringify({ name: "pkg" })).scripts();
    expect(manifest).toEqual({ status: "ok", scripts: {} });
  });

  it("reports a non-object scripts field as unreadable", () => {
    const manifest = port(() => JSON.stringify({ scripts: "nope" })).scripts();
    expect(manifest.status).toBe("unreadable");
  });
});

class FakeChild extends EventEmitter {
  public readonly stdout = new EventEmitter();
  public readonly stderr = new EventEmitter();
  public readonly signals: string[] = [];
  public constructor(public readonly pid?: number) {
    super();
  }
  public kill(signal: string): boolean {
    this.signals.push(signal);
    return true;
  }
}

const spawningInto = (
  child: FakeChild,
): {
  readonly spawn: SpawnProcess;
  readonly state: {
    calls: number;
    command?: string;
    args?: readonly string[];
    options?: Parameters<SpawnProcess>[2];
  };
} => {
  const state: {
    calls: number;
    command?: string;
    args?: readonly string[];
    options?: Parameters<SpawnProcess>[2];
  } = { calls: 0 };
  const spawn: SpawnProcess = (command, args, options) => {
    state.calls += 1;
    state.command = command;
    state.args = args;
    state.options = options;
    return child as unknown as ReturnType<SpawnProcess>;
  };
  return { spawn, state };
};

describe("NodeProcessRunPort", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the exit code and combined stdout/stderr on close", async () => {
    const child = new FakeChild();
    const { spawn, state } = spawningInto(child);
    const port = new NodeProcessRunPort("/repo", spawn);
    const pending = port.run({ script: "test" }, new AbortController().signal);
    child.stdout.emit("data", Buffer.from("out-line\n"));
    child.stderr.emit("data", Buffer.from("err-line\n"));
    child.emit("close", 0, null);
    const result = await pending;
    expect(state.calls).toBe(1);
    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.terminationConfirmed).toBe(true);
    expect(result.output).toContain("out-line");
    expect(result.output).toContain("err-line");
  });

  it("resolves a failure without confirming termination on spawn error", async () => {
    const child = new FakeChild();
    const { spawn } = spawningInto(child);
    const port = new NodeProcessRunPort("/repo", spawn);
    const pending = port.run({ script: "test" }, new AbortController().signal);
    child.emit("error", new Error("spawn ENOENT"));
    const result = await pending;
    expect(result.exitCode).toBeNull();
    expect(result.terminationConfirmed).toBe(false);
  });

  it("settles exactly once and detaches the abort listener on close", async () => {
    const child = new FakeChild();
    const { spawn } = spawningInto(child);
    const controller = new AbortController();
    const port = new NodeProcessRunPort("/repo", spawn);
    const pending = port.run({ script: "test" }, controller.signal);
    child.emit("close", 0, null);
    // A later error must not change the already-settled outcome.
    child.emit("error", new Error("late"));
    const result = await pending;
    expect(result.exitCode).toBe(0);
    // The abort listener was removed on settle, so a subsequent abort is inert.
    controller.abort();
    expect(child.signals).toEqual([]);
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

  it("bounds combined stdout/stderr output to the byte cap", async () => {
    const child = new FakeChild();
    const { spawn } = spawningInto(child);
    const port = new NodeProcessRunPort("/repo", spawn);
    const pending = port.run({ script: "test" }, new AbortController().signal);
    child.stdout.emit("data", Buffer.alloc(100 * 1024, 0x61));
    child.stdout.emit("data", Buffer.alloc(100 * 1024, 0x62));
    child.stderr.emit("data", Buffer.alloc(100 * 1024, 0x63));
    child.emit("close", 0, null);
    const result: RunOutcome = await pending;
    expect(Buffer.byteLength(result.output, "utf8")).toBeLessThanOrEqual(
      MAX_OUTPUT_BYTES,
    );
    expect(result.outputTruncated).toBe(true);
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
    const controller = new AbortController();
    const port = new NodeProcessRunPort("/repo", spawn, tree);
    const pending = port.run({ script: "test" }, controller.signal);

    expect(state.command).toBe(process.platform === "win32" ? "npm.cmd" : "npm");
    expect(state.args).toEqual(["run", "test"]);
    expect(state.options).toMatchObject({
      cwd: "/repo",
      shell: false,
      detached: process.platform !== "win32",
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
});
