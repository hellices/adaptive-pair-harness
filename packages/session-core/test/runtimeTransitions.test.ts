import type { OperationRecord, PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { expect, it } from "vitest";
import { decide, reduce } from "../src/index.js";
import { command, createSessionRuntime, event } from "./sessionCoreFixtures.js";

const createToolRuntime = (): PairRuntimeSnapshot => createSessionRuntime({
  mode: "pair",
  workUnit: {
    id: "wu-1",
    objective: "Run the agreed verification",
    mode: "pair",
    learningValue: "mixed",
    capability: "verification",
    owner: "human",
    allowedPaths: ["packages/runtime"],
    acceptanceChecks: ["npx vitest run packages/runtime/test"],
    verificationPlan: "Run the runtime suite",
    stoppingCondition: "The runtime suite is green",
    baseline: {},
    status: "agreed",
  },
});

const createBriefingRuntime = (): PairRuntimeSnapshot => ({
  ...createSessionRuntime({
    authorityEpoch: 2,
    status: "briefing",
    mode: "pair",
    entrySnapshot: {
      workspaceId: "workspace-1",
      branch: "feature/v2-growth-foundation",
      dirtyPaths: [],
      openPaths: ["packages/runtime/src/coordinator.ts"],
      diagnostics: [],
      protectedPaths: [],
      capturedAt: 3,
    },
  }),
  revision: 4,
});

const verificationInput = { plan: "npx vitest run packages/runtime/test" };
const operation = (fields: Partial<OperationRecord> = {}): OperationRecord => ({
  id: "op-1",
  workUnitId: "wu-1",
  toolName: "pair_run_verification",
  kind: "check",
  input: verificationInput,
  runtimeRevision: 1,
  authorityEpoch: 0,
  status: "authorized",
  summary: undefined,
  userActionGrantId: undefined,
  ...fields,
});
const grantEvent = (nativeToolName = "adaptive_pair_run_verification") => event("UserActionGranted", 1, {
  grantId: "grant-1", nativeToolName, runtimeRevision: 1, authorityEpoch: 0,
});
const authorizeVerification = (runtime: PairRuntimeSnapshot) => command("AuthorizeOperation", runtime.revision, {
  operationId: "op-1",
  toolName: "pair_run_verification",
  kind: "check",
  input: verificationInput,
  userActionGrantId: "grant-1",
}, { actor: "ai" });

it("grants briefing capture-entry actions at the next immutable revision", () => {
  const runtime = createBriefingRuntime();
  const decision = decide(runtime, command("GrantUserAction", runtime.revision, {
    grantId: "grant-capture-1", nativeToolName: "adaptive_pair_capture_entry",
  }, { at: 20 }));

  expect(decision.events).toEqual([event("UserActionGranted", 5, {
    grantId: "grant-capture-1", nativeToolName: "adaptive_pair_capture_entry", runtimeRevision: 5, authorityEpoch: 2,
  }, { at: 20 })]);
  expect(reduce(runtime, decision.events).session?.userActionGrants).toEqual([{
    id: "grant-capture-1",
    nativeToolName: "adaptive_pair_capture_entry",
    runtimeRevision: 5,
    authorityEpoch: 2,
    status: "available",
  }]);
});

it("rejects operational user action grants during briefing", () => {
  const runtime = createBriefingRuntime();
  expect(() => decide(runtime, command("GrantUserAction", runtime.revision, {
    grantId: "grant-verification-1", nativeToolName: "adaptive_pair_run_verification",
  }))).toThrow("SESSION_NOT_OPERATIONAL");
});

it("grants one-shot user actions at the next immutable revision", () => {
  const runtime = createToolRuntime();
  const decision = decide(runtime, command("GrantUserAction", runtime.revision, {
    grantId: "grant-1", nativeToolName: "adaptive_pair_run_verification",
  }));

  expect(decision.events).toEqual([grantEvent()]);
  expect(reduce(runtime, decision.events).session?.userActionGrants).toEqual([{
    id: "grant-1",
    nativeToolName: "adaptive_pair_run_verification",
    runtimeRevision: 1,
    authorityEpoch: 0,
    status: "available",
  }]);
});

it("consumes a persisted grant atomically when authorizing an operation", () => {
  const granted = reduce(createToolRuntime(), [grantEvent()]);
  const decision = decide(granted, authorizeVerification(granted));

  expect(decision.events.map(event => event.type)).toEqual(["UserActionConsumed", "OperationAuthorized"]);

  const next = reduce(granted, decision.events);
  expect(next.session?.userActionGrants).toEqual([{
    id: "grant-1",
    nativeToolName: "adaptive_pair_run_verification",
    runtimeRevision: 1,
    authorityEpoch: 0,
    status: "consumed",
  }]);
  expect(next.session?.operations).toEqual([operation({ runtimeRevision: 3, userActionGrantId: "grant-1" })]);
});

it("rejects stale grants during final operation authorization", () => {
  const granted = reduce(createToolRuntime(), [
    grantEvent(),
    event("OperationAuthorized", 2, {
      operation: operation({
        id: "op-existing", toolName: "pair_read_scope", kind: "read",
        input: { path: "packages/runtime" }, runtimeRevision: 2,
      }),
    }, { actor: "ai" }),
  ]);

  expect(() => decide(granted, authorizeVerification(granted))).toThrow("STALE_USER_ACTION_GRANT");
});

it("rejects mismatched grants during final operation authorization", () => {
  const granted = reduce(createToolRuntime(), [grantEvent("adaptive_pair_request_hint")]);

  expect(() => decide(granted, authorizeVerification(granted))).toThrow("USER_ACTION_MISMATCH");
});

it("cancels pending operations when the session pauses", () => {
  const runtime = reduce(createToolRuntime(), [event("OperationAuthorized", 1, { operation: operation() }, { actor: "ai" })]);
  const decision = decide(runtime, command("PauseSession", runtime.revision, {
    reason: "take over the verification command",
  }));

  expect(decision.events.map(event => event.type)).toEqual(["OperationObserved", "SessionPaused"]);

  const next = reduce(runtime, decision.events);
  expect(next.session?.authorityEpoch).toBe(1);
  expect(next.session?.status).toBe("paused");
  expect(next.session?.operations).toEqual([
    operation({ status: "cancelled", summary: "Session paused before the operation completed." }),
  ]);
});

it("treats duplicate observed results as idempotent", () => {
  const runtime = reduce(createToolRuntime(), [event("OperationAuthorized", 1, {
    operation: operation({ status: "confirmed", summary: "Verification passed." }),
  }, { actor: "ai" })]);

  expect(decide(runtime, command("ObserveOperationResult", runtime.revision, {
    operationId: "op-1",
    authorityEpoch: 0,
    status: "confirmed",
    summary: "Verification passed again.",
    observation: { duplicate: true },
  }, { actor: "host" })).events).toEqual([]);
});
