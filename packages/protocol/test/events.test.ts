import { expect, it } from "vitest";
import { parsePairEvent } from "../src/index.js";
import { createEventFixtures, requiredEventPayloads, toWireEvent } from "./eventFixtures.js";

const fixtures = createEventFixtures();
const events = Object.values(fixtures);
const envelopeFields = ["protocolVersion", "eventId", "commandId", "actor", "revision", "recordedAt", "type"];

it.each(events)("parses version-1 $type without changing its memory shape", event => {
  const wire = toWireEvent(event);
  const parsed = parsePairEvent(wire);

  expect(parsed).toStrictEqual(event);
  expect(parsed).not.toBe(wire);
  expect(Object.isFrozen(parsed)).toBe(true);
  expect(JSON.stringify(parsed)).toBe(JSON.stringify(wire));
});

// Every event schema shares one envelope from createEventSchema, so envelope rows use one type
// while payload requirements stay per type.
it.each([
  ...envelopeFields.map(field => ({ type: "WorkspaceObserved", event: fixtures.WorkspaceObserved, field })),
  ...events.flatMap(event => requiredEventPayloads[event.type].map(field => ({ type: event.type, event, field }))),
])("requires $field in $type", ({ event, field }) => {
  const wire = toWireEvent(event);
  delete wire[field];
  expect(() => parsePairEvent(wire)).toThrow(/^Invalid Pair event:/);
});

it("rejects unknown top-level fields", () => {
  expect(() => parsePairEvent({ ...toWireEvent(fixtures.SessionStarted), extra: "not in the contract" }))
    .toThrow(/^Invalid Pair event:/);
});

it.each([2, "1"])("rejects unsupported version %j", protocolVersion => {
  expect(() => parsePairEvent({ ...toWireEvent(fixtures.SessionStarted), protocolVersion }))
    .toThrow(/^Invalid Pair event:/);
});

it.each([
  ["type", "UnknownEvent"], ["type", "constructor"],
  ["eventId", 1], ["commandId", null], ["actor", "system"],
  ["revision", -1], ["recordedAt", "100"],
])("rejects malformed envelope %s=%j", (field, value) => {
  expect(() => parsePairEvent({ ...fixtures.WorkspaceObserved, [field]: value })).toThrow(/^Invalid Pair event:/);
});

it.each([null, [], "{}"])("rejects a non-event root %j", value => {
  expect(() => parsePairEvent(value)).toThrow(/^Invalid Pair event:/);
});

it.each(["human", "ai", "host", "policy"])("accepts the declared actor %s", actor => {
  const event = { ...createEventFixtures().WorkspaceObserved, actor };
  expect(parsePairEvent(event)).toStrictEqual(event);
});

it("preserves finite clock precision and safe counter boundaries", () => {
  const event = {
    ...createEventFixtures().WorkspaceObserved,
    revision: Number.MAX_SAFE_INTEGER,
    recordedAt: 123.456,
  };
  expect(parsePairEvent(event)).toStrictEqual(event);
  expect(parsePairEvent({ ...event, revision: 0 })).toMatchObject({ revision: 0 });
});

it("normalizes only the declared missing memory fields", () => {
  const fixtures = createEventFixtures();
  const grant = parsePairEvent(toWireEvent(fixtures.UserActionGranted));
  const authorized = parsePairEvent(toWireEvent(fixtures.OperationAuthorized));
  const resumed = parsePairEvent(toWireEvent(fixtures.SessionResumed));
  const observedWire = toWireEvent(fixtures.OperationObserved);
  delete observedWire.observation;
  const observed = parsePairEvent(observedWire);

  expect(Object.hasOwn(grant, "authorityEpoch")).toBe(true);
  expect(grant).toHaveProperty("authorityEpoch", undefined);
  if (authorized.type !== "OperationAuthorized" || resumed.type !== "SessionResumed") {
    throw new Error("Expected operation and resume event fixtures");
  }
  expect(Object.hasOwn(authorized.operation, "summary")).toBe(true);
  expect(Object.hasOwn(authorized.operation, "userActionGrantId")).toBe(true);
  expect(authorized.operation.summary).toBeUndefined();
  expect(authorized.operation.userActionGrantId).toBeUndefined();
  expect(Object.hasOwn(resumed.entry, "branch")).toBe(false);
  expect(Object.hasOwn(observed, "observation")).toBe(false);
});

it("preserves present epoch and operation metadata", () => {
  const fixtures = createEventFixtures();
  const grant = { ...fixtures.UserActionGranted, authorityEpoch: 0 };
  const authorized = {
    ...fixtures.OperationAuthorized,
    operation: { ...fixtures.OperationAuthorized.operation, summary: "", userActionGrantId: "grant-1" },
  };
  expect(parsePairEvent(grant)).toStrictEqual(grant);
  expect(parsePairEvent(authorized)).toStrictEqual(authorized);
});

it.each([undefined, null])("rejects explicit optional wire values %j", value => {
  const fixtures = createEventFixtures();
  expect(() => parsePairEvent({ ...toWireEvent(fixtures.UserActionGranted), authorityEpoch: value }))
    .toThrow(/^Invalid Pair event:/);
  for (const field of ["summary", "userActionGrantId"]) {
    const event = toWireEvent(fixtures.OperationAuthorized);
    event.operation = { ...(event.operation as Record<string, unknown>), [field]: value };
    expect(() => parsePairEvent(event)).toThrow(/^Invalid Pair event:/);
  }
});
