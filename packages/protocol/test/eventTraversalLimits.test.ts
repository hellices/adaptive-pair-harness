import { expect, it } from "vitest";
import { parsePairCommand, parsePairEvent } from "../src/index.js";
import { createEventFixtures, toWireEvent } from "./eventFixtures.js";

const withObservation = (value: unknown) => ({
  ...toWireEvent(createEventFixtures().OperationObserved), observation: { result: value },
});

const nestedValue = (depth: number): unknown =>
  JSON.parse('{"nested":'.repeat(depth) + "null" + "}".repeat(depth)) as unknown;

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

it("does not impose the event depth budget on existing command inputs", () => {
  const command = {
    protocolVersion: 1, type: "ObserveOperationResult", commandId: "command-1", expectedRevision: 0,
    actor: "host", observedAt: 100, operationId: "op", authorityEpoch: 0,
    status: "confirmed", summary: "Observed", observation: { result: nestedValue(80) },
  };
  expect(parsePairCommand(command)).toStrictEqual(command);
});
