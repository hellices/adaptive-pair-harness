import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { FakeClock, FakeIdSource } from "@adaptive-pair/testkit";
import { expect, it } from "vitest";
import { PairCoordinator } from "../src/index.js";
import { createReconcilingRuntime } from "./coordinatorFixtures.js";
import { FakeEffectPort, FakePairStore } from "./fakes.js";

it("invalidates a pending operation when the session pauses", async () => {
  const order: string[] = [];
  const store = new FakePairStore(order);
  const effects = new FakeEffectPort(order, {
    block: true,
    ignoreAbort: true,
    summary: "Verification passed too late.",
  });
  const clock = new FakeClock();
  const coordinator = new PairCoordinator({
    store,
    effects,
    clock,
    ids: new FakeIdSource(),
    streamId: "workspace-1",
  });
  const signal = new AbortController().signal;
  const userActionId = await coordinator.grantUserAction(
    "pair_run_verification",
    signal,
  );

  const invocation = coordinator.invokeTool(
    "pair_run_verification",
    { plan: "npm test" },
    signal,
    { userActionId },
  );

  if (effects.pendingCount() === 0) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  expect(effects.pendingCount()).toBe(1);

  const paused = await coordinator.dispatch({
    protocolVersion: 1,
    commandId: "pause-after-authorization",
    expectedRevision: store.snapshot().revision,
    actor: "human",
    type: "PauseSession",
    reason: "developer took over the shell",
    observedAt: clock.now(),
  });

  expect(paused.session?.status).toBe("paused");
  await effects.releaseNext({
    status: "confirmed",
    summary: "Verification passed after pause.",
  });

  const result = await invocation;

  expect(result.status).toBe("cancelled");
  expect(store.snapshot().session?.operations.at(-1)?.status).toBe("cancelled");
});

it("never retries an unknown state-changing operation", async () => {
  const effects = new FakeEffectPort([], { outcome: "unknown" });
  const coordinator = new PairCoordinator({
    store: new FakePairStore([]),
    effects,
    clock: new FakeClock(),
    ids: new FakeIdSource(),
    streamId: "workspace-1",
  });
  const signal = new AbortController().signal;
  const userActionId = await coordinator.grantUserAction(
    "pair_run_verification",
    signal,
  );

  await coordinator.invokeTool(
    "pair_run_verification",
    { plan: "npm test" },
    signal,
    { userActionId },
  );
  await coordinator.reconcile();

  expect(effects.calls).toHaveLength(1);
});

it("does not replay a read after its work unit needs reconciliation", async () => {
  const base = createReconcilingRuntime();
  if (base.session?.workUnit === undefined) {
    throw new Error("Expected a reconciling work unit.");
  }
  const snapshot: PairRuntimeSnapshot = {
    ...base,
    session: {
      ...base.session,
      operations: [
        {
          id: "stale-read",
          workUnitId: base.session.workUnit.id,
          toolName: "pair_read_scope",
          kind: "read",
          input: { path: "packages/runtime/src/coordinator.ts" },
          runtimeRevision: base.revision,
          authorityEpoch: base.session.authorityEpoch,
          status: "authorized",
          summary: undefined,
          userActionGrantId: undefined,
        },
      ],
    },
  };
  const effects = new FakeEffectPort([]);
  const coordinator = new PairCoordinator({
    store: new FakePairStore([], snapshot),
    effects,
    clock: new FakeClock(),
    ids: new FakeIdSource(),
    streamId: "workspace-1",
  });

  await coordinator.reconcile();

  expect(effects.calls).toHaveLength(0);
});

it("treats duplicate observed results as idempotent", async () => {
  const store = new FakePairStore([]);
  const coordinator = new PairCoordinator({
    store,
    effects: new FakeEffectPort([]),
    clock: new FakeClock(),
    ids: new FakeIdSource(),
    streamId: "workspace-1",
  });

  const first = await coordinator.dispatch({
    protocolVersion: 1,
    commandId: "grant-1",
    expectedRevision: 0,
    actor: "human",
    type: "GrantUserAction",
    grantId: "grant-1",
    nativeToolName: "adaptive_pair_run_verification",
    observedAt: 1,
  });

  const authorized = await coordinator.dispatch({
    protocolVersion: 1,
    commandId: "authorize-1",
    expectedRevision: first.revision,
    actor: "ai",
    type: "AuthorizeOperation",
    operationId: "op-1",
    toolName: "pair_run_verification",
    kind: "check",
    input: { plan: "npm test" },
    userActionGrantId: "grant-1",
    observedAt: 2,
  });

  const observed = await coordinator.dispatch({
    protocolVersion: 1,
    commandId: "observe-1",
    expectedRevision: authorized.revision,
    actor: "host",
    type: "ObserveOperationResult",
    operationId: "op-1",
    authorityEpoch: 0,
    status: "confirmed",
    summary: "Verification passed.",
    observation: { exitCode: 0 },
    observedAt: 3,
  });

  const duplicate = await coordinator.dispatch({
    protocolVersion: 1,
    commandId: "observe-2",
    expectedRevision: observed.revision,
    actor: "host",
    type: "ObserveOperationResult",
    operationId: "op-1",
    authorityEpoch: 0,
    status: "confirmed",
    summary: "Verification passed again.",
    observation: { duplicate: true },
    observedAt: 4,
  });

  expect(duplicate).toEqual(observed);
});

it("fails atomically before effects and permits retry after a commit failure", async () => {
  const order: string[] = [];
  const store = new FakePairStore(order);
  const effects = new FakeEffectPort(order);
  const coordinator = new PairCoordinator({
    store,
    effects,
    clock: new FakeClock(),
    ids: new FakeIdSource(),
    streamId: "workspace-1",
  });
  const signal = new AbortController().signal;
  const userActionId = await coordinator.grantUserAction(
    "pair_run_verification",
    signal,
  );

  const before = await store.load("workspace-1");
  const eventsBefore = store.events();
  store.failCommittingOnce();

  await expect(
    coordinator.invokeTool(
      "pair_run_verification",
      { plan: "npm test" },
      signal,
      { userActionId },
    ),
  ).rejects.toThrow("STORE_COMMIT_FAILED");
  expect(await store.load("workspace-1")).toEqual(before);
  expect(store.events()).toEqual(eventsBefore);
  expect(effects.calls).toEqual([]);

  await expect(coordinator.invokeTool(
    "pair_run_verification",
    { plan: "npm test" },
    signal,
    { userActionId },
  )).resolves.toMatchObject({ status: "confirmed" });
  expect(effects.calls).toHaveLength(1);
});
