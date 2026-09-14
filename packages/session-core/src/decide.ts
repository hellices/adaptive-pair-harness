import type {
  OperationRecord,
  PairCommand,
  PairEvent,
  PairRuntimeSnapshot,
  PairSessionSnapshot,
  SessionStatus,
} from "@adaptive-pair/protocol";
import { normalizeEntrySnapshot } from "./entrySnapshot.js";
import {
  requireModeChangeWithoutWorkUnit,
  requireGrowthAgreement,
  requireGrowthWorkUnit,
  requireLearningEntry,
  requireWorkUnitEntry,
  validateHintLevel,
  validateProposedWorkUnit,
  validateSolutionReveal,
} from "./growth.js";
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

const isOperationalStatus = (status: SessionStatus): boolean =>
  status === "ready" || status === "active";

const isTerminalOperationStatus = (status: OperationRecord["status"]): boolean =>
  status === "confirmed" ||
  status === "failed" ||
  status === "declined" ||
  status === "cancelled" ||
  status === "unknown";

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

const requireOperationalSession = (
  session: PairSessionSnapshot | undefined,
): PairSessionSnapshot => {
  if (session === undefined) {
    throw new Error("SESSION_NOT_STARTED");
  }

  if (!isOperationalStatus(session.status)) {
    throw new Error("SESSION_NOT_OPERATIONAL");
  }

  return session;
};

const requireOperationalWorkUnit = (
  session: PairSessionSnapshot,
): NonNullable<PairSessionSnapshot["workUnit"]> => {
  const workUnit = session.workUnit;

  if (workUnit === undefined || workUnit.status !== "agreed") {
    throw new Error("WORK_UNIT_NOT_AGREED");
  }

  return workUnit;
};

const requireAvailableGrant = (
  session: PairSessionSnapshot,
  grantId: string,
) => {
  const grant = session.userActionGrants.find(candidate => candidate.id === grantId);

  if (grant === undefined) {
    throw new Error("USER_ACTION_REQUIRED");
  }

  if (grant.status !== "available") {
    throw new Error("USER_ACTION_CONSUMED");
  }

  return grant;
};

const requireCurrentGrant = (
  snapshot: PairRuntimeSnapshot,
  session: PairSessionSnapshot,
  grantId: string,
  expectedNativeToolName: string,
) => {
  const grant = requireAvailableGrant(session, grantId);

  if (grant.runtimeRevision !== snapshot.revision || grant.authorityEpoch !== session.authorityEpoch) {
    throw new Error("STALE_USER_ACTION_GRANT");
  }

  if (grant.nativeToolName !== expectedNativeToolName) {
    throw new Error("USER_ACTION_MISMATCH");
  }

  return grant;
};

const requirePausableSession = (
  session: PairSessionSnapshot | undefined,
): PairSessionSnapshot => {
  if (session === undefined || !isPausableStatus(session.status)) {
    throw new Error("SESSION_NOT_PAUSABLE");
  }

  return session;
};

const requireBriefingOrActiveSession = (
  session: PairSessionSnapshot | undefined,
): PairSessionSnapshot => {
  if (session === undefined) {
    throw new Error("SESSION_NOT_STARTED");
  }

  if (
    session.status === "briefing" ||
    session.status === "ready" ||
    session.status === "active"
  ) {
    return session;
  }

  throw new Error("WORK_UNIT_NOT_AGREED");
};

const createEventFactory = (
  snapshot: PairRuntimeSnapshot,
  command: PairCommand,
) => <Type extends PairEvent["type"]>(
  offset: number,
  type: Type,
  payload: Omit<
    Extract<PairEvent, { readonly type: Type }>,
    "protocolVersion" | "eventId" | "commandId" | "actor" | "revision" | "recordedAt" | "type"
  >,
): PairEvent => ({
  protocolVersion: 1,
  eventId: `${command.commandId}:${offset}`,
  commandId: command.commandId,
  actor: command.actor,
  revision: snapshot.revision + offset + 1,
  recordedAt: command.observedAt,
  type,
  ...payload,
} as PairEvent);

const consumeGrantEvents = (
  snapshot: PairRuntimeSnapshot,
  session: PairSessionSnapshot,
  event: ReturnType<typeof createEventFactory>,
  grantId: string | undefined,
  expectedNativeToolName: string,
): PairEvent[] => {
  if (grantId === undefined) {
    return [];
  }

  requireCurrentGrant(snapshot, session, grantId, expectedNativeToolName);
  return [
    event(0, "UserActionConsumed", {
      grantId,
    }),
  ];
};

export const decide = (
  snapshot: PairRuntimeSnapshot,
  command: PairCommand,
): Decision => {
  if (command.expectedRevision !== snapshot.revision) {
    throw new Error("STALE_REVISION");
  }

  const event = createEventFactory(snapshot, command);

  switch (command.type) {
    case "StartSession":
      if (snapshot.session !== undefined) {
        throw new Error("SESSION_ALREADY_STARTED");
      }

      return freezeDecision([
        event(0, "SessionStarted", {
          sessionId: command.sessionId,
        }),
      ]);

    case "PauseSession": {
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
    }

    case "CaptureEntry":
      return freezeDecision((() => {
        const session = requireBriefingSession(snapshot.session);
        const events = consumeGrantEvents(
          snapshot,
          session,
          event,
          command.userActionGrantId,
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

    case "ConfirmLearning":
      requireLearningEntry(requireBriefingSession(snapshot.session));

      return freezeDecision([
        event(0, "LearningConfirmed", {
          agreement: command.agreement,
        }),
      ]);

    case "SelectMode": {
      const session = requireModeChangeWithoutWorkUnit(
        requireBriefingSession(snapshot.session),
      );

      if (command.mode === "growth") {
        requireGrowthAgreement(session);
      }

      return freezeDecision([
        event(0, "ModeSelected", {
          mode: command.mode,
        }),
      ]);
    }

    case "ProposeWorkUnit": {
      const session = requireWorkUnitEntry(
        requireBriefingSession(snapshot.session),
      );
      validateProposedWorkUnit(session, command.workUnit);

      return freezeDecision([
        event(0, "WorkUnitProposed", {
          workUnit: command.workUnit,
        }),
      ]);
    }

    case "AgreeWorkUnit": {
      if (snapshot.session?.status === "reconciling") {
        throw new Error("SESSION_RECONCILING");
      }

      const session = requireWorkUnitEntry(
        requireBriefingSession(snapshot.session),
      );
      const workUnit = session.workUnit;
      if (workUnit === undefined || workUnit.id !== command.workUnitId) {
        throw new Error("WORK_UNIT_NOT_FOUND");
      }

      if (workUnit.status !== "proposed") {
        throw new Error("WORK_UNIT_NOT_PROPOSED");
      }

      if (workUnit.mode !== session.mode) {
        throw new Error("WORK_UNIT_MODE_MISMATCH");
      }

      return freezeDecision([
        event(0, "WorkUnitAgreed", {
          workUnitId: command.workUnitId,
        }),
      ]);
    }

    case "RecordAttempt":
      requireGrowthWorkUnit(
        requireBriefingOrActiveSession(snapshot.session),
        command.workUnitId,
      );

      return freezeDecision((() => {
        const session = requireBriefingOrActiveSession(snapshot.session);
        const events = consumeGrantEvents(
          snapshot,
          session,
          event,
          command.userActionGrantId,
          "adaptive_pair_record_attempt",
        );

        events.push(event(events.length, "AttemptRecorded", {
          workUnitId: command.workUnitId,
          summary: command.summary,
          bypassed: command.bypassed,
        }));

        return events;
      })());

    case "RecordHypothesis":
      return freezeDecision((() => {
        const session = requireBriefingOrActiveSession(snapshot.session);
        requireGrowthWorkUnit(session, command.workUnitId);
        const events = consumeGrantEvents(
          snapshot,
          session,
          event,
          command.userActionGrantId,
          "adaptive_pair_record_hypothesis",
        );

        events.push(event(events.length, "HypothesisRecorded", {
          workUnitId: command.workUnitId,
          summary: command.summary,
          bypassed: command.bypassed,
        }));

        return events;
      })());

    case "RequestHint":
      return freezeDecision((() => {
        const session = requireBriefingOrActiveSession(snapshot.session);
        validateHintLevel(session, command.workUnitId, command.level);
        const events = consumeGrantEvents(
          snapshot,
          session,
          event,
          command.userActionGrantId,
          "adaptive_pair_request_hint",
        );

        events.push(event(events.length, "HintRequested", {
          workUnitId: command.workUnitId,
          level: command.level,
        }));

        return events;
      })());

    case "AuthorizeSolutionReveal":
      return freezeDecision((() => {
        const session = requireBriefingOrActiveSession(snapshot.session);
        validateSolutionReveal(
          session,
          command.workUnitId,
          command.previewOnly,
        );
        const events = consumeGrantEvents(
          snapshot,
          session,
          event,
          command.userActionGrantId,
          "adaptive_pair_reveal_solution",
        );

        events.push(event(events.length, "SolutionRevealAuthorized", {
          workUnitId: command.workUnitId,
          previewOnly: true,
        }));

        return events;
      })());

    case "GrantUserAction": {
      const session = requireOperationalSession(snapshot.session);

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
    }

    case "AuthorizeOperation": {
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
    }

    case "ObserveOperationResult": {
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
    }

    case "RequestEditOperation":
      if (snapshot.session?.mode === "growth") {
        throw new Error("GROWTH_AI_MUTATION_FORBIDDEN");
      }

      throw new Error("EDIT_OPERATION_UNSUPPORTED");

    case "ResumeSession":
      return freezeDecision([
        event(0, "SessionResumed", {
          entry: normalizeEntrySnapshot(
            command.entry,
            requirePausedSession(snapshot.session).entrySnapshot,
          ),
        }),
      ]);

    case "CloseSession":
      if (snapshot.session === undefined) {
        throw new Error("SESSION_NOT_STARTED");
      }

      if (snapshot.session.status === "closed") {
        throw new Error("SESSION_ALREADY_CLOSED");
      }

      return freezeDecision((() => {
        const events = consumeGrantEvents(
          snapshot,
          snapshot.session,
          event,
          command.userActionGrantId,
          "adaptive_pair_close_session",
        );
        events.push(event(events.length, "SessionClosed", {}));
        return events;
      })());

    default:
      throw new Error(`UNSUPPORTED_COMMAND:${command.type}`);
  }
};
