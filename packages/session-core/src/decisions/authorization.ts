import type { PairEvent } from "@adaptive-pair/protocol";
import {
  freezeDecision,
  isTerminalOperationStatus,
  requireCurrentGrant,
  requireGrantableUserActionSession,
  requireOperationalSession,
  requireOperationalWorkUnit,
  type DecisionHandler,
} from "./support.js";

export const grantUserAction: DecisionHandler<"GrantUserAction"> = (snapshot, command, event) => {
  const session = requireGrantableUserActionSession(
    snapshot,
    command.nativeToolName,
  );

  if (command.actor !== "human") {
    throw new Error("USER_ACTION_REQUIRES_HUMAN");
  }

  if (session.userActionGrants.some(grant => grant.id === command.grantId)) {
    throw new Error("USER_ACTION_GRANT_EXISTS");
  }

  return freezeDecision([
    event(0, "UserActionGranted", {
      grantId: command.grantId,
      nativeToolName: command.nativeToolName,
      runtimeRevision: snapshot.revision + 1,
      authorityEpoch: session.authorityEpoch,
    }),
  ]);
};

export const authorizeOperation: DecisionHandler<"AuthorizeOperation"> = (snapshot, command, event) => {
  const session = requireOperationalSession(snapshot.session);
  const workUnit = requireOperationalWorkUnit(session);

  if (session.operations.some(operation => operation.id === command.operationId)) {
    return freezeDecision([]);
  }

  const events: PairEvent[] = [];

  if (command.userActionGrantId !== undefined) {
    requireCurrentGrant(
      snapshot,
      session,
      command.userActionGrantId,
      `adaptive_${command.toolName}`,
    );
    events.push(
      event(events.length, "UserActionConsumed", {
        grantId: command.userActionGrantId,
      }),
    );
  }

  const runtimeRevision = snapshot.revision + events.length + 1;
  events.push(
    event(events.length, "OperationAuthorized", {
      operation: {
        id: command.operationId,
        workUnitId: workUnit.id,
        toolName: command.toolName,
        kind: command.kind,
        input: command.input,
        runtimeRevision,
        authorityEpoch: session.authorityEpoch,
        status: "authorized",
        summary: undefined,
        userActionGrantId: command.userActionGrantId,
      },
    }),
  );

  return freezeDecision(events);
};

export const observeOperationResult: DecisionHandler<"ObserveOperationResult"> = (snapshot, command, event) => {
  const session = snapshot.session;

  if (session === undefined) {
    throw new Error("SESSION_NOT_STARTED");
  }

  const operation = session.operations.find(
    candidate => candidate.id === command.operationId,
  );

  if (operation === undefined) {
    return freezeDecision([]);
  }

  if (
    isTerminalOperationStatus(operation.status) ||
    operation.authorityEpoch !== command.authorityEpoch ||
    session.authorityEpoch !== command.authorityEpoch
  ) {
    return freezeDecision([]);
  }

  return freezeDecision([
    event(0, "OperationObserved", {
      operationId: command.operationId,
      authorityEpoch: command.authorityEpoch,
      status: command.status,
      summary: command.summary,
      ...(command.observation === undefined
        ? {}
        : { observation: command.observation }),
    }),
  ]);
};

export const requestEditOperation: DecisionHandler<"RequestEditOperation"> = (snapshot) => {
  if (snapshot.session?.mode === "growth") {
    throw new Error("GROWTH_AI_MUTATION_FORBIDDEN");
  }

  throw new Error("EDIT_OPERATION_UNSUPPORTED");
};
