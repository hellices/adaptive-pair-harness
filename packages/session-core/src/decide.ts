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

const requireOperationalGrowthSession = (
  session: PairSessionSnapshot | undefined,
): PairSessionSnapshot => {
  const operationalSession = requireOperationalSession(session);
  const workUnit = requireOperationalWorkUnit(operationalSession);

  requireGrowthWorkUnit(operationalSession, workUnit.id);

  return operationalSession;
};

const requireOperationalDeliveryAiSession = (
  session: PairSessionSnapshot | undefined,
): PairSessionSnapshot => {
  const operationalSession = requireOperationalSession(session);
  const workUnit = requireOperationalWorkUnit(operationalSession);

  if (
    operationalSession.mode !== "delivery" ||
    workUnit.mode !== "delivery" ||
    workUnit.owner !== "ai"
  ) {
    throw new Error("USER_ACTION_NOT_ALLOWED");
  }

  return operationalSession;
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

const consumeHumanActionEvents = (
  snapshot: PairRuntimeSnapshot,
  session: PairSessionSnapshot,
  event: ReturnType<typeof createEventFactory>,
  command: Pick<PairCommand, "actor"> & {
    readonly userActionGrantId?: string;
  },
  expectedNativeToolName: string,
): PairEvent[] => {
  const grantId = command.userActionGrantId;
  if (grantId === undefined) {
    if (command.actor !== "human") {
      throw new Error("USER_ACTION_REQUIRED");
    }
    return [];
  }

  requireCurrentGrant(snapshot, session, grantId, expectedNativeToolName);
  return [
    event(0, "UserActionConsumed", {
      grantId,
    }),
  ];
};

const requireGrantableUserActionSession = (
  snapshot: PairRuntimeSnapshot,
  nativeToolName: string,
): PairSessionSnapshot => {
  switch (nativeToolName) {
    case "adaptive_pair_capture_entry":
      return requireBriefingSession(snapshot.session);

    case "adaptive_pair_confirm_learning":
      return requireLearningEntry(requireBriefingSession(snapshot.session));

    case "adaptive_pair_select_mode":
      return requireModeChangeWithoutWorkUnit(
        requireBriefingSession(snapshot.session),
      );

    case "adaptive_pair_agree_work_unit": {
      const session = requireWorkUnitEntry(
        requireBriefingSession(snapshot.session),
      );
      if (session.workUnit === undefined) {
        throw new Error("WORK_UNIT_NOT_FOUND");
      }
      if (session.workUnit.status !== "proposed") {
        throw new Error("WORK_UNIT_NOT_PROPOSED");
      }
      return session;
    }

    case "adaptive_pair_record_attempt":
    case "adaptive_pair_record_hypothesis":
    case "adaptive_pair_reveal_solution":
      return requireOperationalGrowthSession(snapshot.session);

    case "adaptive_pair_request_hint": {
      const session = requireOperationalGrowthSession(snapshot.session);
      requireGrowthAgreement(session);
      return session;
    }

    case "adaptive_pair_run_verification":
      return requireOperationalSession(snapshot.session);

    case "adaptive_pair_run_command":
      return requireOperationalDeliveryAiSession(snapshot.session);

    case "adaptive_pair_close_session":
      return requireClosableSession(snapshot.session);

    default:
      throw new Error("USER_ACTION_NOT_ALLOWED");
  }
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

    case "ConfirmLearning":
      return freezeDecision((() => {
        const session = requireLearningEntry(
          requireBriefingSession(snapshot.session),
        );
        const events = consumeHumanActionEvents(
          snapshot,
          session,
          event,
          command,
          "adaptive_pair_confirm_learning",
        );
        events.push(event(events.length, "LearningConfirmed", {
          agreement: command.agreement,
        }));
        return events;
      })());

    case "SelectMode": {
      const session = requireModeChangeWithoutWorkUnit(
        requireBriefingSession(snapshot.session),
      );

      if (command.mode === "growth") {
        requireGrowthAgreement(session);
      }

      const events = consumeHumanActionEvents(
        snapshot,
        session,
        event,
        command,
        "adaptive_pair_select_mode",
      );
      events.push(event(events.length, "ModeSelected", {
          mode: command.mode,
      }));
      return freezeDecision(events);
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

      const events = consumeHumanActionEvents(
        snapshot,
        session,
        event,
        command,
        "adaptive_pair_agree_work_unit",
      );
      events.push(event(events.length, "WorkUnitAgreed", {
          workUnitId: command.workUnitId,
      }));
      return freezeDecision(events);
    }

    case "RecordAttempt":
      requireGrowthWorkUnit(
        requireBriefingOrActiveSession(snapshot.session),
        command.workUnitId,
      );

      return freezeDecision((() => {
        const session = requireBriefingOrActiveSession(snapshot.session);
        const events = consumeHumanActionEvents(
          snapshot,
          session,
          event,
          command,
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
        const events = consumeHumanActionEvents(
          snapshot,
          session,
          event,
          command,
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
        const events = consumeHumanActionEvents(
          snapshot,
          session,
          event,
          command,
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
        const events = consumeHumanActionEvents(
          snapshot,
          session,
          event,
          command,
          "adaptive_pair_reveal_solution",
        );

        events.push(event(events.length, "SolutionRevealAuthorized", {
          workUnitId: command.workUnitId,
          previewOnly: true,
        }));

        return events;
      })());

    case "GrantUserAction": {
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

    default:
      throw new Error(`UNSUPPORTED_COMMAND:${command.type}`);
  }
};
