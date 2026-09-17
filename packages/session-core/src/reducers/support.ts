import type {
  AssistanceState,
  OperationRecord,
  PairEvent,
  PairRuntimeSnapshot,
  PairSessionSnapshot,
  SessionStatus,
  WorkUnit,
  WorkUnitStatus,
} from "@adaptive-pair/protocol";
import { createGrowthAssistance } from "../growth.js";

export const isPausableStatus = (status: SessionStatus): boolean =>
  status === "ready" || status === "active" || status === "reconciling";

export const requirePausableSession = (
  session: PairSessionSnapshot | undefined,
): PairSessionSnapshot => {
  if (session === undefined || !isPausableStatus(session.status)) {
    throw new Error("SESSION_NOT_PAUSABLE");
  }

  return session;
};

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

export const isTerminalWorkUnitStatus = (status: WorkUnitStatus): boolean =>
  status === "completed" ||
  status === "cancelled" ||
  status === "failed";

export const requireBriefingSessionForGrowth = (
  session: PairSessionSnapshot | undefined,
): PairSessionSnapshot => {
  if (session === undefined || session.status !== "briefing") {
    throw new Error("SESSION_NOT_BRIEFING");
  }

  return session;
};

export const requireWorkSession = (
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

export const requireStartedSession = (
  session: PairSessionSnapshot | undefined,
): PairSessionSnapshot => {
  if (session === undefined) {
    throw new Error("SESSION_NOT_STARTED");
  }

  return session;
};

export const withAssistance = (
  session: PairSessionSnapshot,
  mutate: (assistance: AssistanceState) => AssistanceState,
): AssistanceState => mutate(session.assistance ?? createGrowthAssistance());

export const reconcileWorkUnit = (
  workUnit: WorkUnit | undefined,
): WorkUnit | undefined => {
  if (workUnit === undefined || isTerminalWorkUnitStatus(workUnit.status)) {
    return workUnit;
  }

  return {
    ...workUnit,
    status: "needs-reconcile",
  };
};

export const replaceOperation = (
  operations: readonly OperationRecord[],
  operationId: string,
  mutate: (operation: OperationRecord) => OperationRecord,
): readonly OperationRecord[] => {
  const index = operations.findIndex(operation => operation.id === operationId);

  if (index < 0) {
    throw new Error("OPERATION_NOT_FOUND");
  }

  const current = operations[index];

  if (current === undefined) {
    throw new Error("OPERATION_NOT_FOUND");
  }

  return [
    ...operations.slice(0, index),
    mutate(current),
    ...operations.slice(index + 1),
  ];
};

export type EventReducer<Type extends PairEvent["type"]> = (
  snapshot: PairRuntimeSnapshot,
  event: Extract<PairEvent, { readonly type: Type }>,
) => PairRuntimeSnapshot;
