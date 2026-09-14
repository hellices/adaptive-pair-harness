import { describe, expect, it } from "vitest";
import { growthRuntime, FakeClock, FakeIdSource } from "@adaptive-pair/testkit";
import { PairCoordinator } from "../src/index.js";
import { FakeEffectPort, FakePairStore } from "./fakes.js";

describe("PairCoordinator", () => {
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

  it("rejects hidden tools, wrong owners, and missing grants before dispatch", async () => {
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
    ).rejects.toThrow("WRONG_OWNER");
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
