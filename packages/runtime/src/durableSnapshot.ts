import type { DurableJournal } from "@adaptive-pair/protocol";
import { replayDurableJournal } from "./durableReplay.js";
import type { DurableCacheDisposition, DurableSnapshot } from "./durableTypes.js";

export const createDurableSnapshot = (journal: DurableJournal): DurableSnapshot => Object.freeze({
  format: "adaptive-pair-durable", version: 1,
  namespaceKey: journal.namespaceKey, generationKey: journal.generationKey,
  headSequence: journal.headSequence, state: replayDurableJournal(journal),
});

export const classifyDurableCache = (cacheText: unknown, snapshot: DurableSnapshot): DurableCacheDisposition => {
  if (cacheText === undefined) return "absent";
  return typeof cacheText === "string" && cacheText === JSON.stringify(snapshot) ? "matched" : "discarded";
};
