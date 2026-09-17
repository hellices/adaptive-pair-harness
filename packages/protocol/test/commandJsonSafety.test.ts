import { expect, it } from "vitest";
import { parsePairCommand } from "../src/index.js";
import { createEntry, createWorkUnit } from "./commandFixtures.js";

it("returns a deep-frozen clone of accepted commands", () => {
  const workUnit = createWorkUnit();
  const input = {
    protocolVersion: 1,
    commandId: "cmd-4",
    expectedRevision: 0,
    actor: "human",
    type: "ProposeWorkUnit",
    workUnit: {
      ...workUnit,
      allowedPaths: [...workUnit.allowedPaths],
      acceptanceChecks: [...workUnit.acceptanceChecks],
      baseline: { ...workUnit.baseline } as Record<string, string>,
    },
    observedAt: 100,
  };

  const parsed = parsePairCommand(input);

  expect(parsed).not.toBe(input);
  expect(parsed).toEqual(input);
  expect(Object.isFrozen(parsed)).toBe(true);

  if (parsed.type !== "ProposeWorkUnit") {
    throw new Error("Expected ProposeWorkUnit");
  }

  expect(Object.isFrozen(parsed.workUnit)).toBe(true);
  expect(Object.isFrozen(parsed.workUnit.allowedPaths)).toBe(true);
  expect(Object.isFrozen(parsed.workUnit.acceptanceChecks)).toBe(true);
  expect(Object.isFrozen(parsed.workUnit.baseline)).toBe(true);

  input.workUnit.allowedPaths.push("packages/protocol/test");
  input.workUnit.baseline["packages/protocol/src/types.ts"] = "def456";

  expect(parsed.workUnit.allowedPaths).toEqual(["packages/protocol/src"]);
  expect(parsed.workUnit.baseline).toEqual({
    "packages/protocol/src/index.ts": "abc123",
  });
});

it("accepts shared plain data while cloning away identity", () => {
  const sharedPaths = ["packages/protocol/src/index.ts"];
  const command = {
    protocolVersion: 1,
    commandId: "cmd-shared-plain-data",
    expectedRevision: 0,
    actor: "human",
    type: "CaptureEntry",
    entry: {
      workspaceId: "workspace-1",
      dirtyPaths: sharedPaths,
      openPaths: sharedPaths,
      diagnostics: sharedPaths,
      protectedPaths: [".env"],
      capturedAt: 200,
    },
    observedAt: 100,
  } as const;

  const parsed = parsePairCommand(command);

  expect(parsed).toMatchObject(command);
  expect(Object.isFrozen(parsed)).toBe(true);

  if (parsed.type !== "CaptureEntry") {
    throw new Error("Expected CaptureEntry");
  }

  expect(Object.isFrozen(parsed.entry)).toBe(true);
  expect(Object.isFrozen(parsed.entry.dirtyPaths)).toBe(true);
  expect(Object.isFrozen(parsed.entry.openPaths)).toBe(true);
  expect(Object.isFrozen(parsed.entry.diagnostics)).toBe(true);
  expect(Object.isFrozen(parsed.entry.protectedPaths)).toBe(true);

  expect(parsed.entry.dirtyPaths).not.toBe(parsed.entry.openPaths);
  expect(parsed.entry.dirtyPaths).not.toBe(sharedPaths);
  expect(parsed.entry.openPaths).not.toBe(sharedPaths);
  expect(parsed.entry.diagnostics).not.toBe(sharedPaths);

  sharedPaths.push("packages/protocol/test");

  expect(parsed.entry.dirtyPaths).toEqual(["packages/protocol/src/index.ts"]);
  expect(parsed.entry.openPaths).toEqual(["packages/protocol/src/index.ts"]);
  expect(parsed.entry.diagnostics).toEqual(["packages/protocol/src/index.ts"]);
});

it("rejects true cycles and non-plain prototypes before validation", () => {
  const cyclicPaths: unknown[] = ["packages/protocol/src/index.ts"];
  cyclicPaths.push(cyclicPaths);

  expect(() =>
    parsePairCommand({
      protocolVersion: 1,
      commandId: "cmd-cyclic",
      expectedRevision: 0,
      actor: "human",
      type: "CaptureEntry",
      entry: {
        workspaceId: "workspace-1",
        dirtyPaths: cyclicPaths,
        openPaths: ["packages/protocol/test/protocol.test.ts"],
        diagnostics: ["packages/protocol/src/index.ts:1:1 warning"],
        protectedPaths: [".env"],
        capturedAt: 200,
      },
      observedAt: 100,
    }),
  ).toThrow("circular references are not allowed");

  const exoticCommand = Object.create(null) as {
    protocolVersion: number;
    commandId: string;
    expectedRevision: number;
    actor: "human";
    type: "CaptureEntry";
    entry: ReturnType<typeof createEntry>;
    observedAt: number;
  };

  exoticCommand.protocolVersion = 1;
  exoticCommand.commandId = "cmd-exotic";
  exoticCommand.expectedRevision = 0;
  exoticCommand.actor = "human";
  exoticCommand.type = "CaptureEntry";
  exoticCommand.entry = createEntry();
  exoticCommand.observedAt = 100;

  expect(() => parsePairCommand(exoticCommand)).toThrow(
    "only plain objects and arrays are allowed",
  );
});

it("rejects symbol, non-enumerable, and getter entry properties", () => {
  const symbolKey = Symbol("hidden");
  const symbolEntry = createEntry("feature/v2-growth-foundation") as Record<
    string | symbol,
    unknown
  >;
  symbolEntry[symbolKey] = "secret";

  expect(() =>
    parsePairCommand({
      protocolVersion: 1,
      commandId: "cmd-8",
      expectedRevision: 0,
      actor: "human",
      type: "CaptureEntry",
      entry: symbolEntry,
      observedAt: 100,
    }),
  ).toThrow("Invalid Pair command");

  const nonEnumerableEntry = createEntry("feature/v2-growth-foundation");
  Object.defineProperty(nonEnumerableEntry, "hidden", {
    value: "secret",
    enumerable: false,
  });

  expect(() =>
    parsePairCommand({
      protocolVersion: 1,
      commandId: "cmd-9",
      expectedRevision: 0,
      actor: "human",
      type: "CaptureEntry",
      entry: nonEnumerableEntry,
      observedAt: 100,
    }),
  ).toThrow("Invalid Pair command");

  const getterEntry = createEntry("feature/v2-growth-foundation");
  Object.defineProperty(getterEntry, "branch", {
    get: () => "feature/v2-growth-foundation",
    enumerable: true,
  });

  expect(() =>
    parsePairCommand({
      protocolVersion: 1,
      commandId: "cmd-10",
      expectedRevision: 0,
      actor: "human",
      type: "CaptureEntry",
      entry: getterEntry,
      observedAt: 100,
    }),
  ).toThrow("Invalid Pair command");
});

it("clones arrays without invoking an inherited map method", () => {
  const criteria = ["Keep the validated criterion"];
  Object.setPrototypeOf(criteria, { map: () => 42 });

  const parsed = parsePairCommand({
    protocolVersion: 1,
    commandId: "cmd-poisoned-array-map",
    expectedRevision: 0,
    actor: "human",
    type: "ConfirmBrief",
    goal: "Keep validated data intact",
    criteria,
    observedAt: 100,
  });

  if (parsed.type !== "ConfirmBrief") {
    throw new Error("Expected ConfirmBrief");
  }

  expect(parsed.criteria).toEqual(["Keep the validated criterion"]);
  expect(Object.getPrototypeOf(parsed.criteria)).toBe(Array.prototype);
});

it("rejects an enumerable array property outside the JavaScript index range", () => {
  const criteria: string[] = [];
  Object.defineProperty(criteria, "4294967295", {
    value: "must not disappear during cloning",
    enumerable: true,
  });

  expect(() =>
    parsePairCommand({
      protocolVersion: 1,
      commandId: "cmd-array-index-overflow",
      expectedRevision: 0,
      actor: "human",
      type: "ConfirmBrief",
      goal: "Keep validated data intact",
      criteria,
      observedAt: 100,
    }),
  ).toThrow("non-index array property");
});
