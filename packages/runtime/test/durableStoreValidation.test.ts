import { durableJournalLimits, type DurableCommit, type DurableFact } from "@adaptive-pair/protocol";
import { expect, it } from "vitest";
import {
  durableBaseFacts, durableCommit, durableKey, durableWire, emptyDurableText, generationKey,
  namespaceKey, operationKey, sessionKey,
} from "./durableFixtures.js";
import { presenceCommit, readJournal, readyModel } from "./durableStoreFixtures.js";
import { DurableStoreModel, modelMedium } from "./durableStoreModel.js";

it.each([
  ["invalid JSON", "broken", "INVALID_REQUEST"],
  ["wrong namespace", JSON.stringify({ ...durableWire(), namespaceKey: durableKey(99) }), "BINDING_MISMATCH"],
  ["nonempty generation", JSON.stringify(durableWire([presenceCommit()])), "INVALID_REQUEST"],
  ["nonzero empty head", JSON.stringify({ ...durableWire(), headSequence: 1 }), "INVALID_REQUEST"],
  ["unknown envelope field", JSON.stringify({ ...durableWire(), summary: "private" }), "INVALID_REQUEST"],
  ["expired lifetime bound", JSON.stringify({ ...durableWire(), expiresAt: 101 + durableJournalLimits.lifetimeMs }), "INVALID_REQUEST"],
  ["code unit limit", " ".repeat(durableJournalLimits.textCodeUnits) + emptyDurableText(), "LIMIT_EXCEEDED"],
  ["UTF-8 limit", JSON.stringify({ ...durableWire(), summary: "é".repeat(600_000) }), "LIMIT_EXCEEDED"],
] as const)("rejects create with %s without any owned changes", async (_label, text, code) => {
  const medium = modelMedium();
  const before = JSON.stringify(medium);
  const store = new DurableStoreModel(namespaceKey, medium);
  expect(await store.create(text, null)).toEqual({ status: "not-committed", code });
  expect(JSON.stringify(medium)).toBe(before);
});

it("accepts the exact text limit but stores only the closed canonical envelope", async () => {
  const medium = modelMedium();
  const text = emptyDurableText().padEnd(durableJournalLimits.textCodeUnits, " ");
  const store = new DurableStoreModel(namespaceKey, medium);
  expect((await store.create(text, null)).status).toBe("committed");
  expect(await store.load()).toEqual({ status: "present", text: emptyDurableText() });
});

it("does not accept an expected prior generation for a never-owned namespace", async () => {
  const medium = modelMedium();
  const before = JSON.stringify(medium);
  expect(await new DurableStoreModel(namespaceKey, medium).create(emptyDurableText(), generationKey))
    .toEqual({ status: "not-committed", code: "GENERATION_CONFLICT" });
  expect(JSON.stringify(medium)).toBe(before);
});

it.each([
  ["expected head", { ...presenceCommit(), expectedSequence: 1 }, "IDENTITY_CONFLICT"],
  ["command identity", { ...presenceCommit(), commandKeys: [durableKey(444)] }, "IDENTITY_CONFLICT"],
  ["fact payload", { ...presenceCommit(), facts: [{ type: "PresenceRecorded", status: "quiet" }] }, "IDENTITY_CONFLICT"],
  ["unknown fact", { ...presenceCommit(), facts: [{ type: "ExecuteTool", input: "secret" }] }, "INVALID_REQUEST"],
  ["extra retry field", { ...presenceCommit(), input: "secret" }, "INVALID_REQUEST"],
  ["undefined extra field", { ...presenceCommit(), input: undefined }, "INVALID_REQUEST"],
  ["empty facts", { ...presenceCommit(), facts: [] }, "INVALID_REQUEST"],
  ["duplicate commands", { ...presenceCommit(), commandKeys: [durableKey(2_000), durableKey(2_000)] }, "INVALID_REQUEST"],
  ["fractional sequence", { ...presenceCommit(), expectedSequence: 0.5 }, "INVALID_REQUEST"],
] as const)("validates a malformed or changed retry's %s before returning a receipt", async (_label, request, code) => {
  const { medium, store } = await readyModel();
  await store.append(generationKey, presenceCommit());
  await store.append(generationKey, presenceCommit(1));
  const before = JSON.stringify(medium);
  expect(await store.append(generationKey, request as unknown as DurableCommit)).toEqual({ status: "not-committed", code });
  expect(JSON.stringify(medium)).toBe(before);
});

it("does not treat reordered command keys or facts as the same retry", async () => {
  const { medium, store } = await readyModel();
  const commit = { ...durableCommit(durableBaseFacts), commandKeys: [durableKey(66), durableKey(67)] };
  await store.append(generationKey, commit);
  const before = JSON.stringify(medium);
  for (const retry of [
    { ...commit, commandKeys: [...commit.commandKeys].reverse() },
    { ...commit, facts: [...commit.facts].reverse() },
  ]) {
    expect(await store.append(generationKey, retry)).toEqual({ status: "not-committed", code: "IDENTITY_CONFLICT" });
  }
  expect(JSON.stringify(medium)).toBe(before);
});

it("rejects cross-commit command reuse and a stale unseen head without staging", async () => {
  const { medium, store } = await readyModel();
  const original = presenceCommit();
  await store.append(generationKey, original);
  const before = JSON.stringify(medium);
  expect(await store.append(generationKey, { ...presenceCommit(1), commandKeys: original.commandKeys }))
    .toEqual({ status: "not-committed", code: "IDENTITY_CONFLICT" });
  expect(await store.append(generationKey, { ...presenceCommit(), commitKey: durableKey(89), commandKeys: [durableKey(88)] }))
    .toEqual({ status: "not-committed", code: "HEAD_CONFLICT" });
  expect(await store.append(durableKey(91), original)).toEqual({ status: "not-committed", code: "GENERATION_CONFLICT" });
  expect(JSON.stringify(medium)).toBe(before);
});

it("validates every fact and the full revision-zero replay before publishing any of a batch", async () => {
  const { medium, store } = await readyModel();
  const before = JSON.stringify(medium);
  const facts: DurableFact[] = [
    { type: "PresenceRecorded", status: "engaged" },
    { type: "ModeRecorded", sessionKey, mode: "growth" },
  ];
  expect(await store.append(generationKey, durableCommit(facts))).toEqual({ status: "not-committed", code: "INVALID_REQUEST" });
  expect(JSON.stringify(medium)).toBe(before);
  expect((await readJournal(store)).headSequence).toBe(0);
});

it("keeps pending and unknown operations after close and rejects an outcome rewrite", async () => {
  const { medium, store } = await readyModel();
  await store.append(generationKey, durableCommit(durableBaseFacts));
  const ending: DurableFact[] = [
    { type: "OperationOutcomeRecorded", sessionKey, operationKey, status: "unknown" },
    { type: "SessionStatusRecorded", sessionKey, status: "closed" },
  ];
  expect((await store.append(generationKey, durableCommit(ending, 10))).status).toBe("committed");
  const before = JSON.stringify(medium);
  expect(await store.append(generationKey, durableCommit([
    { type: "OperationOutcomeRecorded", sessionKey, operationKey, status: "confirmed" },
  ], 12))).toEqual({ status: "not-committed", code: "INVALID_REQUEST" });
  expect(JSON.stringify(medium)).toBe(before);
});

it.each(["facts", "commandKeys"] as const)("checks the cumulative %s budget before publication", async field => {
  const { medium, store } = await readyModel();
  const commit = {
    ...presenceCommit(),
    [field]: field === "facts"
      ? Array.from({ length: 1_024 }, () => ({ type: "PresenceRecorded", status: "engaged" }))
      : Array.from({ length: 1_024 }, (_, index) => durableKey(10_000 + index)),
  };
  expect((await store.append(generationKey, commit)).status).toBe("committed");
  const before = JSON.stringify(medium);
  expect(await store.append(generationKey, presenceCommit(commit.facts.length)))
    .toEqual({ status: "not-committed", code: "LIMIT_EXCEEDED" });
  expect(JSON.stringify(medium)).toBe(before);
});

it("refuses omitted live fields without leaking them into persisted copies or results", async () => {
  const { medium, store } = await readyModel();
  const before = JSON.stringify(medium);
  for (const field of ["resourcePath", "resourceHash", "diagnosticText", "input", "summary", "eventLog", "snapshot", "v1Id"]) {
    const commit = {
      ...presenceCommit(), facts: [{ type: "PresenceRecorded", status: "engaged", [field]: "PRIVATE_SENTINEL" }],
    } as unknown as DurableCommit;
    expect(await store.append(generationKey, commit)).toEqual({ status: "not-committed", code: "INVALID_REQUEST" });
    expect(JSON.stringify(medium)).toBe(before);
  }
  await store.append(generationKey, durableCommit(durableBaseFacts));
  expect(JSON.stringify(medium)).not.toContain("PRIVATE_SENTINEL");
  expect(JSON.stringify(medium)).not.toMatch(/resourcePath|resourceHash|diagnosticText|eventLog|v1Id/u);
});

it("rejects non-JSON retry inputs instead of normalizing away malformed fields", async () => {
  const { medium, store } = await readyModel();
  const original = presenceCommit();
  await store.append(generationKey, original);
  const before = JSON.stringify(medium);
  const malformed = [
    { ...original, expectedSequence: -0 },
    { ...original, expectedSequence: Number.NaN },
    { ...original, facts: [{ type: "PresenceRecorded", status: "engaged", omitted: undefined }] },
    { ...original, [Symbol("extra")]: true },
    { ...original, toJSON: () => original },
    Object.defineProperty({ ...original }, "facts", { get: () => { throw new Error("Must not invoke a getter"); } }),
  ] as const;
  for (const request of malformed) {
    expect(await store.append(generationKey, request)).toEqual({ status: "not-committed", code: "INVALID_REQUEST" });
  }
  expect(JSON.stringify(medium)).toBe(before);
});

it("does not consume publication faults until every fact has validated", async () => {
  const { medium } = await readyModel();
  const store = new DurableStoreModel(namespaceKey, medium, { fault: "after-publication" });
  const before = JSON.stringify(medium);
  expect(await store.append(generationKey, durableCommit([
    { type: "PresenceRecorded", status: "engaged" },
    { type: "ModeRecorded", sessionKey, mode: "growth" },
  ]))).toEqual({ status: "not-committed", code: "INVALID_REQUEST" });
  expect(JSON.stringify(medium)).toBe(before);
  expect(await store.append(generationKey, presenceCommit())).toEqual({ status: "indeterminate" });
  expect((await readJournal(store)).headSequence).toBe(1);
});

it("keeps the last safe copy allocation readable and fences erasure independently of allocation limits", async () => {
  const { medium, store } = await readyModel();
  medium.nextCopyKey = Number.MAX_SAFE_INTEGER - 2;
  expect((await store.append(generationKey, presenceCommit())).status).toBe("committed");
  expect((await readJournal(store)).headSequence).toBe(1);
  const before = JSON.stringify(medium);
  expect(await store.append(generationKey, presenceCommit(1))).toEqual({ status: "not-committed", code: "LIMIT_EXCEEDED" });
  expect(JSON.stringify(medium)).toBe(before);
  expect(await store.erase(generationKey)).toEqual({ status: "erased" });
  expect(await store.load()).toEqual({ status: "erased", generationKey });
});
