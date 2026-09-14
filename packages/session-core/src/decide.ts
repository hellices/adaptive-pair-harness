import type {
  PairCommand,
  PairEvent,
  PairRuntimeSnapshot,
  PairSessionSnapshot,
  SessionStatus,
} from "@adaptive-pair/protocol";
import { normalizeEntrySnapshot } from "./entrySnapshot.js";
import { cloneFrozen } from "./immutable.js";

export interface Decision {
  readonly events: readonly PairEvent[];
}

const freezeDecision = (events: readonly PairEvent[]): Decision =>
  cloneFrozen({
    events,
  });

const isPausableStatus = (status: SessionStatus): boolean =>
  status === "ready" || status === "active" || status === "reconciling";

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

export const decide = (
  snapshot: PairRuntimeSnapshot,
  command: PairCommand,
): Decision => {
  if (command.expectedRevision !== snapshot.revision) {
    throw new Error("STALE_REVISION");
  }

  const base = {
    protocolVersion: 1 as const,
    eventId: `${command.commandId}:0`,
    commandId: command.commandId,
    actor: command.actor,
    revision: snapshot.revision + 1,
    recordedAt: command.observedAt,
  };

  switch (command.type) {
    case "StartSession":
      if (snapshot.session !== undefined) {
        throw new Error("SESSION_ALREADY_STARTED");
      }

      return freezeDecision([
        {
          ...base,
          type: "SessionStarted",
          sessionId: command.sessionId,
        },
      ]);

    case "PauseSession": {
      const session = snapshot.session;

      if (session === undefined || !isPausableStatus(session.status)) {
        throw new Error("SESSION_NOT_PAUSABLE");
      }

      return freezeDecision([
        {
          ...base,
          type: "SessionPaused",
          reason: command.reason,
          authorityEpoch: session.authorityEpoch + 1,
        },
      ]);
    }

    case "CaptureEntry":
      return freezeDecision([
        {
          ...base,
          type: "EntryCaptured",
          entry: normalizeEntrySnapshot(
            command.entry,
            requireBriefingSession(snapshot.session).entrySnapshot,
          ),
        },
      ]);

    case "ResumeSession":
      return freezeDecision([
        {
          ...base,
          type: "SessionResumed",
          entry: normalizeEntrySnapshot(
            command.entry,
            requirePausedSession(snapshot.session).entrySnapshot,
          ),
        },
      ]);

    case "CloseSession":
      if (snapshot.session === undefined) {
        throw new Error("SESSION_NOT_STARTED");
      }

      if (snapshot.session.status === "closed") {
        throw new Error("SESSION_ALREADY_CLOSED");
      }

      return freezeDecision([
        {
          ...base,
          type: "SessionClosed",
        },
      ]);

    case "AgreeWorkUnit":
      if (snapshot.session?.status === "reconciling") {
        throw new Error("SESSION_RECONCILING");
      }

      throw new Error(`UNSUPPORTED_COMMAND:${command.type}`);

    default:
      throw new Error(`UNSUPPORTED_COMMAND:${command.type}`);
  }
};
