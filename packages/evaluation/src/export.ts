import type { OperatingMode, HintLevel } from "@adaptive-pair/protocol";
import type { GrowthOutcome } from "./growthOutcome.js";

export type OperationOutcomeCategory =
  | "confirmed"
  | "failed"
  | "declined"
  | "cancelled"
  | "unknown";

/**
 * A single session's evaluation record. Only the fields declared here are ever
 * emitted by {@link exportEvaluation}; the exporter reads nothing else, so any
 * extra properties present on an object at runtime are dropped.
 */
export interface EvaluationRecord {
  readonly protocolVersion: 1;
  readonly mode: OperatingMode;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly operationOutcomes: readonly OperationOutcomeCategory[];
  readonly hintLevel: HintLevel;
  readonly solutionRevealed: boolean;
  readonly growth: GrowthOutcome;
  readonly pauseCount: number;
  readonly conflictCount: number;
  readonly unwantedInterventionCount: number;
}

const MINUTE_MS = 60_000;

const roundToMinute = (timestamp: number): number =>
  Math.round(timestamp / MINUTE_MS) * MINUTE_MS;

const projectGrowth = (growth: GrowthOutcome): Record<string, unknown> => ({
  productVerified: growth.productVerified,
  similarGeneration: growth.similarGeneration,
  variedDebugging: growth.variedDebugging,
  explanation: growth.explanation,
  meaningfulAuthorship: growth.meaningfulAuthorship,
  nextAssistance: growth.nextAssistance,
  product: growth.product,
  growth: growth.growth,
});

const projectRecord = (record: EvaluationRecord): Record<string, unknown> => ({
  protocolVersion: record.protocolVersion,
  mode: record.mode,
  startedAt: roundToMinute(record.startedAt),
  completedAt: roundToMinute(record.completedAt),
  operationOutcomes: [...record.operationOutcomes],
  hintLevel: record.hintLevel,
  solutionRevealed: record.solutionRevealed,
  growth: projectGrowth(record.growth),
  pauseCount: record.pauseCount,
  conflictCount: record.conflictCount,
  unwantedInterventionCount: record.unwantedInterventionCount,
});

/**
 * Serialize evaluation records to a privacy-reviewed JSON string.
 *
 * The export is a narrow allowlist: it emits only the protocol version, mode,
 * timestamps rounded to one minute, categorical operation outcomes, hint level,
 * reveal flag, the five Growth outcomes, and pause/conflict/unwanted-
 * intervention counts. Workspace IDs, paths, source, prompts, model output,
 * diagnostics, branch names, and profile text are never read and therefore
 * cannot leak, even if they are present on an input object.
 */
export const exportEvaluation = (
  records: readonly EvaluationRecord[],
): string =>
  JSON.stringify(
    {
      schema: "adaptive-pair/evaluation-export",
      version: 1,
      records: records.map(projectRecord),
    },
    null,
    2,
  );
