import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import * as vscode from "vscode";
import type { EffectResult } from "@adaptive-pair/runtime";
import { canonicalRelative } from "./workspaceContext.js";
import { ALLOWED_VERIFICATION_SCRIPT } from "./verificationPlan.js";

export const MAX_OUTPUT_BYTES = 128 * 1024;
export const DISPLAY_LIMIT = 16_000;
export const VERIFICATION_TIMEOUT_MS = 120_000;

/**
 * Only an agreed VS Code Testing selection, or an existing root package script
 * named test/check/lint/typecheck/build (with an optional colon suffix) may be
 * run. No raw arbitrary shell is ever accepted. The allowlist is shared with
 * the participant's `/check` route so both gates cannot drift apart.
 */
const ALLOWED_SCRIPT = ALLOWED_VERIFICATION_SCRIPT;

export type VerificationPlan =
  | {
      readonly kind: "vscode-test";
      readonly operationId: string;
      readonly testIds: readonly string[];
      readonly targetPaths: readonly string[];
      readonly label?: string;
    }
  | {
      readonly kind: "package-script";
      readonly operationId: string;
      readonly script: string;
      readonly targetPaths: readonly string[];
    };

export interface RunOutcome {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly output: string;
  readonly outputTruncated: boolean;
  readonly terminationConfirmed: boolean;
}

export interface RunCommand {
  readonly script: string;
}

export interface TestingRunRequest {
  readonly testIds: readonly string[];
  readonly label: string | undefined;
}

export interface BufferInspectionPort {
  dirtyTargets(paths: readonly string[]): readonly string[];
}

export type FilesystemIdentity = (path: string) => string | undefined;

type FilesystemIdentityResolution =
  | { readonly status: "resolved"; readonly identity: string }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

class TargetBufferIdentityUnavailableError extends Error {
  public constructor(public readonly targetPaths: readonly string[]) {
    super(
      `Could not resolve the filesystem identity for agreed verification target(s): ${targetPaths.join(", ") || "<workspace-root>"}.`,
    );
    this.name = "TargetBufferIdentityUnavailableError";
  }
}

export interface ConfirmationPort {
  confirm(request: ConfirmationRequest, signal: AbortSignal): Promise<boolean>;
}

export interface ConfirmationRequest {
  readonly summary: string;
  readonly detail: string;
}

/**
 * The result of reading the root package manifest. A genuinely absent manifest
 * is reported distinctly (`absent`) from one that exists but cannot be read or
 * parsed (`unreadable`). The two must never collapse into the same outcome: an
 * unreadable manifest is a typed failure, not a missing script.
 */
export type ScriptManifest =
  | { readonly status: "ok"; readonly scripts: Readonly<Record<string, string>> }
  | { readonly status: "absent" }
  | { readonly status: "unreadable" };

export interface PackageScriptPort {
  scripts(): ScriptManifest;
}

export interface ProcessRunPort {
  run(command: RunCommand, signal: AbortSignal): Promise<RunOutcome>;
}

export interface TestingRunPort {
  /**
   * Whether this host can execute the selected tests and observe their results.
   * VS Code stable exposes no consumer-side API to run another provider's
   * selected test IDs and observe completion, so the default port reports
   * `false`; a future capability-gated host may provide an observing port.
   */
  available(): boolean;
  run(request: TestingRunRequest, signal: AbortSignal): Promise<RunOutcome>;
}

export interface TimeoutScheduler {
  set(ms: number, callback: () => void): () => void;
}

export interface VerificationAdapterPorts {
  readonly buffers: BufferInspectionPort;
  readonly confirmation: ConfirmationPort;
  readonly scripts: PackageScriptPort;
  readonly process: ProcessRunPort;
  readonly testing: TestingRunPort;
  readonly scheduler: TimeoutScheduler;
}

const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /-----BEGIN[A-Z ]*PRIVATE KEY-----/u,
  /AKIA[0-9A-Z]{16}/u,
  /gh[posru]_[A-Za-z0-9]{20,}/u,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/u,
  /\bBearer\s+[A-Za-z0-9._-]{16,}/u,
  /(?:password|passwd|secret|token|api[_-]?key|access[_-]?key)\s*[:=]\s*\S+/iu,
];

const containsSensitive = (text: string): boolean =>
  SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));

const boundToBytes = (text: string, maxBytes: number): { readonly text: string; readonly truncated: boolean } => {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.byteLength <= maxBytes) {
    return { text, truncated: false };
  }
  return { text: boundedUtf8(buffer, maxBytes), truncated: true };
};

/**
 * Decode at most `maxBytes` of a UTF-8 buffer without emitting a trailing
 * replacement character. `StringDecoder` buffers an incomplete trailing
 * multibyte sequence internally instead of flushing it as U+FFFD, so slicing at
 * an arbitrary byte boundary drops only the partial code point cleanly.
 */
const boundedUtf8 = (buffer: Buffer, maxBytes: number): string => {
  const decoder = new StringDecoder("utf8");
  return decoder.write(buffer.subarray(0, Math.min(buffer.byteLength, maxBytes)));
};

const failed = (
  operationId: string,
  status: EffectResult["status"],
  summary: string,
  observation: Readonly<Record<string, unknown>>,
): EffectResult => ({
  operationId,
  status,
  summary,
  observation,
  sensitiveData: false,
  partial: false,
});

/**
 * The first observed-verification adapter. It runs either an agreed VS Code
 * Testing selection or an allowlisted root package script through injectable
 * ports so tests are deterministic. Product verification is derived strictly
 * from the actual exit code, never from model prose or the command text.
 */
export class VerificationAdapter {
  public constructor(private readonly ports: VerificationAdapterPorts) {}

  public async run(
    plan: VerificationPlan,
    signal: AbortSignal,
  ): Promise<EffectResult> {
    if (signal.aborted) {
      return failed(plan.operationId, "cancelled", "Verification was cancelled before it started.", {
        reason: "caller-cancelled",
      });
    }

    if (plan.kind === "package-script") {
      if (!ALLOWED_SCRIPT.test(plan.script)) {
        return failed(
          plan.operationId,
          "declined",
          "The requested script is not an allowed verification command.",
          { reason: "script-not-allowlisted", script: plan.script },
        );
      }
      const manifest = this.ports.scripts.scripts();
      if (manifest.status === "unreadable") {
        return failed(
          plan.operationId,
          "failed",
          "The root package.json exists but could not be read or parsed.",
          { reason: "manifest-unreadable" },
        );
      }
      const scripts = manifest.status === "ok" ? manifest.scripts : {};
      if (!Object.prototype.hasOwnProperty.call(scripts, plan.script)) {
        return failed(
          plan.operationId,
          "declined",
          "The requested script is not defined in the root package.json.",
          { reason: "script-not-defined", script: plan.script },
        );
      }
    }

    if (plan.kind === "vscode-test" && !this.ports.testing.available()) {
      return failed(
        plan.operationId,
        "declined",
        "This VS Code host cannot execute the selected tests and observe their results.",
        { reason: "testing-api-unavailable" },
      );
    }

    let dirty: readonly string[];
    try {
      dirty = this.ports.buffers.dirtyTargets(plan.targetPaths);
    } catch (error) {
      if (error instanceof TargetBufferIdentityUnavailableError) {
        return failed(
          plan.operationId,
          "cancelled",
          "Verification was cancelled because target buffer identities could not be resolved.",
          {
            reason: "target-buffer-identity-unavailable",
            targetPaths: [...error.targetPaths],
          },
        );
      }
      throw error;
    }
    if (dirty.length > 0) {
      return failed(
        plan.operationId,
        "cancelled",
        "Verification was cancelled because target buffers have unsaved changes.",
        { reason: "dirty-target-buffers", dirtyPaths: [...dirty] },
      );
    }

    const confirmed = await this.ports.confirmation.confirm(
      {
        summary: "Run the agreed verification?",
        detail: this.describe(plan),
      },
      signal,
    );
    if (signal.aborted) {
      return failed(plan.operationId, "cancelled", "Verification was cancelled.", {
        reason: "caller-cancelled",
      });
    }
    if (!confirmed) {
      return failed(
        plan.operationId,
        "declined",
        "The developer declined to run the verification.",
        { reason: "confirmation-declined" },
      );
    }

    return await this.execute(plan, signal);
  }

  private describe(plan: VerificationPlan): string {
    return plan.kind === "package-script"
      ? `npm run ${plan.script}`
      : `VS Code Testing: ${plan.testIds.join(", ")}`;
  }

  private async execute(
    plan: VerificationPlan,
    signal: AbortSignal,
  ): Promise<EffectResult> {
    const controller = new AbortController();
    const forwardAbort = (): void => controller.abort();
    signal.addEventListener("abort", forwardAbort, { once: true });

    let deadlineFired = false;
    const cancelDeadline = this.ports.scheduler.set(VERIFICATION_TIMEOUT_MS, () => {
      deadlineFired = true;
      controller.abort();
    });

    let outcome: RunOutcome;
    try {
      outcome =
        plan.kind === "package-script"
          ? await this.ports.process.run({ script: plan.script }, controller.signal)
          : await this.ports.testing.run(
              { testIds: plan.testIds, label: plan.label },
              controller.signal,
            );
    } finally {
      cancelDeadline();
      signal.removeEventListener("abort", forwardAbort);
    }

    return this.interpret(plan.operationId, outcome, controller.signal.aborted, deadlineFired);
  }

  private interpret(
    operationId: string,
    outcome: RunOutcome,
    aborted: boolean,
    deadlineFired: boolean,
  ): EffectResult {
    const bounded = boundToBytes(outcome.output, MAX_OUTPUT_BYTES);
    const sensitive = containsSensitive(bounded.text);
    const display = sensitive
      ? "[redacted: potential secret detected in verification output]"
      : bounded.text.slice(0, DISPLAY_LIMIT);

    // Only the adapter's own 120s deadline sets timedOut. A manual caller
    // cancellation aborts the same controller but must never be labelled a
    // timeout.
    const interrupted = aborted;
    const timedOut = deadlineFired;

    let status: EffectResult["status"];
    if (interrupted) {
      status = outcome.terminationConfirmed ? "cancelled" : "unknown";
    } else if (outcome.exitCode === null) {
      status = "failed";
    } else {
      status = "confirmed";
    }

    const passed = status === "confirmed" && outcome.exitCode === 0;
    const partial =
      interrupted || outcome.outputTruncated || bounded.truncated;

    const observation: Record<string, unknown> = {
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut,
      terminationConfirmed: outcome.terminationConfirmed,
      output: display,
      outputTruncatedForDisplay: !sensitive && bounded.text.length > DISPLAY_LIMIT,
    };
    if (status === "confirmed") {
      observation["passed"] = passed;
    }

    return {
      operationId,
      status,
      summary: this.summarize(status, passed, timedOut),
      observation,
      sensitiveData: sensitive,
      partial,
    };
  }

  private summarize(
    status: EffectResult["status"],
    passed: boolean,
    timedOut: boolean,
  ): string {
    switch (status) {
      case "confirmed":
        return passed ? "Verification ran and the check passed." : "Verification ran and the check failed.";
      case "cancelled":
        return timedOut
          ? "Verification exceeded the 120-second cap and was terminated."
          : "Verification was cancelled.";
      case "unknown":
        return "Verification was interrupted and process termination could not be confirmed.";
      default:
        return "Verification did not complete.";
    }
  }
}

// --- Production port bindings ------------------------------------------------

const defaultFilesystemIdentity: FilesystemIdentity = path =>
  realpathSync.native(path);

const comparableFilesystemIdentity = (path: string): string =>
  process.platform === "win32" ? path.toLowerCase() : path;

const withinFilesystemRoot = (root: string, target: string): boolean => {
  const relativePath = relative(
    comparableFilesystemIdentity(root),
    comparableFilesystemIdentity(target),
  );
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== ".." &&
      !isAbsolute(relativePath))
  );
};

const withinPathScope = (scope: string, path: string): boolean =>
  path === scope || path.startsWith(`${scope}/`);

export class VscodeBufferInspectionPort implements BufferInspectionPort {
  public constructor(
    private readonly rootPath: string,
    private readonly filesystemIdentity: FilesystemIdentity =
      defaultFilesystemIdentity,
  ) {}

  public dirtyTargets(paths: readonly string[]): readonly string[] {
    const root = resolve(this.rootPath);
    const rootResolution = this.identityFor(root);
    if (rootResolution.status !== "resolved") {
      throw new TargetBufferIdentityUnavailableError(paths);
    }
    const rootIdentity = rootResolution.identity;

    let inspectAll = paths.length === 0;
    const targetPaths: string[] = [];
    const targetIdentities: string[] = [];
    for (const rawTarget of paths) {
      const target = canonicalRelative(rawTarget);
      if (target === undefined) {
        inspectAll = true;
        continue;
      }
      targetPaths.push(target);
      const targetResolution = this.identityFor(resolve(root, target));
      if (targetResolution.status === "unavailable") {
        throw new TargetBufferIdentityUnavailableError([target]);
      }
      if (targetResolution.status === "resolved") {
        if (!withinFilesystemRoot(rootIdentity, targetResolution.identity)) {
          throw new TargetBufferIdentityUnavailableError([target]);
        }
        targetIdentities.push(targetResolution.identity);
      }
    }

    const dirty = new Set<string>();
    for (const document of vscode.workspace.textDocuments) {
      if (document.isDirty !== true) {
        continue;
      }
      if (
        document.uri.scheme !== undefined &&
        document.uri.scheme !== "file"
      ) {
        continue;
      }

      const documentPath = resolve(document.uri.fsPath);
      const lexicalPath = canonicalRelative(
        relative(root, documentPath).replace(/\\/gu, "/"),
      );
      const documentResolution = this.identityFor(documentPath);
      if (documentResolution.status === "missing") {
        if (
          lexicalPath !== undefined &&
          (inspectAll ||
            targetPaths.some(target => withinPathScope(target, lexicalPath)))
        ) {
          dirty.add(lexicalPath);
        }
        continue;
      }
      if (documentResolution.status === "unavailable") {
        if (!withinFilesystemRoot(root, documentPath)) {
          if (this.isWithinAnotherWorkspaceRoot(root, documentPath)) {
            continue;
          }
          throw new TargetBufferIdentityUnavailableError(paths);
        }
        throw new TargetBufferIdentityUnavailableError(paths);
      }
      const documentIdentity = documentResolution.identity;

      if (!withinFilesystemRoot(rootIdentity, documentIdentity)) {
        continue;
      }
      const normalized = canonicalRelative(
        relative(rootIdentity, documentIdentity).replace(/\\/gu, "/"),
      );
      if (normalized === undefined) {
        continue;
      }
      const withinTarget =
        inspectAll ||
        targetIdentities.some(
          targetIdentity =>
            withinFilesystemRoot(targetIdentity, documentIdentity),
        ) ||
        (lexicalPath !== undefined &&
          targetPaths.some(target => withinPathScope(target, lexicalPath)));
      if (withinTarget) {
        dirty.add(normalized);
      }
    }
    return [...dirty];
  }

  private identityFor(path: string): FilesystemIdentityResolution {
    try {
      const identity = this.filesystemIdentity(path);
      return identity === undefined
        ? { status: "unavailable" }
        : { status: "resolved", identity };
    } catch (error) {
      const code =
        typeof error === "object" && error !== null
          ? (error as { readonly code?: unknown }).code
          : undefined;
      if (code === "ENOENT" || code === "ENOTDIR") {
        return { status: "missing" };
      }
      if (typeof code === "string") {
        return { status: "unavailable" };
      }
      throw error;
    }
  }

  private isWithinAnotherWorkspaceRoot(
    root: string,
    target: string,
  ): boolean {
    return (
      vscode.workspace.workspaceFolders?.some(folder => {
        const folderRoot = resolve(folder.uri.fsPath);
        return (
          comparableFilesystemIdentity(folderRoot) !==
            comparableFilesystemIdentity(root) &&
          withinFilesystemRoot(folderRoot, target)
        );
      }) ?? false
    );
  }
}

export class VscodeConfirmationPort implements ConfirmationPort {
  public async confirm(
    request: ConfirmationRequest,
    signal: AbortSignal,
  ): Promise<boolean> {
    // Honor cancellation before showing the modal. VS Code exposes no API to
    // programmatically dismiss an open message, so we cannot close it once
    // shown; instead we re-check the signal after it resolves so that an abort
    // that arrives while the modal is open can never lead to execution.
    if (signal.aborted) {
      return false;
    }
    const choice = await vscode.window.showWarningMessage(
      request.summary,
      { modal: true, detail: request.detail },
      "Run Verification",
    );
    if (signal.aborted) {
      return false;
    }
    return choice === "Run Verification";
  }
}

export type ReadTextFile = (path: string) => string;

const isFileNotFound = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { readonly code?: unknown }).code === "ENOENT";

const defaultReadText: ReadTextFile = (path) => readFileSync(path, "utf8");

export class NodePackageScriptPort implements PackageScriptPort {
  public constructor(
    private readonly rootPath: string,
    private readonly readText: ReadTextFile = defaultReadText,
  ) {}

  public scripts(): ScriptManifest {
    let raw: string;
    try {
      raw = this.readText(join(this.rootPath, "package.json"));
    } catch (error) {
      // A genuinely absent root manifest is distinct from one that exists but
      // cannot be read; only the former is a "no script here" condition.
      return isFileNotFound(error) ? { status: "absent" } : { status: "unreadable" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: "unreadable" };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { status: "unreadable" };
    }

    const scripts = (parsed as { readonly scripts?: unknown }).scripts;
    if (scripts === undefined) {
      return { status: "ok", scripts: {} };
    }
    if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) {
      return { status: "unreadable" };
    }
    return { status: "ok", scripts: scripts as Record<string, string> };
  }
}

export type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly shell: false;
    readonly detached: boolean;
  },
) => ChildProcessWithoutNullStreams;

const defaultSpawn: SpawnProcess = (command, args, options) =>
  spawn(command, [...args], options);

export interface ProcessRuntime {
  readonly platform: NodeJS.Platform;
  readonly execPath: string;
  readonly path: string | undefined;
  readonly npmExecPath: string | undefined;
  readonly npmNodeExecPath: string | undefined;
  exists(path: string): boolean;
}

const defaultProcessRuntime: ProcessRuntime = {
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

const npmInvocation = (runtime: ProcessRuntime): NpmInvocation | undefined =>
  runtime.platform === "win32"
    ? windowsNpmInvocation(runtime)
    : { command: "npm", argsPrefix: [], detached: true };

type TerminationSignal = "SIGTERM" | "SIGKILL";

export interface ProcessTreePort {
  signal(
    child: ChildProcessWithoutNullStreams,
    signal: TerminationSignal,
  ): boolean;
  isAlive(child: ChildProcessWithoutNullStreams): boolean;
}

const errnoCode = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
};

class SystemProcessTreePort implements ProcessTreePort {
  private readonly terminatedWindowsTrees = new Set<number>();

  public signal(
    child: ChildProcessWithoutNullStreams,
    signal: TerminationSignal,
  ): boolean {
    const pid = child.pid;
    if (pid === undefined) {
      return child.kill(signal);
    }

    if (process.platform === "win32") {
      const result = spawnSync(
        "taskkill",
        [
          "/PID",
          String(pid),
          "/T",
          ...(signal === "SIGKILL" ? ["/F"] : []),
        ],
        { stdio: "ignore", windowsHide: true },
      );
      if (result.status === 0) {
        this.terminatedWindowsTrees.add(pid);
        return true;
      }
      return false;
    }

    try {
      process.kill(-pid, signal);
      return true;
    } catch (error) {
      return errnoCode(error) === "ESRCH" ? false : false;
    }
  }

  public isAlive(child: ChildProcessWithoutNullStreams): boolean {
    const pid = child.pid;
    if (pid === undefined) {
      return true;
    }
    if (process.platform === "win32") {
      return !this.terminatedWindowsTrees.has(pid);
    }

    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      return errnoCode(error) !== "ESRCH";
    }
  }
}

export class NodeProcessRunPort implements ProcessRunPort {
  public constructor(
    private readonly rootPath: string,
    private readonly spawnProcess: SpawnProcess = defaultSpawn,
    private readonly processTree: ProcessTreePort = new SystemProcessTreePort(),
    private readonly runtime: ProcessRuntime = defaultProcessRuntime,
  ) {}

  public run(command: RunCommand, signal: AbortSignal): Promise<RunOutcome> {
    return new Promise<RunOutcome>((resolve) => {
      const invocation = npmInvocation(this.runtime);
      if (invocation === undefined) {
        resolve({
          exitCode: null,
          signal: null,
          output: "",
          outputTruncated: false,
          terminationConfirmed: false,
        });
        return;
      }
      const child = this.spawnProcess(
        invocation.command,
        [...invocation.argsPrefix, "run", command.script],
        {
          cwd: this.rootPath,
          shell: false,
          detached: invocation.detached,
        },
      );

      const chunks: Buffer[] = [];
      let byteLength = 0;
      let outputTruncated = false;
      let settled = false;

      const collect = (data: Buffer): void => {
        const remaining = MAX_OUTPUT_BYTES - byteLength;
        if (remaining <= 0) {
          outputTruncated = true;
          return;
        }
        if (data.byteLength > remaining) {
          chunks.push(data.subarray(0, remaining));
          byteLength += remaining;
          outputTruncated = true;
          return;
        }
        byteLength += data.byteLength;
        chunks.push(data);
      };
      child.stdout?.on("data", collect);
      child.stderr?.on("data", collect);

      const output = (): string =>
        boundedUtf8(Buffer.concat(chunks), MAX_OUTPUT_BYTES);

      const KILL_GRACE_MS = 5_000;
      const KILL_CONFIRM_MS = 250;
      let graceHandle: ReturnType<typeof setTimeout> | undefined;
      let confirmHandle: ReturnType<typeof setTimeout> | undefined;
      let aborting = false;
      let childClosed = false;
      let childCloseSignal: string | null = null;
      let onAbort: () => void = () => undefined;
      const settle = (result: RunOutcome): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (graceHandle !== undefined) {
          clearTimeout(graceHandle);
        }
        if (confirmHandle !== undefined) {
          clearTimeout(confirmHandle);
        }
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      };

      const interruptedOutcome = (
        terminationSignal: string | null,
        terminationConfirmed: boolean,
      ): RunOutcome => ({
        exitCode: null,
        signal: terminationSignal,
        output: output(),
        outputTruncated,
        terminationConfirmed,
      });

      const settleIfTreeStopped = (terminationSignal: string | null): boolean => {
        if (
          (child.pid === undefined && childClosed) ||
          (child.pid !== undefined && !this.processTree.isAlive(child))
        ) {
          settle(interruptedOutcome(terminationSignal, true));
          return true;
        }
        return false;
      };

      onAbort = (): void => {
        aborting = true;
        this.processTree.signal(child, "SIGTERM");
        // If the process ignores SIGTERM, escalate and then report an
        // unconfirmed termination rather than hanging forever.
        graceHandle = setTimeout(() => {
          this.processTree.signal(child, "SIGKILL");
          if (settleIfTreeStopped("SIGKILL")) {
            return;
          }
          confirmHandle = setTimeout(() => {
            settle(
              interruptedOutcome(
                "SIGKILL",
                child.pid !== undefined && !this.processTree.isAlive(child),
              ),
            );
          }, KILL_CONFIRM_MS);
        }, KILL_GRACE_MS);
      };
      signal.addEventListener("abort", onAbort, { once: true });

      child.on("error", () => {
        settle({
          exitCode: null,
          signal: null,
          output: output(),
          outputTruncated,
          terminationConfirmed: false,
        });
      });

      child.on("close", (code, terminationSignal) => {
        childClosed = true;
        childCloseSignal = terminationSignal;
        if (aborting) {
          settleIfTreeStopped(childCloseSignal);
          return;
        }
        settle({
          exitCode: code,
          signal: terminationSignal,
          output: output(),
          outputTruncated,
          terminationConfirmed: true,
        });
      });

      if (signal.aborted) {
        onAbort();
      }
    });
  }
}

const productionScheduler: TimeoutScheduler = {
  set(ms: number, callback: () => void): () => void {
    const handle = setTimeout(callback, ms);
    return () => clearTimeout(handle);
  },
};

/**
 * The default VS Code stable Testing port. VS Code 1.136 stable's public
 * `vscode.tests` namespace exposes provider-side `createTestController` but no
 * consumer-side API to execute another provider's selected test IDs and observe
 * their completion or results. This port therefore reports itself unavailable
 * and never runs anything: the adapter declines a Testing plan with a typed
 * `testing-api-unavailable` reason. The `TestingRunPort` seam is retained so a
 * future capability-gated host can inject a port that provides observed results;
 * until then, package-script verification remains the complete observed path.
 */
export class StableTestingRunPort implements TestingRunPort {
  public available(): boolean {
    return false;
  }

  public run(): Promise<RunOutcome> {
    return Promise.reject(
      new Error(
        "VS Code stable exposes no consumer API to run selected tests and observe results.",
      ),
    );
  }
}

/**
 * Compose the production adapter from real buffer, confirmation, script, and
 * process ports. The VS Code Testing port defaults to {@link StableTestingRunPort}
 * so the factory is host-usable without a fake; a capability-gated host may
 * inject an observing Testing port instead.
 */
export const createVerificationAdapter = (
  rootPath: string,
  testing: TestingRunPort = new StableTestingRunPort(),
  confirmation: ConfirmationPort = new VscodeConfirmationPort(),
  filesystemIdentity: FilesystemIdentity = defaultFilesystemIdentity,
): VerificationAdapter =>
  new VerificationAdapter({
    buffers: new VscodeBufferInspectionPort(rootPath, filesystemIdentity),
    confirmation,
    scripts: new NodePackageScriptPort(rootPath),
    process: new NodeProcessRunPort(rootPath),
    testing,
    scheduler: productionScheduler,
  });
