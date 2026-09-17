import { normalizeEntrySnapshot } from "../entrySnapshot.js";
import { createSession } from "../initialState.js";
import {
  reconcileWorkUnit,
  requireBriefingSession,
  requireClosableSession,
  requirePausableSession,
  requirePausedSession,
  type EventReducer,
} from "./support.js";

export const sessionStarted: EventReducer<"SessionStarted"> = (snapshot, event) => {
  if (snapshot.session !== undefined) {
    throw new Error("SESSION_ALREADY_STARTED");
  }

  const session = createSession(event.sessionId, event.revision);

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
};

export const sessionPaused: EventReducer<"SessionPaused"> = (snapshot, event) => {
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
};

export const entryCaptured: EventReducer<"EntryCaptured"> = (snapshot, event) => {
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
};

export const sessionResumed: EventReducer<"SessionResumed"> = (snapshot, event) => {
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
};

export const sessionClosed: EventReducer<"SessionClosed"> = (snapshot, event) => {
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
};
