import { pairJournalLimits, type PairJournal, type PairJournalCommit } from "./journalTypes.js";
import { parsePairEvent } from "./parseEvent.js";

interface WireCommit {
  readonly expectedRevision: number;
  readonly events: readonly unknown[];
}

const fail = (code: string): never => {
  throw new Error(`Invalid Pair journal: ${code}`);
};

const hasKeys = (
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));

const isCounter = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isIdentifier = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const readText = (value: unknown): unknown => {
  if (typeof value !== "string") return fail("INVALID_TEXT");
  if (value.length > pairJournalLimits.textCodeUnits) return fail("TEXT_LIMIT");
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fail("INVALID_JSON");
  }
};

const readCommit = (value: unknown): WireCommit => {
  if (!hasKeys(value, ["expectedRevision", "events"])) return fail("INVALID_ENVELOPE");
  const { expectedRevision, events } = value;
  if (!isCounter(expectedRevision) || !Array.isArray(events) || events.length === 0) {
    return fail("INVALID_ENVELOPE");
  }
  return { expectedRevision, events };
};

const parseCommit = (commit: WireCommit): PairJournalCommit => {
  try {
    return Object.freeze({
      expectedRevision: commit.expectedRevision,
      events: Object.freeze(commit.events.map(parsePairEvent)),
    });
  } catch {
    return fail("INVALID_EVENT");
  }
};

export const parsePairJournal = (value: unknown): PairJournal => {
  const raw = readText(value);
  if (!hasKeys(raw, ["formatVersion", "streamId", "initialWorkspaceId", "headRevision", "commits"])) {
    return fail("INVALID_ENVELOPE");
  }
  const { formatVersion, streamId, initialWorkspaceId, headRevision, commits } = raw;
  if (formatVersion !== 1) return fail("UNSUPPORTED_JOURNAL_VERSION");
  if (!isIdentifier(streamId) || !isIdentifier(initialWorkspaceId) || !isCounter(headRevision) ||
      !Array.isArray(commits) || commits.length > pairJournalLimits.commits) {
    return fail("INVALID_ENVELOPE");
  }
  if (commits.length === 0 && headRevision !== 0) return fail("INVALID_ENVELOPE");
  const wireCommits = commits.map(readCommit);
  const eventCount = wireCommits.reduce((count, commit) => count + commit.events.length, 0);
  if (eventCount > pairJournalLimits.events) return fail("EVENT_LIMIT");
  return Object.freeze({
    formatVersion,
    streamId,
    initialWorkspaceId,
    headRevision,
    commits: Object.freeze(wireCommits.map(parseCommit)),
  });
};
