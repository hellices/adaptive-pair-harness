import type { DurableCommit } from "@adaptive-pair/protocol";
import { expect, it } from "vitest";
import type { DurableStore } from "../src/durableStore.js";
import {
  durableBaseFacts, durableCommit, durableKey, durableWire, emptyDurableText, generationKey, namespaceKey,
} from "./durableFixtures.js";
import { presenceCommit, readJournal, readyModel, reconstruct } from "./durableStoreFixtures.js";
import { DurableStoreModel, modelMedium } from "./durableStoreModel.js";

it("exposes the complete head after create publication loses its acknowledgement", async () => {
  const medium = modelMedium();
  const store = new DurableStoreModel(namespaceKey, medium, { fault: "after-publication" });

  expect(await store.create(emptyDurableText(), null)).toEqual({ status: "indeterminate" });
  expect(await new DurableStoreModel(namespaceKey, medium).load()).toEqual({
    status: "present", text: emptyDurableText(),
  });
});

it("starts empty and creates only an empty, namespace-bound generation", async () => {
  const store: DurableStore = new DurableStoreModel(namespaceKey, modelMedium());
  expect(await store.load()).toEqual({ status: "empty" });
  expect(await store.create(emptyDurableText(), null)).toEqual({
    status: "committed", receipt: { namespaceKey, generationKey, commitKey: null, headSequence: 0 },
  });
  expect((await readJournal(store)).commits).toEqual([]);
});

it("does not auto-create on append or erase an absent generation", async () => {
  const medium = modelMedium();
  const store = new DurableStoreModel(namespaceKey, medium);
  expect(await store.append(generationKey, presenceCommit())).toEqual({
    status: "not-committed", code: "GENERATION_CONFLICT",
  });
  expect(await store.erase(generationKey)).toEqual({ status: "not-erased", code: "GENERATION_CONFLICT" });
  expect(await store.load()).toEqual({ status: "empty" });
});

it("refuses create over a present generation, even for identical text", async () => {
  const { medium, store } = await readyModel();
  const before = JSON.stringify(medium);
  for (const expected of [null, generationKey]) {
    expect(await store.create(emptyDurableText(), expected)).toEqual({
      status: "not-committed", code: "HEAD_CONFLICT",
    });
  }
  expect(JSON.stringify(medium)).toBe(before);
});

it("publishes every fact and command in a batch as one complete head", async () => {
  const { store } = await readyModel();
  const commit = { ...durableCommit(durableBaseFacts), commandKeys: [durableKey(40), durableKey(41)] };
  expect(await store.append(generationKey, commit)).toEqual({
    status: "committed", receipt: { namespaceKey, generationKey, commitKey: commit.commitKey, headSequence: 10 },
  });
  expect(await readJournal(store)).toEqual(durableWire([commit]));
});

it("returns the original canonical retry receipt after a later append and reconstruction", async () => {
  const { medium, store } = await readyModel();
  const original = presenceCommit();
  const receipt = await store.append(generationKey, original);
  expect((await store.append(generationKey, presenceCommit(1))).status).toBe("committed");
  const rebuilt = reconstruct(medium);
  const before = JSON.stringify(rebuilt);
  const canonicalRetry: DurableCommit = {
    facts: [{ status: "engaged", type: "PresenceRecorded" }],
    commandKeys: [...original.commandKeys], expectedSequence: 0, commitKey: original.commitKey,
  };
  expect(await new DurableStoreModel(namespaceKey, rebuilt).append(generationKey, canonicalRetry)).toEqual(receipt);
  expect(JSON.stringify(rebuilt)).toBe(before);
  expect(receipt).toMatchObject({ receipt: { headSequence: 1 } });
});

it.each(["before-publication", "after-publication"] as const)(
  "reconstructs append after %s without duplicate application", async fault => {
    const { medium } = await readyModel();
    const commit = presenceCommit();
    expect(await new DurableStoreModel(namespaceKey, medium, { fault }).append(generationKey, commit))
      .toEqual({ status: "indeterminate" });
    const rebuilt = new DurableStoreModel(namespaceKey, reconstruct(medium));
    expect((await readJournal(rebuilt)).headSequence).toBe(fault === "before-publication" ? 0 : 1);
    const receipt = await rebuilt.append(generationKey, commit);
    expect(receipt).toMatchObject({ status: "committed", receipt: { headSequence: 1 } });
    expect(await rebuilt.append(generationKey, commit)).toEqual(receipt);
    expect((await readJournal(rebuilt)).commits).toEqual([commit]);
  },
);

it("leaves pre-publication create copies blocked rather than promoting an orphan", async () => {
  const medium = modelMedium();
  expect(await new DurableStoreModel(namespaceKey, medium, { fault: "before-publication" })
    .create(emptyDurableText(), null)).toEqual({ status: "indeterminate" });
  const rebuilt = reconstruct(medium);
  expect(rebuilt.copies.some(copy => copy.kind === "staged")).toBe(true);
  const store = new DurableStoreModel(namespaceKey, rebuilt);
  expect(await store.load()).toEqual({ status: "blocked" });
  expect(await store.create(emptyDurableText(), null)).toEqual({ status: "not-committed", code: "HEAD_CONFLICT" });
});

it("freezes results and receipts without exposing mutable deduplication state", async () => {
  const { store } = await readyModel();
  const commit = presenceCommit();
  const first = await store.append(generationKey, commit);
  expect(Object.isFrozen(first)).toBe(true);
  if (first.status !== "committed") throw new Error("Expected a receipt");
  expect(Object.isFrozen(first.receipt)).toBe(true);
  expect(Reflect.set(first.receipt, "headSequence", 999)).toBe(false);
  expect(await store.append(generationKey, commit)).toEqual(first);
  expect(Object.isFrozen(await store.load())).toBe(true);
  expect(Object.isFrozen(await store.create(emptyDurableText(), null))).toBe(true);
  expect(Object.isFrozen(await store.erase(generationKey))).toBe(true);
  expect(Object.isFrozen(await store.load())).toBe(true);
});

it("keeps namespaces and their identities independent", async () => {
  const { medium, store } = await readyModel();
  const otherNamespace = durableKey(80);
  const other = new DurableStoreModel(otherNamespace, modelMedium());
  const text = JSON.stringify({ ...durableWire(), namespaceKey: otherNamespace });
  expect((await other.create(text, null)).status).toBe("committed");
  expect((await other.append(generationKey, presenceCommit())).status).toBe("committed");
  expect((await readJournal(store)).headSequence).toBe(0);
  expect((await store.append(generationKey, presenceCommit())).status).toBe("committed");
  const before = JSON.stringify(medium);
  const wronglyBound = new DurableStoreModel(otherNamespace, medium);
  expect(await wronglyBound.load()).toEqual({ status: "blocked" });
  expect(await wronglyBound.append(generationKey, presenceCommit())).toEqual({
    status: "not-committed", code: "BINDING_MISMATCH",
  });
  expect(await wronglyBound.erase(generationKey)).toEqual({ status: "not-erased", code: "BINDING_MISMATCH" });
  expect(JSON.stringify(medium)).toBe(before);
  await store.erase(generationKey);
  expect((await readJournal(other)).headSequence).toBe(1);
});
