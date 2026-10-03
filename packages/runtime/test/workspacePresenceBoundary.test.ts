import type { PairEvent } from "@adaptive-pair/protocol";
import { reduce } from "@adaptive-pair/session-core";
import { FakeClock, FakeIdSource, growthRuntime } from "@adaptive-pair/testkit";
import { expect, it, vi } from "vitest";
import { PairCoordinator } from "../src/coordinator.js";
import { InMemoryJournal } from "../src/journal.js";
import type { EffectRequest, EffectResult } from "../src/ports.js";
import { confirmedEffect, deferred } from "./coordinatorInterleavingFixtures.js";

const pendingVerification = async () => {
  const started = deferred<{ readonly request: EffectRequest; readonly signal: AbortSignal }>();
  const completed = deferred<EffectResult>();
  const store = new InMemoryJournal("stream-1", growthRuntime());
  const coordinator = new PairCoordinator({
    store, clock: new FakeClock(), ids: new FakeIdSource(), streamId: "stream-1",
    effects: {
      execute(request, signal) {
        started.resolve({ request, signal });
        return completed.promise;
      },
    },
  });
  await coordinator.observeWorkspace();
  const signal = new AbortController().signal;
  const userActionId = await coordinator.grantUserAction("pair_run_verification", signal);
  const invocation = coordinator.invokeTool(
    "pair_run_verification", { plan: "npm test" }, signal, { userActionId },
  );
  const effect = await started.promise;
  // Keep an unused available grant in the session that the workspace switch resets.
  await coordinator.grantUserAction("pair_run_verification", signal);
  return {
    store, coordinator, invocation, effect,
    finish: () => completed.resolve({
      ...confirmedEffect(effect.request), summary: "Result from the original workspace.",
      observation: { workspaceId: "workspace-1" },
    }),
  };
};

it.each(["observing", "quiet"] as const)(
  "atomically resets workspace authority before enabling %s", async status => {
    const { store, coordinator, effect, finish, invocation } = await pendingVerification();
    const before = store.snapshotNow();
    const seenBefore = (await store.load("stream-1")).seenCommandIds;
    const commit = vi.spyOn(store, "commit");

    const next = await coordinator.setPresence(status, "workspace-2");
    const abortedAfterCommit = effect.signal.aborted;
    const committed = commit.mock.calls.slice();
    finish();
    await invocation;

    expect(committed).toHaveLength(1);
    const events = committed[0]?.[2] ?? [];
    expect(events.map(event => event.type)).toEqual(status === "quiet"
      ? ["PresenceChanged", "PresenceEnabled", "PresenceChanged"]
      : ["PresenceChanged", "PresenceEnabled"]);
    expect(abortedAfterCommit).toBe(true);
    expect(next.session).toBeUndefined();
    expect(next.presence).toEqual({
      workspaceId: "workspace-2", status, observationRevision: 0, activeSessionId: undefined,
    });
    expect(next.revision).toBe(before.revision + events.length);
    expect(store.events()).toEqual(events);
    expect(reduce(before, store.events())).toEqual(next);
    const seenAfter = (await store.load("stream-1")).seenCommandIds;
    expect([...seenBefore].every(commandId => seenAfter.has(commandId))).toBe(true);
  },
);

it.each(["setPresence", "dispatch"] as const)(
  "ignores an abort-resistant old effect after workspace rebinding through %s", async route => {
    const { store, coordinator, effect, finish, invocation } = await pendingVerification();
    const before = store.snapshotNow();
    const next = route === "setPresence"
      ? await coordinator.setPresence("observing", "workspace-2")
      : await coordinator.dispatch({
        protocolVersion: 1, commandId: "direct-rebind", expectedRevision: before.revision,
        actor: "human", observedAt: 10, type: "EnablePresence", workspaceId: "workspace-2",
      });
    const abortedAfterCommit = effect.signal.aborted;
    finish();

    await expect(invocation).resolves.toMatchObject({ status: "cancelled", observation: { stale: true } });
    expect(abortedAfterCommit).toBe(true);
    expect(await coordinator.snapshot()).toEqual(next);
    expect(store.events().some(event => event.type === "OperationObserved")).toBe(false);
  },
);

it.each(["observing", "quiet"] as const)(
  "retains authority and accepts an in-flight effect when enabling %s in the same workspace", async status => {
    const { store, coordinator, effect, finish, invocation } = await pendingVerification();
    const before = store.snapshotNow();
    const next = await coordinator.setPresence(status, "workspace-1");
    const abortedAfterCommit = effect.signal.aborted;
    finish();

    await expect(invocation).resolves.toMatchObject({ status: "confirmed" });
    expect(abortedAfterCommit).toBe(false);
    expect(next.session).toEqual(before.session);
    expect(next.presence).toEqual({ ...before.presence, status: status === "quiet" ? "quiet" : "engaged" });
    expect(store.snapshotNow().session?.operations.at(-1)).toMatchObject({ status: "confirmed" });
    expect(store.events().some(event => event.type === "PresenceChanged" && event.status === "off")).toBe(false);
  },
);

it("preserves original authority and pending effects when the atomic workspace commit fails", async () => {
  const { store, coordinator, effect, finish, invocation } = await pendingVerification();
  const before = await store.load("stream-1");
  const eventsBefore = store.events();
  vi.spyOn(store, "commit").mockRejectedValueOnce(new Error("STORE_COMMIT_FAILED"));

  await expect(coordinator.setPresence("quiet", "workspace-2")).rejects.toThrow("STORE_COMMIT_FAILED");
  const abortedAfterFailure = effect.signal.aborted;
  const afterFailure = await store.load("stream-1");
  const eventsAfterFailure = store.events();
  finish();

  await expect(invocation).resolves.toMatchObject({ status: "confirmed" });
  expect(abortedAfterFailure).toBe(false);
  expect(afterFailure).toEqual(before);
  expect(eventsAfterFailure).toEqual(eventsBefore);
  expect(store.snapshotNow().presence.workspaceId).toBe("workspace-1");
  await expect(coordinator.setPresence("quiet", "workspace-2")).resolves.toMatchObject({
    presence: { workspaceId: "workspace-2", status: "quiet" }, session: undefined,
  });
});

it("aborts old effects only after the workspace reset batch commits", async () => {
  const { store, coordinator, effect, finish, invocation } = await pendingVerification();
  const before = await store.load("stream-1");
  const entered = deferred<readonly PairEvent[]>();
  const released = deferred<void>();
  const commit = store.commit.bind(store);
  vi.spyOn(store, "commit").mockImplementationOnce(async (streamId, revision, events) => {
    entered.resolve(events);
    await released.promise;
    return commit(streamId, revision, events);
  });
  const switching = coordinator.setPresence("quiet", "workspace-2");
  await entered.promise;
  finish();
  const whileStaged = await store.load("stream-1");
  const abortedBeforeCommit = effect.signal.aborted;
  released.resolve();
  const next = await switching;
  const abortedAfterCommit = effect.signal.aborted;
  await expect(invocation).resolves.toMatchObject({ status: "cancelled" });

  expect(abortedBeforeCommit).toBe(false);
  expect(whileStaged).toEqual(before);
  expect(abortedAfterCommit).toBe(true);
  expect(store.snapshotNow()).toEqual(next);
  expect(next.session).toBeUndefined();
});
