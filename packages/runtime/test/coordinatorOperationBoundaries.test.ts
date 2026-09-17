import { getEventListeners } from "node:events";
import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { expect, it } from "vitest";
import type { PairCoordinator } from "../src/coordinator.js";
import type { EffectPort, EffectRequest, EffectResult } from "../src/ports.js";
import {
  confirmedEffect,
  createInterleavingFixture,
  deferred,
} from "./coordinatorInterleavingFixtures.js";
import { FakeEffectPort } from "./fakes.js";

type Boundary = "pause-session" | "paused" | "off";

const changeAuthority = (
  coordinator: PairCoordinator,
  snapshot: PairRuntimeSnapshot,
  boundary: Boundary,
): Promise<PairRuntimeSnapshot> => boundary === "pause-session"
  ? coordinator.dispatch({
      protocolVersion: 1,
      commandId: "pause-at-authorization",
      expectedRevision: snapshot.revision,
      actor: "human",
      type: "PauseSession",
      reason: "Developer paused the session.",
      observedAt: 1,
    })
  : coordinator.setPresence(boundary);

it.each(["pause-session", "paused", "off"] as const)(
  "registers an authorized operation before queued %s can invalidate it",
  async boundary => {
    const started = deferred<{ readonly request: EffectRequest; readonly signal: AbortSignal }>();
    const completed = deferred<EffectResult>();
    const effects: EffectPort = {
      execute(request, signal) {
        started.resolve({ request, signal });
        return completed.promise;
      },
    };
    const { coordinator, store } = createInterleavingFixture(effects);
    const authorization = store.delayCommit("OperationAuthorized");
    const invocation = coordinator.invokeTool(
      "pair_read_scope", { path: "src/retry.ts" }, new AbortController().signal,
    );
    const authorized = await authorization.reached;
    const changed = changeAuthority(coordinator, authorized, boundary);
    expect((await store.journal.load("workspace-1")).snapshot).toEqual(authorized);
    authorization.release();

    const effect = await started.promise;
    expect(store.journal.snapshotNow().session?.status).toBe("active");
    const invalidated = await changed;
    expect(effect.signal.aborted).toBe(true);
    completed.resolve(confirmedEffect(effect.request));
    await expect(invocation).resolves.toMatchObject({ status: "cancelled" });
    expect(store.journal.snapshotNow()).toEqual(invalidated);
  },
);

it.each(["pause-session", "paused", "off"] as const)(
  "does not authorize an invocation whose snapshot predates %s",
  async boundary => {
    const effects = new FakeEffectPort([]);
    const { coordinator, store } = createInterleavingFixture(effects);
    const reading = store.delayNextLoad();
    const invocation = coordinator.invokeTool(
      "pair_read_scope", { path: "src/retry.ts" }, new AbortController().signal,
    );
    const { snapshot } = await reading.reached;
    const changed = await changeAuthority(coordinator, snapshot, boundary);
    reading.release();

    await expect(invocation).rejects.toThrow("STALE_REVISION");
    expect(effects.calls).toEqual([]);
    expect(store.journal.snapshotNow()).toEqual(changed);
  },
);

it.each(["pair_read_scope", "pair_run_verification"] as const)(
  "dispatches the persisted %s payload even if caller input changes during authorization",
  async name => {
    const effects = new FakeEffectPort([]);
    const { coordinator, store } = createInterleavingFixture(effects);
    const signal = new AbortController().signal;
    const options = name === "pair_run_verification"
      ? { userActionId: await coordinator.grantUserAction(name, signal) }
      : {};
    const input = { path: "src/retry.ts", plan: { script: "test", targets: ["src/retry.ts"] } };
    const expected = structuredClone(input);
    const authorization = store.delayCommit("OperationAuthorized");
    const invocation = coordinator.invokeTool(name, input, signal, options);
    const authorized = await authorization.reached;
    expect(authorized.session?.operations.at(-1)?.input).toEqual(expected);
    input.path = "outside-the-agreed-scope.ts";
    input.plan.script = "build";
    input.plan.targets[0] = "outside-the-agreed-scope.ts";
    authorization.release();

    await expect(invocation).resolves.toMatchObject({ status: "confirmed" });
    expect(effects.calls).toHaveLength(1);
    expect(effects.calls[0]?.payload).toEqual(expected);
    expect(store.journal.snapshotNow().session?.operations.at(-1)?.input).toEqual(expected);
  },
);

it("does not dispatch or replay an operation cancelled during authorization acknowledgement", async () => {
  const effects = new FakeEffectPort([]);
  const { coordinator, store } = createInterleavingFixture(effects);
  const controller = new AbortController();
  const authorization = store.delayCommit("OperationAuthorized");
  const invocation = coordinator.invokeTool("pair_read_scope", { path: "src/retry.ts" }, controller.signal);
  await authorization.reached;
  controller.abort();
  authorization.release();

  const result = await invocation;
  expect(effects.calls).toEqual([]);
  expect(result.status).toBe("cancelled");
  expect(store.journal.snapshotNow().session?.operations.at(-1)?.status).toBe("cancelled");
  await coordinator.reconcile();
  expect(effects.calls).toEqual([]);
});

it.each([false, true])("removes the caller abort listener after an effect settles (reject=%s)", async reject => {
  const effects: EffectPort = {
    execute: request => reject
      ? Promise.reject(new Error("effect-rejected"))
      : Promise.resolve(confirmedEffect(request)),
  };
  const { coordinator } = createInterleavingFixture(effects);
  const signal = new AbortController().signal;
  const invocation = coordinator.invokeTool("pair_read_scope", { path: "src/retry.ts" }, signal);
  if (reject) {
    await expect(invocation).rejects.toThrow("effect-rejected");
  } else {
    await expect(invocation).resolves.toMatchObject({ status: "confirmed" });
  }
  expect(getEventListeners(signal, "abort")).toEqual([]);
});
