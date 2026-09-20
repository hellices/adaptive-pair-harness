import { parseDurableJournal, type DurableCommit, type DurableJournal } from "@adaptive-pair/protocol";
import { expect } from "vitest";
import type { DurableStore } from "../src/durableStore.js";
import { durableCommit, durableKey, durableWire, emptyDurableText, namespaceKey } from "./durableFixtures.js";
import {
  DurableStoreModel, modelMedium, type ModelBoundary, type ModelMedium, type ModelOperation,
} from "./durableStoreModel.js";

export const presenceCommit = (expectedSequence = 0): DurableCommit =>
  durableCommit([{ type: "PresenceRecorded", status: "engaged" }], expectedSequence);

export const freshText = (generationKey = durableKey(90)): string =>
  JSON.stringify({ ...durableWire(), generationKey });

export const reconstruct = (medium: ModelMedium): ModelMedium =>
  JSON.parse(JSON.stringify(medium)) as ModelMedium;

export const readyModel = async () => {
  const medium = modelMedium();
  const store = new DurableStoreModel(namespaceKey, medium);
  expect((await store.create(emptyDurableText(), null)).status).toBe("committed");
  return { medium, store };
};

export const readJournal = async (store: DurableStore): Promise<DurableJournal> => {
  const result = await store.load();
  expect(result.status).toBe("present");
  if (result.status !== "present") throw new Error("Expected an authoritative head");
  return parseDurableJournal(result.text);
};

export const modelBarrier = (operation: ModelOperation, boundary: ModelBoundary = "before-publish") => {
  let signalEntered!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { signalEntered = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  const hook = (currentBoundary: ModelBoundary, currentOperation: ModelOperation): Promise<void> => {
    if (currentBoundary !== boundary || currentOperation !== operation) return Promise.resolve();
    signalEntered();
    return released;
  };
  return { entered, release, hook };
};
