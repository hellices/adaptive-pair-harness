import type {
  PairEvent,
  PairRuntimeSnapshot,
  PairSessionSnapshot,
  SessionStatus,
  WorkUnit,
  WorkUnitStatus,
} from "@adaptive-pair/protocol";
import { normalizeEntrySnapshot } from "./entrySnapshot.js";
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

const requireReconciliationBlock = (
  session: PairSessionSnapshot | undefined,
): never => {
  if (session?.status === "reconciling") {
    throw new Error("SESSION_RECONCILING");
  }

  throw new Error("UNSUPPORTED_EVENT:WorkUnitAgreed");
};

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

    case "WorkUnitAgreed":
      return requireReconciliationBlock(snapshot.session);

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
