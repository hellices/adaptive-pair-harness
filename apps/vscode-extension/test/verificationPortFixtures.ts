import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { afterEach, vi } from "vitest";
import type { SpawnProcess } from "../src/verificationAdapter.js";

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

afterEach(() => {
  vscode.reset();
});

const codedError = (code: string): NodeJS.ErrnoException => {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
};

const lexicalIdentity = (path: string): string => resolve(path);

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

export { codedError, FakeChild, lexicalIdentity, spawningInto, vscode };
