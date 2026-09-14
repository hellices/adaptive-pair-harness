import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
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
  readonly timedOut: boolean;
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

export interface PackageScriptPort {
  scripts(): Readonly<Record<string, string>>;
}

export interface ProcessRunPort {
  run(command: RunCommand, signal: AbortSignal): Promise<RunOutcome>;
}

export interface TestingRunPort {
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
  return { text: buffer.subarray(0, maxBytes).toString("utf8"), truncated: true };
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
      if (!Object.prototype.hasOwnProperty.call(this.ports.scripts.scripts(), plan.script)) {
        return failed(
          plan.operationId,
          "declined",
          "The requested script is not defined in the root package.json.",
          { reason: "script-not-defined", script: plan.script },
        );
      }
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

    const interrupted = outcome.timedOut || aborted;
    const timedOut = outcome.timedOut || deadlineFired;

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
  public async confirm(request: ConfirmationRequest): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(
      request.summary,
      { modal: true, detail: request.detail },
      "Run Verification",
    );
    return choice === "Run Verification";
  }
}

export class NodePackageScriptPort implements PackageScriptPort {
  public constructor(private readonly rootPath: string) {}

  public scripts(): Readonly<Record<string, string>> {
    try {
      const raw = readFileSync(join(this.rootPath, "package.json"), "utf8");
      const parsed = JSON.parse(raw) as { readonly scripts?: Record<string, string> };
      return parsed.scripts ?? {};
    } catch {
      return {};
    }
  }
}

export class NodeProcessRunPort implements ProcessRunPort {
  public constructor(private readonly rootPath: string) {}

  public run(command: RunCommand, signal: AbortSignal): Promise<RunOutcome> {
    return new Promise<RunOutcome>((resolve) => {
      const child = spawn("npm", ["run", command.script], {
        cwd: this.rootPath,
        shell: false,
      });

      const chunks: Buffer[] = [];
      let byteLength = 0;
      let timedOut = false;
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
        Buffer.concat(chunks).subarray(0, MAX_OUTPUT_BYTES).toString("utf8");

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
        timedOut = true;
        child.kill("SIGTERM");
        // If the process ignores SIGTERM, escalate and then report an
        // unconfirmed termination rather than hanging forever.
        graceHandle = setTimeout(() => {
          child.kill("SIGKILL");
          settle({
            exitCode: null,
            signal: "SIGKILL",
            output: output(),
            timedOut: true,
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
          timedOut,
          terminationConfirmed: false,
        });
      });

      child.on("close", (code, terminationSignal) => {
        settle({
          exitCode: code,
          signal: terminationSignal,
          output: output(),
          timedOut,
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
 * Compose the production adapter from real buffer, confirmation, script, and
 * process ports. The VS Code Testing port is supplied by the host wiring layer,
 * keeping the Testing surface injectable.
 */
export const createVerificationAdapter = (
  rootPath: string,
  testing: TestingRunPort,
): VerificationAdapter =>
  new VerificationAdapter({
    buffers: new VscodeBufferInspectionPort(),
    confirmation: new VscodeConfirmationPort(),
    scripts: new NodePackageScriptPort(rootPath),
    process: new NodeProcessRunPort(rootPath),
    testing,
    scheduler: productionScheduler,
  });
