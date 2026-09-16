import { FakeClock, FakeIdSource, growthRuntime } from "@adaptive-pair/testkit";
import { expect, it } from "vitest";
import { PairCoordinator } from "../src/index.js";
import {
  createBriefingRuntime,
  createEntrySnapshot,
  createLearningAgreement,
  createWorkUnit,
} from "./coordinatorFixtures.js";
import { FakeEffectPort, FakePairStore } from "./fakes.js";

it("grants and consumes pair_capture_entry during briefing", async () => {
  const store = new FakePairStore([], createBriefingRuntime());
  const coordinator = new PairCoordinator({
    store,
    effects: new FakeEffectPort([]),
    clock: new FakeClock(),
    ids: new FakeIdSource(),
    streamId: "workspace-1",
  });
  const signal = new AbortController().signal;

  const userActionId = await coordinator.grantUserAction(
    "pair_capture_entry",
    signal,
  );

  expect(store.snapshot().session?.userActionGrants).toEqual([
    {
      id: userActionId,
      nativeToolName: "adaptive_pair_capture_entry",
      runtimeRevision: 5,
      authorityEpoch: 2,
      status: "available",
    },
  ]);

  const result = await coordinator.invokeTool(
    "pair_capture_entry",
    {
      entry: {
        ...createEntrySnapshot(42),
        branch: "feature/v2-growth-foundation-refreshed",
      },
    },
    signal,
    { userActionId },
  );

  expect(result.status).toBe("confirmed");
  expect(store.snapshot().session?.entrySnapshot?.branch).toBe(
    "feature/v2-growth-foundation-refreshed",
  );
  expect(store.snapshot().session?.userActionGrants.at(-1)?.status).toBe(
    "consumed",
  );
});

it("requires and consumes human grants for the Growth briefing contract", async () => {
  const store = new FakePairStore([], createBriefingRuntime());
  const coordinator = new PairCoordinator({
    store,
    effects: new FakeEffectPort([]),
    clock: new FakeClock(),
    ids: new FakeIdSource(),
    streamId: "workspace-1",
  });
  const signal = new AbortController().signal;

  for (const [name, input] of [
    [
      "pair_confirm_learning",
      { agreement: createLearningAgreement() },
    ],
    ["pair_select_mode", { mode: "growth" }],
  ] as const) {
    await expect(coordinator.invokeTool(name, input, signal)).rejects.toThrow(
      "USER_ACTION_REQUIRED",
    );
    const userActionId = await coordinator.grantUserAction(name, signal);
    await coordinator.invokeTool(name, input, signal, { userActionId });
  }

  await coordinator.invokeTool(
    "pair_propose_work_unit",
    {
      workUnit: createWorkUnit({
        id: "growth-unit",
        mode: "growth",
        learningValue: "high",
        owner: "human",
        status: "proposed",
      }),
    },
    signal,
  );

  await expect(
    coordinator.invokeTool(
      "pair_agree_work_unit",
      { workUnitId: "growth-unit" },
      signal,
    ),
  ).rejects.toThrow("USER_ACTION_REQUIRED");
  const agreementGrant = await coordinator.grantUserAction(
    "pair_agree_work_unit",
    signal,
  );
  await coordinator.invokeTool(
    "pair_agree_work_unit",
    { workUnitId: "growth-unit" },
    signal,
    { userActionId: agreementGrant },
  );

  expect(store.snapshot().session).toMatchObject({
    status: "ready",
    mode: "growth",
    workUnit: {
      id: "growth-unit",
      owner: "human",
      status: "agreed",
    },
  });
  expect(
    store.snapshot().session?.userActionGrants.filter(
      grant => grant.status === "available",
    ),
  ).toEqual([]);
});

it("rejects hidden operational grants during briefing", async () => {
  const store = new FakePairStore([], createBriefingRuntime());
  const coordinator = new PairCoordinator({
    store,
    effects: new FakeEffectPort([]),
    clock: new FakeClock(),
    ids: new FakeIdSource(),
    streamId: "workspace-1",
  });
  const signal = new AbortController().signal;

  await expect(
    coordinator.grantUserAction("pair_run_verification", signal),
  ).rejects.toThrow("TOOL_HIDDEN");
  expect(store.snapshot().session?.userActionGrants).toEqual([]);
});

it("rejects a user-action grant requested from a stale runtime boundary", async () => {
  const store = new FakePairStore([], createBriefingRuntime());
  const coordinator = new PairCoordinator({
    store,
    effects: new FakeEffectPort([]),
    clock: new FakeClock(),
    ids: new FakeIdSource(),
    streamId: "workspace-1",
  });
  const signal = new AbortController().signal;
  const current = store.snapshot();

  await expect(
    coordinator.grantUserAction("pair_select_mode", signal, {
      runtimeRevision: current.revision - 1,
      authorityEpoch: current.session?.authorityEpoch,
    }),
  ).rejects.toThrow("STALE_TOOL_VIEW");
  expect(store.snapshot().session?.userActionGrants).toEqual([]);
});

it("persists grant consumption and authorization before dispatching an effect", async () => {
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

  order.length = 0;

  await coordinator.invokeTool(
    "pair_run_verification",
    { plan: "npm test" },
    signal,
    { userActionId },
  );

  expect(order.slice(0, 3)).toEqual([
    "commit:UserActionConsumed",
    "commit:OperationAuthorized",
    "effect:check",
  ]);
});

it("rejects hidden grants before persisting them", async () => {
  const store = new FakePairStore([], growthRuntime());
  const coordinator = new PairCoordinator({
    store,
    effects: new FakeEffectPort([]),
    clock: new FakeClock(),
    ids: new FakeIdSource(),
    streamId: "workspace-1",
  });
  const signal = new AbortController().signal;

  await expect(
    coordinator.grantUserAction("pair_apply_edit", signal),
  ).rejects.toThrow("TOOL_HIDDEN");
  expect(store.snapshot().session?.userActionGrants).toEqual([]);
});
