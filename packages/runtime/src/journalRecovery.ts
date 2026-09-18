import { parsePairJournal } from "@adaptive-pair/protocol";
import { replayPairJournal } from "./journalReplay.js";
import type { JournalExpectation, JournalRecoveryReport } from "./journalRecoveryTypes.js";

export const inspectPairJournal = (
  value: unknown,
  expectation: JournalExpectation,
): JournalRecoveryReport => {
  const journal = parsePairJournal(value);
  if (journal.streamId !== expectation.streamId) {
    throw new Error("Invalid Pair journal: STREAM_MISMATCH");
  }
  const replay = replayPairJournal(journal);
  const { snapshot } = replay;
  if (snapshot.presence.workspaceId !== expectation.workspaceId) {
    throw new Error("Invalid Pair journal: WORKSPACE_MISMATCH");
  }
  const session = snapshot.session;
  return Object.freeze({
    formatVersion: 1,
    streamId: journal.streamId,
    workspaceId: snapshot.presence.workspaceId,
    headRevision: snapshot.revision,
    commitCount: journal.commits.length,
    eventCount: journal.commits.reduce((count, commit) => count + commit.events.length, 0),
    historicalSession: session === undefined ? undefined : Object.freeze({
      sessionId: session.sessionId,
      startedAtRevision: session.startedAtRevision,
      status: session.status,
    }),
    unsettledOperations: replay.unsettledOperations,
    authorityRestored: false,
    automaticReplayAllowed: false,
  });
};
