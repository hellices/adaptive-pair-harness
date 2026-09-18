import { expect, it, vi } from "vitest";
import { parsePairEvent } from "../src/index.js";
import { createEventFixtures, toWireEvent } from "./eventFixtures.js";

const withObservation = (value: unknown) => ({
  ...toWireEvent(createEventFixtures().OperationObserved),
  observation: { result: value },
});

it.each([
  ["undefined", undefined], ["NaN", Number.NaN], ["infinity", Number.POSITIVE_INFINITY],
  ["bigint", 1n], ["symbol", Symbol("value")], ["function", () => 1],
  ["date", new Date(0)], ["map", new Map()], ["set", new Set()],
  ["null prototype", Object.create(null) as unknown],
])("rejects non-JSON %s in open records", (_name, value) => {
  expect(() => parsePairEvent(withObservation(value))).toThrow(/^Invalid Pair event:/);
  const event = toWireEvent(createEventFixtures().OperationAuthorized);
  event.operation = { ...(event.operation as Record<string, unknown>), input: { result: value } };
  expect(() => parsePairEvent(event)).toThrow(/^Invalid Pair event:/);
});

it("rejects cycles while accepting repeated references", () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const arrayCycle: unknown[] = [];
  arrayCycle.push(arrayCycle);
  expect(() => parsePairEvent(withObservation(cycle))).toThrow("Invalid Pair event: circular references");
  expect(() => parsePairEvent(withObservation(arrayCycle))).toThrow("Invalid Pair event: circular references");

  const shared = { paths: ["src/index.ts"] };
  const parsed = parsePairEvent(withObservation({ first: shared, second: shared }));
  if (parsed.type !== "OperationObserved") throw new Error("Expected OperationObserved");
  const result = parsed.observation?.result as { first: typeof shared; second: typeof shared };
  expect(result.first).toStrictEqual(shared);
  expect(result.first).not.toBe(shared);
  expect(result.first).not.toBe(result.second);
  expect(result.first.paths).not.toBe(result.second.paths);
  expect(Object.isFrozen(result.first.paths)).toBe(true);
});

it("rejects accessors without invoking them", () => {
  const getter = vi.fn(() => { throw new Error("getter must not run"); });
  const observation = Object.defineProperty({}, "result", { enumerable: true, get: getter });
  expect(() => parsePairEvent(withObservation(observation))).toThrow(/^Invalid Pair event:/);
  const event = Object.defineProperty(createEventFixtures().WorkspaceObserved, "type", {
    enumerable: true, get: getter,
  });
  expect(() => parsePairEvent(event)).toThrow(/^Invalid Pair event:/);
  expect(getter).not.toHaveBeenCalled();
});

it("rejects conversion hooks without invoking them", () => {
  const toJSON = vi.fn(() => { throw new Error("toJSON must not run"); });
  expect(() => parsePairEvent(withObservation({ toJSON }))).toThrow(/^Invalid Pair event:/);
  expect(toJSON).not.toHaveBeenCalled();
});

it("rejects hidden, symbol, and inherited object properties", () => {
  const hidden = Object.defineProperty({ accepted: true }, "secret", { value: "hidden" });
  const symbol = { accepted: true, [Symbol("secret")]: "hidden" };
  const inherited = Object.create({ inherited: true }) as Record<string, unknown>;
  inherited.accepted = true;
  for (const value of [hidden, symbol, inherited]) {
    expect(() => parsePairEvent(withObservation(value))).toThrow(/^Invalid Pair event:/);
  }
});

it("rejects sparse and decorated arrays without reading accessors", () => {
  const sparse = ["valid"];
  sparse.length = 2;
  const decorated = Object.assign(["valid"], { extra: "discarded by JSON" });
  const overflow = Object.assign([], { "4294967295": "outside index range" });
  const hiddenIndex = Object.defineProperty([], "0", { value: "hidden", enumerable: false });
  const symbolIndex = Object.assign(["valid"], { [Symbol("hidden")]: true });
  const getter = vi.fn(() => "do not read");
  const accessorIndex = Object.defineProperty([], "0", { enumerable: true, get: getter });
  for (const value of [sparse, decorated, overflow, hiddenIndex, symbolIndex, accessorIndex]) {
    expect(() => parsePairEvent(withObservation(value))).toThrow(/^Invalid Pair event:/);
  }
  expect(getter).not.toHaveBeenCalled();
});

it("copies array values without inherited methods or conversion hooks", () => {
  const inheritedMethod = vi.fn(() => { throw new Error("inherited hook must not run"); });
  const values = ["accepted", { nested: true }];
  Object.setPrototypeOf(values, { map: inheritedMethod, toJSON: inheritedMethod });
  const parsed = parsePairEvent(withObservation(values));
  if (parsed.type !== "OperationObserved") throw new Error("Expected OperationObserved");
  expect(parsed.observation?.result).toStrictEqual(["accepted", { nested: true }]);
  expect(Object.getPrototypeOf(parsed.observation?.result)).toBe(Array.prototype);
  expect(inheritedMethod).not.toHaveBeenCalled();
});

it("returns a recursively frozen snapshot without freezing or retaining caller data", () => {
  const workUnit = createEventFixtures().WorkUnitProposed;
  const parsed = parsePairEvent(workUnit);
  if (parsed.type !== "WorkUnitProposed") throw new Error("Expected WorkUnitProposed");
  expect(Object.isFrozen(workUnit)).toBe(false);
  expect(Object.isFrozen(workUnit.workUnit)).toBe(false);
  expect(Object.isFrozen(parsed.workUnit)).toBe(true);
  expect(Object.isFrozen(parsed.workUnit.allowedPaths)).toBe(true);
  expect(Object.isFrozen(parsed.workUnit.baseline)).toBe(true);
  workUnit.workUnit.allowedPaths.push("unvalidated/new-path");
  workUnit.workUnit.baseline["packages/protocol/src/index.ts"] = "changed";
  expect(parsed.workUnit.allowedPaths).toStrictEqual(["packages/protocol/src"]);
  expect(parsed.workUnit.baseline["packages/protocol/src/index.ts"]).toBe("abc123");
  expect(() => (parsed.workUnit.allowedPaths as string[]).push("mutation")).toThrow(TypeError);

  const operation = toWireEvent(createEventFixtures().OperationAuthorized);
  const parsedOperation = parsePairEvent(operation);
  if (parsedOperation.type !== "OperationAuthorized") throw new Error("Expected OperationAuthorized");
  expect(Object.isFrozen(parsedOperation.operation)).toBe(true);
  expect(Object.isFrozen(parsedOperation.operation.input)).toBe(true);
  expect(Object.isFrozen(parsedOperation.operation.input.arguments)).toBe(true);
  expect(Object.isFrozen(parsedOperation.operation.input.options)).toBe(true);
});

it("preserves an own __proto__ dictionary key without changing the clone prototype", () => {
  const dictionary = JSON.parse('{"__proto__":{"injected":true},"safe":1}') as Record<string, unknown>;
  const parsed = parsePairEvent(withObservation(dictionary));
  if (parsed.type !== "OperationObserved") throw new Error("Expected OperationObserved");
  const result = parsed.observation?.result as Record<string, unknown>;
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  expect(Object.hasOwn(result, "__proto__")).toBe(true);
  expect(Object.hasOwn(result, "injected")).toBe(false);
  expect(result.__proto__).toStrictEqual({ injected: true });
  expect(Object.isFrozen(result.__proto__)).toBe(true);
  expect(Object.prototype).not.toHaveProperty("injected");
});
