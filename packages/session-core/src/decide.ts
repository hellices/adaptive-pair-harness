import type { PairCommand, PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import * as agreements from "./decisions/agreements.js";
import * as authorization from "./decisions/authorization.js";
import * as growth from "./decisions/growth.js";
import * as presence from "./decisions/presence.js";
import * as session from "./decisions/session.js";
import { createEventFactory, type Decision } from "./decisions/support.js";
export type { Decision } from "./decisions/support.js";

export const decide = (
  snapshot: PairRuntimeSnapshot,
  command: PairCommand,
): Decision => {
  if (command.expectedRevision !== snapshot.revision) {
    throw new Error("STALE_REVISION");
  }

  const event = createEventFactory(snapshot, command);

  switch (command.type) {
    case "EnablePresence":
      return presence.enablePresence(snapshot, command, event);
    case "SetPresence":
      return presence.setPresence(snapshot, command, event);
    case "ObserveWorkspace":
      return presence.observeWorkspace(snapshot, command, event);
    case "StartSession":
      return session.startSession(snapshot, command, event);
    case "PauseSession":
      return session.pauseSession(snapshot, command, event);
    case "CaptureEntry":
      return session.captureEntry(snapshot, command, event);
    case "ConfirmLearning":
      return agreements.confirmLearning(snapshot, command, event);
    case "SelectMode":
      return agreements.selectMode(snapshot, command, event);
    case "ProposeWorkUnit":
      return agreements.proposeWorkUnit(snapshot, command, event);
    case "AgreeWorkUnit":
      return agreements.agreeWorkUnit(snapshot, command, event);
    case "RecordAttempt":
      return growth.recordAttempt(snapshot, command, event);
    case "RecordHypothesis":
      return growth.recordHypothesis(snapshot, command, event);
    case "RequestHint":
      return growth.requestHint(snapshot, command, event);
    case "AuthorizeSolutionReveal":
      return growth.authorizeSolutionReveal(snapshot, command, event);
    case "GrantUserAction":
      return authorization.grantUserAction(snapshot, command, event);
    case "AuthorizeOperation":
      return authorization.authorizeOperation(snapshot, command, event);
    case "ObserveOperationResult":
      return authorization.observeOperationResult(snapshot, command, event);
    case "RequestEditOperation":
      return authorization.requestEditOperation(snapshot, command, event);
    case "ResumeSession":
      return session.resumeSession(snapshot, command, event);
    case "CloseSession":
      return session.closeSession(snapshot, command, event);
    default:
      throw new Error(`UNSUPPORTED_COMMAND:${command.type}`);
  }
};
