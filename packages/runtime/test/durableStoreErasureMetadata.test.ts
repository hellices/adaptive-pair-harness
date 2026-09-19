import { durableJournalLimits } from "@adaptive-pair/protocol";
import { expect, it } from "vitest";
import { durableKey, generationKey, namespaceKey } from "./durableFixtures.js";
import { modelBarrier, readyModel, reconstruct } from "./durableStoreFixtures.js";
import { DurableStoreModel, type ModelMedium } from "./durableStoreModel.js";

const privateCanary = "PRIVATE_CANARY_RETAINED";
const metadataDamage = ["extra root field", "malformed allocator"] as const;
type MetadataDamage = typeof metadataDamage[number];

const damageMetadata = (medium: ModelMedium, damage: MetadataDamage): void => {
  Object.assign(medium, damage === "extra root field"
    ? { extra: { text: privateCanary } } : { nextCopyKey: { text: privateCanary } });
};

it.each((["present", "erasing", "erased"] as const).flatMap(state =>
  metadataDamage.map(damage => ({ state, damage })),
))("refuses erasure of cold $state state with $damage without modifying it", async ({ state, damage }) => {
  const { medium, store } = await readyModel();
  if (state === "erasing") {
    expect(await new DurableStoreModel(namespaceKey, medium, { fault: "after-publication" }).erase(generationKey))
      .toEqual({ status: "indeterminate" });
  }
  if (state === "erased") expect(await store.erase(generationKey)).toEqual({ status: "erased" });
  damageMetadata(medium, damage);
  const rebuilt = reconstruct(medium);
  const before = JSON.stringify(rebuilt);
  const reader = new DurableStoreModel(namespaceKey, rebuilt);
  expect(before).toContain(privateCanary);
  expect(await reader.load()).toEqual({ status: "blocked" });
  expect(await reader.erase(generationKey)).toEqual({ status: "not-erased", code: "HEAD_CONFLICT" });
  expect(JSON.stringify(rebuilt)).toBe(before);
  expect(await reader.load()).toEqual({ status: "blocked" });
});

it.each(metadataDamage)("revalidates %s at the final erase boundary before publishing a fence", async damage => {
  const { medium } = await readyModel();
  const barrier = modelBarrier("erase");
  const pending = new DurableStoreModel(namespaceKey, medium, { hook: barrier.hook }).erase(generationKey);
  await barrier.entered;
  damageMetadata(medium, damage);
  const before = JSON.stringify(medium);
  barrier.release();
  expect(await pending).toEqual({ status: "not-erased", code: "HEAD_CONFLICT" });
  expect(JSON.stringify(medium)).toBe(before);
  expect(await new DurableStoreModel(namespaceKey, reconstruct(medium)).load()).toEqual({ status: "blocked" });
});

it.each(["corrupt text", "UTF-16 overflow", "UTF-8 overflow", "extra copy metadata", "excess copy count"] as const)(
  "still erases owned %s at safe allocator and retirement capacity after reconstruction", async damage => {
    const { medium } = await readyModel();
    const payload = medium.copies.find(copy => copy.kind === "payload");
    if (payload === undefined) throw new Error("Expected an owned payload");
    if (damage === "extra copy metadata") Object.assign(payload, { extra: { text: privateCanary } });
    else {
      const text = damage === "UTF-16 overflow" ? privateCanary.padEnd(durableJournalLimits.textCodeUnits + 1, " ")
        : damage === "UTF-8 overflow" ? privateCanary + "é".repeat(durableJournalLimits.encodedBytes / 2) : privateCanary;
      medium.copies = medium.copies.map(copy => copy === payload ? { ...copy, text } : copy);
    }
    if (damage === "excess copy count") {
      for (let extraCopy = 0; extraCopy < 2; extraCopy += 1) {
        medium.copies.push({ ...payload, copyKey: medium.nextCopyKey++, text: privateCanary });
      }
    }
    const retired = Array.from({ length: durableJournalLimits.commits }, (_, index) => durableKey(50_000 + index));
    medium.control = { ...medium.control as object, retiredGenerationKeys: retired };
    medium.nextCopyKey = Number.MAX_SAFE_INTEGER;
    const rebuilt = reconstruct(medium);
    const reader = new DurableStoreModel(namespaceKey, rebuilt);
    expect(JSON.stringify(rebuilt)).toContain(privateCanary);
    expect(await reader.load()).toEqual({ status: "blocked" });
    expect(await reader.erase(generationKey)).toEqual({ status: "erased" });
    expect(rebuilt.copies).toEqual([]);
    expect(rebuilt.nextCopyKey).toBe(Number.MAX_SAFE_INTEGER);
    expect(rebuilt.control).toMatchObject({ state: "erased", retiredGenerationKeys: retired });
    expect(JSON.stringify(rebuilt)).not.toContain(privateCanary);
    expect(await new DurableStoreModel(namespaceKey, reconstruct(rebuilt)).load()).toEqual({ status: "erased", generationKey });
  },
);

it("refuses a foreign namespace copy unchanged even when the allocator is at safe capacity", async () => {
  const { medium } = await readyModel();
  medium.copies = medium.copies.map(copy => copy.kind === "payload"
    ? { ...copy, namespaceKey: durableKey(99), text: privateCanary } : copy);
  medium.nextCopyKey = Number.MAX_SAFE_INTEGER;
  const rebuilt = reconstruct(medium);
  const before = JSON.stringify(rebuilt);
  const store = new DurableStoreModel(namespaceKey, rebuilt);
  expect(await store.load()).toEqual({ status: "blocked" });
  expect(await store.erase(generationKey)).toEqual({ status: "not-erased", code: "BINDING_MISMATCH" });
  expect(JSON.stringify(rebuilt)).toBe(before);
});
