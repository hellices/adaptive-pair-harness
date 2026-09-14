import type {
  AssistanceState,
  HintLevel,
  PairSessionSnapshot,
  WorkUnit,
} from "@adaptive-pair/protocol";

const createAssistance = (): AssistanceState => ({
  attempt: undefined,
  hypothesis: undefined,
  hint: undefined,
  solutionReveal: undefined,
});

const isGrowthMode = (session: PairSessionSnapshot): boolean =>
  session.mode === "growth";

const validateGrowthWorkUnit = (workUnit: WorkUnit): void => {
  if (workUnit.mode !== "growth") {
    return;
  }

  if (workUnit.owner !== "human") {
    throw new Error("GROWTH_REQUIRES_HUMAN_OWNER");
  }

  if (workUnit.learningValue === "low") {
    throw new Error("GROWTH_REQUIRES_LEARNING_VALUE");
  }

  if (workUnit.acceptanceChecks.length === 0) {
    throw new Error("GROWTH_REQUIRES_CHECK");
  }
};

export const createGrowthAssistance = (): AssistanceState => createAssistance();

export const requireLearningEntry = (
  session: PairSessionSnapshot,
): PairSessionSnapshot => {
  if (session.entrySnapshot === undefined) {
    throw new Error("LEARNING_REQUIRES_ENTRY");
  }

  return session;
};

export const requireGrowthAgreement = (
  session: PairSessionSnapshot,
): PairSessionSnapshot => {
  if (session.learningAgreement === undefined) {
    throw new Error("MODE_REQUIRES_LEARNING_AGREEMENT");
  }

  return session;
};

export const requireModeChangeWithoutWorkUnit = (
  session: PairSessionSnapshot,
): PairSessionSnapshot => {
  if (session.workUnit !== undefined) {
    throw new Error("MODE_CHANGE_REQUIRES_NEW_WORK_UNIT");
  }

  return session;
};

export const validateProposedWorkUnit = (
  session: PairSessionSnapshot,
  workUnit: WorkUnit,
): void => {
  if (session.mode === undefined) {
    throw new Error("WORK_UNIT_REQUIRES_MODE");
  }

  if (workUnit.mode !== session.mode) {
    throw new Error("WORK_UNIT_MODE_MISMATCH");
  }

  if (workUnit.status !== "proposed") {
    throw new Error("WORK_UNIT_NOT_PROPOSED");
  }

  validateGrowthWorkUnit(workUnit);
};

export const requireAgreedWorkUnit = (
  session: PairSessionSnapshot,
  workUnitId: string,
): WorkUnit => {
  if (session.workUnit === undefined || session.workUnit.id !== workUnitId) {
    throw new Error("WORK_UNIT_NOT_FOUND");
  }

  if (session.workUnit.status !== "agreed") {
    throw new Error("WORK_UNIT_NOT_AGREED");
  }

  return session.workUnit;
};

export const requireGrowthWorkUnit = (
  session: PairSessionSnapshot,
  workUnitId: string,
): WorkUnit => {
  const workUnit = requireAgreedWorkUnit(session, workUnitId);

  if (!isGrowthMode(session) || workUnit.mode !== "growth") {
    throw new Error("GROWTH_MODE_REQUIRED");
  }

  return workUnit;
};

export const validateHintLevel = (
  session: PairSessionSnapshot,
  workUnitId: string,
  level: HintLevel,
): void => {
  requireGrowthWorkUnit(session, workUnitId);

  const agreement = requireGrowthAgreement(session).learningAgreement!;
  if (level > agreement.maximumHintLevel) {
    throw new Error("HINT_EXCEEDS_AGREEMENT");
  }

  const attempt = session.assistance?.attempt;
  if (level > 1 && attempt === undefined) {
    throw new Error("HINT_REQUIRES_ATTEMPT");
  }

  if (level === 5 && session.assistance?.solutionReveal === undefined) {
    throw new Error("HINT_REQUIRES_REVEAL");
  }
};

export const validateSolutionReveal = (
  session: PairSessionSnapshot,
  workUnitId: string,
  previewOnly: boolean,
): void => {
  requireGrowthWorkUnit(session, workUnitId);

  if (previewOnly !== true) {
    throw new Error("SOLUTION_REVEAL_PREVIEW_ONLY");
  }
};
