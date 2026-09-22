import { describe, expect, it, vi } from "vitest";
import type { HintLevel, PairRuntimeSnapshot, WorkUnitStatus } from "@adaptive-pair/protocol";
import { growthRuntime } from "@adaptive-pair/testkit";
import {
  createNativeCheckpoint,
  inspectNativeHistory,
  renderNativeHistory,
  type NativeGrowthCheckpoint,
  type NativeHistoryInspection,
} from "../src/nativeCheckpoint.js";

const checkpointFixture = (): NativeGrowthCheckpoint => ({
  format: "adaptive-pair-native-checkpoint", version: 1, mode: "growth",
  workUnitStatus: "agreed", maximumHintLevel: 4, attempt: "none", hypothesis: "none",
  hintLevel: null, solutionRevealed: false,
});

const checkpointFields = Object.keys(checkpointFixture());
const workUnitStatuses: readonly WorkUnitStatus[] = [
  "proposed", "agreed", "executing", "verifying", "completed", "paused",
  "needs-reconcile", "cancelled", "failed",
];
const hintLevels: readonly HintLevel[] = [0, 1, 2, 3, 4, 5];
const response = (checkpoint: unknown, participant = "adaptivePair.chat") => ({
  participant, response: [], result: { metadata: { adaptivePairCheckpoint: checkpoint } },
});
const inspectCheckpoint = (checkpoint: unknown): NativeHistoryInspection =>
  inspectNativeHistory([response(checkpoint)]);

const privateSnapshot = (): PairRuntimeSnapshot => {
  const snapshot = growthRuntime();
  const session = snapshot.session;
  if (session?.workUnit === undefined || session.learningAgreement === undefined) throw new Error("Missing fixture");
  const secret = "private-source-sentinel";
  return {
    ...snapshot, revision: 918273645,
    presence: { ...snapshot.presence, workspaceId: secret, activeSessionId: secret },
    session: {
      ...session, sessionId: secret, startedAtRevision: 918273645, authorityEpoch: 918273645,
      goal: secret, criteria: [secret],
      workUnit: {
        ...session.workUnit, id: secret, objective: secret, allowedPaths: [secret],
        acceptanceChecks: [secret], verificationPlan: secret, stoppingCondition: secret,
        baseline: { [secret]: secret },
      },
      learningAgreement: {
        ...session.learningAgreement, learningGoals: [secret], familiarAreas: [secret],
        delegatableWork: [secret], independentCheck: secret,
      },
      entrySnapshot: {
        workspaceId: secret, branch: secret, dirtyPaths: [secret], openPaths: [secret],
        diagnostics: [secret], protectedPaths: [secret], capturedAt: 918273645,
      },
      assistance: {
        attempt: { summary: secret, bypassed: false, recordedAt: 918273645 },
        hypothesis: { summary: secret, bypassed: true, recordedAt: 918273645 },
        hint: { level: 2, recordedAt: 918273645 },
        solutionReveal: { previewOnly: true, recordedAt: 918273645 },
      },
      operations: [{
        id: secret, workUnitId: secret, toolName: secret, kind: "check", input: { source: secret },
        runtimeRevision: 918273645, authorityEpoch: 918273645, status: "confirmed",
        summary: secret, userActionGrantId: secret,
      }],
      userActionGrants: [{
        id: secret, nativeToolName: secret, runtimeRevision: 918273645,
        authorityEpoch: 918273645, status: "available",
      }],
    },
  };
};

describe("native checkpoint projection", () => {
  it("exports the exact nine-field allowlist without private text or authority", () => {
    const snapshot = privateSnapshot();
    const before = structuredClone(snapshot);
    const checkpoint = createNativeCheckpoint(snapshot);
    expect(checkpoint).toEqual({
      ...checkpointFixture(), attempt: "recorded", hypothesis: "bypassed", hintLevel: 2, solutionRevealed: true,
    });
    expect(Reflect.ownKeys(checkpoint ?? {})).toEqual(checkpointFields);
    expect(JSON.stringify(checkpoint)).not.toContain("private-source-sentinel");
    expect(JSON.stringify(checkpoint)).not.toContain("918273645");
    expect(Buffer.byteLength(JSON.stringify(checkpoint), "utf8")).toBeLessThanOrEqual(512);
    expect(snapshot).toEqual(before);
    expect(Object.isFrozen(checkpoint)).toBe(true);
  });

  it("projects absent assistance as none, null, and false", () => {
    expect(createNativeCheckpoint(growthRuntime())).toEqual(checkpointFixture());
  });

  it.each([false, true])("projects both record flags with bypassed=%s", bypassed => {
    const record = { summary: "private-source-sentinel", bypassed, recordedAt: 123 };
    const checkpoint = createNativeCheckpoint(growthRuntime({ session: {
      assistance: { attempt: record, hypothesis: record, hint: undefined, solutionReveal: undefined },
    } }));
    expect(checkpoint).toEqual({
      ...checkpointFixture(), attempt: bypassed ? "bypassed" : "recorded",
      hypothesis: bypassed ? "bypassed" : "recorded",
    });
  });

  it("does not read private fields when projecting", () => {
    const snapshot = privateSnapshot();
    const getter = vi.fn(() => { throw new Error("Private field read"); });
    Object.defineProperty(snapshot.session?.workUnit, "objective", { get: getter });
    Object.defineProperty(snapshot.session?.workUnit, "baseline", { get: getter });
    Object.defineProperty(snapshot.session?.assistance?.attempt, "summary", { get: getter });
    Object.defineProperty(snapshot.session, "operations", { get: getter });
    expect(createNativeCheckpoint(snapshot)?.attempt).toBe("recorded");
    expect(getter).not.toHaveBeenCalled();
  });
});

describe("native checkpoint admission", () => {
  it.each(["off", "paused"] as const)("rejects %s Presence", status => {
    const snapshot = growthRuntime();
    expect(createNativeCheckpoint({ ...snapshot, presence: { ...snapshot.presence, status } })).toBeUndefined();
  });

  it.each(["inactive", "paused", "closing", "closed"] as const)("rejects a %s session", status => {
    expect(createNativeCheckpoint(growthRuntime({ session: { status } }))).toBeUndefined();
  });

  it.each(["pair", "delivery"] as const)("rejects %s sessions and work units", mode => {
    expect(createNativeCheckpoint(growthRuntime({ session: { mode } }))).toBeUndefined();
    const snapshot = privateSnapshot();
    if (snapshot.session?.workUnit === undefined) throw new Error("Missing fixture");
    expect(createNativeCheckpoint(growthRuntime({ session: {
      workUnit: { ...snapshot.session.workUnit, mode },
    } }))).toBeUndefined();
  });

  it("requires a session, work unit, and learning agreement", () => {
    expect(createNativeCheckpoint({ ...growthRuntime(), session: undefined })).toBeUndefined();
    expect(createNativeCheckpoint(growthRuntime({ session: { workUnit: undefined } }))).toBeUndefined();
    expect(createNativeCheckpoint(growthRuntime({ session: { learningAgreement: undefined } }))).toBeUndefined();
  });

  it.each(["observing", "engaged", "quiet"] as const)("accepts enabled %s Presence", status => {
    const snapshot = growthRuntime();
    expect(createNativeCheckpoint({ ...snapshot, presence: { ...snapshot.presence, status } })).toEqual(checkpointFixture());
  });

  it.each(workUnitStatuses)("preserves the bounded %s work-unit status", status => {
    const snapshot = privateSnapshot();
    if (snapshot.session?.workUnit === undefined) throw new Error("Missing fixture");
    expect(createNativeCheckpoint(growthRuntime({ session: {
      workUnit: { ...snapshot.session.workUnit, status },
    } }))?.workUnitStatus).toBe(status);
  });
});

describe("native checkpoint schema", () => {
  it.each(workUnitStatuses)("accepts the %s work-unit enum", workUnitStatus => {
    const checkpoint = { ...checkpointFixture(), workUnitStatus };
    expect(inspectCheckpoint(checkpoint)).toEqual({ status: "available", checkpoint });
  });

  it.each(hintLevels)("accepts hint boundary %s", hintLevel => {
    const checkpoint = { ...checkpointFixture(), maximumHintLevel: hintLevel, hintLevel };
    expect(inspectCheckpoint(checkpoint)).toEqual({ status: "available", checkpoint });
  });

  it.each(["none", "recorded", "bypassed"] as const)("accepts the %s historical flags", flag => {
    const checkpoint = { ...checkpointFixture(), attempt: flag, hypothesis: flag };
    expect(inspectCheckpoint(checkpoint)).toEqual({ status: "available", checkpoint });
  });

  it("accepts a closed null-prototype record without retaining it", () => {
    const checkpoint: unknown = Object.assign(Object.create(null) as object, checkpointFixture());
    const inspection = inspectCheckpoint(checkpoint);
    expect(inspection).toEqual({ status: "available", checkpoint: checkpointFixture() });
    if (inspection.status !== "available") throw new Error("Missing checkpoint");
    expect(inspection.checkpoint).not.toBe(checkpoint);
    expect(Object.isFrozen(inspection.checkpoint)).toBe(true);
  });

  it.each(checkpointFields)("rejects missing field %s", field => {
    const checkpoint = { ...checkpointFixture() } as Record<string, unknown>;
    delete checkpoint[field];
    expect(inspectCheckpoint(checkpoint)).toEqual({ status: "invalid" });
  });

  it.each([
    ["format", "foreign"], ["version", 0], ["version", 2], ["version", "1"],
    ["mode", "pair"], ["mode", "delivery"], ["workUnitStatus", "active"],
    ["attempt", "passed"], ["attempt", true], ["hypothesis", "verified"],
    ["hypothesis", {}], ["solutionRevealed", 1], ["solutionRevealed", "false"],
    ["hintLevel", undefined], ["hintLevel", "2"], ["maximumHintLevel", null],
    ["workUnitStatus", "私".repeat(513)], ["format", { toString: () => "adaptive-pair-native-checkpoint" }],
  ])("rejects malformed %s=%s", (field, value) => {
    expect(inspectCheckpoint({ ...checkpointFixture(), [field]: value })).toEqual({ status: "invalid" });
  });

  it.each([-1, -0, 6, 1.5, NaN, Infinity, -Infinity, "0", 1n, {}, []])("rejects invalid hint %s", value => {
    for (const field of ["maximumHintLevel", "hintLevel"]) {
      expect(inspectCheckpoint({ ...checkpointFixture(), [field]: value })).toEqual({ status: "invalid" });
    }
  });

  it.each([undefined, null, true, 1, "checkpoint", [], () => checkpointFixture()])("rejects non-record %s", value => {
    expect(inspectCheckpoint(value)).toEqual({ status: "invalid" });
  });
});

describe("native checkpoint closed data descriptors", () => {
  it.each(["extra", "__proto__", Symbol("private"), "toJSON"])("rejects extra key %s without evaluating it", key => {
    const checkpoint = checkpointFixture();
    const getter = vi.fn(() => "private-source-sentinel".repeat(512));
    Object.defineProperty(checkpoint, key, { get: getter });
    expect(inspectCheckpoint(checkpoint)).toEqual({ status: "invalid" });
    expect(getter).not.toHaveBeenCalled();
  });

  it.each(checkpointFields)("rejects accessor field %s without invoking it", field => {
    const checkpoint = checkpointFixture();
    const getter = vi.fn(() => { throw new Error("Accessor invoked"); });
    Object.defineProperty(checkpoint, field, { get: getter });
    expect(inspectCheckpoint(checkpoint)).toEqual({ status: "invalid" });
    expect(getter).not.toHaveBeenCalled();
  });

  it.each(checkpointFields)("rejects non-enumerable field %s", field => {
    const checkpoint = checkpointFixture();
    Object.defineProperty(checkpoint, field, { enumerable: false });
    expect(inspectCheckpoint(checkpoint)).toEqual({ status: "invalid" });
  });

  it("rejects inherited fields, custom prototypes, and throwing inspection traps", () => {
    expect(inspectCheckpoint(Object.create(checkpointFixture()))).toEqual({ status: "invalid" });
    expect(inspectCheckpoint(Object.assign(Object.create({ private: true }) as object, checkpointFixture())))
      .toEqual({ status: "invalid" });
    expect(inspectCheckpoint(new Proxy(checkpointFixture(), {
      ownKeys: () => { throw new Error("private-source-sentinel"); },
    }))).toEqual({ status: "invalid" });
  });
});

describe("native history ownership", () => {
  it("treats absence as a normal empty state", () => {
    expect(inspectNativeHistory([])).toEqual({ status: "missing" });
    expect(inspectNativeHistory([null, undefined, {}, { participant: "adaptivePair.chat", result: {} }]))
      .toEqual({ status: "missing" });
  });

  it("ignores foreign participants, prompt text, response text, and other metadata locations", () => {
    const checkpoint = checkpointFixture();
    expect(inspectNativeHistory([
      response(checkpoint, "foreign.chat"), { participant: "adaptivePair.chat", prompt: JSON.stringify(checkpoint) },
      { participant: "adaptivePair.chat", response: [checkpoint], metadata: { adaptivePairCheckpoint: checkpoint } },
      { participant: "adaptivePair.chat", result: { adaptivePairCheckpoint: checkpoint } },
      { participant: "adaptivePair.chat", result: { metadata: { otherCheckpoint: checkpoint } } },
    ])).toEqual({ status: "missing" });
  });

  it("never evaluates prompt, response content, or a foreign result", () => {
    const getter = vi.fn(() => { throw new Error("Private history read"); });
    const owned = response(checkpointFixture());
    Object.defineProperty(owned, "prompt", { get: getter });
    Object.defineProperty(owned, "response", { get: getter });
    const foreign = { participant: "foreign.chat" };
    Object.defineProperty(foreign, "result", { get: getter });
    expect(inspectNativeHistory([owned, foreign]).status).toBe("available");
    expect(getter).not.toHaveBeenCalled();
  });

  it.each(["result", "metadata", "adaptivePairCheckpoint"])("rejects an owned %s accessor without fallback", field => {
    const newest = response(checkpointFixture());
    const target = field === "result" ? newest : field === "metadata" ? newest.result : newest.result.metadata;
    const getter = vi.fn(() => { throw new Error("Accessor invoked"); });
    Object.defineProperty(target, field, { get: getter });
    expect(inspectNativeHistory([response(checkpointFixture()), newest])).toEqual({ status: "invalid" });
    expect(getter).not.toHaveBeenCalled();
  });

  it("does not use inherited metadata or accessor-based ownership", () => {
    const getter = vi.fn(() => "adaptivePair.chat");
    const turn = response(checkpointFixture());
    Object.defineProperty(turn, "participant", { get: getter });
    const metadata: unknown = Object.create({ adaptivePairCheckpoint: checkpointFixture() });
    expect(inspectNativeHistory([turn, {
      participant: "adaptivePair.chat", result: { metadata },
    }])).toEqual({ status: "missing" });
    expect(getter).not.toHaveBeenCalled();
  });
});

describe("native history recency and bounds", () => {
  it("chooses the newest owned checkpoint, skipping turns without an owned record", () => {
    const newest = { ...checkpointFixture(), hintLevel: 3 };
    expect(inspectNativeHistory([
      response(checkpointFixture()), response(newest), response(undefined, "foreign.chat"),
      { participant: "adaptivePair.chat", prompt: "private-source-sentinel" },
      { participant: "adaptivePair.chat", result: { metadata: {} } },
    ])).toEqual({ status: "available", checkpoint: newest });
  });

  it.each([undefined, null, { ...checkpointFixture(), version: 2 }, { ...checkpointFixture(), extra: true }])(
    "never falls back past an invalid newest owned checkpoint %s", checkpoint => {
      expect(inspectNativeHistory([response(checkpointFixture()), response(checkpoint)])).toEqual({ status: "invalid" });
    },
  );

  it("counts all turns, not just owned responses, toward the latest 32", () => {
    const fillers = Array.from({ length: 32 }, (_, index) => index % 2 === 0
      ? { participant: "adaptivePair.chat", prompt: "request" }
      : response(checkpointFixture(), "foreign.chat"));
    expect(inspectNativeHistory([response(checkpointFixture()), ...fillers])).toEqual({ status: "missing" });
    expect(inspectNativeHistory([response(checkpointFixture()), ...fillers.slice(1)]).status).toBe("available");
    expect(inspectNativeHistory([response(undefined), ...fillers])).toEqual({ status: "missing" });
  });

  it("does not access turns outside the latest 32", () => {
    const history: unknown[] = [undefined, ...Array.from({ length: 32 }, () => ({}))];
    const getter = vi.fn(() => { throw new Error("Old history accessed"); });
    Object.defineProperty(history, "0", { get: getter });
    expect(inspectNativeHistory(history)).toEqual({ status: "missing" });
    expect(getter).not.toHaveBeenCalled();
  });
});

describe("native history presentation is non-authorizing", () => {
  it("renders empty and invalid states without exposing rejected data", () => {
    expect(renderNativeHistory({ status: "missing" })).toContain("No checkpoint");
    const invalid = renderNativeHistory({ status: "invalid" });
    expect(invalid).toContain("unavailable");
    expect(invalid).toContain("Older checkpoints are not used");
    expect(renderNativeHistory(inspectCheckpoint({ private: "private-source-sentinel" }))).not.toContain("private-source-sentinel");
  });

  it("renders a bounded deterministic historical report, not live state or verified evidence", () => {
    const inspection = inspectCheckpoint(createNativeCheckpoint(privateSnapshot()));
    const report = renderNativeHistory(inspection);
    expect(report).toContain("Historical report");
    expect(report).toContain("not live state or verified evidence");
    expect(report).toContain("Attempt: recorded");
    expect(report).toContain("Hypothesis: bypassed");
    expect(report).toContain("Hint level: 2");
    expect(report).toContain("current window");
    expect(report).toContain("attempt gate");
    expect(report).toContain("permissions");
    expect(report).toContain("/session");
    expect(report).toContain("/setup");
    expect(report).not.toContain("private-source-sentinel");
    expect(report.length).toBeLessThanOrEqual(1_200);
    expect(renderNativeHistory(inspection)).toBe(report);
  });

  it("displays a fork-shaped copy without mutating the source snapshot or admitting authority", () => {
    const snapshot = privateSnapshot();
    const before = structuredClone(snapshot);
    const checkpoint = createNativeCheckpoint(snapshot);
    const copied: unknown = JSON.parse(JSON.stringify(checkpoint));
    const inspection = inspectNativeHistory([response(copied)]);
    expect(inspection).toEqual({ status: "available", checkpoint });
    expect(renderNativeHistory(inspection)).toContain("fresh /setup confirmations");
    if (inspection.status !== "available") throw new Error("Missing checkpoint");
    expect(inspection.checkpoint).not.toBe(copied);
    expect(Reflect.set(inspection.checkpoint, "attempt", "none")).toBe(false);
    expect(snapshot).toEqual(before);
    expect(copied).toEqual(checkpoint);
  });

  it("does not render unchecked checkpoint fields supplied by a caller", () => {
    const checkpoint = { ...checkpointFixture(), attempt: "private-source-sentinel".repeat(512) } as unknown as NativeGrowthCheckpoint;
    const report = renderNativeHistory({ status: "available", checkpoint });
    expect(report).toContain("unavailable");
    expect(report).not.toContain("private-source-sentinel");
    expect(report.length).toBeLessThanOrEqual(1_200);
  });
});
