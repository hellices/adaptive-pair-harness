import { durableJournalLimits, parseDurableJournal, type DurableCommit, type DurableJournal } from "@adaptive-pair/protocol";
import { createDurableSnapshot } from "../src/durableSnapshot.js";
import type { DurableReceipt, DurableWriteResult } from "../src/durableStore.js";
import { failModel, modelKey, type ModelView } from "./durableStoreState.js";
import { modelRequestText } from "./durableStoreRequest.js";

export interface PreparedHead {
  readonly journal: DurableJournal;
  readonly text: string;
  readonly cacheText: string;
  readonly receipt: DurableReceipt;
  readonly retiredGenerationKeys: readonly string[];
}

export type PreparedAppend =
  | { readonly kind: "retry"; readonly result: DurableWriteResult }
  | { readonly kind: "head"; readonly head: PreparedHead };

export const modelReceipt = (journal: DurableJournal, commit?: DurableCommit): DurableReceipt => Object.freeze({
  namespaceKey: journal.namespaceKey, generationKey: journal.generationKey,
  commitKey: commit?.commitKey ?? null,
  headSequence: commit === undefined ? 0 : commit.expectedSequence + commit.facts.length,
});

const prepareHead = (journal: DurableJournal, retiredGenerationKeys: readonly string[]): PreparedHead => ({
  journal, text: JSON.stringify(journal), cacheText: JSON.stringify(createDurableSnapshot(journal)),
  receipt: modelReceipt(journal, journal.commits.at(-1)),
  retiredGenerationKeys: Object.freeze([...retiredGenerationKeys]),
});

export const requireGeneration = (view: ModelView, generationKey: string): Extract<ModelView, { state: "present" }> => {
  if (!modelKey(generationKey)) return failModel("INVALID_REQUEST");
  if (view.state !== "present" || view.control.generationKey !== generationKey) return failModel("GENERATION_CONFLICT");
  return view;
};

export const copyModelCommit = (journal: DurableJournal, commit: DurableCommit): DurableCommit => {
  const parsed = parseDurableJournal(modelRequestText(journal, commit));
  const result = parsed.commits[0];
  if (result === undefined) return failModel("INVALID_REQUEST");
  return result;
};

export const prepareModelCreate = (
  view: ModelView, namespaceKey: string, text: string, expectedGenerationKey: string | null,
): PreparedHead => {
  if (view.state === "present") return failModel("HEAD_CONFLICT");
  if (expectedGenerationKey !== null && !modelKey(expectedGenerationKey)) return failModel("INVALID_REQUEST");
  if ((view.state === "empty" && expectedGenerationKey !== null) ||
      (view.state === "erased" && expectedGenerationKey !== view.control.generationKey)) return failModel("GENERATION_CONFLICT");
  const journal = parseDurableJournal(text);
  if (journal.namespaceKey !== namespaceKey) return failModel("BINDING_MISMATCH");
  if (journal.commits.length !== 0 || journal.headSequence !== 0) return failModel("INVALID_REQUEST");
  const retired = view.state === "empty" ? [] : [...view.control.retiredGenerationKeys, view.control.generationKey];
  if (retired.includes(journal.generationKey)) return failModel("GENERATION_CONFLICT");
  if (retired.length > durableJournalLimits.commits) return failModel("LIMIT_EXCEEDED");
  return prepareHead(journal, retired);
};

export const prepareModelAppend = (view: ModelView, generationKey: string, commit: DurableCommit): PreparedAppend => {
  const { journal, control } = requireGeneration(view, generationKey);
  const previous = journal.commits.find(candidate => candidate.commitKey === commit.commitKey);
  if (previous !== undefined) {
    if (JSON.stringify(previous) !== JSON.stringify(commit)) return failModel("IDENTITY_CONFLICT");
    return { kind: "retry", result: Object.freeze({ status: "committed", receipt: modelReceipt(journal, previous) }) };
  }
  const commandKeys = new Set(journal.commits.flatMap(candidate => candidate.commandKeys));
  if (commit.commandKeys.some(key => commandKeys.has(key))) return failModel("IDENTITY_CONFLICT");
  if (commit.expectedSequence !== journal.headSequence) return failModel("HEAD_CONFLICT");
  if (journal.commits.length + 1 > durableJournalLimits.commits ||
      journal.headSequence + commit.facts.length > durableJournalLimits.facts ||
      commandKeys.size + commit.commandKeys.length > durableJournalLimits.commandKeys) return failModel("LIMIT_EXCEEDED");
  const next = parseDurableJournal(JSON.stringify({
    ...journal, headSequence: journal.headSequence + commit.facts.length, commits: [...journal.commits, commit],
  }));
  return { kind: "head", head: prepareHead(next, control.retiredGenerationKeys) };
};
