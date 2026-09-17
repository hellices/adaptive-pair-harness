import type {
  CompiledInstructionEnvelope,
  PairToolView,
} from "@adaptive-pair/harness";
import type { OperatingMode } from "@adaptive-pair/protocol";
import type { GrowthResponse } from "@adaptive-pair/restraint";
import {
  isGrowthBoundaryFailureCode,
  isGrowthModelFailureCode,
  type GrowthModelFailureCode,
} from "./growthFailureCodes.js";
export type { GrowthModelFailureCode } from "./growthFailureCodes.js";

export class GrowthModelFailure extends Error {
  public constructor(
    public readonly code: GrowthModelFailureCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "GrowthModelFailure";
  }
}

export interface GrowthModel {
  request(
    instructions: CompiledInstructionEnvelope,
    tools: PairToolView,
    signal: AbortSignal,
  ): Promise<GrowthModelOutput>;
}

export interface GrowthRuntimeBoundary {
  readonly runtimeRevision: number;
  readonly authorityEpoch: number | undefined;
  readonly mode: OperatingMode | undefined;
}

export interface GrowthModelResult {
  readonly response: GrowthResponse;
  readonly runtime: GrowthRuntimeBoundary;
}

export type GrowthModelOutput = GrowthResponse | GrowthModelResult;

export const isGrowthModelResult = (
  output: GrowthModelOutput,
): output is GrowthModelResult => "response" in output;

export const growthFailureReason = (error: unknown): string => {
  try {
    if (error instanceof GrowthModelFailure) {
      const code = error.code;
      return isGrowthModelFailureCode(code) ? code : "GROWTH_UNKNOWN_ERROR";
    }
    if (error instanceof Error) {
      const message = error.message;
      if (isGrowthBoundaryFailureCode(message)) return message;
    }
  } catch {
    return "GROWTH_UNKNOWN_ERROR";
  }
  return "GROWTH_UNKNOWN_ERROR";
};
