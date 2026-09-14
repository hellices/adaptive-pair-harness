import type {
  PairEvent,
  PairRuntimeSnapshot,
  PairSessionSnapshot,
  SessionStatus,
} from "@adaptive-pair/protocol";
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
