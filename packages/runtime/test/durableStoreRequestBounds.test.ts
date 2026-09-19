import { durableJournalLimits, type DurableCommit } from "@adaptive-pair/protocol";
import { expect, it, vi } from "vitest";
import { durableKey, durableWire, generationKey, sessionKey } from "./durableFixtures.js";
import { presenceCommit, readyModel } from "./durableStoreFixtures.js";
import { copyModelCommit } from "./durableStorePreparation.js";

const observedGraph = (depth: number, shared: boolean) => {
  const work = { descriptors: 0, enumerations: 0 };
  let value: object = {};
  for (let level = 0; level < depth; level += 1) {
    value = new Proxy(shared ? { left: value, right: value } : { nested: value }, {
      ownKeys(target) { work.enumerations += 1; return Reflect.ownKeys(target); },
      getOwnPropertyDescriptor(target, field) {
        work.descriptors += 1;
        return Reflect.getOwnPropertyDescriptor(target, field);
      },
    });
  }
  return { value, work };
};

const measuredRejection = async (request: unknown, code = "INVALID_REQUEST") => {
  const { medium, store } = await readyModel();
  const before = JSON.stringify(medium);
  const stringify = vi.spyOn(JSON, "stringify");
  let serializations: number;
  try {
    expect.soft(await store.append(generationKey, request as DurableCommit)).toEqual({ status: "not-committed", code });
    serializations = stringify.mock.calls.length;
  } finally {
    stringify.mockRestore();
  }
  expect(JSON.stringify(medium)).toBe(before);
  return serializations;
};

it.each(["root", "fact"] as const)("rejects an extra %s field before visiting an 18-level shared DAG", async location => {
  const graph = observedGraph(18, true);
  const request = location === "root" ? { ...presenceCommit(), extra: graph.value }
    : { ...presenceCommit(), facts: [{ type: "PresenceRecorded", status: "engaged", extra: graph.value }] };
  const serializations = await measuredRejection(request);
  expect.soft(graph.work).toEqual({ descriptors: 0, enumerations: 0 });
  expect(serializations).toBe(0);
});

it.each(["counter", "status", "type", "command"] as const)("does not traverse a deep object in a primitive %s slot", async slot => {
  const graph = observedGraph(512, false);
  const request = slot === "counter" ? { ...presenceCommit(), expectedSequence: graph.value }
    : slot === "command" ? { ...presenceCommit(), commandKeys: [graph.value] }
    : { ...presenceCommit(), facts: [{ type: "PresenceRecorded", status: "engaged", [slot]: graph.value }] };
  const serializations = await measuredRejection(request);
  expect.soft(graph.work).toEqual({ descriptors: 0, enumerations: 0 });
  expect(serializations).toBe(0);
});

it.each(["facts", "commandKeys", "humanOwnedCapabilities"] as const)(
  "rejects oversized %s cardinality before enumerating or reading elements", async field => {
    const limit = field === "facts" ? durableJournalLimits.facts
      : field === "commandKeys" ? durableJournalLimits.commandKeys : 7;
    const work = { elements: 0, enumerations: 0, indexedReads: 0 };
    const values = new Proxy(Array.from({ length: limit + 1 }, () => field === "facts"
      ? { type: "PresenceRecorded", status: "engaged" } : durableKey(500)), {
      ownKeys(target) { work.enumerations += 1; return Reflect.ownKeys(target); },
      get(target, key, receiver): unknown {
        if (typeof key === "string" && /^(0|[1-9][0-9]*)$/u.test(key)) work.indexedReads += 1;
        return Reflect.get(target, key, receiver);
      },
      getOwnPropertyDescriptor(target, key) {
        if (key !== "length") work.elements += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const request = field === "humanOwnedCapabilities" ? {
      ...presenceCommit(), facts: [{ type: "LearningBoundaryRecorded", sessionKey, maximumHintLevel: 3, [field]: values }],
    } : { ...presenceCommit(), [field]: values };
    const serializations = await measuredRejection(request, field === "humanOwnedCapabilities" ? "INVALID_REQUEST" : "LIMIT_EXCEEDED");
    expect.soft(work).toEqual({ elements: 0, enumerations: 0, indexedReads: 0 });
    expect(serializations).toBe(0);
    expect(values.length).toBe(limit + 1);
    expect(values[Symbol.iterator]).toBe(Array.prototype[Symbol.iterator]);
    expect(work).toEqual({ elements: 0, enumerations: 0, indexedReads: 0 });
    expect(values[0]).toBeDefined();
    expect(work).toEqual({ elements: 0, enumerations: 0, indexedReads: 1 });
  },
);

it.each(["commitKey", "type", "status"] as const)("rejects an overlong %s primitive before encoding", async field => {
  const request = field === "commitKey" ? { ...presenceCommit(), commitKey: "a".repeat(33) }
    : { ...presenceCommit(), facts: [{ type: "PresenceRecorded", status: "engaged", [field]: "a".repeat(33) }] };
  expect(await measuredRejection(request)).toBe(0);
});

it("bounds work for a shared graph hidden in a valid field without expanding its encoding", async () => {
  const graph = observedGraph(18, true);
  const serializations = await measuredRejection({ ...presenceCommit(), facts: [graph.value] });
  expect.soft(graph.work.descriptors).toBeLessThanOrEqual(1);
  expect.soft(graph.work.enumerations).toBeLessThanOrEqual(1);
  expect(serializations).toBe(0);
});

it("rejects sparse and extended arrays, nested accessors, prototypes, toJSON, symbols and negative zero without invoking them", async () => {
  let calls = 0;
  const fact = { type: "PresenceRecorded", status: "engaged" };
  const requests = [
    { ...presenceCommit(), facts: new Array<unknown>(1) },
    { ...presenceCommit(), facts: Object.assign([fact], { extra: true }) },
    { ...presenceCommit(), facts: [Object.defineProperty({ ...fact }, "status", { get: () => { calls += 1; return "engaged"; } })] },
    { ...presenceCommit(), facts: [Object.assign(Object.create({ inherited: true }) as object, fact)] },
    { ...presenceCommit(), facts: [Object.assign({ ...fact }, { toJSON: () => { calls += 1; return fact; } })] },
    { ...presenceCommit(), facts: [{ ...fact, [Symbol("extra")]: true }] },
    { ...presenceCommit(), facts: [Object.defineProperty({ ...fact }, "extra", { value: true })] },
    { ...presenceCommit(), expectedSequence: -0 },
  ];
  for (const request of requests) expect(await measuredRejection(request)).toBe(0);
  expect(calls).toBe(0);
});

it("copies a maximum-cardinality shared valid request into canonical, deeply frozen data", () => {
  const sharedFact = { status: "engaged", type: "PresenceRecorded" } as const;
  const request = {
    facts: Array.from({ length: durableJournalLimits.facts }, () => sharedFact),
    commandKeys: Array.from({ length: durableJournalLimits.commandKeys }, (_, index) => durableKey(10_000 + index)),
    expectedSequence: 0, commitKey: durableKey(100),
  };
  const canonical = copyModelCommit(durableWire(), request);
  expect(Object.keys(canonical)).toEqual(["commitKey", "expectedSequence", "commandKeys", "facts"]);
  expect(Object.keys(canonical.facts[0] as object)).toEqual(["type", "status"]);
  expect(Object.isFrozen(canonical)).toBe(true);
  expect(Object.isFrozen(canonical.commandKeys)).toBe(true);
  expect(Object.isFrozen(canonical.facts)).toBe(true);
  expect(canonical.facts.every(Object.isFrozen)).toBe(true);
  expect(canonical.facts[0]).not.toBe(sharedFact);
  expect(canonical.facts[0]).not.toBe(canonical.facts[1]);
  request.commandKeys[0] = durableKey(999);
  expect(canonical.commandKeys[0]).toBe(durableKey(10_000));
});
