import type { OperatingMode, HintLevel } from "@adaptive-pair/protocol";
import type {
  Demonstration,
  GrowthOutcome,
  NextAssistance,
} from "./growthOutcome.js";

export type OperationOutcomeCategory =
  | "confirmed"
  | "failed"
  | "declined"
  | "cancelled"
  | "unknown";

/**
 * A single session's evaluation record. Only the fields declared here are ever
 * emitted by {@link exportEvaluation}, and every record is validated against
 * this exact shape before serialization; any extra property or out-of-domain
 * value is rejected rather than dropped or coerced.
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

/**
 * Raised when a record fails strict validation. The `reason` is a stable,
 * non-sensitive code and the message names only the offending field; the raw
 * offending value is never included so that smuggled paths, prompts, or other
 * text cannot leak through a validation failure.
 */
export class EvaluationExportError extends Error {
  public constructor(
    public readonly reason: string,
    public readonly field: string,
  ) {
    super(`Evaluation export rejected: ${reason} at ${field}`);
    this.name = "EvaluationExportError";
  }
}

const MINUTE_MS = 60_000;

const roundToMinute = (timestamp: number): number =>
  Math.round(timestamp / MINUTE_MS) * MINUTE_MS;

const MODES: ReadonlySet<OperatingMode> = new Set<OperatingMode>([
  "growth",
  "pair",
  "delivery",
]);
const OPERATION_OUTCOMES: ReadonlySet<OperationOutcomeCategory> =
  new Set<OperationOutcomeCategory>([
    "confirmed",
    "failed",
    "declined",
    "cancelled",
    "unknown",
  ]);
const DEMONSTRATIONS: ReadonlySet<Demonstration> = new Set<Demonstration>([
  "demonstrated",
  "not-demonstrated",
  "not-assessed",
]);
const NEXT_ASSISTANCE: ReadonlySet<NextAssistance> = new Set<NextAssistance>([
  "less",
  "unchanged",
  "more",
  "not-assessed",
]);
const HINT_LEVELS: ReadonlySet<number> = new Set<number>([0, 1, 2, 3, 4, 5]);
const PRODUCT_VERDICTS: ReadonlySet<string> = new Set<string>([
  "verified",
  "unverified",
]);

const RECORD_KEYS: readonly string[] = [
  "protocolVersion",
  "mode",
  "startedAt",
  "completedAt",
  "operationOutcomes",
  "hintLevel",
  "solutionRevealed",
  "growth",
  "pauseCount",
  "conflictCount",
  "unwantedInterventionCount",
];

const GROWTH_KEYS: readonly string[] = [
  "productVerified",
  "similarGeneration",
  "variedDebugging",
  "explanation",
  "meaningfulAuthorship",
  "nextAssistance",
  "product",
  "growth",
];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertExactKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  container: string,
): void => {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      throw new EvaluationExportError("unexpected-property", `${container}.${key}`);
    }
  }
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new EvaluationExportError("missing-property", `${container}.${key}`);
    }
  }
};

const assertCount = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new EvaluationExportError("invalid-count", field);
  }
  return value;
};

const assertTimestamp = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new EvaluationExportError("invalid-timestamp", field);
  }
  return value;
};

const assertBoolean = (value: unknown, field: string): boolean => {
  if (typeof value !== "boolean") {
    throw new EvaluationExportError("invalid-boolean", field);
  }
  return value;
};

const assertDemonstration = (value: unknown, field: string): Demonstration => {
  if (typeof value !== "string" || !DEMONSTRATIONS.has(value as Demonstration)) {
    throw new EvaluationExportError("invalid-demonstration", field);
  }
  return value as Demonstration;
};

const validateGrowth = (
  value: unknown,
  field: string,
): Record<string, unknown> => {
  if (!isPlainObject(value)) {
    throw new EvaluationExportError("invalid-growth", field);
  }
  assertExactKeys(value, GROWTH_KEYS, field);

  const nextAssistance = value["nextAssistance"];
  if (
    typeof nextAssistance !== "string" ||
    !NEXT_ASSISTANCE.has(nextAssistance as NextAssistance)
  ) {
    throw new EvaluationExportError(
      "invalid-next-assistance",
      `${field}.nextAssistance`,
    );
  }
  const product = value["product"];
  if (typeof product !== "string" || !PRODUCT_VERDICTS.has(product)) {
    throw new EvaluationExportError("invalid-verdict", `${field}.product`);
  }
  const growthVerdict = value["growth"];
  if (typeof growthVerdict !== "string" || !PRODUCT_VERDICTS.has(growthVerdict)) {
    throw new EvaluationExportError("invalid-verdict", `${field}.growth`);
  }

  return {
    productVerified: assertBoolean(
      value["productVerified"],
      `${field}.productVerified`,
    ),
    similarGeneration: assertDemonstration(
      value["similarGeneration"],
      `${field}.similarGeneration`,
    ),
    variedDebugging: assertDemonstration(
      value["variedDebugging"],
      `${field}.variedDebugging`,
    ),
    explanation: assertDemonstration(
      value["explanation"],
      `${field}.explanation`,
    ),
    meaningfulAuthorship: assertDemonstration(
      value["meaningfulAuthorship"],
      `${field}.meaningfulAuthorship`,
    ),
    nextAssistance,
    product,
    growth: growthVerdict,
  };
};

const validateRecord = (
  value: unknown,
  field: string,
): Record<string, unknown> => {
  if (!isPlainObject(value)) {
    throw new EvaluationExportError("invalid-record", field);
  }
  assertExactKeys(value, RECORD_KEYS, field);

  if (value["protocolVersion"] !== 1) {
    throw new EvaluationExportError(
      "invalid-protocol-version",
      `${field}.protocolVersion`,
    );
  }
  const mode = value["mode"];
  if (typeof mode !== "string" || !MODES.has(mode as OperatingMode)) {
    throw new EvaluationExportError("invalid-mode", `${field}.mode`);
  }
  const hintLevel = value["hintLevel"];
  if (typeof hintLevel !== "number" || !HINT_LEVELS.has(hintLevel)) {
    throw new EvaluationExportError("invalid-hint-level", `${field}.hintLevel`);
  }
  const outcomes = value["operationOutcomes"];
  if (!Array.isArray(outcomes)) {
    throw new EvaluationExportError(
      "invalid-operation-outcomes",
      `${field}.operationOutcomes`,
    );
  }
  const operationOutcomes = outcomes.map((outcome, index) => {
    if (
      typeof outcome !== "string" ||
      !OPERATION_OUTCOMES.has(outcome as OperationOutcomeCategory)
    ) {
      throw new EvaluationExportError(
        "invalid-operation-outcome",
        `${field}.operationOutcomes[${index}]`,
      );
    }
    return outcome;
  });

  return {
    protocolVersion: 1,
    mode,
    startedAt: roundToMinute(
      assertTimestamp(value["startedAt"], `${field}.startedAt`),
    ),
    completedAt: roundToMinute(
      assertTimestamp(value["completedAt"], `${field}.completedAt`),
    ),
    operationOutcomes,
    hintLevel,
    solutionRevealed: assertBoolean(
      value["solutionRevealed"],
      `${field}.solutionRevealed`,
    ),
    growth: validateGrowth(value["growth"], `${field}.growth`),
    pauseCount: assertCount(value["pauseCount"], `${field}.pauseCount`),
    conflictCount: assertCount(value["conflictCount"], `${field}.conflictCount`),
    unwantedInterventionCount: assertCount(
      value["unwantedInterventionCount"],
      `${field}.unwantedInterventionCount`,
    ),
  };
};

/**
 * Serialize evaluation records to a privacy-reviewed JSON string.
 *
 * Every record is strictly validated first: the exporter rejects records that
 * carry unexpected properties, out-of-domain categories, non-finite / unsafe /
 * negative counts or timestamps, or malformed operation outcomes. Validation
 * failures raise a typed {@link EvaluationExportError} whose message names only
 * the offending field, never its value. Only the protocol version, mode,
 * minute-rounded timestamps, categorical operation outcomes, hint level, reveal
 * flag, the eight Growth outcome fields, and the pause / conflict / unwanted-
 * intervention counts are emitted, so workspace IDs, paths, source, prompts,
 * model output, diagnostics, branch names, and profile text can never leak.
 */
export const exportEvaluation = (
  records: readonly EvaluationRecord[],
): string => {
  if (!Array.isArray(records)) {
    throw new EvaluationExportError("invalid-records", "records");
  }
  return JSON.stringify(
    {
      schema: "adaptive-pair/evaluation-export",
      version: 1,
      records: records.map((record, index) =>
        validateRecord(record, `records[${index}]`),
      ),
    },
    null,
    2,
  );
};
