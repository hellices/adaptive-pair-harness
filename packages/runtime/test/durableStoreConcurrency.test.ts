import { expect, it } from "vitest";
import { durableKey, emptyDurableText, generationKey, namespaceKey } from "./durableFixtures.js";
import { freshText, modelBarrier, presenceCommit, readJournal, readyModel } from "./durableStoreFixtures.js";
import { DurableStoreModel, modelMedium } from "./durableStoreModel.js";

it.each(["first", "second"] as const)("allows only the %s released writer to publish at a shared head", async winner => {
  const { medium, store } = await readyModel();
  const firstBarrier = modelBarrier("append");
  const secondBarrier = modelBarrier("append");
  const firstCommit = presenceCommit();
  const secondCommit = { ...presenceCommit(), commitKey: durableKey(70), commandKeys: [durableKey(71)] };
  const first = new DurableStoreModel(namespaceKey, medium, { hook: firstBarrier.hook }).append(generationKey, firstCommit);
  const second = new DurableStoreModel(namespaceKey, medium, { hook: secondBarrier.hook }).append(generationKey, secondCommit);
  await Promise.all([firstBarrier.entered, secondBarrier.entered]);
  expect((await readJournal(store)).headSequence).toBe(0);
  const winningBarrier = winner === "first" ? firstBarrier : secondBarrier;
  const losingBarrier = winner === "first" ? secondBarrier : firstBarrier;
  winningBarrier.release();
  expect((await (winner === "first" ? first : second)).status).toBe("committed");
  losingBarrier.release();
  expect(await (winner === "first" ? second : first)).toEqual({ status: "not-committed", code: "HEAD_CONFLICT" });
  expect((await readJournal(store)).commits).toEqual([winner === "first" ? firstCommit : secondCommit]);
});

it("serializes competing creates instead of replacing the winner", async () => {
  const medium = modelMedium();
  const firstBarrier = modelBarrier("create");
  const secondBarrier = modelBarrier("create");
  const first = new DurableStoreModel(namespaceKey, medium, { hook: firstBarrier.hook }).create(emptyDurableText(), null);
  const second = new DurableStoreModel(namespaceKey, medium, { hook: secondBarrier.hook }).create(freshText(), null);
  await Promise.all([firstBarrier.entered, secondBarrier.entered]);
  firstBarrier.release();
  expect((await first).status).toBe("committed");
  secondBarrier.release();
  expect(await second).toEqual({ status: "not-committed", code: "HEAD_CONFLICT" });
  expect((await readJournal(new DurableStoreModel(namespaceKey, medium))).generationKey).toBe(generationKey);
});

it.each(["pending", "erased", "recreated"] as const)("does not resurrect a %s generation with a late append", async state => {
  const { medium } = await readyModel();
  const barrier = modelBarrier("append");
  const late = new DurableStoreModel(namespaceKey, medium, { hook: barrier.hook }).append(generationKey, presenceCommit());
  await barrier.entered;
  const eraser = new DurableStoreModel(namespaceKey, medium, state === "pending" ? { fault: "during-cleanup" } : {});
  expect((await eraser.erase(generationKey)).status).toBe(state === "pending" ? "cleanup-pending" : "erased");
  if (state === "recreated") expect((await eraser.create(freshText(), generationKey)).status).toBe("committed");
  const before = JSON.stringify(medium);
  barrier.release();
  expect(await late).toEqual({
    status: "not-committed", code: state === "pending" ? "ERASURE_PENDING" : "GENERATION_CONFLICT",
  });
  expect(JSON.stringify(medium)).toBe(before);
  if (state === "recreated") expect((await readJournal(eraser)).headSequence).toBe(0);
  else expect(await eraser.load()).toEqual(state === "pending" ? { status: "blocked" } : { status: "erased", generationKey });
});

it("rechecks the generation before an old exact retry at the compare barrier", async () => {
  const { medium, store } = await readyModel();
  const commit = presenceCommit();
  await store.append(generationKey, commit);
  const barrier = modelBarrier("append", "before-compare");
  const retry = new DurableStoreModel(namespaceKey, medium, { hook: barrier.hook }).append(generationKey, commit);
  await barrier.entered;
  await store.erase(generationKey);
  await store.create(freshText(), generationKey);
  const before = JSON.stringify(medium);
  barrier.release();
  expect(await retry).toEqual({ status: "not-committed", code: "GENERATION_CONFLICT" });
  expect(JSON.stringify(medium)).toBe(before);
});

it("returns one original receipt for two scheduled identical writes after a lost acknowledgement", async () => {
  const { medium, store } = await readyModel();
  const firstBarrier = modelBarrier("append");
  const secondBarrier = modelBarrier("append");
  const commit = presenceCommit();
  const first = new DurableStoreModel(namespaceKey, medium, { hook: firstBarrier.hook, fault: "after-publication" })
    .append(generationKey, commit);
  const second = new DurableStoreModel(namespaceKey, medium, { hook: secondBarrier.hook }).append(generationKey, commit);
  await Promise.all([firstBarrier.entered, secondBarrier.entered]);
  firstBarrier.release();
  expect(await first).toEqual({ status: "indeterminate" });
  await store.append(generationKey, presenceCommit(1));
  secondBarrier.release();
  expect(await second).toEqual({
    status: "committed", receipt: { namespaceKey, generationKey, commitKey: commit.commitKey, headSequence: 1 },
  });
  expect((await readJournal(store)).commits).toHaveLength(2);
});

it("snapshots the validated request before awaiting publication", async () => {
  const { medium, store } = await readyModel();
  const barrier = modelBarrier("append");
  const commit = structuredClone(presenceCommit());
  const pending = new DurableStoreModel(namespaceKey, medium, { hook: barrier.hook }).append(generationKey, commit);
  await barrier.entered;
  Reflect.set(commit, "commandKeys", [durableKey(555)]);
  Reflect.set(commit, "facts", [{ type: "PresenceRecorded", status: "quiet" }]);
  barrier.release();
  expect((await pending).status).toBe("committed");
  expect((await readJournal(store)).commits).toEqual([presenceCommit()]);
});

it("serializes a same-generation append ahead of an erasure paused before fence publication", async () => {
  const { medium, store } = await readyModel();
  const barrier = modelBarrier("erase");
  const erasing = new DurableStoreModel(namespaceKey, medium, { hook: barrier.hook }).erase(generationKey);
  await barrier.entered;
  expect((await store.append(generationKey, presenceCommit())).status).toBe("committed");
  barrier.release();
  expect(await erasing).toEqual({ status: "erased" });
  expect(medium.copies).toEqual([]);
  expect(await store.load()).toEqual({ status: "erased", generationKey });
});

it("does not let a late eraser remove a newly created generation", async () => {
  const { medium, store } = await readyModel();
  const barrier = modelBarrier("erase");
  const late = new DurableStoreModel(namespaceKey, medium, { hook: barrier.hook }).erase(generationKey);
  await barrier.entered;
  await store.erase(generationKey);
  await store.create(freshText(), generationKey);
  const before = JSON.stringify(medium);
  barrier.release();
  expect(await late).toEqual({ status: "not-erased", code: "GENERATION_CONFLICT" });
  expect(JSON.stringify(medium)).toBe(before);
  expect((await readJournal(store)).generationKey).toBe(durableKey(90));
});
