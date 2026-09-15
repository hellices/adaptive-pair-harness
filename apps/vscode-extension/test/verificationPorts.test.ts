import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const vscode = vi.hoisted(() => {
  const state = {
    workspaceRoots: ["/workspace", "/other-workspace"] as string[],
    textDocuments: [] as {
      readonly uri: { readonly fsPath: string; readonly scheme?: string };
      readonly isDirty: boolean;
    }[],
  };
  const reset = (): void => {
    state.workspaceRoots = ["/workspace", "/other-workspace"];
    state.textDocuments = [];
  };
  return { state, reset };
});

vi.mock("vscode", () => ({
  workspace: {
    get workspaceFolders() {
      return vscode.state.workspaceRoots.map(root => ({
        uri: { fsPath: root },
      }));
    },
    get textDocuments() {
      return vscode.state.textDocuments;
    },
    asRelativePath: (uri: { readonly fsPath: string }): string => {
      const root = vscode.state.workspaceRoots.find(candidate =>
        uri.fsPath.startsWith(`${candidate}/`),
      );
      return root === undefined ? uri.fsPath : uri.fsPath.slice(root.length + 1);
    },
  },
  window: {},
  tests: {},
}));

const {
  createVerificationAdapter,
  NodePackageScriptPort,
  NodeProcessRunPort,
  VscodeBufferInspectionPort,
  MAX_OUTPUT_BYTES,
} = await import("../src/verificationAdapter.js");
import type {
  ConfirmationPort,
  ProcessRuntime,
  ProcessTreePort,
  ReadTextFile,
  RunOutcome,
  SpawnProcess,
  TestingRunPort,
} from "../src/verificationAdapter.js";

afterEach(() => {
  vscode.reset();
});

const codedError = (code: string): NodeJS.ErrnoException => {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
};

const lexicalIdentity = (path: string): string => resolve(path);

describe("VscodeBufferInspectionPort", () => {
  it("does not cancel first-root verification for a dirty duplicate path in the second root", async () => {
    vscode.state.textDocuments = [
      {
        uri: { fsPath: "/other-workspace/src/shared.ts" },
        isDirty: true,
      },
    ];
    const testing: TestingRunPort = {
      available: () => true,
      run: () =>
        Promise.resolve({
          exitCode: 0,
          signal: null,
          output: "passed",
          outputTruncated: false,
          terminationConfirmed: true,
        }),
    };
    const confirmation: ConfirmationPort = {
      confirm: () => Promise.resolve(true),
    };

    const result = await createVerificationAdapter(
      "/workspace",
      testing,
      confirmation,
      lexicalIdentity,
    ).run(
      {
        kind: "vscode-test",
        operationId: "op-multi-root",
        testIds: ["suite/case"],
        targetPaths: ["src/shared.ts"],
      },
      new AbortController().signal,
    );

    expect(result.status).toBe("confirmed");
  });

  it("returns only dirty documents in the bound root when targets are empty", () => {
    vscode.state.textDocuments = [
      {
        uri: { fsPath: "/workspace/src/shared.ts" },
        isDirty: true,
      },
      {
        uri: { fsPath: "/other-workspace/src/shared.ts" },
        isDirty: true,
      },
    ];

    expect(
      new VscodeBufferInspectionPort(
        "/workspace",
        lexicalIdentity,
      ).dirtyTargets([]),
    ).toEqual(["src/shared.ts"]);
  });

  it.each(["src", "./src"])(
    "returns a dirty descendant of directory-scoped target %s",
    target => {
    vscode.state.textDocuments = [
      {
        uri: { fsPath: "/workspace/src/retry.ts" },
        isDirty: true,
      },
      {
        uri: { fsPath: "/workspace/src-other/clean-boundary.ts" },
        isDirty: true,
      },
    ];

    expect(
      new VscodeBufferInspectionPort(
        "/workspace",
        lexicalIdentity,
      ).dirtyTargets([target]),
    ).toEqual(["src/retry.ts"]);
    },
  );

  it.each([".", ""])(
    "checks every dirty document in the bound root for invalid target %j",
    target => {
      vscode.state.textDocuments = [
        {
          uri: { fsPath: "/workspace/src/retry.ts" },
          isDirty: true,
        },
        {
          uri: { fsPath: "/other-workspace/src/other.ts" },
          isDirty: true,
        },
      ];

      expect(
        new VscodeBufferInspectionPort(
          "/workspace",
          lexicalIdentity,
        ).dirtyTargets([target]),
      ).toEqual(["src/retry.ts"]);
    },
  );

  it.each([
    "/workspace-alias/src/retry.ts",
    "/WORKSPACE/SRC/RETRY.TS",
  ])(
    "finds a dirty target opened through the physical alias %s",
    documentPath => {
      vscode.state.textDocuments = [
        {
          uri: { fsPath: documentPath },
          isDirty: true,
        },
      ];
      const identities = new Map([
        [resolve("/workspace"), "/physical/workspace"],
        [
          resolve("/workspace/src/retry.ts"),
          "/physical/workspace/src/retry.ts",
        ],
        [resolve(documentPath), "/physical/workspace/src/retry.ts"],
      ]);

      expect(
        new VscodeBufferInspectionPort(
          "/workspace",
          path => identities.get(resolve(path)),
        ).dirtyTargets(["src/retry.ts"]),
      ).toEqual(["src/retry.ts"]);
    },
  );

  it.each([
    {
      name: "returns no identity",
      unresolved: () => undefined,
    },
    {
      name: "reports a coded filesystem error",
      unresolved: () => {
        throw codedError("ENAMETOOLONG");
      },
    },
  ])(
    "refuses inspection when resolving an agreed target $name",
    ({ unresolved }) => {
      expect(
        () =>
          new VscodeBufferInspectionPort(
            "/workspace",
            path =>
              resolve(path) === resolve("/workspace/src/retry.ts")
                ? unresolved()
                : resolve(path),
          ).dirtyTargets(["src/retry.ts"]),
      ).toThrow(/filesystem identity.*src\/retry\.ts/iu);
    },
  );

  it("refuses inspection when an external dirty document has no filesystem identity", () => {
    const documentPath = "/external-alias/src/retry.ts";
    vscode.state.textDocuments = [
      {
        uri: { fsPath: documentPath },
        isDirty: true,
      },
    ];

    expect(
      () =>
        new VscodeBufferInspectionPort(
          "/workspace",
          path => {
            if (resolve(path) === resolve(documentPath)) {
              throw codedError("EACCES");
            }
            return resolve(path);
          },
        ).dirtyTargets(["src/retry.ts"]),
    ).toThrow(/filesystem identity.*src\/retry\.ts/iu);
  });

  it("excludes an unresolvable dirty document owned by the second workspace root", () => {
    const documentPath = "/other-workspace/src/retry.ts";
    vscode.state.textDocuments = [
      {
        uri: { fsPath: documentPath },
        isDirty: true,
      },
    ];

    expect(
      new VscodeBufferInspectionPort(
        "/workspace",
        path => {
          if (resolve(path) === resolve(documentPath)) {
            throw codedError("EACCES");
          }
          return resolve(path);
        },
      ).dirtyTargets(["src/retry.ts"]),
    ).toEqual([]);
  });

  it("cancels verification when an agreed target has no filesystem identity", async () => {
    const testing: TestingRunPort = {
      available: () => true,
      run: () =>
        Promise.resolve({
          exitCode: 0,
          signal: null,
          output: "passed",
          outputTruncated: false,
          terminationConfirmed: true,
        }),
    };
    const confirmation: ConfirmationPort = {
      confirm: () => Promise.resolve(true),
    };

    const result = await createVerificationAdapter(
      "/workspace",
      testing,
      confirmation,
      path =>
        resolve(path) === resolve("/workspace/src/retry.ts")
          ? undefined
          : resolve(path),
    ).run(
      {
        kind: "vscode-test",
        operationId: "op-unresolved-target",
        testIds: ["suite/case"],
        targetPaths: ["src/retry.ts"],
      },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: "cancelled",
      observation: {
        reason: "target-buffer-identity-unavailable",
        targetPaths: ["src/retry.ts"],
      },
    });
  });

  it("allows a missing agreed target when no matching dirty file exists", () => {
    expect(
      new VscodeBufferInspectionPort(
        "/workspace",
        path => {
          if (resolve(path) === resolve("/workspace/src/new.ts")) {
            throw codedError("ENOENT");
          }
          return resolve(path);
        },
      ).dirtyTargets(["src/new.ts"]),
    ).toEqual([]);
  });

  it("finds a dirty new file lexically when its filesystem identity does not exist yet", () => {
    const documentPath = "/workspace/src/new.ts";
    vscode.state.textDocuments = [
      {
        uri: { fsPath: documentPath, scheme: "file" },
        isDirty: true,
      },
    ];

    expect(
      new VscodeBufferInspectionPort(
        "/workspace",
        path => {
          if (resolve(path) === resolve(documentPath)) {
            throw codedError("ENOENT");
          }
          return resolve(path);
        },
      ).dirtyTargets(["src/new.ts"]),
    ).toEqual(["src/new.ts"]);
  });

  it("ignores dirty untitled documents without a filesystem identity", () => {
    vscode.state.textDocuments = [
      {
        uri: { fsPath: "Untitled-1", scheme: "untitled" },
        isDirty: true,
      },
    ];

    expect(
      new VscodeBufferInspectionPort(
        "/workspace",
        path => {
          if (path.endsWith("Untitled-1")) {
            throw codedError("ENOENT");
          }
          return resolve(path);
        },
      ).dirtyTargets(["src/retry.ts"]),
    ).toEqual([]);
  });
});

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

  it.each([
    {
      name: "the current Node installation",
      runtime: {
        platform: "win32",
        execPath: "C:\\nodejs\\node.exe",
        path: undefined,
        npmExecPath: undefined,
        npmNodeExecPath: undefined,
        exists: (path: string) =>
          path === "C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
      },
      expectedCommand: "C:\\nodejs\\node.exe",
      expectedCli: "C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
    },
    {
      name: "the npm installation on PATH when hosted by VS Code",
      runtime: {
        platform: "win32",
        execPath: "C:\\Program Files\\Microsoft VS Code\\Code.exe",
        path: "C:\\nodejs",
        npmExecPath: undefined,
        npmNodeExecPath: undefined,
        exists: (path: string) =>
          new Set([
            "C:\\nodejs\\npm.cmd",
            "C:\\nodejs\\node.exe",
            "C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
          ]).has(path),
      },
      expectedCommand: "C:\\nodejs\\node.exe",
      expectedCli: "C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
    },
  ] satisfies readonly {
    readonly name: string;
    readonly runtime: ProcessRuntime;
    readonly expectedCommand: string;
    readonly expectedCli: string;
  }[])(
    "invokes npm's JavaScript CLI without a shell using $name on Windows",
    async ({ runtime, expectedCommand, expectedCli }) => {
      const child = new FakeChild();
      const { spawn, state } = spawningInto(child);
      const port = new NodeProcessRunPort("/repo", spawn, undefined, runtime);

      const pending = port.run({ script: "test" }, new AbortController().signal);
      child.emit("close", 0, null);
      await pending;

      expect(state.command).toBe(expectedCommand);
      expect(state.args).toEqual([expectedCli, "run", "test"]);
      expect(state.options).toMatchObject({
        cwd: "/repo",
        shell: false,
        detached: false,
      });
    },
  );

  it("does not fall back to a command shell when a Windows npm CLI cannot be resolved", async () => {
    const child = new FakeChild();
    const { spawn, state } = spawningInto(child);
    const runtime: ProcessRuntime = {
      platform: "win32",
      execPath: "C:\\Program Files\\Microsoft VS Code\\Code.exe",
      path: "C:\\broken-node-install",
      npmExecPath: undefined,
      npmNodeExecPath: undefined,
      exists: (path) => path === "C:\\broken-node-install\\npm.cmd",
    };
    const port = new NodeProcessRunPort("/repo", spawn, undefined, runtime);

    const pending = port.run({ script: "test" }, new AbortController().signal);
    child.emit("close", 0, null);
    const result = await pending;

    expect(state.calls).toBe(0);
    expect(result.exitCode).toBeNull();
    expect(result.terminationConfirmed).toBe(false);
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
});
