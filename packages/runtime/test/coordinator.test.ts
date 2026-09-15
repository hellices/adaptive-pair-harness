import { describe, expect, it } from "vitest";
import { toolsFor, type PairToolName } from "@adaptive-pair/harness";
import { growthRuntime, FakeClock, FakeIdSource } from "@adaptive-pair/testkit";
import type { PairRuntimeSnapshot, PairSessionSnapshot, WorkUnit } from "@adaptive-pair/protocol";
import { PairCoordinator } from "../src/index.js";
import { FakeEffectPort, FakePairStore } from "./fakes.js";

const createEntrySnapshot = (
  capturedAt: number,
): NonNullable<PairSessionSnapshot["entrySnapshot"]> => ({
  workspaceId: "workspace-1",
  branch: "feature/v2-growth-foundation",
  dirtyPaths: [],
  openPaths: ["packages/runtime/src/coordinator.ts"],
  diagnostics: [],
  protectedPaths: [],
  capturedAt,
});

const createGrowthAssistance = (): NonNullable<PairSessionSnapshot["assistance"]> => ({
  attempt: undefined,
  hypothesis: undefined,
  hint: undefined,
  solutionReveal: undefined,
});

const createLearningAgreement = (): NonNullable<PairSessionSnapshot["learningAgreement"]> => ({
  learningGoals: ["Validate the runtime tool projection"],
  familiarAreas: [],
  humanOwnedCapabilities: ["diagnosis", "implementation"],
  delegatableWork: [],
  maximumHintLevel: 2,
  independentCheck: "Recreate the projection without help",
});

const createWorkUnit = (
  overrides: Partial<WorkUnit>,
): WorkUnit => ({
  id: "unit-1",
  objective: "Complete the current bounded task",
  mode: "pair",
  learningValue: "mixed",
  capability: "implementation",
  owner: "human",
  allowedPaths: ["packages/runtime/src/coordinator.ts"],
  acceptanceChecks: ["npm test"],
  verificationPlan: "npm test",
  stoppingCondition: "The changed tests stay green",
  baseline: {},
  status: "agreed",
  ...overrides,
});

const createBriefingRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 4,
    session: {
      authorityEpoch: 2,
      status: "briefing",
      mode: undefined,
      learningAgreement: undefined,
      entrySnapshot: createEntrySnapshot(3),
      workUnit: undefined,
      assistance: undefined,
      operations: [],
      userActionGrants: [],
    },
  });

const createBriefingPairRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 4,
    session: {
      authorityEpoch: 2,
      status: "briefing",
      mode: "pair",
      learningAgreement: undefined,
      entrySnapshot: createEntrySnapshot(3),
      workUnit: undefined,
      assistance: undefined,
      operations: [],
      userActionGrants: [],
    },
  });

const createBriefingUninitializedRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 2,
    session: {
      authorityEpoch: 1,
      status: "briefing",
      mode: undefined,
      learningAgreement: undefined,
      entrySnapshot: undefined,
      workUnit: undefined,
      assistance: undefined,
      operations: [],
      userActionGrants: [],
    },
  });

const createBriefingGrowthRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 5,
    session: {
      authorityEpoch: 2,
      status: "briefing",
      mode: "growth",
      learningAgreement: undefined,
      entrySnapshot: createEntrySnapshot(3),
      workUnit: undefined,
      assistance: undefined,
      operations: [],
      userActionGrants: [],
    },
  });

const createBriefingProposedRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 6,
    session: {
      authorityEpoch: 2,
      status: "briefing",
      mode: "growth",
      learningAgreement: createLearningAgreement(),
      entrySnapshot: createEntrySnapshot(3),
      workUnit: createWorkUnit({
        mode: "growth",
        learningValue: "high",
        capability: "diagnosis",
        owner: "human",
        status: "proposed",
      }),
      assistance: undefined,
      operations: [],
      userActionGrants: [],
    },
  });

const createReadyGrowthRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 7,
    session: {
      status: "ready",
      mode: "growth",
      assistance: createGrowthAssistance(),
      workUnit: createWorkUnit({
        mode: "growth",
        learningValue: "high",
        capability: "diagnosis",
        owner: "human",
      }),
    },
  });

const createActivePairAiRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 9,
    session: {
      status: "active",
      mode: "pair",
      learningAgreement: undefined,
      assistance: undefined,
      workUnit: createWorkUnit({
        mode: "pair",
        owner: "ai",
      }),
    },
  });

const createActiveDeliveryAiRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 11,
    session: {
      status: "active",
      mode: "delivery",
      learningAgreement: undefined,
      assistance: undefined,
      workUnit: createWorkUnit({
        mode: "delivery",
        capability: "verification",
        owner: "ai",
      }),
    },
  });

const createPausedRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 12,
    session: {
      status: "paused",
      mode: "pair",
      learningAgreement: undefined,
      assistance: undefined,
      workUnit: createWorkUnit({
        mode: "pair",
        owner: "ai",
      }),
    },
  });

const createReconcilingRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 13,
    session: {
      status: "reconciling",
      mode: "pair",
      learningAgreement: undefined,
      assistance: undefined,
      workUnit: createWorkUnit({
        mode: "pair",
        owner: "ai",
        status: "needs-reconcile",
      }),
    },
  });

const createClosingRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 14,
    session: {
      status: "closing",
      mode: "delivery",
      learningAgreement: undefined,
      assistance: undefined,
      workUnit: createWorkUnit({
        mode: "delivery",
        capability: "verification",
        owner: "ai",
      }),
    },
  });

const createClosedRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 15,
    session: {
      status: "closed",
      mode: "delivery",
      learningAgreement: undefined,
      assistance: undefined,
      workUnit: createWorkUnit({
        mode: "delivery",
        capability: "verification",
        owner: "ai",
      }),
    },
  });

const createInactiveRuntime = (): PairRuntimeSnapshot => ({
  protocolVersion: 1,
  revision: 0,
  presence: {
    workspaceId: "workspace-1",
    observationRevision: 0,
    status: "observing",
    activeSessionId: undefined,
  },
  session: undefined,
});

const inputForTool = (
  name: PairToolName,
  snapshot: PairRuntimeSnapshot,
): Readonly<Record<string, unknown>> => {
  const workUnitId = snapshot.session?.workUnit?.id ?? "unit-1";
  const mode = snapshot.session?.mode ?? "pair";

  switch (name) {
    case "pair_get_state":
    case "pair_close_session":
      return {};
    case "pair_capture_entry":
      return {
        entry: {
          ...createEntrySnapshot(42),
          branch: "feature/v2-growth-foundation-refreshed",
          dirtyPaths: ["packages/runtime/src/coordinator.ts"],
        },
      };
    case "pair_confirm_learning":
      return {
        agreement: createLearningAgreement(),
      };
    case "pair_select_mode":
      return {
        mode:
          snapshot.session?.mode === "growth" &&
          snapshot.session.learningAgreement === undefined
            ? "pair"
            : snapshot.session?.mode ?? "pair",
      };
    case "pair_read_scope":
      return { path: "packages/runtime/src" };
    case "pair_search_scope":
      return { query: "grantUserAction" };
    case "pair_record_attempt":
      return {
        workUnitId,
        summary: "Tried a bounded reproduction.",
        bypassed: false,
      };
    case "pair_record_hypothesis":
      return {
        workUnitId,
        summary: "The visible tool set does not match the current phase.",
        bypassed: false,
      };
    case "pair_request_hint":
      return { workUnitId, level: 1 };
    case "pair_reveal_solution":
      return { workUnitId };
    case "pair_propose_work_unit":
      return {
        workUnit: createWorkUnit({
          id: "unit-2",
          mode,
          capability: mode === "delivery" ? "verification" : "implementation",
          learningValue: mode === "growth" ? "high" : "mixed",
          owner: mode === "growth" ? "human" : "ai",
          status: "proposed",
        }),
      };
    case "pair_agree_work_unit":
      return { workUnitId };
    case "pair_apply_edit":
      return {
        targetPath: "packages/runtime/src/coordinator.ts",
        description: "Apply the agreed fix",
      };
    case "pair_run_verification":
      return { plan: "npm test" };
    case "pair_run_command":
      return { command: "npm test" };
    case "pair_accept_handoff":
    case "pair_record_transfer":
      throw new Error(`Hidden tool should not be visible: ${name}`);
  }
};

describe("PairCoordinator", () => {
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
      "append:UserActionConsumed",
      "append:OperationAuthorized",
      "effect:check",
    ]);
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
      workUnitId: "unit-1",
      allowedPaths: ["src/retry.ts"],
    });
  });

  it("uses one configured stream id for load, append, and save", async () => {
    const store = new FakePairStore([], growthRuntime());
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
    expect(store.appendedStreamIds).toEqual(["pair-stream"]);
    expect(store.savedStreamIds).toEqual(["pair-stream"]);
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

  it("surfaces snapshot save failures explicitly", async () => {
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

    store.failSavingOnce();

    await expect(
      coordinator.invokeTool(
        "pair_run_verification",
        { plan: "npm test" },
        signal,
        { userActionId },
      ),
    ).rejects.toThrow("STORE_SAVE_FAILED");
  });
});
