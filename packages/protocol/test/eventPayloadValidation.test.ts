import { expect, it } from "vitest";
import { parsePairEvent, type PairEvent } from "../src/index.js";
import { createEventFixtures, requiredEventPayloads, toWireEvent } from "./eventFixtures.js";

const fixtures = createEventFixtures();
const nestedPayloads = [
  { type: "EntryCaptured", parent: "entry", optional: ["branch"] },
  { type: "SessionResumed", parent: "entry", optional: ["branch"] },
  { type: "LearningConfirmed", parent: "agreement", optional: [] },
  { type: "WorkUnitProposed", parent: "workUnit", optional: [] },
  { type: "OperationAuthorized", parent: "operation", optional: ["summary", "userActionGrantId"] },
] as const;

const withField = (type: PairEvent["type"], field: string, value: unknown, parent?: string) => {
  const event = toWireEvent(fixtures[type]);
  const target = parent === undefined ? event : event[parent] as Record<string, unknown>;
  target[field] = value;
  return event;
};

it.each(Object.values(fixtures).flatMap(event =>
  requiredEventPayloads[event.type].map(field => ({ type: event.type, field })),
))("rejects null $type.$field", ({ type, field }) => {
  expect(() => parsePairEvent(withField(type, field, null))).toThrow(/^Invalid Pair event:/);
});

it.each(nestedPayloads)("rejects unknown properties in $type.$parent", ({ type, parent }) => {
  expect(() => parsePairEvent(withField(type, "unexpected", true, parent)))
    .toThrow(/^Invalid Pair event:/);
});

it.each(nestedPayloads.flatMap(({ type, parent, optional }) => {
  const event = toWireEvent(fixtures[type]);
  const payload = event[parent] as Record<string, unknown>;
  const optionalFields: readonly string[] = optional;
  return Object.keys(payload).filter(field => !optionalFields.includes(field))
    .map(field => ({ type, parent, field }));
}))("requires $type.$parent.$field with a non-null value", ({ type, parent, field }) => {
  const event = toWireEvent(fixtures[type]);
  delete (event[parent] as Record<string, unknown>)[field];
  expect(() => parsePairEvent(event)).toThrow(/^Invalid Pair event:/);
  expect(() => parsePairEvent(withField(type, field, null, parent)))
    .toThrow(/^Invalid Pair event:/);
});

type EnumCase = {
  readonly type: PairEvent["type"];
  readonly field: string;
  readonly parent?: string;
  readonly values: readonly unknown[];
};

const enumCases: readonly EnumCase[] = [
  { type: "PresenceChanged", field: "status", values: ["off", "observing", "engaged", "quiet", "paused"] },
  { type: "ModeSelected", field: "mode", values: ["growth", "pair", "delivery"] },
  { type: "HintRequested", field: "level", values: [0, 1, 2, 3, 4, 5] },
  { type: "LearningConfirmed", parent: "agreement", field: "maximumHintLevel", values: [0, 1, 2, 3, 4, 5] },
  { type: "WorkUnitProposed", parent: "workUnit", field: "mode", values: ["growth", "pair", "delivery"] },
  { type: "WorkUnitProposed", parent: "workUnit", field: "learningValue", values: ["high", "mixed", "low"] },
  { type: "WorkUnitProposed", parent: "workUnit", field: "owner", values: ["human", "ai"] },
  {
    type: "WorkUnitProposed", parent: "workUnit", field: "capability",
    values: ["problem-framing", "design", "test", "implementation", "diagnosis", "repair", "verification"],
  },
  {
    type: "WorkUnitProposed", parent: "workUnit", field: "status",
    values: ["proposed", "agreed", "executing", "verifying", "completed", "paused", "needs-reconcile", "cancelled", "failed"],
  },
  { type: "OperationAuthorized", parent: "operation", field: "kind", values: ["read", "edit", "check"] },
  {
    type: "OperationAuthorized", parent: "operation", field: "status",
    values: ["planned", "authorized", "started", "confirmed", "failed", "declined", "cancelled", "unknown"],
  },
  {
    type: "OperationObserved", field: "status",
    values: ["confirmed", "failed", "declined", "cancelled", "unknown"],
  },
];

it.each(enumCases.flatMap(entry => entry.values.map(value => ({ ...entry, value }))))(
  "accepts $type.$field=$value without applying runtime policy", ({ type, parent, field, value }) => {
    expect(() => parsePairEvent(withField(type, field, value, parent))).not.toThrow();
  },
);

it.each(enumCases)("rejects an unknown $type.$field", ({ type, parent, field }) => {
  expect(() => parsePairEvent(withField(type, field, "not-a-member", parent)))
    .toThrow(/^Invalid Pair event:/);
});

it.each([
  { type: "AttemptRecorded", field: "bypassed", value: "false" },
  { type: "HypothesisRecorded", field: "bypassed", value: 0 },
  { type: "SolutionRevealAuthorized", field: "previewOnly", value: false },
  { type: "HintRequested", field: "level", value: 6 },
  { type: "HintRequested", field: "level", value: 0.5 },
  { type: "BriefConfirmed", field: "criteria", value: ["valid", 1] },
  { type: "EntryCaptured", parent: "entry", field: "branch", value: null },
  { type: "EntryCaptured", parent: "entry", field: "openPaths", value: [false] },
  { type: "EntryCaptured", parent: "entry", field: "capturedAt", value: "100" },
  { type: "LearningConfirmed", parent: "agreement", field: "humanOwnedCapabilities", value: ["unknown"] },
  { type: "LearningConfirmed", parent: "agreement", field: "maximumHintLevel", value: 7 },
  { type: "LearningConfirmed", parent: "agreement", field: "delegatableWork", value: [2] },
  { type: "WorkUnitProposed", parent: "workUnit", field: "baseline", value: { path: 42 } },
  { type: "WorkUnitProposed", parent: "workUnit", field: "allowedPaths", value: "src" },
  { type: "OperationAuthorized", parent: "operation", field: "input", value: [] },
  { type: "OperationAuthorized", parent: "operation", field: "summary", value: false },
  { type: "OperationAuthorized", parent: "operation", field: "userActionGrantId", value: 1 },
  { type: "OperationObserved", field: "observation", value: [] },
  { type: "OperationObserved", field: "status", value: "started" },
] satisfies (Omit<EnumCase, "values"> & { value: unknown })[])(
  "rejects malformed $type.$field", ({ type, parent, field, value }) => {
    expect(() => parsePairEvent(withField(type, field, value, parent)))
      .toThrow(/^Invalid Pair event:/);
  },
);

const counterFields = [
  { type: "UserActionGranted", field: "runtimeRevision" },
  { type: "UserActionGranted", field: "authorityEpoch" },
  { type: "OperationAuthorized", parent: "operation", field: "runtimeRevision" },
  { type: "OperationAuthorized", parent: "operation", field: "authorityEpoch" },
  { type: "OperationObserved", field: "authorityEpoch" },
  { type: "SessionPaused", field: "authorityEpoch" },
] satisfies Omit<EnumCase, "values">[];

it.each(counterFields)("bounds the $type.$field counter", ({ type, field, parent }) => {
  for (const value of [-1, 1.25, Number.MAX_SAFE_INTEGER + 1, Number.NaN, "1"]) {
    expect(() => parsePairEvent(withField(type, field, value, parent)))
      .toThrow(/^Invalid Pair event:/);
  }
  for (const value of [0, Number.MAX_SAFE_INTEGER]) {
    expect(() => parsePairEvent(withField(type, field, value, parent))).not.toThrow();
  }
});

it("keeps record keys and nested JSON values without inventing a tool schema", () => {
  const input = {
    customToolField: { path: "src/index.ts", nested: [true, null, 1.5, { label: "ok" }] },
    constructor: "ordinary JSON key",
  };
  const authorized = parsePairEvent(withField("OperationAuthorized", "input", input, "operation"));
  expect(authorized).toMatchObject({ operation: { input } });

  const observation = { customResult: { exitCode: 0 }, extensions: ["one", "two"] };
  expect(parsePairEvent(withField("OperationObserved", "observation", observation)))
    .toMatchObject({ observation });
});
