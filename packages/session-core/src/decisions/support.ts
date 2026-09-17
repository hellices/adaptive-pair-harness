import type {
  OperationRecord,
  PairCommand,
  PairEvent,
  PairRuntimeSnapshot,
  PairSessionSnapshot,
  SessionStatus,
} from "@adaptive-pair/protocol";
import {
  requireGrowthAgreement,
  requireGrowthWorkUnit,
  requireLearningEntry,
  requireModeChangeWithoutWorkUnit,
  requireWorkUnitEntry,
} from "../growth.js";
import { cloneFrozen } from "../immutable.js";

export interface Decision {
  readonly events: readonly PairEvent[];
}

export const freezeDecision = (events: readonly PairEvent[]): Decision =>
  cloneFrozen({
    events,
  });

export const isPausableStatus = (status: SessionStatus): boolean =>
  status === "ready" || status === "active" || status === "reconciling";

export const isOperationalStatus = (status: SessionStatus): boolean =>
  status === "ready" || status === "active";

export const isTerminalOperationStatus = (status: OperationRecord["status"]): boolean =>
  status === "confirmed" ||
  status === "failed" ||
  status === "declined" ||
  status === "cancelled" ||
  status === "unknown";

export const requireBriefingSession = (
  session: PairSessionSnapshot | undefined,
): PairSessionSnapshot => {
  if (session === undefined || session.status !== "briefing") {
    throw new Error("SESSION_NOT_BRIEFING");
  }

  return session;
};

export const requirePausedSession = (
  session: PairSessionSnapshot | undefined,
): PairSessionSnapshot => {
  if (session === undefined || session.status !== "paused") {
    throw new Error("SESSION_NOT_PAUSED");
  }

  return session;
};

export const requireClosableSession = (
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

export const requireOperationalSession = (
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

export const requireOperationalWorkUnit = (
  session: PairSessionSnapshot,
): NonNullable<PairSessionSnapshot["workUnit"]> => {
  const workUnit = session.workUnit;

  if (workUnit === undefined || workUnit.status !== "agreed") {
    throw new Error("WORK_UNIT_NOT_AGREED");
  }

  return workUnit;
};

export const requireOperationalGrowthSession = (
  session: PairSessionSnapshot | undefined,
): PairSessionSnapshot => {
  const operationalSession = requireOperationalSession(session);
  const workUnit = requireOperationalWorkUnit(operationalSession);

  requireGrowthWorkUnit(operationalSession, workUnit.id);

  return operationalSession;
};

export const requireOperationalDeliveryAiSession = (
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

export const requireAvailableGrant = (
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

export const requireCurrentGrant = (
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

export const requirePausableSession = (
  session: PairSessionSnapshot | undefined,
): PairSessionSnapshot => {
  if (session === undefined || !isPausableStatus(session.status)) {
    throw new Error("SESSION_NOT_PAUSABLE");
  }

  return session;
};

export const requireBriefingOrActiveSession = (
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

export const createEventFactory = (
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

export const consumeHumanActionEvents = (
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

export const requireGrantableUserActionSession = (
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

export type DecisionHandler<Type extends PairCommand["type"]> = (
  snapshot: PairRuntimeSnapshot,
  command: Extract<PairCommand, { readonly type: Type }>,
  event: ReturnType<typeof createEventFactory>,
) => Decision;
