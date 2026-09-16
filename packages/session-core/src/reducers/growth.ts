import { requireGrowthWorkUnit, validateHintLevel, validateSolutionReveal } from "../growth.js";
import { requireWorkSession, withAssistance, type EventReducer } from "./support.js";

export const attemptRecorded: EventReducer<"AttemptRecorded"> = (snapshot, event) => {
  const session = requireWorkSession(snapshot.session);
  requireGrowthWorkUnit(session, event.workUnitId);

  return {
    protocolVersion: 1,
    revision: event.revision,
    presence: snapshot.presence,
    session: {
      ...session,
      status: "active",
      assistance: withAssistance(session, assistance => ({
        ...assistance,
        attempt: {
          summary: event.summary,
          bypassed: event.bypassed,
          recordedAt: event.recordedAt,
        },
      })),
    },
  };
};

export const hypothesisRecorded: EventReducer<"HypothesisRecorded"> = (snapshot, event) => {
  const session = requireWorkSession(snapshot.session);
  requireGrowthWorkUnit(session, event.workUnitId);

  return {
    protocolVersion: 1,
    revision: event.revision,
    presence: snapshot.presence,
    session: {
      ...session,
      status: "active",
      assistance: withAssistance(session, assistance => ({
        ...assistance,
        hypothesis: {
          summary: event.summary,
          bypassed: event.bypassed,
          recordedAt: event.recordedAt,
        },
      })),
    },
  };
};

export const hintRequested: EventReducer<"HintRequested"> = (snapshot, event) => {
  const session = requireWorkSession(snapshot.session);
  validateHintLevel(session, event.workUnitId, event.level);
  const level = Math.max(
    session.assistance?.hint?.level ?? 0,
    event.level,
  ) as typeof event.level;

  return {
    protocolVersion: 1,
    revision: event.revision,
    presence: snapshot.presence,
    session: {
      ...session,
      status: "active",
      assistance: withAssistance(session, assistance => ({
        ...assistance,
        hint: {
          level,
          recordedAt: event.recordedAt,
        },
      })),
    },
  };
};

export const solutionRevealAuthorized: EventReducer<"SolutionRevealAuthorized"> = (snapshot, event) => {
  const session = requireWorkSession(snapshot.session);
  validateSolutionReveal(session, event.workUnitId, event.previewOnly);

  return {
    protocolVersion: 1,
    revision: event.revision,
    presence: snapshot.presence,
    session: {
      ...session,
      status: "active",
      assistance: withAssistance(session, assistance => ({
        ...assistance,
        solutionReveal: {
          previewOnly: true,
          recordedAt: event.recordedAt,
        },
      })),
    },
  };
};
