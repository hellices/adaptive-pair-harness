import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import * as vscode from "vscode";
import type { EffectResult } from "@adaptive-pair/runtime";

export const MAX_OUTPUT_BYTES = 128 * 1024;
export const DISPLAY_LIMIT = 16_000;
export const VERIFICATION_TIMEOUT_MS = 120_000;

/**
 * Only an agreed VS Code Testing selection, or an existing root package script
 * named test/check/lint/typecheck/build (with an optional colon suffix) may be
 * run. No raw arbitrary shell is ever accepted.
 */
const ALLOWED_SCRIPT = /^(?:test|check|lint|typecheck|build)(?::[A-Za-z0-9._-]+)?$/u;

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

    const dirty = this.ports.buffers.dirtyTargets(plan.targetPaths);
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
    const partial = interrupted || bounded.truncated;

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

export class VscodeBufferInspectionPort implements BufferInspectionPort {
  public dirtyTargets(paths: readonly string[]): readonly string[] {
    const targets = new Set(paths);
    const dirty: string[] = [];
    for (const document of vscode.workspace.textDocuments) {
      if (document.isDirty !== true) {
        continue;
      }
      const relative = vscode.workspace.asRelativePath(document.uri, false);
      if (targets.size === 0 || targets.has(relative)) {
        dirty.push(relative);
      }
    }
    return dirty;
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
  options: { readonly cwd: string; readonly shell: false },
) => ChildProcessWithoutNullStreams;

const defaultSpawn: SpawnProcess = (command, args, options) =>
  spawn(command, [...args], options);

export class NodeProcessRunPort implements ProcessRunPort {
  public constructor(
    private readonly rootPath: string,
    private readonly spawnProcess: SpawnProcess = defaultSpawn,
  ) {}

  public run(command: RunCommand, signal: AbortSignal): Promise<RunOutcome> {
    return new Promise<RunOutcome>((resolve) => {
      const child = this.spawnProcess("npm", ["run", command.script], {
        cwd: this.rootPath,
        shell: false,
      });

      const chunks: Buffer[] = [];
      let byteLength = 0;
      let settled = false;

      const collect = (data: Buffer): void => {
        if (byteLength >= MAX_OUTPUT_BYTES) {
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
      let graceHandle: ReturnType<typeof setTimeout> | undefined;
      const settle = (result: RunOutcome): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (graceHandle !== undefined) {
          clearTimeout(graceHandle);
        }
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      };

      function onAbort(): void {
        child.kill("SIGTERM");
        // If the process ignores SIGTERM, escalate and then report an
        // unconfirmed termination rather than hanging forever.
        graceHandle = setTimeout(() => {
          child.kill("SIGKILL");
          settle({
            exitCode: null,
            signal: "SIGKILL",
            output: output(),
            terminationConfirmed: false,
          });
        }, KILL_GRACE_MS);
      }
      signal.addEventListener("abort", onAbort, { once: true });

      child.on("error", () => {
        settle({
          exitCode: null,
          signal: null,
          output: output(),
          terminationConfirmed: false,
        });
      });

      child.on("close", (code, terminationSignal) => {
        settle({
          exitCode: code,
          signal: terminationSignal,
          output: output(),
          terminationConfirmed: true,
        });
      });
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
): VerificationAdapter =>
  new VerificationAdapter({
    buffers: new VscodeBufferInspectionPort(),
    confirmation: new VscodeConfirmationPort(),
    scripts: new NodePackageScriptPort(rootPath),
    process: new NodeProcessRunPort(rootPath),
    testing,
    scheduler: productionScheduler,
  });
