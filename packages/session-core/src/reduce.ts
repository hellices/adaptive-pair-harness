import type { PairEvent, PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { cloneFrozen } from "./immutable.js";
import * as agreements from "./reducers/agreements.js";
import * as authorization from "./reducers/authorization.js";
import * as growth from "./reducers/growth.js";
import * as presence from "./reducers/presence.js";
import * as session from "./reducers/session.js";

const applyEvent = (
  snapshot: PairRuntimeSnapshot,
  event: PairEvent,
): PairRuntimeSnapshot => {
  if (event.revision !== snapshot.revision + 1) {
    throw new Error("INVALID_EVENT_REVISION");
  }

  switch (event.type) {
    case "PresenceEnabled":
      return presence.presenceEnabled(snapshot, event);
    case "PresenceChanged":
      return presence.presenceChanged(snapshot, event);
    case "WorkspaceObserved":
      return presence.workspaceObserved(snapshot, event);
    case "SessionStarted":
      return session.sessionStarted(snapshot, event);
    case "SessionPaused":
      return session.sessionPaused(snapshot, event);
    case "EntryCaptured":
      return session.entryCaptured(snapshot, event);
    case "LearningConfirmed":
      return agreements.learningConfirmed(snapshot, event);
    case "ModeSelected":
      return agreements.modeSelected(snapshot, event);
    case "WorkUnitProposed":
      return agreements.workUnitProposed(snapshot, event);
    case "WorkUnitAgreed":
      return agreements.workUnitAgreed(snapshot, event);
    case "AttemptRecorded":
      return growth.attemptRecorded(snapshot, event);
    case "HypothesisRecorded":
      return growth.hypothesisRecorded(snapshot, event);
    case "HintRequested":
      return growth.hintRequested(snapshot, event);
    case "SolutionRevealAuthorized":
      return growth.solutionRevealAuthorized(snapshot, event);
    case "UserActionGranted":
      return authorization.userActionGranted(snapshot, event);
    case "UserActionConsumed":
      return authorization.userActionConsumed(snapshot, event);
    case "OperationAuthorized":
      return authorization.operationAuthorized(snapshot, event);
    case "OperationObserved":
      return authorization.operationObserved(snapshot, event);
    case "SessionResumed":
      return session.sessionResumed(snapshot, event);
    case "SessionClosed":
      return session.sessionClosed(snapshot, event);
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
