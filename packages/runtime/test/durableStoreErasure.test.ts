import { durableJournalLimits } from "@adaptive-pair/protocol";
import { expect, it } from "vitest";
import {
  durableBaseFacts, durableCommit, durableKey, emptyDurableText, generationKey, namespaceKey,
} from "./durableFixtures.js";
import { freshText, presenceCommit, readJournal, readyModel, reconstruct } from "./durableStoreFixtures.js";
import { DurableStoreModel, type ModelFault } from "./durableStoreModel.js";

it.each<ModelFault>(["after-publication", "during-cleanup", "after-cleanup"])(
  "persists the erasing fence across reconstruction at %s", async fault => {
    const { medium, store } = await readyModel();
    const commit = durableCommit(durableBaseFacts);
    await store.append(generationKey, commit);
    const result = await new DurableStoreModel(namespaceKey, medium, { fault }).erase(generationKey);
    expect(result).toEqual({ status: fault === "after-publication" ? "indeterminate" : "cleanup-pending" });
    expect(medium.control).toMatchObject({ state: "erasing", namespaceKey, generationKey });
    expect(JSON.stringify(medium.control)).not.toContain(commit.commitKey);
    expect(JSON.stringify(medium.control)).not.toContain("facts");
    expect(JSON.stringify(medium.control)).not.toContain("text");
    const rebuilt = reconstruct(medium);
    const retry = new DurableStoreModel(namespaceKey, rebuilt);
    const before = JSON.stringify(rebuilt);
    expect(await retry.load()).toEqual({ status: "blocked" });
    expect(await retry.append(generationKey, commit)).toEqual({ status: "not-committed", code: "ERASURE_PENDING" });
    expect(await retry.append(durableKey(999), presenceCommit())).toEqual({
      status: "not-committed", code: "ERASURE_PENDING",
    });
    for (const expected of [null, generationKey, durableKey(999)]) {
      expect(await retry.create(freshText(), expected)).toEqual({ status: "not-committed", code: "ERASURE_PENDING" });
    }
    expect(await retry.create("invalid", null)).toEqual({ status: "not-committed", code: "ERASURE_PENDING" });
    expect(JSON.stringify(rebuilt)).toBe(before);
    expect(await retry.erase(generationKey)).toEqual({ status: "erased" });
    expect(rebuilt.copies).toEqual([]);
    expect(await retry.load()).toEqual({ status: "erased", generationKey });
    expect((await retry.create(freshText(), generationKey)).status).toBe("committed");
  },
);

it("removes payload, cache and abandoned staged copies before publishing erased", async () => {
  const { medium, store } = await readyModel();
  await store.append(generationKey, presenceCommit());
  await new DurableStoreModel(namespaceKey, medium, { fault: "before-publication" })
    .append(generationKey, presenceCommit(1));
  expect(new Set(medium.copies.map(copy => copy.kind))).toEqual(new Set(["payload", "cache", "staged"]));
  expect(await new DurableStoreModel(namespaceKey, medium, { fault: "during-cleanup" }).erase(generationKey))
    .toEqual({ status: "cleanup-pending" });
  expect(medium.copies.length).toBeGreaterThan(0);
  const rebuilt = reconstruct(medium);
  const retry = new DurableStoreModel(namespaceKey, rebuilt);
  expect(await retry.erase(generationKey)).toEqual({ status: "erased" });
  expect(rebuilt.copies).toEqual([]);
  expect(rebuilt.control).toMatchObject({ state: "erased", namespaceKey, generationKey });
  expect(await retry.erase(generationKey)).toEqual({ status: "erased" });
});

it("resolves a lost final acknowledgement through a verified completed fence", async () => {
  const { medium } = await readyModel();
  expect(await new DurableStoreModel(namespaceKey, medium, { fault: "after-erased-publication" })
    .erase(generationKey)).toEqual({ status: "indeterminate" });
  const rebuilt = reconstruct(medium);
  const store = new DurableStoreModel(namespaceKey, rebuilt);
  expect(rebuilt.copies).toEqual([]);
  expect(await store.load()).toEqual({ status: "erased", generationKey });
  expect(await store.erase(generationKey)).toEqual({ status: "erased" });
  expect((await store.create(freshText(), generationKey)).status).toBe("committed");
});

it("does not trust an erased marker while any owned payload copy survives", async () => {
  const { medium, store } = await readyModel();
  const retained = structuredClone(medium.copies);
  await store.erase(generationKey);
  medium.copies.push(...retained);
  const rebuilt = reconstruct(medium);
  const retry = new DurableStoreModel(namespaceKey, rebuilt);
  expect(await retry.load()).toEqual({ status: "blocked" });
  expect(await retry.create(freshText(), generationKey)).toEqual({ status: "not-committed", code: "ERASURE_PENDING" });
  expect(await retry.append(generationKey, presenceCommit())).toEqual({ status: "not-committed", code: "ERASURE_PENDING" });
  expect(await retry.erase(generationKey)).toEqual({ status: "erased" });
  expect(rebuilt.copies).toEqual([]);
});

it("requires the matching completed generation and a never-used replacement key", async () => {
  const { medium, store } = await readyModel();
  await store.erase(generationKey);
  const before = JSON.stringify(medium);
  for (const expected of [null, durableKey(99)]) {
    expect(await store.create(freshText(), expected)).toEqual({ status: "not-committed", code: "GENERATION_CONFLICT" });
  }
  expect(await store.create(emptyDurableText(), generationKey)).toEqual({
    status: "not-committed", code: "GENERATION_CONFLICT",
  });
  expect(JSON.stringify(medium)).toBe(before);
  const nextGeneration = durableKey(90);
  await store.create(freshText(nextGeneration), generationKey);
  await store.erase(nextGeneration);
  expect(await store.create(emptyDurableText(), nextGeneration)).toEqual({
    status: "not-committed", code: "GENERATION_CONFLICT",
  });
});

it("fences retired exact retries and gives a fresh generation no old command identities", async () => {
  const { medium, store } = await readyModel();
  const commit = durableCommit(durableBaseFacts);
  await store.append(generationKey, commit);
  await store.erase(generationKey);
  expect(await store.append(generationKey, commit)).toEqual({ status: "not-committed", code: "GENERATION_CONFLICT" });
  const nextGeneration = durableKey(90);
  await store.create(freshText(nextGeneration), generationKey);
  expect((await readJournal(store)).commits).toEqual([]);
  expect(JSON.stringify(medium)).not.toContain(commit.commitKey);
  expect(JSON.stringify(medium)).not.toContain(commit.commandKeys[0]);
  expect(await store.append(generationKey, commit)).toEqual({ status: "not-committed", code: "GENERATION_CONFLICT" });
  expect(await store.append(nextGeneration, commit)).toMatchObject({
    status: "committed", receipt: { generationKey: nextGeneration, headSequence: durableBaseFacts.length },
  });
  const before = JSON.stringify(medium);
  expect(await store.erase(generationKey)).toEqual({ status: "not-erased", code: "GENERATION_CONFLICT" });
  expect(JSON.stringify(medium)).toBe(before);
});

it("can write an erasure fence when the generation fact and command budgets are exhausted", async () => {
  const { medium, store } = await readyModel();
  const commit = {
    ...presenceCommit(),
    facts: Array.from({ length: durableJournalLimits.facts }, () => ({ type: "PresenceRecorded", status: "engaged" } as const)),
    commandKeys: Array.from({ length: durableJournalLimits.commandKeys }, (_, index) => durableKey(10_000 + index)),
  };
  expect((await store.append(generationKey, commit)).status).toBe("committed");
  expect(await store.append(generationKey, presenceCommit(durableJournalLimits.facts)))
    .toEqual({ status: "not-committed", code: "LIMIT_EXCEEDED" });
  expect(await store.erase(generationKey)).toEqual({ status: "erased" });
  expect(medium.copies).toEqual([]);
});

it("reconstructs failed replacement staging as pending rather than bypassing the completed fence", async () => {
  const { medium, store } = await readyModel();
  await store.erase(generationKey);
  expect(await new DurableStoreModel(namespaceKey, medium, { fault: "before-publication" })
    .create(freshText(), generationKey)).toEqual({ status: "indeterminate" });
  const rebuilt = reconstruct(medium);
  const retry = new DurableStoreModel(namespaceKey, rebuilt);
  const before = JSON.stringify(rebuilt);
  expect(await retry.load()).toEqual({ status: "blocked" });
  expect(await retry.create(freshText(durableKey(91)), generationKey)).toEqual({
    status: "not-committed", code: "ERASURE_PENDING",
  });
  expect(await retry.append(durableKey(90), presenceCommit())).toEqual({ status: "not-committed", code: "ERASURE_PENDING" });
  expect(JSON.stringify(rebuilt)).toBe(before);
  expect(await retry.erase(generationKey)).toEqual({ status: "erased" });
  expect((await retry.create(freshText(), generationKey)).status).toBe("committed");
});

it("writes only a content-free fence while the authoritative text fills its byte budget", async () => {
  const { medium } = await readyModel();
  medium.copies = medium.copies.map(copy => copy.kind === "payload"
    ? { ...copy, text: copy.text.padEnd(durableJournalLimits.encodedBytes, " ") } : copy);
  expect((await new DurableStoreModel(namespaceKey, medium).load()).status).toBe("present");
  expect(await new DurableStoreModel(namespaceKey, medium, { fault: "after-publication" }).erase(generationKey))
    .toEqual({ status: "indeterminate" });
  expect(Object.keys(medium.control as object).sort())
    .toEqual(["format", "generationKey", "namespaceKey", "retiredGenerationKeys", "state", "version"]);
  const retry = new DurableStoreModel(namespaceKey, reconstruct(medium));
  expect(await retry.load()).toEqual({ status: "blocked" });
  expect(await retry.erase(generationKey)).toEqual({ status: "erased" });
});
