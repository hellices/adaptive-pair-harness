import { expect, it } from "vitest";
import { emptyDurableText, generationKey, namespaceKey } from "./durableFixtures.js";
import { freshText, presenceCommit, readyModel, reconstruct } from "./durableStoreFixtures.js";
import { DurableStoreModel } from "./durableStoreModel.js";

const framing = { format: "adaptive-pair-durable", version: 1 } as const;
const fenceFields = ["format", "generationKey", "namespaceKey", "retiredGenerationKeys", "state", "version"];

it("publishes exactly the closed, framed present control and reads it after reconstruction", async () => {
  const { medium } = await readyModel();
  expect(medium.control).toEqual({
    ...framing, state: "present", namespaceKey, generationKey, retiredGenerationKeys: [], headSequence: 0, payloadKey: 1,
  });
  expect(Object.keys(medium.control as object).sort()).toEqual([...fenceFields, "headSequence", "payloadKey"].sort());
  const rebuilt = reconstruct(medium);
  expect(await new DurableStoreModel(namespaceKey, rebuilt).load()).toEqual({ status: "present", text: emptyDurableText() });
});

it("accepts a framed present control with the required empty retirement list on cold reconstruction", async () => {
  const { medium } = await readyModel();
  medium.control = { ...medium.control as object, ...framing, retiredGenerationKeys: [] };
  expect(await new DurableStoreModel(namespaceKey, reconstruct(medium)).load())
    .toEqual({ status: "present", text: emptyDurableText() });
});

it("persists only closed, framed erasing and erased fences across lost acknowledgements", async () => {
  const { medium } = await readyModel();
  expect(await new DurableStoreModel(namespaceKey, medium, { fault: "after-publication" }).erase(generationKey))
    .toEqual({ status: "indeterminate" });
  expect(medium.control).toEqual({ ...framing, state: "erasing", namespaceKey, generationKey, retiredGenerationKeys: [] });
  expect(Object.keys(medium.control as object).sort()).toEqual(fenceFields);
  const rebuilt = reconstruct(medium);
  expect(await new DurableStoreModel(namespaceKey, rebuilt, { fault: "after-erased-publication" }).erase(generationKey))
    .toEqual({ status: "indeterminate" });
  expect(rebuilt.control).toEqual({ ...framing, state: "erased", namespaceKey, generationKey, retiredGenerationKeys: [] });
  expect(Object.keys(rebuilt.control as object).sort()).toEqual(fenceFields);
  const retry = new DurableStoreModel(namespaceKey, reconstruct(rebuilt));
  expect(await retry.load()).toEqual({ status: "erased", generationKey });
  expect(await retry.erase(generationKey)).toEqual({ status: "erased" });
});

const framingDamage: readonly [string, (record: Record<string, unknown>) => void][] = [
  ["missing framing", record => { delete record.format; delete record.version; }],
  ["missing format", record => { delete record.format; }],
  ["wrong format", record => { record.format = "adaptive-pair-journal"; }],
  ["missing version", record => { delete record.version; }],
  ["unsupported version", record => { record.version = 2; }],
  ["non-numeric version", record => { record.version = "1"; }],
  ["missing retirement list", record => { delete record.retiredGenerationKeys; }],
  ["extra field", record => { record.text = "PRIVATE_SENTINEL"; }],
];

it.each((["present", "erasing", "erased"] as const).flatMap(state =>
  framingDamage.map(([label, damage]) => ({ state, label, damage })),
))("blocks $state control with $label after cold reconstruction without overwriting it", async ({ state, damage }) => {
  const { medium, store } = await readyModel();
  if (state === "erasing") await new DurableStoreModel(namespaceKey, medium, { fault: "after-publication" }).erase(generationKey);
  if (state === "erased") await store.erase(generationKey);
  const record: Record<string, unknown> = { ...medium.control as object, ...framing, retiredGenerationKeys: [] };
  damage(record);
  medium.control = record;
  const rebuilt = reconstruct(medium);
  const before = JSON.stringify(rebuilt);
  const reader = new DurableStoreModel(namespaceKey, rebuilt);
  expect(await reader.load()).toEqual({ status: "blocked" });
  expect((await reader.append(generationKey, presenceCommit())).status).toBe("not-committed");
  expect((await reader.create(freshText(), state === "present" ? null : generationKey)).status).toBe("not-committed");
  expect((await reader.erase(generationKey)).status).toBe("not-erased");
  expect(JSON.stringify(rebuilt)).toBe(before);
});
