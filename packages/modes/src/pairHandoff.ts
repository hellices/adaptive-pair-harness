import type {
  OperationRecord,
  PairRuntimeSnapshot,
  WorkUnit,
} from "@adaptive-pair/protocol";
import {
  assessPairWorkUnit,
  type PairEditCapability,
  type PairWorkUnitRejection,
} from "./pairWorkUnit.js";

export interface PairHandoffProposal {
  readonly sessionId: string;
  readonly workUnitId: string;
  readonly fromOwner: WorkUnit["owner"];
  readonly toOwner: WorkUnit["owner"];
  readonly runtimeRevision: number;
  readonly authorityEpoch: number;
}

export interface PairHandoffContext {
  readonly snapshot: PairRuntimeSnapshot;
  readonly proposal: PairHandoffProposal;
  readonly operationAdmission: "open" | "stopped";
  readonly editCapability: PairEditCapability;
}

export type PairHandoffAssessment =
  | { readonly status: "ready-for-baseline-review" }
  | {
      readonly status: "blocked";
      readonly reason:
        | PairWorkUnitRejection
        | "PAIR_NOT_OPERATIONAL"
        | "PAIR_HANDOFF_IDENTITY_MISMATCH"
        | "PAIR_HANDOFF_OWNER_MISMATCH"
        | "PAIR_STALE_HANDOFF"
        | "PAIR_ADMISSION_OPEN"
        | "PAIR_OPERATIONS_PENDING"
        | "PAIR_RECONCILIATION_REQUIRED"
        | "PAIR_LEARNING_AGREEMENT_REQUIRED";
    };

const isSettledOperation = (operation: OperationRecord): boolean =>
  operation.status === "confirmed" ||
  operation.status === "failed" ||
  operation.status === "declined" ||
  operation.status === "cancelled" ||
  operation.status === "unknown";

export const assessPairHandoff = (
  context: PairHandoffContext,
): PairHandoffAssessment => {
  const { snapshot, proposal } = context;
  const session = snapshot.session;
  const workUnit = session?.workUnit;
  if (session?.mode !== "pair" || workUnit?.mode !== "pair") {
    return { status: "blocked", reason: "PAIR_MODE_REQUIRED" };
  }
  if ((session.status !== "ready" && session.status !== "active") ||
      (snapshot.presence.status !== "engaged" && snapshot.presence.status !== "quiet") ||
      snapshot.presence.activeSessionId !== session.sessionId ||
      (workUnit.status !== "agreed" && workUnit.status !== "executing" &&
       workUnit.status !== "verifying" && workUnit.status !== "completed")) {
    return { status: "blocked", reason: "PAIR_NOT_OPERATIONAL" };
  }
  if (proposal.sessionId !== session.sessionId || proposal.workUnitId !== workUnit.id) {
    return { status: "blocked", reason: "PAIR_HANDOFF_IDENTITY_MISMATCH" };
  }
  if (proposal.fromOwner !== workUnit.owner || proposal.fromOwner === proposal.toOwner) {
    return { status: "blocked", reason: "PAIR_HANDOFF_OWNER_MISMATCH" };
  }
  if (proposal.runtimeRevision !== snapshot.revision ||
      proposal.authorityEpoch !== session.authorityEpoch) {
    return { status: "blocked", reason: "PAIR_STALE_HANDOFF" };
  }
  if (context.operationAdmission !== "stopped") {
    return { status: "blocked", reason: "PAIR_ADMISSION_OPEN" };
  }
  if (session.operations.some(operation =>
    operation.kind !== "read" && operation.status === "unknown")) {
    return { status: "blocked", reason: "PAIR_RECONCILIATION_REQUIRED" };
  }
  if (session.operations.some(operation => !isSettledOperation(operation))) {
    return { status: "blocked", reason: "PAIR_OPERATIONS_PENDING" };
  }
  if (session.learningAgreement === undefined) {
    return { status: "blocked", reason: "PAIR_LEARNING_AGREEMENT_REQUIRED" };
  }
  const proposedOwner = assessPairWorkUnit(
    { ...workUnit, owner: proposal.toOwner, status: "proposed" },
    { learningAgreement: session.learningAgreement, editCapability: context.editCapability },
  );
  if (!proposedOwner.admissible) {
    return { status: "blocked", reason: proposedOwner.reason };
  }
  return { status: "ready-for-baseline-review" };
};
