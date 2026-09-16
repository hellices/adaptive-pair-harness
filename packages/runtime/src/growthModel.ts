import type {
  CompiledInstructionEnvelope,
  PairToolView,
} from "@adaptive-pair/harness";
import type { OperatingMode } from "@adaptive-pair/protocol";
import type { GrowthResponse } from "@adaptive-pair/restraint";

export type GrowthModelFailureCode =
  | "GROWTH_MODEL_CALL_CAP"
  | "GROWTH_INPUT_TOKEN_CAP"
  | "GROWTH_OUTPUT_TOKEN_CAP"
  | "GROWTH_TIME_CAP"
  | "GROWTH_NON_JSON_RESPONSE"
  | "GROWTH_INVALID_ENVELOPE"
  | "GROWTH_EMPTY_RESPONSE"
  | "GROWTH_MODEL_ERROR"
  | "GROWTH_TOOL_TRANSLATION_FAILED"
  | "GROWTH_DIRECT_USER_ACTION_REQUIRED"
  | "GROWTH_STALE_TURN"
  | "GROWTH_CANCELLED";

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
  if (error instanceof GrowthModelFailure) {
    return error.code;
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "GROWTH_UNKNOWN_ERROR";
};
