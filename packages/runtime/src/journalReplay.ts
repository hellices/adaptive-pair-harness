import type { PairEvent, PairJournal, PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { createRuntime, reduce } from "@adaptive-pair/session-core";
import type { UnsettledJournalOperation } from "./journalRecoveryTypes.js";

const fail = (code: string): never => {
  throw new Error(`Invalid Pair journal: ${code}`);
};

const rememberOperation = (
  snapshot: PairRuntimeSnapshot,
  event: PairEvent,
  unsettled: Map<string, UnsettledJournalOperation>,
): void => {
  if (event.type !== "OperationAuthorized" && event.type !== "OperationObserved") return;
  const session = snapshot.session;
  if (session === undefined) return fail("INVALID_EVENT_SEQUENCE");
  const operationId = event.type === "OperationAuthorized" ? event.operation.id : event.operationId;
  const operation = session.operations.find(candidate => candidate.id === operationId);
  if (operation === undefined) return fail("INVALID_EVENT_SEQUENCE");
  const key = JSON.stringify([session.startedAtRevision, operationId]);
  const recordedStatus = operation.status;
  if (recordedStatus === "planned" || recordedStatus === "authorized" ||
      recordedStatus === "started" || recordedStatus === "unknown") {
    unsettled.set(key, Object.freeze({
      sessionStartedAtRevision: session.startedAtRevision,
      workspaceId: snapshot.presence.workspaceId,
      operationId,
      kind: operation.kind,
      recordedStatus,
    }));
  } else {
    unsettled.delete(key);
  }
};

export const replayPairJournal = (journal: PairJournal): {
  readonly snapshot: PairRuntimeSnapshot;
  readonly unsettledOperations: readonly UnsettledJournalOperation[];
} => {
  let snapshot = createRuntime(journal.initialWorkspaceId);
  const eventIds = new Set<string>();
  const commandIds = new Set<string>();
  const unsettled = new Map<string, UnsettledJournalOperation>();
  for (const commit of journal.commits) {
    if (commit.expectedRevision !== snapshot.revision) return fail("NON_CONTIGUOUS_REVISION");
    for (const event of commit.events) {
      if (event.revision !== snapshot.revision + 1) return fail("NON_CONTIGUOUS_REVISION");
      if (eventIds.has(event.eventId)) return fail("DUPLICATE_EVENT_ID");
      if (commandIds.has(event.commandId)) return fail("DUPLICATE_COMMAND_ID");
      if (event.type === "BriefConfirmed") return fail("UNSUPPORTED_REPLAY_EVENT");
      try {
        snapshot = reduce(snapshot, [event]);
      } catch {
        return fail("INVALID_EVENT_SEQUENCE");
      }
      rememberOperation(snapshot, event, unsettled);
      eventIds.add(event.eventId);
    }
    for (const event of commit.events) commandIds.add(event.commandId);
  }
  if (snapshot.revision !== journal.headRevision) return fail("HEAD_REVISION_MISMATCH");
  return Object.freeze({
    snapshot,
    unsettledOperations: Object.freeze([...unsettled.values()]),
  });
};
