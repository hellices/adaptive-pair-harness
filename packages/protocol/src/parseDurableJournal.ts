import { durableJournalLimits, type DurableCommit, type DurableJournal } from "./durableTypes.js";
import {
  failDurableJournal, hasDurableFields, isDurableCounter, isDurableKey, readDurableFact,
} from "./durableValidation.js";

interface WireCommit {
  readonly commitKey: string;
  readonly expectedSequence: number;
  readonly commandKeys: readonly string[];
  readonly facts: readonly unknown[];
}

const exceedsByteBudget = (text: string): boolean => {
  let bytes = 0;
  for (const character of text) {
    const code = character.charCodeAt(0);
    bytes += character.length === 2 ? 4 : code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
    if (bytes > durableJournalLimits.encodedBytes) return true;
  }
  return false;
};

const readText = (value: unknown): unknown => {
  if (typeof value !== "string") return failDurableJournal("INVALID_TEXT");
  if (value.length > durableJournalLimits.textCodeUnits) return failDurableJournal("TEXT_LIMIT");
  if (exceedsByteBudget(value)) return failDurableJournal("BYTE_LIMIT");
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return failDurableJournal("INVALID_JSON");
  }
};

const readCommit = (value: unknown): WireCommit => {
  if (!hasDurableFields(value, ["commitKey", "expectedSequence", "commandKeys", "facts"])) {
    return failDurableJournal("INVALID_COMMIT");
  }
  const { commitKey, expectedSequence, commandKeys, facts } = value;
  if (!isDurableKey(commitKey) || !isDurableCounter(expectedSequence) ||
      !Array.isArray(commandKeys) || commandKeys.length === 0 ||
      !Array.isArray(facts) || facts.length === 0) {
    return failDurableJournal("INVALID_COMMIT");
  }
  if (commandKeys.length > durableJournalLimits.commandKeys || facts.length > durableJournalLimits.facts) {
    return failDurableJournal("LIMIT_EXCEEDED");
  }
  if (!commandKeys.every(isDurableKey) || new Set<unknown>(commandKeys).size !== commandKeys.length) {
    return failDurableJournal("INVALID_COMMIT");
  }
  return { commitKey, expectedSequence, commandKeys, facts };
};

const parseCommit = (commit: WireCommit): DurableCommit => Object.freeze({
  commitKey: commit.commitKey,
  expectedSequence: commit.expectedSequence,
  commandKeys: Object.freeze([...commit.commandKeys]),
  facts: Object.freeze(commit.facts.map(readDurableFact)),
});

export const parseDurableJournal = (value: unknown): DurableJournal => {
  const raw = readText(value);
  if (!hasDurableFields(raw, [
    "format", "version", "namespaceKey", "generationKey", "createdAt", "expiresAt", "headSequence", "commits",
  ])) return failDurableJournal("INVALID_ENVELOPE");
  const { format, version, namespaceKey, generationKey, createdAt, expiresAt, headSequence, commits } = raw;
  if (version !== 1) return failDurableJournal("UNSUPPORTED_VERSION");
  if (format !== "adaptive-pair-durable" || !isDurableKey(namespaceKey) || !isDurableKey(generationKey) ||
      !isDurableCounter(createdAt) || !isDurableCounter(expiresAt) ||
      expiresAt <= createdAt || expiresAt - createdAt > durableJournalLimits.lifetimeMs ||
      !isDurableCounter(headSequence) || !Array.isArray(commits) ||
      (commits.length === 0 && headSequence !== 0)) return failDurableJournal("INVALID_ENVELOPE");
  if (commits.length > durableJournalLimits.commits) return failDurableJournal("LIMIT_EXCEEDED");
  const wireCommits = commits.map(readCommit);
  const factCount = wireCommits.reduce((total, commit) => total + commit.facts.length, 0);
  const commandCount = wireCommits.reduce((total, commit) => total + commit.commandKeys.length, 0);
  if (factCount > durableJournalLimits.facts || commandCount > durableJournalLimits.commandKeys) {
    return failDurableJournal("LIMIT_EXCEEDED");
  }
  return Object.freeze({
    format, version, namespaceKey, generationKey, createdAt, expiresAt, headSequence,
    commits: Object.freeze(wireCommits.map(parseCommit)),
  });
};
