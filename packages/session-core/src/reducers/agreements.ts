import {
  createGrowthAssistance,
  requireGrowthAgreement,
  requireLearningEntry,
  requireModeChangeWithoutWorkUnit,
  requireWorkUnitEntry,
  validateProposedWorkUnit,
} from "../growth.js";
import { requireBriefingSessionForGrowth, type EventReducer } from "./support.js";

export const learningConfirmed: EventReducer<"LearningConfirmed"> = (snapshot, event) => {
  const session = requireLearningEntry(
    requireBriefingSessionForGrowth(snapshot.session),
  );

  return {
    protocolVersion: 1,
    revision: event.revision,
    presence: snapshot.presence,
    session: {
      ...session,
      learningAgreement: event.agreement,
    },
  };
};

export const modeSelected: EventReducer<"ModeSelected"> = (snapshot, event) => {
  const session = requireModeChangeWithoutWorkUnit(
    requireBriefingSessionForGrowth(snapshot.session),
  );

  if (event.mode === "growth") {
    requireGrowthAgreement(session);
  }

  return {
    protocolVersion: 1,
    revision: event.revision,
    presence: snapshot.presence,
    session: {
      ...session,
      mode: event.mode,
      assistance: event.mode === "growth" ? createGrowthAssistance() : undefined,
    },
  };
};

export const workUnitProposed: EventReducer<"WorkUnitProposed"> = (snapshot, event) => {
  const session = requireWorkUnitEntry(
    requireBriefingSessionForGrowth(snapshot.session),
  );
  validateProposedWorkUnit(session, event.workUnit);

  return {
    protocolVersion: 1,
    revision: event.revision,
    presence: snapshot.presence,
    session: {
      ...session,
      workUnit: event.workUnit,
    },
  };
};

export const workUnitAgreed: EventReducer<"WorkUnitAgreed"> = (snapshot, event) => {
  if (snapshot.session?.status === "reconciling") {
    throw new Error("SESSION_RECONCILING");
  }

  const session = requireWorkUnitEntry(
    requireBriefingSessionForGrowth(snapshot.session),
  );
  const workUnit = session.workUnit;
  if (workUnit === undefined || workUnit.id !== event.workUnitId) {
    throw new Error("WORK_UNIT_NOT_FOUND");
  }

  if (workUnit.status !== "proposed") {
    throw new Error("WORK_UNIT_NOT_PROPOSED");
  }

  if (workUnit.mode !== session.mode) {
    throw new Error("WORK_UNIT_MODE_MISMATCH");
  }

  return {
    protocolVersion: 1,
    revision: event.revision,
    presence: snapshot.presence,
    session: {
      ...session,
      status: "ready",
      workUnit: {
        ...workUnit,
        status: "agreed",
      },
      assistance:
        workUnit.mode === "growth"
          ? createGrowthAssistance()
          : session.assistance,
    },
  };
};
