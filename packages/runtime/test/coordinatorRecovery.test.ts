import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { FakeClock, FakeIdSource, growthRuntime } from "@adaptive-pair/testkit";
import { expect, it } from "vitest";
import { PairCoordinator } from "../src/coordinator.js";
import { InMemoryJournal } from "../src/journal.js";
import type { EffectPort, EffectRequest, EffectResult } from "../src/ports.js";
import { confirmedEffect, deferred } from "./coordinatorInterleavingFixtures.js";
import { FakeEffectPort } from "./fakes.js";

const createRecoveryFixture = (effects: EffectPort) => {
  const store = new InMemoryJournal("workspace-1", growthRuntime());
  const coordinator = new PairCoordinator({
    store,
    effects,
    clock: new FakeClock(),
    ids: new FakeIdSource(),
    streamId: "workspace-1",
  });
  return { coordinator, store };
};

const authorizeRead = async (coordinator: PairCoordinator, operationId = "orphan-read") => {
  const snapshot = await coordinator.snapshot();
  return coordinator.dispatch({
    protocolVersion: 1,
    commandId: `authorize-${operationId}`,
    expectedRevision: snapshot.revision,
    actor: "ai",
    type: "AuthorizeOperation",
    operationId,
    toolName: "pair_read_scope",
    kind: "read",
    input: { path: "src/retry.ts" },
    observedAt: 1,
  });
};

const changeAuthority = (
  coordinator: PairCoordinator,
  snapshot: PairRuntimeSnapshot,
  boundary: "pause-session" | "paused" | "off",
): Promise<PairRuntimeSnapshot> => boundary === "pause-session"
  ? coordinator.dispatch({
      protocolVersion: 1,
      commandId: "pause-during-recovery",
      expectedRevision: snapshot.revision,
      actor: "human",
      type: "PauseSession",
      reason: "Developer paused recovery.",
      observedAt: 2,
    })
  : coordinator.setPresence(boundary);

it("does not resurrect a cancelled invocation through concurrent public recovery", async () => {
  const unlinkedDispatches: number[] = [];
  for (let schedule = 0; schedule < 20; schedule += 1) {
    const calls: boolean[] = [];
    const { coordinator, store } = createRecoveryFixture({
      execute(request, signal) {
        calls.push(signal.aborted);
        return Promise.resolve(confirmedEffect(request));
      },
    });
    const controller = new AbortController();
    const invocation = coordinator.invokeTool(
      "pair_read_scope", { path: "src/retry.ts" }, controller.signal,
    );
    for (let turn = 0; turn < 100 && store.snapshotNow().session?.operations.length === 0; turn += 1) {
      await Promise.resolve();
    }
    expect(store.snapshotNow().session?.operations).toHaveLength(1);
    expect(calls).toEqual([]);
    controller.abort();

    const [result] = await Promise.all([invocation, coordinator.reconcile()]);
    expect(result.status).toBe("cancelled");
    expect(store.snapshotNow().session?.operations.at(-1)?.status).toBe("cancelled");
    unlinkedDispatches.push(calls.filter(aborted => !aborted).length);
  }
  expect(unlinkedDispatches).toEqual(Array.from({ length: 20 }, () => 0));
});

it.each(["pause-session", "paused", "off"] as const)(
  "does not dispatch a recovery read behind queued %s",
  async boundary => {
    const effects = new FakeEffectPort([]);
    const { coordinator, store } = createRecoveryFixture(effects);
    const authorized = await authorizeRead(coordinator);
    const changed = changeAuthority(coordinator, authorized, boundary);
    await Promise.resolve();
    const recovery = coordinator.reconcile();

    const [invalidated, recovered] = await Promise.all([changed, recovery]);
    expect(effects.calls).toEqual([]);
    expect(recovered).toEqual(invalidated);
    expect(store.snapshotNow()).toEqual(invalidated);
  },
);

it.each(["invocation", "recovery"] as const)(
  "does not duplicate a read owned by an in-flight %s",
  async owner => {
    const calls: EffectRequest[] = [];
    const started = deferred<EffectRequest>();
    const completed = deferred<EffectResult>();
    const { coordinator, store } = createRecoveryFixture({
      execute(request) {
        calls.push(request);
        if (calls.length === 1) {
          started.resolve(request);
          return completed.promise;
        }
        return Promise.resolve(confirmedEffect(request));
      },
    });
    if (owner === "recovery") {
      await authorizeRead(coordinator);
    }
    const original = owner === "invocation"
      ? coordinator.invokeTool("pair_read_scope", { path: "src/retry.ts" }, new AbortController().signal)
      : coordinator.reconcile();
    const request = await started.promise;
    const concurrent = await coordinator.reconcile();
    completed.resolve(confirmedEffect(request));
    await original;

    expect(calls).toHaveLength(1);
    expect(concurrent.session?.operations.at(-1)?.status).toBe("authorized");
    expect(store.snapshotNow().session?.operations.at(-1)?.status).toBe("confirmed");
  },
);

it.each(["pause-session", "paused", "off"] as const)(
  "invalidates a running recovery read on %s without blocking the transition",
  async boundary => {
    const started = deferred<{ readonly request: EffectRequest; readonly signal: AbortSignal }>();
    const completed = deferred<EffectResult>();
    const { coordinator, store } = createRecoveryFixture({
      execute(request, signal) {
        started.resolve({ request, signal });
        return completed.promise;
      },
    });
    const authorized = await authorizeRead(coordinator);
    const recovery = coordinator.reconcile();
    const effect = await started.promise;
    const invalidated = await changeAuthority(coordinator, authorized, boundary);
    const abortedAtBoundary = effect.signal.aborted;
    completed.resolve(confirmedEffect(effect.request));
    const recovered = await recovery;

    expect(abortedAtBoundary).toBe(true);
    expect(recovered).toEqual(invalidated);
    expect(store.snapshotNow()).toEqual(invalidated);
  },
);

it("revalidates each recovery read after another recovered effect crosses Pause", async () => {
  const calls: EffectRequest[] = [];
  const started = deferred<EffectRequest>();
  const completed = deferred<EffectResult>();
  const { coordinator, store } = createRecoveryFixture({
    execute(request) {
      calls.push(request);
      if (calls.length === 1) {
        started.resolve(request);
        return completed.promise;
      }
      return Promise.resolve(confirmedEffect(request));
    },
  });
  await authorizeRead(coordinator, "first-read");
  const authorized = await authorizeRead(coordinator, "second-read");
  const recovery = coordinator.reconcile();
  const request = await started.promise;
  const paused = await changeAuthority(coordinator, authorized, "pause-session");
  completed.resolve(confirmedEffect(request));

  await expect(recovery).resolves.toEqual(paused);
  expect(calls).toHaveLength(1);
  expect(store.snapshotNow()).toEqual(paused);
});

it("recovers an orphaned authorized read once using its persisted scope and payload", async () => {
  const effects = new FakeEffectPort([]);
  const { coordinator, store } = createRecoveryFixture(effects);
  const authorized = await authorizeRead(coordinator);

  await coordinator.reconcile();
  await coordinator.reconcile();

  expect(effects.calls).toHaveLength(1);
  expect(effects.calls[0]).toMatchObject({
    operationId: "orphan-read",
    workspaceId: "workspace-1",
    workUnitId: "unit-1",
    allowedPaths: ["src/retry.ts"],
    payload: { path: "src/retry.ts" },
    runtimeRevision: authorized.revision,
    authorityEpoch: authorized.session?.authorityEpoch,
  });
  expect(store.snapshotNow().session?.operations.at(-1)?.status).toBe("confirmed");
});

it("releases failed recovery admission so a safe read can be retried", async () => {
  const calls: EffectRequest[] = [];
  const { coordinator, store } = createRecoveryFixture({
    execute(request) {
      calls.push(request);
      return calls.length === 1
        ? Promise.reject(new Error("temporary-read-failure"))
        : Promise.resolve(confirmedEffect(request));
    },
  });
  await authorizeRead(coordinator);

  await expect(coordinator.reconcile()).rejects.toThrow("temporary-read-failure");
  await coordinator.reconcile();
  await coordinator.reconcile();

  expect(calls).toHaveLength(2);
  expect(store.snapshotNow().session?.operations.at(-1)?.status).toBe("confirmed");
});
