import type * as vscode from "vscode";
import type { HintLevel, PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import type { GrowthModel, PairCoordinatorPort, PairToolResult } from "@adaptive-pair/runtime";
import type { GrowthResponse } from "@adaptive-pair/restraint";

export type GrowthEvaluationOutcome =
  | "delivered"
  | "withheld"
  | "restraint-failure"
  | "transfer-started";

/**
 * A bounded, non-raw record of one Growth turn. It carries only the response
 * class, hint level, and a stable reason code; no prompt, repository, or model
 * text is ever retained here.
 */
export interface GrowthEvaluationRecord {
  readonly outcome: GrowthEvaluationOutcome;
  readonly level: HintLevel | undefined;
  readonly kind: GrowthResponse["kind"] | undefined;
  readonly reason: string | undefined;
  readonly recordedAt: number;
}

/**
 * The state of the independent transfer task for the current work unit. A
 * started transfer is never a demonstrated one: `demonstrated` stays `false`
 * until an independent completion is separately observed and recorded.
 */
export interface GrowthTransferState {
  readonly status: "started";
  readonly sessionId: string;
  readonly workUnitId: string;
  readonly independentCheck: string;
  readonly demonstrated: false;
  readonly startedAt: number;
}

/** The last observed product check, recorded only from a real run result. */
export interface GrowthCheckState {
  readonly sessionId: string;
  readonly workUnitId: string;
  readonly script: string;
  readonly status: PairToolResult["status"];
  readonly passed: boolean | undefined;
  readonly observedAt: number;
}

export interface GrowthEvaluationInput {
  readonly outcome: GrowthEvaluationOutcome;
  readonly level?: HintLevel;
  readonly kind?: GrowthResponse["kind"];
  readonly reason?: string;
}

export class GrowthEvaluationLog {
  private readonly entries: GrowthEvaluationRecord[] = [];

  public constructor(private readonly now: () => number = () => Date.now()) {}

  public record(input: GrowthEvaluationInput): void {
    this.entries.push(
      Object.freeze({
        outcome: input.outcome,
        level: input.level,
        kind: input.kind,
        reason: input.reason,
        recordedAt: this.now(),
      }),
    );
  }

  public get records(): readonly GrowthEvaluationRecord[] {
    return Object.freeze([...this.entries]);
  }
}

export const modelConsentKey = (model: vscode.LanguageModelChat): string =>
  `${model.vendor}::${model.family}::${model.id}::${model.version}`;

export class ModelConsentRegistry {
  private readonly granted = new Set<string>();

  public has(model: vscode.LanguageModelChat): boolean {
    return this.granted.has(modelConsentKey(model));
  }

  public grant(model: vscode.LanguageModelChat): void {
    this.granted.add(modelConsentKey(model));
  }

  public revoke(model: vscode.LanguageModelChat): void {
    this.granted.delete(modelConsentKey(model));
  }
}

export type GrowthConsentResult =
  | { readonly status: "granted"; readonly taskContext: string | undefined }
  | { readonly status: "declined" };

export interface GrowthParticipantDependencies {
  readonly coordinator: PairCoordinatorPort;
  readonly snapshotNow: () => PairRuntimeSnapshot;
  readonly consent: ModelConsentRegistry;
  readonly evaluations: GrowthEvaluationLog;
  readonly createModel?: (model: vscode.LanguageModelChat) => GrowthModel;
  readonly requestWorkspaceConsent: (
    model: vscode.LanguageModelChat,
  ) => Promise<boolean>;
  readonly confirmSolutionReveal: (
    model: vscode.LanguageModelChat,
  ) => Promise<boolean>;
  readonly stayQuiet?: () => Promise<unknown>;
  readonly now?: () => number;
}

export interface GrowthTransientState {
  transfer: GrowthTransferState | undefined;
  lastCheck: GrowthCheckState | undefined;
}
