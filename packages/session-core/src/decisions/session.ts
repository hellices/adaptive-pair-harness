import type { PairEvent } from "@adaptive-pair/protocol";
import { normalizeEntrySnapshot } from "../entrySnapshot.js";
import {
  consumeHumanActionEvents,
  freezeDecision,
  isTerminalOperationStatus,
  requireBriefingSession,
  requirePausableSession,
  requirePausedSession,
  type DecisionHandler,
} from "./support.js";

export const startSession: DecisionHandler<"StartSession"> = (snapshot, command, event) => {
  if (snapshot.session !== undefined) {
    throw new Error("SESSION_ALREADY_STARTED");
  }

  return freezeDecision([
    event(0, "SessionStarted", {
      sessionId: command.sessionId,
    }),
  ]);
};

export const pauseSession: DecisionHandler<"PauseSession"> = (snapshot, command, event) => {
  const session = requirePausableSession(snapshot.session);
  const events: PairEvent[] = session.operations
    .filter(operation => !isTerminalOperationStatus(operation.status))
    .map((operation, index) =>
      event(index, "OperationObserved", {
        operationId: operation.id,
        authorityEpoch: operation.authorityEpoch,
        status: "cancelled",
        summary: "Session paused before the operation completed.",
      }),
    );

  events.push(
    event(events.length, "SessionPaused", {
      reason: command.reason,
      authorityEpoch: session.authorityEpoch + 1,
    }),
  );

  return freezeDecision(events);
};

export const captureEntry: DecisionHandler<"CaptureEntry"> = (snapshot, command, event) => {
  return freezeDecision((() => {
    const session = requireBriefingSession(snapshot.session);
    const events = consumeHumanActionEvents(
      snapshot,
      session,
      event,
      command,
      "adaptive_pair_capture_entry",
    );

    events.push(event(events.length, "EntryCaptured", {
      entry: normalizeEntrySnapshot(
        command.entry,
        session.entrySnapshot,
      ),
    }));

    return events;
  })());
};

export const resumeSession: DecisionHandler<"ResumeSession"> = (snapshot, command, event) => {
  return freezeDecision([
    event(0, "SessionResumed", {
      entry: normalizeEntrySnapshot(
        command.entry,
        requirePausedSession(snapshot.session).entrySnapshot,
      ),
    }),
  ]);
};

export const closeSession: DecisionHandler<"CloseSession"> = (snapshot, command, event) => {
  if (snapshot.session === undefined) {
    throw new Error("SESSION_NOT_STARTED");
  }

  if (snapshot.session.status === "closed") {
    throw new Error("SESSION_ALREADY_CLOSED");
  }

  return freezeDecision((() => {
    const events = consumeHumanActionEvents(
      snapshot,
      snapshot.session,
      event,
      command,
      "adaptive_pair_close_session",
    );
    events.push(event(events.length, "SessionClosed", {}));
    return events;
  })());
};
