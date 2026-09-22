import type * as vscode from "vscode";
import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import type { ActivitySnapshot } from "../../src/activityLedger.js";
import type { NativeHistoryInspection } from "../../src/nativeCheckpoint.js";
import type { GrowthSetupStage } from "../../src/growthSetup.js";

export interface NativeHistoryInvocation {
  readonly command: string | undefined;
  readonly resource: string;
  readonly history: NativeHistoryInspection;
  readonly result: vscode.ChatResult | void;
  readonly emitted: readonly string[];
  readonly before: PairRuntimeSnapshot;
  readonly after: PairRuntimeSnapshot;
}

export interface NativeHistoryApi {
  readonly bootId: string;
  snapshot(): PairRuntimeSnapshot;
  activity(): ActivitySnapshot;
  invocations(): readonly NativeHistoryInvocation[];
  metrics(): {
    readonly modelCalls: number;
    readonly tokenCountCalls: number;
    readonly setupConfirmations: readonly { readonly stage: GrowthSetupStage; readonly accepted: boolean }[];
    readonly checkpointConfirmations: number;
    readonly verificationConfirmations: number;
  };
}

export const requiredHistoryEnvironment = (name: string): string => {
  const value = process.env[name];
  if (!value) { throw new Error(`Missing native history fixture environment: ${name}`); }
  return value;
};
