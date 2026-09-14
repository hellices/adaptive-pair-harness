import type {
  PairCommand,
  PairEvent,
  PairRuntimeSnapshot,
  SessionStatus,
} from "@adaptive-pair/protocol";
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

    default:
      throw new Error(`UNSUPPORTED_COMMAND:${command.type}`);
  }
};
