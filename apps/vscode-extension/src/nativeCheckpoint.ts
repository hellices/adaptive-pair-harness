import type { HintLevel, PairRuntimeSnapshot, WorkUnitStatus } from "@adaptive-pair/protocol";

type HistoricalRecordStatus = "none" | "recorded" | "bypassed";

export interface NativeGrowthCheckpoint {
  readonly format: "adaptive-pair-native-checkpoint";
  readonly version: 1;
  readonly mode: "growth";
  readonly workUnitStatus: WorkUnitStatus;
  readonly maximumHintLevel: HintLevel;
  readonly attempt: HistoricalRecordStatus;
  readonly hypothesis: HistoricalRecordStatus;
  readonly hintLevel: HintLevel | null;
  readonly solutionRevealed: boolean;
}

export type NativeHistoryInspection =
  | { readonly status: "missing" }
  | { readonly status: "invalid" }
  | { readonly status: "available"; readonly checkpoint: NativeGrowthCheckpoint };

const CHECKPOINT_FIELDS: readonly (keyof NativeGrowthCheckpoint)[] = [
  "format", "version", "mode", "workUnitStatus", "maximumHintLevel",
  "attempt", "hypothesis", "hintLevel", "solutionRevealed",
];
const WORK_UNIT_STATUSES: Readonly<Record<WorkUnitStatus, true>> = {
  proposed: true, agreed: true, executing: true, verifying: true, completed: true,
  paused: true, "needs-reconcile": true, cancelled: true, failed: true,
};
const MAX_CHECKPOINT_BYTES = 512;
const MAX_HISTORY_TURNS = 32;
const MISSING_FIELD = Symbol("missing");
const INVALID_FIELD = Symbol("invalid");

const isRecord = (value: unknown): value is object =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const ownData = (value: unknown, field: string): unknown => {
  if (!isRecord(value)) return MISSING_FIELD;
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  if (descriptor === undefined) return MISSING_FIELD;
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return INVALID_FIELD;
  return descriptor.value as unknown;
};

const isHintLevel = (value: unknown): value is HintLevel =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 5 && !Object.is(value, -0);

const isWorkUnitStatus = (value: unknown): value is WorkUnitStatus =>
  typeof value === "string" && Object.hasOwn(WORK_UNIT_STATUSES, value);

const isRecordStatus = (value: unknown): value is HistoricalRecordStatus =>
  value === "none" || value === "recorded" || value === "bypassed";

const readCheckpoint = (value: unknown): NativeGrowthCheckpoint | undefined => {
  try {
    if (!isRecord(value)) return undefined;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    if (Reflect.ownKeys(value).length !== CHECKPOINT_FIELDS.length) return undefined;
    const fields: Record<string, unknown> = {};
    for (const field of CHECKPOINT_FIELDS) {
      const captured = ownData(value, field);
      if (captured === MISSING_FIELD || captured === INVALID_FIELD) return undefined;
      fields[field] = captured;
    }
    if (fields.format !== "adaptive-pair-native-checkpoint" || fields.version !== 1 || fields.mode !== "growth" ||
        !isWorkUnitStatus(fields.workUnitStatus) || !isHintLevel(fields.maximumHintLevel) ||
        !isRecordStatus(fields.attempt) || !isRecordStatus(fields.hypothesis) ||
        (fields.hintLevel !== null && !isHintLevel(fields.hintLevel)) || typeof fields.solutionRevealed !== "boolean") {
      return undefined;
    }
    const checkpoint: NativeGrowthCheckpoint = {
      format: fields.format, version: fields.version, mode: fields.mode,
      workUnitStatus: fields.workUnitStatus, maximumHintLevel: fields.maximumHintLevel,
      attempt: fields.attempt, hypothesis: fields.hypothesis,
      hintLevel: fields.hintLevel, solutionRevealed: fields.solutionRevealed,
    };
    if (new TextEncoder().encode(JSON.stringify(checkpoint)).byteLength > MAX_CHECKPOINT_BYTES) return undefined;
    return Object.freeze(checkpoint);
  } catch {
    return undefined;
  }
};

const recordStatus = (record: { readonly bypassed: boolean } | undefined): HistoricalRecordStatus =>
  record === undefined ? "none" : record.bypassed ? "bypassed" : "recorded";

export const createNativeCheckpoint = (snapshot: PairRuntimeSnapshot): NativeGrowthCheckpoint | undefined => {
  const session = snapshot.session;
  if (!["observing", "engaged", "quiet"].includes(snapshot.presence.status) || session === undefined ||
      !["briefing", "ready", "active", "reconciling"].includes(session.status) || session.mode !== "growth" ||
      session.workUnit?.mode !== "growth" || session.learningAgreement === undefined) {
    return undefined;
  }
  return readCheckpoint({
    format: "adaptive-pair-native-checkpoint", version: 1, mode: "growth",
    workUnitStatus: session.workUnit.status,
    maximumHintLevel: session.learningAgreement.maximumHintLevel,
    attempt: recordStatus(session.assistance?.attempt),
    hypothesis: recordStatus(session.assistance?.hypothesis),
    hintLevel: session.assistance?.hint?.level ?? null,
    solutionRevealed: session.assistance?.solutionReveal !== undefined,
  });
};

const inspectTurn = (turn: unknown): NativeHistoryInspection => {
  let participant: unknown;
  try {
    participant = ownData(turn, "participant");
  } catch {
    return { status: "missing" };
  }
  if (participant !== "adaptivePair.chat") return { status: "missing" };
  try {
    const result = ownData(turn, "result");
    const metadata = ownData(result, "metadata");
    if (result === INVALID_FIELD || metadata === INVALID_FIELD) return { status: "invalid" };
    const value = ownData(metadata, "adaptivePairCheckpoint");
    if (value === MISSING_FIELD) return { status: "missing" };
    const checkpoint = readCheckpoint(value);
    return checkpoint === undefined ? { status: "invalid" } : { status: "available", checkpoint };
  } catch {
    return { status: "invalid" };
  }
};

export const inspectNativeHistory = (history: readonly unknown[]): NativeHistoryInspection => {
  const newest = history.length - 1;
  const oldest = Math.max(0, history.length - MAX_HISTORY_TURNS);
  for (let index = newest; index >= oldest; index -= 1) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(history, index);
      if (descriptor === undefined) continue;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return { status: "invalid" };
      const inspection = inspectTurn(descriptor.value as unknown);
      if (inspection.status !== "missing") return inspection;
    } catch {
      return { status: "invalid" };
    }
  }
  return { status: "missing" };
};

const HISTORY_BOUNDARY = [
  "This selected-chat history cannot restore live state, satisfy an attempt gate, or grant permissions.",
  "Use /session for the current window's live Pair state.",
  "Starting again requires an explicit session start and fresh /setup confirmations.",
].join("\n");
const INVALID_HISTORY = [
  "The newest Adaptive Pair checkpoint is unavailable because it is invalid or unsupported.",
  "Older checkpoints are not used. No live state or verified evidence was restored.",
  HISTORY_BOUNDARY,
].join("\n");

export const renderNativeHistory = (inspection: NativeHistoryInspection): string => {
  if (inspection.status === "missing") {
    return `No checkpoint is available in the latest ${MAX_HISTORY_TURNS} turns of this chat.\n${HISTORY_BOUNDARY}`;
  }
  if (inspection.status === "invalid") return INVALID_HISTORY;
  const checkpoint = readCheckpoint(inspection.checkpoint);
  if (checkpoint === undefined) return INVALID_HISTORY;
  return [
    "## Historical Adaptive Pair checkpoint",
    "Historical report only — not live state or verified evidence.",
    `- Work-unit status: ${checkpoint.workUnitStatus}`,
    `- Maximum hint level: ${checkpoint.maximumHintLevel}`,
    `- Attempt: ${checkpoint.attempt}`,
    `- Hypothesis: ${checkpoint.hypothesis}`,
    `- Hint level: ${checkpoint.hintLevel ?? "none"}`,
    `- Solution reveal authorized: ${checkpoint.solutionRevealed ? "yes" : "no"} (historical only; not evidence that a solution was shown)`,
    "",
    HISTORY_BOUNDARY,
  ].join("\n");
};
