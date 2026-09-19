import { durableJournalLimits } from "@adaptive-pair/protocol";
import { expect, it } from "vitest";
import { durableKey, generationKey, namespaceKey } from "./durableFixtures.js";
import { freshText, modelBarrier, presenceCommit, readJournal, readyModel, reconstruct } from "./durableStoreFixtures.js";
import { DurableStoreModel, type ModelMedium } from "./durableStoreModel.js";

const copyLimit = 1_048_576;
const aggregateLimit = 3_145_728;
const metadataLimit = 37_376;
const encodedSize = (text: string): number => new TextEncoder().encode(text).length;

const assertRetainedBounds = (medium: ModelMedium): void => {
  expect(medium.copies.length).toBeLessThanOrEqual(3);
  for (const kind of ["payload", "cache", "staged"]) {
    expect(medium.copies.filter(copy => copy.kind === kind).length).toBeLessThanOrEqual(1);
  }
  for (const copy of medium.copies) {
    expect(copy.text.length).toBeLessThanOrEqual(copyLimit);
    expect(encodedSize(copy.text)).toBeLessThanOrEqual(copyLimit);
  }
  const codeUnits = medium.copies.reduce((total, copy) => total + copy.text.length, 0);
  const bytes = medium.copies.reduce((total, copy) => total + encodedSize(copy.text), 0);
  expect(codeUnits).toBeLessThanOrEqual(aggregateLimit);
  expect(bytes).toBeLessThanOrEqual(aggregateLimit);
  const metadata = JSON.stringify({ ...medium, copies: medium.copies.map(copy => ({ ...copy, text: "" })) });
  expect(metadata.length).toBeLessThanOrEqual(metadataLimit);
  expect(encodedSize(metadata)).toBeLessThanOrEqual(metadataLimit);
  const serialized = JSON.stringify(medium);
  expect(serialized.length - codeUnits).toBeLessThanOrEqual(5 * codeUnits + metadataLimit);
  expect(encodedSize(serialized) - bytes).toBeLessThanOrEqual(5 * bytes + metadataLimit);
};

const stagedMedium = async (): Promise<ModelMedium> => {
  const { medium } = await readyModel();
  expect(await new DurableStoreModel(namespaceKey, medium, { fault: "before-head-publication" }).append(generationKey, presenceCommit()))
    .toEqual({ status: "indeterminate" });
  return medium;
};

it("retains only one abandoned candidate through repeated pre-head-publication faults and reconstruction", async () => {
  let medium = await stagedMedium();
  const authority = medium.copies.filter(copy => copy.kind !== "staged");
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const request = { ...presenceCommit(), commitKey: durableKey(30_000 + attempt) };
    expect(await new DurableStoreModel(namespaceKey, medium, { fault: "before-head-publication" }).append(generationKey, request))
      .toEqual({ status: "indeterminate" });
    medium = reconstruct(medium);
  }
  assertRetainedBounds(medium);
  expect(medium.copies.filter(copy => copy.kind !== "staged")).toEqual(authority);
  expect((await readJournal(new DurableStoreModel(namespaceKey, medium))).headSequence).toBe(0);
  expect((await new DurableStoreModel(namespaceKey, medium).append(generationKey, presenceCommit())).status).toBe("committed");
  expect(medium.copies.map(copy => copy.kind).sort()).toEqual(["cache", "payload"]);
  assertRetainedBounds(medium);
});

it.each(["acknowledged", "lost acknowledgement"] as const)("replaces derived caches on repeated successful heads with %s", async outcome => {
  const { medium } = await readyModel();
  for (let sequence = 0; sequence < 32; sequence += 1) {
    const store = new DurableStoreModel(namespaceKey, medium, outcome === "acknowledged" ? {} : { fault: "after-publication" });
    expect((await store.append(generationKey, presenceCommit(sequence))).status)
      .toBe(outcome === "acknowledged" ? "committed" : "indeterminate");
  }
  expect(medium.copies.map(copy => copy.kind).sort()).toEqual(["cache", "payload"]);
  const cache = medium.copies.find(copy => copy.kind === "cache");
  expect(JSON.parse(cache?.text ?? "null")).toMatchObject({ headSequence: 32 });
  expect((await readJournal(new DurableStoreModel(namespaceKey, reconstruct(medium)))).headSequence).toBe(32);
  assertRetainedBounds(medium);
});

it("leaves every retained copy and allocation unchanged for ordinary rejected requests", async () => {
  const medium = await stagedMedium();
  const store = new DurableStoreModel(namespaceKey, medium);
  const before = JSON.stringify(medium);
  expect((await store.append(generationKey, { ...presenceCommit(), facts: [] })).status).toBe("not-committed");
  expect(await store.append(generationKey, presenceCommit(1))).toEqual({ status: "not-committed", code: "HEAD_CONFLICT" });
  expect(await store.append(durableKey(99), presenceCommit())).toEqual({ status: "not-committed", code: "GENERATION_CONFLICT" });
  expect(await store.create(freshText(), null)).toEqual({ status: "not-committed", code: "HEAD_CONFLICT" });
  expect(JSON.stringify(medium)).toBe(before);
  medium.nextCopyKey = Number.MAX_SAFE_INTEGER;
  const exhausted = JSON.stringify(medium);
  expect(await store.append(generationKey, presenceCommit())).toEqual({ status: "not-committed", code: "LIMIT_EXCEEDED" });
  expect(JSON.stringify(medium)).toBe(exhausted);
});

it("does not reclaim a winner's cache or staged candidate after losing the final head compare", async () => {
  const medium = await stagedMedium();
  const barrier = modelBarrier("append");
  const late = new DurableStoreModel(namespaceKey, medium, { hook: barrier.hook }).append(generationKey, presenceCommit());
  await barrier.entered;
  const winner = { ...presenceCommit(), commitKey: durableKey(701), commandKeys: [durableKey(702)] };
  expect((await new DurableStoreModel(namespaceKey, medium).append(generationKey, winner)).status).toBe("committed");
  expect(await new DurableStoreModel(namespaceKey, medium, { fault: "before-head-publication" }).append(generationKey, presenceCommit(1)))
    .toEqual({ status: "indeterminate" });
  const before = JSON.stringify(medium);
  barrier.release();
  expect(await late).toEqual({ status: "not-committed", code: "HEAD_CONFLICT" });
  expect(JSON.stringify(medium)).toBe(before);
  assertRetainedBounds(medium);
});

it("does not reclaim copies when the authoritative payload becomes corrupt before final comparison", async () => {
  const medium = await stagedMedium();
  const barrier = modelBarrier("append");
  const pending = new DurableStoreModel(namespaceKey, medium, { hook: barrier.hook }).append(generationKey, presenceCommit());
  await barrier.entered;
  medium.copies = medium.copies.map(copy => copy.kind === "payload" ? { ...copy, text: "corrupt" } : copy);
  const before = JSON.stringify(medium);
  barrier.release();
  expect(await pending).toEqual({ status: "not-committed", code: "HEAD_CONFLICT" });
  expect(JSON.stringify(medium)).toBe(before);
});

it.each(["ASCII", "UTF-8", "escaped"] as const)("enforces exact retained copy and serialization bounds with %s text after reconstruction", async encoding => {
  const medium = await stagedMedium();
  medium.copies = medium.copies.map(copy => ({
    ...copy, text: copy.kind === "payload" ? copy.text.padEnd(copyLimit, " ")
      : encoding === "UTF-8" ? "é".repeat(copyLimit / 2) : (encoding === "escaped" ? "\u0000" : " ").repeat(copyLimit),
  }));
  const rebuilt = reconstruct(medium);
  expect(rebuilt.copies.reduce((total, copy) => total + encodedSize(copy.text), 0)).toBe(aggregateLimit);
  if (encoding !== "UTF-8") expect(rebuilt.copies.reduce((total, copy) => total + copy.text.length, 0)).toBe(aggregateLimit);
  assertRetainedBounds(rebuilt);
  const reader = new DurableStoreModel(namespaceKey, rebuilt);
  expect((await reader.load()).status).toBe("present");
  expect((await reader.append(generationKey, presenceCommit())).status).toBe("committed");
  assertRetainedBounds(rebuilt);
  expect(rebuilt.copies.map(copy => copy.kind).sort()).toEqual(["cache", "payload"]);
});

it.each((["payload", "cache", "staged"] as const).flatMap(kind =>
  (["UTF-16", "UTF-8"] as const).map(encoding => ({ kind, encoding })),
))("refuses an oversized $kind copy in $encoding after reconstruction but permits erasure", async ({ kind, encoding }) => {
  const medium = await stagedMedium();
  medium.copies = medium.copies.map(copy => copy.kind === kind ? {
    ...copy, text: encoding === "UTF-16" ? " ".repeat(copyLimit + 1) : "é".repeat(copyLimit / 2) + "a",
  } : copy);
  const rebuilt = reconstruct(medium);
  const before = JSON.stringify(rebuilt);
  const reader = new DurableStoreModel(namespaceKey, rebuilt);
  expect(await reader.load()).toEqual({ status: "blocked" });
  expect((await reader.append(generationKey, presenceCommit())).status).toBe("not-committed");
  expect((await reader.create(freshText(), null)).status).toBe("not-committed");
  expect(JSON.stringify(rebuilt)).toBe(before);
  expect(await reader.erase(generationKey)).toEqual({ status: "erased" });
  expect(rebuilt.copies).toEqual([]);
  expect(await reader.load()).toEqual({ status: "erased", generationKey });
});

it.each(["payload", "cache", "staged"] as const)("blocks duplicate retained %s slots on cold reconstruction without reclaiming them", async kind => {
  const medium = await stagedMedium();
  medium.copies = medium.copies.filter(copy => copy.kind !== (kind === "staged" ? "cache" : "staged"));
  const original = medium.copies.find(copy => copy.kind === kind);
  if (original === undefined) throw new Error("Expected an owned copy");
  medium.copies.push({ ...original, copyKey: medium.nextCopyKey++ });
  const rebuilt = reconstruct(medium);
  const before = JSON.stringify(rebuilt);
  const reader = new DurableStoreModel(namespaceKey, rebuilt);
  expect(await reader.load()).toEqual({ status: "blocked" });
  expect((await reader.append(generationKey, presenceCommit())).status).toBe("not-committed");
  expect(JSON.stringify(rebuilt)).toBe(before);
  expect(await reader.erase(generationKey)).toEqual({ status: "erased" });
});

it("rejects a fourth retained copy after cold reconstruction instead of silently reclaiming it", async () => {
  const medium = await stagedMedium();
  const staged = medium.copies.find(copy => copy.kind === "staged");
  if (staged === undefined) throw new Error("Expected an abandoned candidate");
  medium.copies.push({ ...staged, copyKey: medium.nextCopyKey++ });
  const rebuilt = reconstruct(medium);
  const before = JSON.stringify(rebuilt);
  const store = new DurableStoreModel(namespaceKey, rebuilt);
  expect(await store.load()).toEqual({ status: "blocked" });
  expect(await store.append(generationKey, presenceCommit())).toEqual({ status: "not-committed", code: "LIMIT_EXCEEDED" });
  expect(JSON.stringify(rebuilt)).toBe(before);
  expect(await store.erase(generationKey)).toEqual({ status: "erased" });
});

it.each(["medium", "copy", "retirement"] as const)("rejects unbounded %s metadata on cold reconstruction", async scope => {
  const { medium } = await readyModel();
  if (scope === "medium") Object.assign(medium, { extra: "unbounded metadata" });
  if (scope === "copy") Object.assign(medium.copies[0] as object, { extra: "unbounded metadata" });
  if (scope === "retirement") medium.control = {
    ...medium.control as object,
    retiredGenerationKeys: Array.from({ length: durableJournalLimits.commits + 1 }, (_, index) => durableKey(50_000 + index)),
  };
  const rebuilt = reconstruct(medium);
  const before = JSON.stringify(rebuilt);
  const store = new DurableStoreModel(namespaceKey, rebuilt);
  expect(await store.load()).toEqual({ status: "blocked" });
  expect((await store.append(generationKey, presenceCommit())).status).toBe("not-committed");
  expect((await store.create(freshText(), null)).status).toBe("not-committed");
  expect(JSON.stringify(rebuilt)).toBe(before);
});

it("allows retirement 1,023 to 1,024, never evicts tokens, and rejects the next replacement unchanged after reconstruction", async () => {
  const { medium, store } = await readyModel();
  const retired = Array.from({ length: durableJournalLimits.commits - 1 }, (_, index) => durableKey(50_000 + index));
  medium.control = { ...medium.control as object, retiredGenerationKeys: retired };
  expect(await store.erase(generationKey)).toEqual({ status: "erased" });
  const lastGeneration = durableKey(90);
  expect((await store.create(freshText(lastGeneration), generationKey)).status).toBe("committed");
  const completeHistory = [...retired, generationKey];
  expect(medium.control).toMatchObject({ retiredGenerationKeys: completeHistory });
  const rebuilt = reconstruct(medium);
  const reader = new DurableStoreModel(namespaceKey, rebuilt);
  expect((await readJournal(reader)).generationKey).toBe(lastGeneration);
  expect((await reader.append(lastGeneration, presenceCommit())).status).toBe("committed");
  expect(await reader.erase(lastGeneration)).toEqual({ status: "erased" });
  const cold = reconstruct(rebuilt);
  const retry = new DurableStoreModel(namespaceKey, cold);
  const before = JSON.stringify(cold);
  expect(await retry.create(freshText(durableKey(91)), lastGeneration)).toEqual({ status: "not-committed", code: "LIMIT_EXCEEDED" });
  for (const oldGeneration of [retired[0], retired.at(-1), generationKey]) {
    if (oldGeneration === undefined) throw new Error("Expected a retired generation");
    expect(await retry.create(freshText(oldGeneration), lastGeneration)).toEqual({ status: "not-committed", code: "GENERATION_CONFLICT" });
    expect(await retry.append(oldGeneration, presenceCommit())).toEqual({ status: "not-committed", code: "GENERATION_CONFLICT" });
  }
  expect(JSON.stringify(cold)).toBe(before);
  expect(cold.control).toMatchObject({ retiredGenerationKeys: completeHistory });
  expect(await retry.load()).toEqual({ status: "erased", generationKey: lastGeneration });
  expect(await retry.erase(lastGeneration)).toEqual({ status: "erased" });
  assertRetainedBounds(cold);
});

it("can fence and erase at retirement, copy, text and allocator capacity even with corrupt payload content", async () => {
  const medium = await stagedMedium();
  const retired = Array.from({ length: durableJournalLimits.commits }, (_, index) => durableKey(50_000 + index));
  medium.control = { ...medium.control as object, retiredGenerationKeys: retired };
  medium.copies = medium.copies.map(copy => ({ ...copy, text: "!".repeat(copyLimit) }));
  medium.nextCopyKey = Number.MAX_SAFE_INTEGER;
  const store = new DurableStoreModel(namespaceKey, medium, { fault: "after-publication" });
  expect(await store.load()).toEqual({ status: "blocked" });
  expect(await store.erase(generationKey)).toEqual({ status: "indeterminate" });
  expect(medium.control).toMatchObject({ state: "erasing", retiredGenerationKeys: retired });
  assertRetainedBounds(medium);
  const rebuilt = reconstruct(medium);
  const reader = new DurableStoreModel(namespaceKey, rebuilt);
  expect(await reader.load()).toEqual({ status: "blocked" });
  expect(await reader.create(freshText(), generationKey)).toEqual({ status: "not-committed", code: "ERASURE_PENDING" });
  expect(await reader.erase(generationKey)).toEqual({ status: "erased" });
  expect(await reader.load()).toEqual({ status: "erased", generationKey });
  expect(rebuilt.copies).toEqual([]);
  expect(rebuilt.control).toMatchObject({ retiredGenerationKeys: retired });
  const before = JSON.stringify(rebuilt);
  expect(await reader.create(freshText(), generationKey)).toEqual({ status: "not-committed", code: "LIMIT_EXCEEDED" });
  expect(JSON.stringify(rebuilt)).toBe(before);
});

it("retains the full history through 1,024 actual replacements and periodic cold reconstruction", async () => {
  let { medium } = await readyModel();
  let currentGeneration = generationKey;
  const retired: string[] = [];
  for (let replacement = 0; replacement < durableJournalLimits.commits; replacement += 1) {
    const store = new DurableStoreModel(namespaceKey, medium);
    expect(await store.erase(currentGeneration)).toEqual({ status: "erased" });
    const nextGeneration = durableKey(60_000 + replacement);
    expect((await store.create(freshText(nextGeneration), currentGeneration)).status).toBe("committed");
    retired.push(currentGeneration);
    currentGeneration = nextGeneration;
    if ((replacement + 1) % 128 === 0) {
      medium = reconstruct(medium);
      expect(medium.control).toMatchObject({ retiredGenerationKeys: retired });
      assertRetainedBounds(medium);
    }
  }
  const store = new DurableStoreModel(namespaceKey, medium);
  expect((await readJournal(store)).generationKey).toBe(currentGeneration);
  expect(await store.erase(currentGeneration)).toEqual({ status: "erased" });
  const before = JSON.stringify(medium);
  expect(await store.create(freshText(durableKey(99_999)), currentGeneration)).toEqual({ status: "not-committed", code: "LIMIT_EXCEEDED" });
  expect(await store.create(freshText(generationKey), currentGeneration)).toEqual({ status: "not-committed", code: "GENERATION_CONFLICT" });
  expect(await store.append(generationKey, presenceCommit())).toEqual({ status: "not-committed", code: "GENERATION_CONFLICT" });
  expect(JSON.stringify(medium)).toBe(before);
  expect(medium.control).toMatchObject({ retiredGenerationKeys: retired });
});
