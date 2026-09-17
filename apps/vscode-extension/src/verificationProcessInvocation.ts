import { existsSync } from "node:fs";
import { win32 } from "node:path";

export interface ProcessRuntime {
  readonly platform: NodeJS.Platform;
  readonly execPath: string;
  readonly path: string | undefined;
  readonly npmExecPath: string | undefined;
  readonly npmNodeExecPath: string | undefined;
  exists(path: string): boolean;
}

export const defaultProcessRuntime: ProcessRuntime = {
  platform: process.platform,
  execPath: process.execPath,
  path: process.env["PATH"],
  npmExecPath: process.env["npm_execpath"],
  npmNodeExecPath: process.env["npm_node_execpath"],
  exists: existsSync,
};

interface NpmInvocation {
  readonly command: string;
  readonly argsPrefix: readonly string[];
  readonly detached: boolean;
}

const isWindowsNode = (path: string): boolean =>
  win32.basename(path).toLowerCase() === "node.exe";

const windowsNpmInvocation = (
  runtime: ProcessRuntime,
): NpmInvocation | undefined => {
  const npmExecPath = runtime.npmExecPath;
  const npmNodeExecPath = runtime.npmNodeExecPath;
  if (
    npmExecPath !== undefined &&
    win32.basename(npmExecPath).toLowerCase() === "npm-cli.js" &&
    runtime.exists(npmExecPath)
  ) {
    if (
      npmNodeExecPath !== undefined &&
      isWindowsNode(npmNodeExecPath) &&
      runtime.exists(npmNodeExecPath)
    ) {
      return {
        command: npmNodeExecPath,
        argsPrefix: [npmExecPath],
        detached: false,
      };
    }
    if (isWindowsNode(runtime.execPath)) {
      return {
        command: runtime.execPath,
        argsPrefix: [npmExecPath],
        detached: false,
      };
    }
  }

  if (isWindowsNode(runtime.execPath)) {
    const adjacentCli = win32.join(
      win32.dirname(runtime.execPath),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
    if (runtime.exists(adjacentCli)) {
      return {
        command: runtime.execPath,
        argsPrefix: [adjacentCli],
        detached: false,
      };
    }
  }

  for (const rawEntry of runtime.path?.split(";") ?? []) {
    const entry = rawEntry.replace(/^"(.*)"$/u, "$1");
    if (entry.length === 0) {
      continue;
    }
    const npmCommand = win32.join(entry, "npm.cmd");
    const nodeExecutable = win32.join(entry, "node.exe");
    const npmCli = win32.join(
      entry,
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
    if (
      runtime.exists(npmCommand) &&
      runtime.exists(nodeExecutable) &&
      runtime.exists(npmCli)
    ) {
      return {
        command: nodeExecutable,
        argsPrefix: [npmCli],
        detached: false,
      };
    }
  }
  return undefined;
};

export const npmInvocation = (runtime: ProcessRuntime): NpmInvocation | undefined =>
  runtime.platform === "win32"
    ? windowsNpmInvocation(runtime)
    : { command: "npm", argsPrefix: [], detached: true };
