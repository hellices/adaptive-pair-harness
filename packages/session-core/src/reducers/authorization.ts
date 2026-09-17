import { replaceOperation, requireStartedSession, type EventReducer } from "./support.js";

export const userActionGranted: EventReducer<"UserActionGranted"> = (snapshot, event) => {
  const session = requireStartedSession(snapshot.session);

  if (event.runtimeRevision !== event.revision) {
    throw new Error("INVALID_GRANT_RUNTIME_REVISION");
  }

  if (
    session.userActionGrants.some(grant => grant.id === event.grantId)
  ) {
    throw new Error("USER_ACTION_GRANT_EXISTS");
  }

  return {
    protocolVersion: 1,
    revision: event.revision,
    presence: snapshot.presence,
    session: {
      ...session,
      userActionGrants: [
        ...session.userActionGrants,
        {
          id: event.grantId,
          nativeToolName: event.nativeToolName,
          runtimeRevision: event.runtimeRevision,
          authorityEpoch: event.authorityEpoch,
          status: "available",
        },
      ],
    },
  };
};

export const userActionConsumed: EventReducer<"UserActionConsumed"> = (snapshot, event) => {
  const session = requireStartedSession(snapshot.session);
  const grant = session.userActionGrants.find(
    candidate => candidate.id === event.grantId,
  );

  if (grant === undefined) {
    throw new Error("USER_ACTION_GRANT_NOT_FOUND");
  }

  if (grant.status !== "available") {
    throw new Error("USER_ACTION_GRANT_ALREADY_CONSUMED");
  }

  return {
    protocolVersion: 1,
    revision: event.revision,
    presence: snapshot.presence,
    session: {
      ...session,
      userActionGrants: session.userActionGrants.map(candidate =>
        candidate.id === event.grantId
          ? {
              ...candidate,
              status: "consumed",
            }
          : candidate,
      ),
    },
  };
};

export const operationAuthorized: EventReducer<"OperationAuthorized"> = (snapshot, event) => {
  const session = requireStartedSession(snapshot.session);

  if (event.operation.runtimeRevision !== event.revision) {
    throw new Error("INVALID_OPERATION_RUNTIME_REVISION");
  }

  if (event.operation.authorityEpoch !== session.authorityEpoch) {
    throw new Error("INVALID_OPERATION_AUTHORITY");
  }

  if (
    session.operations.some(operation => operation.id === event.operation.id)
  ) {
    throw new Error("OPERATION_ALREADY_EXISTS");
  }

  return {
    protocolVersion: 1,
    revision: event.revision,
    presence: snapshot.presence,
    session: {
      ...session,
      operations: [...session.operations, event.operation],
    },
  };
};

export const operationObserved: EventReducer<"OperationObserved"> = (snapshot, event) => {
  const session = requireStartedSession(snapshot.session);

  return {
    protocolVersion: 1,
    revision: event.revision,
    presence: snapshot.presence,
    session: {
      ...session,
      operations: replaceOperation(session.operations, event.operationId, operation => {
        if (operation.status === "confirmed" ||
            operation.status === "failed" ||
            operation.status === "declined" ||
            operation.status === "cancelled" ||
            operation.status === "unknown") {
          throw new Error("OPERATION_ALREADY_SETTLED");
        }

        if (operation.authorityEpoch !== event.authorityEpoch) {
          throw new Error("STALE_OPERATION_OBSERVATION");
        }

        return {
          ...operation,
          status: event.status,
          summary: event.summary,
        };
      }),
    },
  };
};
