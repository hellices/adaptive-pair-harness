import { describe, expect, it } from "vitest";
import { FakeChild, spawningInto } from "./verificationPortFixtures.js";

const { NodeProcessRunPort } = await import("../src/verificationAdapter.js");
import type { ProcessRuntime } from "../src/verificationAdapter.js";

describe("NodeProcessRunPort — Windows npm invocation", () => {
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
      name: "npm's explicit Node executable ahead of the host executable",
      runtime: {
        platform: "win32",
        execPath: "C:\\host\\node.exe",
        path: undefined,
        npmExecPath: "C:\\npm\\npm-cli.js",
        npmNodeExecPath: "C:\\npm\\node.exe",
        exists: (path: string) =>
          new Set(["C:\\npm\\npm-cli.js", "C:\\npm\\node.exe"]).has(path),
      },
      expectedCommand: "C:\\npm\\node.exe",
      expectedCli: "C:\\npm\\npm-cli.js",
    },
    {
      name: "npm's explicit CLI with the host Node executable",
      runtime: {
        platform: "win32",
        execPath: "C:\\host\\node.exe",
        path: undefined,
        npmExecPath: "C:\\npm\\npm-cli.js",
        npmNodeExecPath: undefined,
        exists: (path: string) => path === "C:\\npm\\npm-cli.js",
      },
      expectedCommand: "C:\\host\\node.exe",
      expectedCli: "C:\\npm\\npm-cli.js",
    },
    {
      name: "a quoted PATH installation after empty and incomplete entries",
      runtime: {
        platform: "win32",
        execPath: "C:\\host\\Code.exe",
        path: ';"C:\\incomplete";"C:\\node installation";',
        npmExecPath: undefined,
        npmNodeExecPath: undefined,
        exists: (path: string) =>
          new Set([
            "C:\\incomplete\\npm.cmd",
            "C:\\node installation\\npm.cmd",
            "C:\\node installation\\node.exe",
            "C:\\node installation\\node_modules\\npm\\bin\\npm-cli.js",
          ]).has(path),
      },
      expectedCommand: "C:\\node installation\\node.exe",
      expectedCli: "C:\\node installation\\node_modules\\npm\\bin\\npm-cli.js",
    },
  ] satisfies readonly {
    readonly name: string;
    readonly runtime: ProcessRuntime;
    readonly expectedCommand: string;
    readonly expectedCli: string;
  }[])("invokes npm's JavaScript CLI without a shell using $name", async ({ runtime, expectedCommand, expectedCli }) => {
    const child = new FakeChild();
    const { spawn, state } = spawningInto(child);
    const port = new NodeProcessRunPort("/repo", spawn, undefined, runtime);

    const pending = port.run({ script: "test" }, new AbortController().signal);
    expect(state.calls).toBe(1);
    child.emit("close", 0, null);
    const result = await pending;

    expect(state.command).toBe(expectedCommand);
    expect(state.args).toEqual([expectedCli, "run", "test"]);
    expect(state.options).toEqual({ cwd: "/repo", shell: false, detached: false });
    expect(result.exitCode).toBe(0);
  });

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
});
