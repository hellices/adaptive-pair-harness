import { expect, it } from "vitest";
import { durableKey, durableWire, emptyDurableText, generationKey, namespaceKey } from "./durableFixtures.js";
import { freshText, presenceCommit, readJournal, readyModel, reconstruct } from "./durableStoreFixtures.js";
import { DurableStoreModel, type ModelMedium } from "./durableStoreModel.js";

const damageHead = (medium: ModelMedium, text: string): void => {
  medium.copies = medium.copies.map(copy => copy.kind === "payload" ? { ...copy, text } : copy);
};

it.each([
  ["missing control", (medium: ModelMedium) => { medium.control = null; }],
  ["corrupt control", (medium: ModelMedium) => { medium.control = "corrupt"; }],
  ["ambiguous control", (medium: ModelMedium) => { medium.control = [medium.control, medium.control]; }],
  ["unknown control fields", (medium: ModelMedium) => { medium.control = { ...medium.control as object, text: "unexpected" }; }],
  ["missing payload", (medium: ModelMedium) => { medium.copies = medium.copies.filter(copy => copy.kind !== "payload"); }],
  ["ambiguous payload", (medium: ModelMedium) => {
    const payload = medium.copies.find(copy => copy.kind === "payload");
    if (payload !== undefined) medium.copies.push({ ...payload });
  }],
  ["corrupt payload", (medium: ModelMedium) => { damageHead(medium, "not JSON"); }],
  ["invalid replay", (medium: ModelMedium) => {
    damageHead(medium, JSON.stringify({ ...durableWire(), commits: [{ ...presenceCommit(), expectedSequence: 2 }], headSequence: 1 }));
  }],
  ["foreign payload", (medium: ModelMedium) => {
    damageHead(medium, JSON.stringify({ ...durableWire(), namespaceKey: durableKey(555) }));
  }],
  ["retired payload", (medium: ModelMedium) => {
    damageHead(medium, JSON.stringify({ ...durableWire(), generationKey: durableKey(556) }));
  }],
  ["head sequence mismatch", (medium: ModelMedium) => {
    medium.control = { ...medium.control as object, headSequence: 99 };
  }],
] as const)("refuses %s rather than falling back to a valid cache or staged copy", async (_label, damage) => {
  const { medium, store } = await readyModel();
  await store.append(generationKey, presenceCommit());
  await new DurableStoreModel(namespaceKey, medium, { fault: "before-head-publication" })
    .append(generationKey, presenceCommit(1));
  damage(medium);
  const rebuilt = reconstruct(medium);
  const before = JSON.stringify(rebuilt);
  const reader = new DurableStoreModel(namespaceKey, rebuilt);
  expect(await reader.load()).toEqual({ status: "blocked" });
  expect((await reader.append(generationKey, presenceCommit())).status).toBe("not-committed");
  expect((await reader.create(freshText(), null)).status).toBe("not-committed");
  expect(JSON.stringify(rebuilt)).toBe(before);
});

it.each(["stale", "corrupt", "missing", "foreign"] as const)("ignores a %s derived cache and reads the full authoritative log", async kind => {
  const { medium, store } = await readyModel();
  const oldCache = medium.copies.find(copy => copy.kind === "cache");
  await store.append(generationKey, presenceCommit());
  medium.copies = medium.copies.filter(copy => copy.kind !== "cache");
  if (kind !== "missing" && oldCache !== undefined) {
    medium.copies.push({
      ...oldCache, copyKey: medium.nextCopyKey++,
      text: kind === "stale" ? oldCache.text : kind === "corrupt" ? "broken" : JSON.stringify({ namespaceKey: durableKey(99) }),
    });
  }
  const reader = new DurableStoreModel(namespaceKey, reconstruct(medium));
  expect((await readJournal(reader)).commits).toEqual([presenceCommit()]);
  expect((await reader.append(generationKey, presenceCommit(1))).status).toBe("committed");
});

it("does not replace a completed fence with an orphaned retired head", async () => {
  const { medium, store } = await readyModel();
  const payload = medium.copies.find(copy => copy.kind === "payload");
  await store.erase(generationKey);
  if (payload === undefined) throw new Error("Expected a payload");
  medium.copies.push(payload);
  const rebuilt = new DurableStoreModel(namespaceKey, reconstruct(medium));
  expect(await rebuilt.load()).toEqual({ status: "blocked" });
  expect(await rebuilt.create(freshText(), generationKey)).toEqual({ status: "not-committed", code: "ERASURE_PENDING" });
  expect(await rebuilt.append(generationKey, presenceCommit())).toEqual({ status: "not-committed", code: "ERASURE_PENDING" });
});

it("never promotes an orphan even when its text is a valid empty generation", async () => {
  const { medium } = await readyModel();
  medium.control = null;
  medium.copies = medium.copies.map(copy => ({ ...copy, kind: "staged", text: emptyDurableText() }));
  const reader = new DurableStoreModel(namespaceKey, reconstruct(medium));
  expect(await reader.load()).toEqual({ status: "blocked" });
  expect(await reader.create(emptyDurableText(), null)).toEqual({ status: "not-committed", code: "HEAD_CONFLICT" });
});
