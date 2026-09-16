import type { EffectResult } from "@adaptive-pair/runtime";
import { ALLOWED_VERIFICATION_SCRIPT } from "./verificationPlan.js";
import { TargetBufferIdentityUnavailableError } from "./verificationContracts.js";
import type {
  ConfirmationPort,
  FilesystemIdentity,
  RunOutcome,
  TestingRunPort,
  TimeoutScheduler,
  VerificationAdapterPorts,
  VerificationPlan,
} from "./verificationContracts.js";
import { defaultFilesystemIdentity, VscodeBufferInspectionPort } from "./verificationBuffers.js";
import { StableTestingRunPort, VscodeConfirmationPort } from "./verificationNativePorts.js";
import { interpretVerificationOutcome } from "./verificationOutput.js";
import { NodePackageScriptPort } from "./verificationPackageScripts.js";
import { NodeProcessRunPort } from "./verificationProcess.js";

export type {
  BufferInspectionPort,
  ConfirmationPort,
  ConfirmationRequest,
  FilesystemIdentity,
  PackageScriptPort,
  ProcessRunPort,
  RunCommand,
  RunOutcome,
  ScriptManifest,
  TestingRunPort,
  TestingRunRequest,
  TimeoutScheduler,
  VerificationAdapterPorts,
  VerificationPlan,
} from "./verificationContracts.js";
export { MAX_OUTPUT_BYTES, DISPLAY_LIMIT } from "./verificationOutput.js";
export type { ReadTextFile } from "./verificationPackageScripts.js";
export type { SpawnProcess } from "./verificationProcess.js";
export type { ProcessRuntime } from "./verificationProcessInvocation.js";
export type { ProcessTreePort } from "./verificationProcessTree.js";
export {
  NodePackageScriptPort,
  NodeProcessRunPort,
  StableTestingRunPort,
  VscodeBufferInspectionPort,
  VscodeConfirmationPort,
};

export const VERIFICATION_TIMEOUT_MS = 120_000;

/**
 * Only an agreed VS Code Testing selection, or an existing root package script
 * named test/check/lint/typecheck/build (with an optional colon suffix) may be
 * run. No raw arbitrary shell is ever accepted. The allowlist is shared with
 * the participant's `/check` route so both gates cannot drift apart.
 */
const ALLOWED_SCRIPT = ALLOWED_VERIFICATION_SCRIPT;

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

    return interpretVerificationOutcome(plan.operationId, outcome, controller.signal.aborted, deadlineFired);
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
