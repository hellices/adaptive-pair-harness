import { maximumHintLevelForSnapshot } from "@adaptive-pair/harness";
import type { OperationRecord, PairRuntimeSnapshot, PairSessionSnapshot, WorkUnit } from "@adaptive-pair/protocol";

const boundedIdentifier = (identifier: string | undefined): string | undefined =>
  identifier !== undefined && identifier.length > 0 && identifier.length <= 128 &&
  !/[^A-Za-z0-9_-]/u.test(identifier) ? identifier : undefined;

const projectVerification = (session: PairSessionSnapshot) => {
  let latestStatus: OperationRecord["status"] | "not-run" = "not-run";
  let pendingCount = 0;
  for (const operation of session.operations) {
    if (
      operation.toolName !== "pair_run_verification" ||
      operation.workUnitId !== session.workUnit?.id ||
      operation.authorityEpoch !== session.authorityEpoch
    ) {
      continue;
    }
    latestStatus = operation.status;
    if (operation.status === "planned" || operation.status === "authorized" || operation.status === "started") {
      pendingCount += 1;
    }
  }
  return Object.freeze({ latestStatus, pendingCount });
};

const projectWorkUnit = (workUnit: WorkUnit | undefined, identifier: string | undefined) =>
  workUnit === undefined ? undefined : Object.freeze({
    ...(identifier === undefined ? {} : { id: identifier }),
    mode: workUnit.mode,
    owner: workUnit.owner,
    capability: workUnit.capability,
    learningValue: workUnit.learningValue,
    status: workUnit.status,
  });

export const projectModelState = (snapshot: PairRuntimeSnapshot) => {
  const session = snapshot.session;
  const sessionId = boundedIdentifier(session?.sessionId);
  const workUnitId = boundedIdentifier(session?.workUnit?.id);
  return Object.freeze({
    snapshot: Object.freeze({
      protocolVersion: snapshot.protocolVersion,
      revision: snapshot.revision,
      presence: Object.freeze({
        status: snapshot.presence.status,
        observationRevision: snapshot.presence.observationRevision,
      }),
      session: session === undefined ? undefined : Object.freeze({
        ...(sessionId === undefined ? {} : { sessionId }),
        authorityEpoch: session.authorityEpoch,
        status: session.status,
        mode: session.mode,
        workUnit: projectWorkUnit(session.workUnit, workUnitId),
        assistance: Object.freeze({
          maximumHintLevel: maximumHintLevelForSnapshot(snapshot),
          attemptRecorded: session.assistance?.attempt !== undefined,
          hypothesisRecorded: session.assistance?.hypothesis !== undefined,
          solutionRevealed: session.assistance?.solutionReveal !== undefined,
        }),
        verification: projectVerification(session),
      }),
    }),
    partial: (session !== undefined && sessionId === undefined) ||
      (session?.workUnit !== undefined && workUnitId === undefined),
  });
};
