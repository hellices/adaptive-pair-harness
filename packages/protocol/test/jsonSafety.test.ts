import { describe, expect, it, vi } from "vitest";
import { parsePairCommand, parsePairEvent } from "../src/index.js";
import { createWorkUnit } from "./commandFixtures.js";
import { createEventFixtures, toWireEvent } from "./eventFixtures.js";

type Parsed = ReturnType<typeof parsePairCommand> | ReturnType<typeof parsePairEvent>;

const entryPoints = [
  {
    kind: "event",
    parse: (value: unknown): Parsed => parsePairEvent(value),
    withObservation: (value: unknown): Record<string, unknown> => ({
      ...toWireEvent(createEventFixtures().OperationObserved), observation: { result: value },
    }),
    withWorkUnit: () => createEventFixtures().WorkUnitProposed,
  },
  {
    kind: "command",
    parse: (value: unknown): Parsed => parsePairCommand(value),
    withObservation: (value: unknown): Record<string, unknown> => ({
      protocolVersion: 1, commandId: "command-1", expectedRevision: 0, actor: "host",
      type: "ObserveOperationResult", operationId: "operation-1", authorityEpoch: 0,
      status: "confirmed", summary: "Tests passed", observation: { result: value }, observedAt: 100,
    }),
    withWorkUnit: () => ({
      protocolVersion: 1, commandId: "command-1", expectedRevision: 0, actor: "human",
      type: "ProposeWorkUnit", workUnit: createWorkUnit(), observedAt: 100,
    }),
  },
] as const;

const resultOf = (parsed: Parsed): unknown => {
  if (!("observation" in parsed)) throw new Error("Expected an observation");
  return parsed.observation?.result;
};

const expectRejectedBy = (kind: string, parse: (value: unknown) => Parsed, value: unknown, reason: string) => {
  let message = "accepted";
  try {
    parse(value);
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message.startsWith(`Invalid Pair ${kind}: `)).toBe(true);
  expect(message).toContain(reason);
};

// Both parsers share jsonValidationSnapshot and immutableJsonSnapshot; the command entry point
// keeps only the checks that its own wiring (error prefix and returned snapshot) can break.
describe.each(entryPoints)("$kind JSON entry point", ({ kind, parse, withObservation, withWorkUnit }) => {
  it("rejects undefined in open records with its own error prefix", () => {
    expectRejectedBy(kind, parse, withObservation(undefined), "undefined is not allowed");
  });

  it("returns a recursively frozen snapshot without freezing or retaining caller data", () => {
    const input = withWorkUnit();
    const parsed = parse(input);
    if (!("workUnit" in parsed)) throw new Error("Expected a work unit");
    expect(parsed).not.toBe(input);
    expect(parsed).toStrictEqual(input);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.workUnit)).toBe(false);
    const { workUnit } = parsed;
    for (const value of [parsed, workUnit, workUnit.allowedPaths, workUnit.acceptanceChecks, workUnit.baseline]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    input.workUnit.allowedPaths.push("unvalidated/new-path");
    const baseline: Record<string, string> = input.workUnit.baseline;
    baseline["packages/protocol/src/index.ts"] = "changed";
    baseline["packages/protocol/src/types.ts"] = "def456";
    expect(workUnit.allowedPaths).toStrictEqual(["packages/protocol/src"]);
    expect(workUnit.baseline).toStrictEqual({ "packages/protocol/src/index.ts": "abc123" });
    expect(() => (workUnit.allowedPaths as string[]).push("mutation")).toThrow(TypeError);
  });
});

describe("event JSON safety", () => {
  const [{ parse, withObservation }] = entryPoints;
  const expectRejected = (value: unknown, reason: string) => expectRejectedBy("event", parse, value, reason);

  it.each([
    ["NaN", Number.NaN, "non-finite numbers"],
    ["bigint", 1n, "unsupported bigint"],
    ["date", new Date(0), "only plain objects"],
    ["null prototype", Object.create(null) as unknown, "only plain objects"],
  ])("rejects non-JSON %s in open records", (_name, value, reason) => {
    expectRejected(withObservation(value), reason);
  });

  it("rejects cycles while accepting repeated references", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const arrayCycle: unknown[] = ["src/index.ts"];
    arrayCycle.push(arrayCycle);
    expectRejected(withObservation(cycle), "circular references are not allowed");
    expectRejected(withObservation(arrayCycle), "circular references are not allowed");

    const shared = { paths: ["src/index.ts"] };
    const result = resultOf(parse(withObservation({ first: shared, second: shared }))) as {
      first: typeof shared; second: typeof shared;
    };
    expect(result.first).toStrictEqual(shared);
    expect(result.first).not.toBe(shared);
    expect(result.first).not.toBe(result.second);
    expect(result.first.paths).not.toBe(result.second.paths);
    expect(Object.isFrozen(result.first.paths)).toBe(true);
    shared.paths.push("src/added.ts");
    expect(result.second.paths).toStrictEqual(["src/index.ts"]);
  });

  it("rejects accessors without invoking them", () => {
    const getter = vi.fn(() => { throw new Error("getter must not run"); });
    const observation = Object.defineProperty({}, "result", { enumerable: true, get: getter });
    expectRejected(withObservation(observation), "property result must be a plain enumerable data property");
    const root = Object.defineProperty(withObservation(null), "type", { enumerable: true, get: getter });
    expectRejected(root, "property type must be a plain enumerable data property");
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects conversion hooks without invoking them", () => {
    const toJSON = vi.fn(() => { throw new Error("toJSON must not run"); });
    expectRejected(withObservation({ toJSON }), "functions are not allowed");
    expect(toJSON).not.toHaveBeenCalled();
  });

  it("rejects hidden, symbol, and inherited object properties", () => {
    const hidden = Object.defineProperty({ accepted: true }, "secret", { value: "hidden" });
    const symbol = { accepted: true, [Symbol("secret")]: "hidden" };
    const inherited = Object.create({ inherited: true }) as Record<string, unknown>;
    inherited.accepted = true;
    expectRejected(withObservation(hidden), "property secret must be a plain enumerable data property");
    expectRejected(withObservation(symbol), "symbol key Symbol(secret) is not allowed");
    expectRejected(withObservation(inherited), "only plain objects");
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
    expectRejected(withObservation(sparse), "sparse array holes are not allowed at index 1");
    expectRejected(withObservation(decorated), "non-index array property extra");
    expectRejected(withObservation(overflow), "non-index array property 4294967295");
    expectRejected(withObservation(hiddenIndex), "array index 0 must be a plain enumerable data property");
    expectRejected(withObservation(symbolIndex), "symbol key Symbol(hidden) is not allowed");
    expectRejected(withObservation(accessorIndex), "array index 0 must be a plain enumerable data property");
    expect(getter).not.toHaveBeenCalled();
  });

  it("copies array values without inherited methods or conversion hooks", () => {
    const inheritedMethod = vi.fn(() => { throw new Error("inherited hook must not run"); });
    const values = ["accepted", { nested: true }];
    Object.setPrototypeOf(values, { map: inheritedMethod, toJSON: inheritedMethod });
    const result = resultOf(parse(withObservation(values)));
    expect(result).toStrictEqual(["accepted", { nested: true }]);
    expect(Object.getPrototypeOf(result)).toBe(Array.prototype);
    expect(inheritedMethod).not.toHaveBeenCalled();
  });

  it("preserves an own __proto__ dictionary key without changing the clone prototype", () => {
    const dictionary = JSON.parse('{"__proto__":{"injected":true},"safe":1}') as Record<string, unknown>;
    const result = resultOf(parse(withObservation(dictionary))) as Record<string, unknown>;
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(Object.hasOwn(result, "injected")).toBe(false);
    expect(result.__proto__).toStrictEqual({ injected: true });
    expect(Object.isFrozen(result.__proto__)).toBe(true);
    expect(Object.prototype).not.toHaveProperty("injected");
  });
});
