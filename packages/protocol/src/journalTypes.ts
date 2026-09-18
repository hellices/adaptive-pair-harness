import type { PairEvent } from "./events.js";

export const pairJournalLimits = Object.freeze({
  textCodeUnits: 1_048_576,
  commits: 1_024,
  events: 1_024,
});

export interface PairJournalCommit {
  readonly expectedRevision: number;
  readonly events: readonly PairEvent[];
}

export interface PairJournal {
  readonly formatVersion: 1;
  readonly streamId: string;
  readonly initialWorkspaceId: string;
  readonly headRevision: number;
  readonly commits: readonly PairJournalCommit[];
}
