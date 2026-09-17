import { expect, it } from "vitest";
import { parsePairCommand, parsePairEvent } from "../src/index.js";
import { createEventFixtures, toWireEvent } from "./eventFixtures.js";

const withObservation = (value: unknown) => ({
  ...toWireEvent(createEventFixtures().OperationObserved), observation: { result: value },
});

const nestedValue = (depth: number): unknown =>
  JSON.parse('{"nested":'.repeat(depth) + "null" + "}".repeat(depth)) as unknown;

const parseWithinOwnCheckBudget = (event: unknown) => {
  const hasOwn = Object.hasOwn;
  let ownChecks = 0;
  try {
    Object.hasOwn = (object, property) => {
      ownChecks += 1;
      if (ownChecks > 20_000) throw new Error("Unbounded own-property traversal");
      return hasOwn(object, property);
    };
    return parsePairEvent(event);
  } finally {
    Object.hasOwn = hasOwn;
  }
};

it("bounds event value depth at 64 with the root at zero", () => {
  expect(() => parsePairEvent(withObservation(nestedValue(62)))).not.toThrow();
  expect(() => parsePairEvent(withObservation(nestedValue(63))))
    .toThrow("Invalid Pair event: maximum JSON depth of 64 exceeded");
});

it("rejects deeply nested parsed JSON without overflowing the call stack", () => {
  expect(() => parsePairEvent(withObservation(nestedValue(4000))))
    .toThrow("Invalid Pair event: maximum JSON depth of 64 exceeded");
});

it("counts every expanded value against the 10,000-node event budget", () => {
  const event = createEventFixtures().WorkspaceObserved;
  const wire = { ...event, type: "OperationObserved", operationId: "op", authorityEpoch: 0,
    status: "confirmed", summary: "Observed", observation: { result: Array.from({ length: 9986 }, () => null) } };
  expect(() => parsePairEvent(wire)).not.toThrow();
  wire.observation.result.push(null);
  expect(() => parsePairEvent(wire))
    .toThrow("Invalid Pair event: maximum expanded JSON node count of 10000 exceeded");
});

it("bounds shared-reference expansion while accepting a small shared graph", () => {
  const buildShared = (depth: number): unknown => {
    let value: unknown = { leaf: null };
    for (let level = 0; level < depth; level += 1) value = { left: value, right: value };
    return value;
  };
  expect(() => parsePairEvent(withObservation(buildShared(4)))).not.toThrow();
  expect(() => parsePairEvent(withObservation(buildShared(16))))
    .toThrow("Invalid Pair event: maximum expanded JSON node count of 10000 exceeded");
});

it.each([
  { prefixLength: 0, reason: "sparse array holes are not allowed at index 0" },
  { prefixLength: 100, reason: "sparse array holes are not allowed at index 100" },
  { prefixLength: 10_000, reason: "maximum expanded JSON node count of 10000 exceeded" },
])("bounds a maximum-length sparse array with $prefixLength populated indices", ({ prefixLength, reason }) => {
  const sparse = Array.from({ length: prefixLength }, () => null);
  sparse.length = 2 ** 32 - 1;
  expect(() => parseWithinOwnCheckBudget(withObservation(sparse))).toThrow(`Invalid Pair event: ${reason}`);
});

it("does not impose the event depth budget on existing command inputs", () => {
  const command = {
    protocolVersion: 1, type: "ObserveOperationResult", commandId: "command-1", expectedRevision: 0,
    actor: "host", observedAt: 100, operationId: "op", authorityEpoch: 0,
    status: "confirmed", summary: "Observed", observation: { result: nestedValue(80) },
  };
  expect(parsePairCommand(command)).toStrictEqual(command);
});
