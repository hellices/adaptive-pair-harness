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

export class TargetBufferIdentityUnavailableError extends Error {
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
