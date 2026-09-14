import type {
  AssistanceState,
  PairEvent,
  PairRuntimeSnapshot,
  PairSessionSnapshot,
  SessionStatus,
  WorkUnit,
  WorkUnitStatus,
} from "@adaptive-pair/protocol";
import { normalizeEntrySnapshot } from "./entrySnapshot.js";
import {
  createGrowthAssistance,
  requireGrowthAgreement,
  requireGrowthWorkUnit,
  requireLearningEntry,
  requireModeChangeWithoutWorkUnit,
  requireWorkUnitEntry,
  validateHintLevel,
  validateProposedWorkUnit,
  validateSolutionReveal,
} from "./growth.js";
import { createSession } from "./initialState.js";
import { cloneFrozen } from "./immutable.js";

const isPausableStatus = (status: SessionStatus): boolean =>
  status === "ready" || status === "active" || status === "reconciling";

const requirePausableSession = (
  session: PairSessionSnapshot | undefined,
): PairSessionSnapshot => {
  if (session === undefined || !isPausableStatus(session.status)) {
    throw new Error("SESSION_NOT_PAUSABLE");
  }

  return session;
};

const requireBriefingSession = (
  session: PairSessionSnapshot | undefined,
): PairSessionSnapshot => {
  if (session === undefined || session.status !== "briefing") {
    throw new Error("SESSION_NOT_BRIEFING");
  }

  return session;
};

const requirePausedSession = (
  session: PairSessionSnapshot | undefined,
): PairSessionSnapshot => {
  if (session === undefined || session.status !== "paused") {
    throw new Error("SESSION_NOT_PAUSED");
  }

  return session;
};

const requireClosableSession = (
  session: PairSessionSnapshot | undefined,
): PairSessionSnapshot => {
  if (session === undefined) {
    throw new Error("SESSION_NOT_STARTED");
  }

  if (session.status === "closed") {
    throw new Error("SESSION_ALREADY_CLOSED");
  }

  return session;
};

const isTerminalWorkUnitStatus = (status: WorkUnitStatus): boolean =>
  status === "completed" ||
  status === "cancelled" ||
  status === "failed";

const requireBriefingSessionForGrowth = (
  session: PairSessionSnapshot | undefined,
): PairSessionSnapshot => {
  if (session === undefined || session.status !== "briefing") {
    throw new Error("SESSION_NOT_BRIEFING");
  }

  return session;
};

const requireWorkSession = (
  session: PairSessionSnapshot | undefined,
): PairSessionSnapshot => {
  if (session === undefined) {
    throw new Error("SESSION_NOT_STARTED");
  }

  if (session.status === "briefing" || session.status === "ready" || session.status === "active") {
    return session;
  }

  throw new Error("WORK_UNIT_NOT_AGREED");
};

const withAssistance = (
  session: PairSessionSnapshot,
  mutate: (assistance: AssistanceState) => AssistanceState,
): AssistanceState => mutate(session.assistance ?? createGrowthAssistance());

const reconcileWorkUnit = (
  workUnit: WorkUnit | undefined,
): WorkUnit | undefined => {
  if (workUnit === undefined || isTerminalWorkUnitStatus(workUnit.status)) {
    return workUnit;
  }

  return {
    ...workUnit,
    status: "needs-reconcile",
  };
};

const applyEvent = (
  snapshot: PairRuntimeSnapshot,
  event: PairEvent,
): PairRuntimeSnapshot => {
  if (event.revision !== snapshot.revision + 1) {
    throw new Error("INVALID_EVENT_REVISION");
  }

  switch (event.type) {
    case "SessionStarted": {
      if (snapshot.session !== undefined) {
        throw new Error("SESSION_ALREADY_STARTED");
      }

      const session = createSession(event.sessionId);

      return {
        protocolVersion: 1,
        revision: event.revision,
        presence: {
          workspaceId: snapshot.presence.workspaceId,
          observationRevision: snapshot.presence.observationRevision,
          status: "engaged",
          activeSessionId: event.sessionId,
        },
        session: {
          ...session,
          status: "briefing",
        },
      };
    }

    case "SessionPaused": {
      const session = requirePausableSession(snapshot.session);
      if (event.authorityEpoch !== session.authorityEpoch + 1) {
        throw new Error("INVALID_AUTHORITY_EPOCH");
      }

      return {
        protocolVersion: 1,
        revision: event.revision,
        presence: {
          workspaceId: snapshot.presence.workspaceId,
          observationRevision: snapshot.presence.observationRevision,
          status: "paused",
          activeSessionId: session.sessionId,
        },
        session: {
          ...session,
          status: "paused",
          authorityEpoch: event.authorityEpoch,
        },
      };
    }

    case "EntryCaptured": {
      const session = requireBriefingSession(snapshot.session);

      return {
        protocolVersion: 1,
        revision: event.revision,
        presence: {
          workspaceId: snapshot.presence.workspaceId,
          observationRevision: snapshot.presence.observationRevision,
          status: "engaged",
          activeSessionId: session.sessionId,
        },
        session: {
          ...session,
          entrySnapshot: normalizeEntrySnapshot(event.entry, session.entrySnapshot),
        },
      };
    }

    case "LearningConfirmed": {
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
    }

    case "ModeSelected": {
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
    }

    case "WorkUnitProposed": {
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
    }

    case "WorkUnitAgreed": {
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
    }

    case "AttemptRecorded": {
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
    }

    case "HypothesisRecorded": {
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
    }

    case "HintRequested": {
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
    }

    case "SolutionRevealAuthorized": {
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
    }

    case "SessionResumed": {
      const session = requirePausedSession(snapshot.session);

      return {
        protocolVersion: 1,
        revision: event.revision,
        presence: {
          workspaceId: snapshot.presence.workspaceId,
          observationRevision: snapshot.presence.observationRevision,
          status: "engaged",
          activeSessionId: session.sessionId,
        },
        session: {
          ...session,
          status: "reconciling",
          entrySnapshot: normalizeEntrySnapshot(event.entry, session.entrySnapshot),
          workUnit: reconcileWorkUnit(session.workUnit),
        },
      };
    }

    case "SessionClosed": {
      const session = requireClosableSession(snapshot.session);

      return {
        protocolVersion: 1,
        revision: event.revision,
        presence: {
          workspaceId: snapshot.presence.workspaceId,
          observationRevision: snapshot.presence.observationRevision,
          status: "observing",
          activeSessionId: undefined,
        },
        session: {
          ...session,
          status: "closed",
        },
      };
    }

    default:
      throw new Error(`UNSUPPORTED_EVENT:${event.type}`);
  }
};

export const reduce = (
  snapshot: PairRuntimeSnapshot,
  events: readonly PairEvent[],
): PairRuntimeSnapshot => {
  let next = snapshot;

  for (const event of events) {
    next = applyEvent(next, event);
  }

  return cloneFrozen(next);
};
