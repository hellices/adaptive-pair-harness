import { type PairToolName } from "@adaptive-pair/harness";
import type {
  EntrySnapshot,
  HintLevel,
  LearningAgreement,
  OperatingMode,
  PairCommand,
  PairRuntimeSnapshot,
  WorkUnit,
} from "@adaptive-pair/protocol";
import type { Clock, IdSource } from "./ports.js";

type CommandBase = Pick<PairCommand, "protocolVersion" | "commandId" | "expectedRevision" | "actor" | "observedAt"> & { readonly userActionGrantId?: string };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(item => typeof item === "string");

const isHintLevel = (value: unknown): value is HintLevel =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 5;

const isCapability = (value: unknown): value is LearningAgreement["humanOwnedCapabilities"][number] =>
  value === "problem-framing" ||
  value === "design" ||
  value === "test" ||
  value === "implementation" ||
  value === "diagnosis" ||
  value === "repair" ||
  value === "verification";

const isOperatingMode = (value: unknown): value is OperatingMode =>
  value === "growth" || value === "pair" || value === "delivery";

const isEntrySnapshot = (value: unknown): value is EntrySnapshot => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.workspaceId === "string" &&
    (value.branch === undefined || typeof value.branch === "string") &&
    isStringArray(value.dirtyPaths) &&
    isStringArray(value.openPaths) &&
    isStringArray(value.diagnostics) &&
    isStringArray(value.protectedPaths) &&
    typeof value.capturedAt === "number"
  );
};

const isLearningAgreement = (value: unknown): value is LearningAgreement => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isStringArray(value.learningGoals) &&
    isStringArray(value.familiarAreas) &&
    Array.isArray(value.humanOwnedCapabilities) &&
    value.humanOwnedCapabilities.every(isCapability) &&
    isStringArray(value.delegatableWork) &&
    isHintLevel(value.maximumHintLevel) &&
    typeof value.independentCheck === "string"
  );
};

const isWorkUnit = (value: unknown): value is WorkUnit => {
  if (!isRecord(value) || !isRecord(value.baseline)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.objective === "string" &&
    isOperatingMode(value.mode) &&
    (value.learningValue === "high" || value.learningValue === "mixed" || value.learningValue === "low") &&
    isCapability(value.capability) &&
    (value.owner === "human" || value.owner === "ai") &&
    isStringArray(value.allowedPaths) &&
    isStringArray(value.acceptanceChecks) &&
    typeof value.verificationPlan === "string" &&
    typeof value.stoppingCondition === "string" &&
    Object.values(value.baseline).every(entry => typeof entry === "string") &&
    (
      value.status === "proposed" ||
      value.status === "agreed" ||
      value.status === "executing" ||
      value.status === "verifying" ||
      value.status === "completed" ||
      value.status === "paused" ||
      value.status === "needs-reconcile" ||
      value.status === "cancelled" ||
      value.status === "failed"
    )
  );
};

const commandBuilders: Partial<Record<PairToolName, (input: Readonly<Record<string, unknown>>, commandBase: CommandBase) => PairCommand>> = {
  pair_capture_entry: (input, commandBase) => {
    if (!isEntrySnapshot(input.entry)) {
      throw new Error("INVALID_CAPTURE_ENTRY_INPUT");
    }
    return {
      ...commandBase,
      type: "CaptureEntry",
      entry: input.entry,
    };
  },
  pair_confirm_learning: (input, commandBase) => {
    if (!isLearningAgreement(input.agreement)) {
      throw new Error("INVALID_CONFIRM_LEARNING_INPUT");
    }
    return {
      ...commandBase,
      type: "ConfirmLearning",
      agreement: input.agreement,
    };
  },
  pair_select_mode: (input, commandBase) => {
    if (!isOperatingMode(input.mode)) {
      throw new Error("INVALID_SELECT_MODE_INPUT");
    }
    return {
      ...commandBase,
      type: "SelectMode",
      mode: input.mode,
    };
  },
  pair_record_attempt: (input, commandBase) => {
    if (
      typeof input.workUnitId !== "string" ||
      typeof input.summary !== "string" ||
      typeof input.bypassed !== "boolean"
    ) {
      throw new Error("INVALID_RECORD_ATTEMPT_INPUT");
    }
    return {
      ...commandBase,
      type: "RecordAttempt",
      workUnitId: input.workUnitId,
      summary: input.summary,
      bypassed: input.bypassed,
    };
  },
  pair_record_hypothesis: (input, commandBase) => {
    if (
      typeof input.workUnitId !== "string" ||
      typeof input.summary !== "string" ||
      typeof input.bypassed !== "boolean"
    ) {
      throw new Error("INVALID_RECORD_HYPOTHESIS_INPUT");
    }
    return {
      ...commandBase,
      type: "RecordHypothesis",
      workUnitId: input.workUnitId,
      summary: input.summary,
      bypassed: input.bypassed,
    };
  },
  pair_request_hint: (input, commandBase) => {
    if (typeof input.workUnitId !== "string" || !isHintLevel(input.level)) {
      throw new Error("INVALID_REQUEST_HINT_INPUT");
    }
    return {
      ...commandBase,
      type: "RequestHint",
      workUnitId: input.workUnitId,
      level: input.level,
    };
  },
  pair_reveal_solution: (input, commandBase) => {
    if (typeof input.workUnitId !== "string") {
      throw new Error("INVALID_REVEAL_SOLUTION_INPUT");
    }
    return {
      ...commandBase,
      type: "AuthorizeSolutionReveal",
      workUnitId: input.workUnitId,
      previewOnly: true,
    };
  },
  pair_propose_work_unit: (input, commandBase) => {
    if (!isWorkUnit(input.workUnit)) {
      throw new Error("INVALID_PROPOSE_WORK_UNIT_INPUT");
    }
    return {
      ...commandBase,
      type: "ProposeWorkUnit",
      workUnit: input.workUnit,
    };
  },
  pair_agree_work_unit: (input, commandBase) => {
    if (typeof input.workUnitId !== "string") {
      throw new Error("INVALID_AGREE_WORK_UNIT_INPUT");
    }
    return {
      ...commandBase,
      type: "AgreeWorkUnit",
      workUnitId: input.workUnitId,
    };
  },
  pair_close_session: (input, commandBase) => {
    return {
      ...commandBase,
      type: "CloseSession",
    };
  },
};

export const commandForTool = (
    name: PairToolName,
    input: Readonly<Record<string, unknown>>,
    snapshot: PairRuntimeSnapshot,
    userActionGrantId: string | undefined,
  ids: IdSource,
  clock: Clock,
): PairCommand | undefined => {
    const commandBase = {
      protocolVersion: 1 as const,
      commandId: ids.next("command"),
      expectedRevision: snapshot.revision,
      actor: "ai" as const,
      observedAt: clock.now(),
      ...(userActionGrantId === undefined ? {} : { userActionGrantId }),
    };

    return commandBuilders[name]?.(input, commandBase);
  };
