import { toolsFor } from "@adaptive-pair/harness";
import { FakeClock, FakeIdSource, growthRuntime } from "@adaptive-pair/testkit";
import { expect, it } from "vitest";
import { PairCoordinator } from "../src/index.js";
import {
  createActiveDeliveryAiRuntime,
  createActivePairAiRuntime,
  createBriefingGrowthRuntime,
  createBriefingPairRuntime,
  createBriefingProposedRuntime,
  createBriefingRuntime,
  createBriefingUninitializedRuntime,
  createClosedRuntime,
  createClosingRuntime,
  createInactiveRuntime,
  createPausedRuntime,
  createReadyGrowthRuntime,
  createReconcilingRuntime,
  inputForTool,
} from "./coordinatorFixtures.js";
import { FakeEffectPort, FakePairStore } from "./fakes.js";

it("only exposes visible tools that the coordinator can execute", async () => {
  const snapshots = [
    createInactiveRuntime(),
    createBriefingUninitializedRuntime(),
    createBriefingRuntime(),
    createBriefingPairRuntime(),
    createBriefingGrowthRuntime(),
    createBriefingProposedRuntime(),
    createReadyGrowthRuntime(),
    createActivePairAiRuntime(),
    createActiveDeliveryAiRuntime(),
    createPausedRuntime(),
    createReconcilingRuntime(),
    createClosingRuntime(),
    createClosedRuntime(),
  ];

  for (const snapshot of snapshots) {
    for (const descriptor of toolsFor(snapshot).tools) {
      const store = new FakePairStore([], snapshot);
      const effects = new FakeEffectPort([]);
      const coordinator = new PairCoordinator({
        store,
        effects,
        clock: new FakeClock(),
        ids: new FakeIdSource(),
        streamId: "workspace-1",
      });
      const signal = new AbortController().signal;
      const userActionId = descriptor.requiresExplicitUserAction
        ? await coordinator.grantUserAction(descriptor.name, signal)
        : undefined;

      const result = await coordinator.invokeTool(
        descriptor.name,
        inputForTool(descriptor.name, snapshot),
        signal,
        userActionId === undefined ? undefined : { userActionId },
      );

      expect([
        "confirmed",
        "failed",
        "declined",
        "cancelled",
        "unknown",
      ]).toContain(result.status);
    }
  }
});

it("compiles instructions and tool visibility from one snapshot", async () => {
  const coordinator = new PairCoordinator({
    store: new FakePairStore([], growthRuntime({
      runtimeRevision: 8,
      session: { authorityEpoch: 3 },
    })),
    effects: new FakeEffectPort([]),
    clock: new FakeClock(),
    ids: new FakeIdSource(),
    streamId: "workspace-1",
  });

  const prepared = await coordinator.prepareTurn({
    presenceSummary: "Developer is running the runtime suite.",
    userRequest: "Help me understand the latest verification result.",
  });

  expect(prepared.instructions.runtimeRevision).toBe(8);
  expect(prepared.instructions.authorityEpoch).toBe(3);
  expect(prepared.tools.runtimeRevision).toBe(8);
  expect(prepared.tools.authorityEpoch).toBe(3);
});

it("passes the trusted work-unit scope to read effects", async () => {
  const effects = new FakeEffectPort([]);
  const coordinator = new PairCoordinator({
    store: new FakePairStore([], growthRuntime()),
    effects,
    clock: new FakeClock(),
    ids: new FakeIdSource(),
    streamId: "workspace-1",
  });

  await coordinator.invokeTool(
    "pair_read_scope",
    { path: "src/retry.ts" },
    new AbortController().signal,
  );

  expect(effects.calls[0]).toMatchObject({
    toolName: "pair_read_scope",
    workspaceId: "workspace-1",
    workUnitId: "unit-1",
    allowedPaths: ["src/retry.ts"],
  });
});

it("uses one configured stream id for load and commit", async () => {
  const store = new FakePairStore([], growthRuntime(), "pair-stream");
  const coordinator = new PairCoordinator({
    store,
    effects: new FakeEffectPort([]),
    clock: new FakeClock(),
    ids: new FakeIdSource(),
    streamId: "pair-stream",
  });
  const signal = new AbortController().signal;

  await coordinator.grantUserAction("pair_run_verification", signal);

  expect(store.loadedStreamIds).toContain("pair-stream");
  expect(store.committedStreamIds).toEqual(["pair-stream"]);
});

it("rejects stale tool views before dispatching effects", async () => {
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

  await expect(
    coordinator.invokeTool(
      "pair_run_verification",
      { plan: "npm test" },
      signal,
      {
        userActionId,
        runtimeRevision: store.snapshot().revision - 1,
      },
    ),
  ).rejects.toThrow("STALE_TOOL_VIEW");
  expect(effects.calls).toHaveLength(0);
});

it("rejects hidden tools and missing grants before dispatch", async () => {
  const growthCoordinator = new PairCoordinator({
    store: new FakePairStore([], growthRuntime()),
    effects: new FakeEffectPort([]),
    clock: new FakeClock(),
    ids: new FakeIdSource(),
    streamId: "workspace-1",
  });
  const pairCoordinator = new PairCoordinator({
    store: new FakePairStore([], growthRuntime({
      session: {
        mode: "pair",
        workUnit: {
          id: "unit-1",
          objective: "Let the AI navigate the fix",
          mode: "pair",
          learningValue: "mixed",
          capability: "implementation",
          owner: "ai",
          allowedPaths: ["src/retry.ts"],
          acceptanceChecks: ["npm test -- retry"],
          verificationPlan: "npm test -- retry",
          stoppingCondition: "The failing retry test is green",
          baseline: {},
          status: "agreed",
        },
      },
    })),
    effects: new FakeEffectPort([]),
    clock: new FakeClock(),
    ids: new FakeIdSource(),
    streamId: "workspace-1",
  });
  const signal = new AbortController().signal;

  await expect(
    growthCoordinator.invokeTool(
      "pair_apply_edit",
      { targetPath: "src/retry.ts" },
      signal,
    ),
  ).rejects.toThrow("TOOL_HIDDEN");
  await expect(
    pairCoordinator.invokeTool(
      "pair_record_attempt",
      { workUnitId: "unit-1", summary: "Tried a fix.", bypassed: false },
      signal,
    ),
  ).rejects.toThrow("TOOL_HIDDEN");
  await expect(
    growthCoordinator.invokeTool(
      "pair_run_verification",
      { plan: "npm test" },
      signal,
    ),
  ).rejects.toThrow("USER_ACTION_REQUIRED");
});

it("executes direct state tools through the core", async () => {
  const store = new FakePairStore([], growthRuntime());
  const coordinator = new PairCoordinator({
    store,
    effects: new FakeEffectPort([]),
    clock: new FakeClock(),
    ids: new FakeIdSource(),
    streamId: "workspace-1",
  });
  const signal = new AbortController().signal;
  const userActionId = await coordinator.grantUserAction(
    "pair_record_attempt",
    signal,
  );

  const result = await coordinator.invokeTool(
    "pair_record_attempt",
    {
      workUnitId: "unit-1",
      summary: "Tried moving the retry guard.",
      bypassed: false,
    },
    signal,
    { userActionId },
  );

  expect(result.status).toBe("confirmed");
  expect(store.snapshot().session?.assistance?.attempt).toEqual({
    summary: "Tried moving the retry guard.",
    bypassed: false,
    recordedAt: 0,
  });
  expect(store.snapshot().session?.userActionGrants.at(-1)?.status).toBe(
    "consumed",
  );
});
