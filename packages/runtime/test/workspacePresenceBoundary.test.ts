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
  const availableGrantId = await coordinator.grantUserAction("pair_run_verification", signal);
  return {
    store, coordinator, invocation, effect, availableGrantId,
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
    expect(events[0]).toMatchObject({ type: "PresenceChanged", status: "off" });
    expect(events[1]).toMatchObject({
      type: "PresenceEnabled", workspaceId: "workspace-2", commandId: events[0]?.commandId,
    });
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

it("rolls back a replay batch whose enable event fails after the reset event", async () => {
  const { store, coordinator, effect, finish, invocation } = await pendingVerification();
  const before = await store.load("stream-1");
  const eventsBefore = store.events();
  const events: readonly PairEvent[] = [
    {
      protocolVersion: 1, eventId: "bad-switch:0", commandId: "bad-switch",
      actor: "human", recordedAt: 1, revision: before.snapshot.revision + 1,
      type: "PresenceChanged", status: "off",
    },
    {
      protocolVersion: 1, eventId: "bad-switch:1", commandId: "bad-switch",
      actor: "ai", recordedAt: 1, revision: before.snapshot.revision + 2,
      type: "PresenceEnabled", workspaceId: "workspace-2",
    },
  ];
  await expect(store.commit("stream-1", before.snapshot.revision, events)).rejects.toThrow("HUMAN_ACTION_REQUIRED");
  const afterFailure = await store.load("stream-1");
  const eventsAfterFailure = store.events();
  const abortedAfterFailure = effect.signal.aborted;
  finish();

  await expect(invocation).resolves.toMatchObject({ status: "confirmed" });
  expect(afterFailure).toEqual(before);
  expect(eventsAfterFailure).toEqual(eventsBefore);
  expect(abortedAfterFailure).toBe(false);
  expect((await coordinator.snapshot()).presence.workspaceId).toBe("workspace-1");
});

it.each(["workspace-2", "workspace-1"])(
  "does not settle recreated operation IDs with old results after switching to %s", async workspaceId => {
    const { store, coordinator, effect, finish, invocation, availableGrantId } = await pendingVerification();
    const previous = store.snapshotNow().session;
    const entry = previous?.entrySnapshot;
    const agreement = previous?.learningAgreement;
    const workUnit = previous?.workUnit;
    const oldOperation = previous?.operations.at(-1);
    if (previous === undefined || entry === undefined || agreement === undefined ||
        workUnit === undefined || oldOperation === undefined) {
      throw new Error("INVALID_AUTHORITY_FIXTURE");
    }
    await coordinator.setPresence("observing", "workspace-2");
    if (workspaceId === "workspace-1") {
      await coordinator.setPresence("observing", workspaceId);
    }
    const abortedAfterSwitch = effect.signal.aborted;
    const commandBase = () => ({
      protocolVersion: 1 as const, commandId: `recreated-${store.snapshotNow().revision}`,
      expectedRevision: store.snapshotNow().revision, actor: "human" as const, observedAt: 30,
    });
    await coordinator.dispatch({
      ...commandBase(), type: "StartSession", sessionId: previous.sessionId,
    });
    await coordinator.dispatch({
      ...commandBase(), type: "CaptureEntry", entry: { ...entry, workspaceId },
    });
    await coordinator.dispatch({ ...commandBase(), type: "ConfirmLearning", agreement });
    await coordinator.dispatch({ ...commandBase(), type: "SelectMode", mode: "growth" });
    await coordinator.dispatch({
      ...commandBase(), type: "ProposeWorkUnit",
      workUnit: { ...workUnit, status: "proposed", allowedPaths: ["src/new-workspace.ts"], baseline: {} },
    });
    await coordinator.dispatch({ ...commandBase(), type: "AgreeWorkUnit", workUnitId: workUnit.id });
    await coordinator.dispatch({
      ...commandBase(), type: "GrantUserAction", grantId: availableGrantId,
      nativeToolName: "adaptive_pair_run_verification",
    });
    const recreated = await coordinator.dispatch({
      ...commandBase(), actor: "ai", type: "AuthorizeOperation", operationId: oldOperation.id,
      toolName: "pair_run_verification", kind: "check", input: { plan: "npm test" },
      userActionGrantId: availableGrantId,
    });
    finish();
    const result = await invocation;

    expect(abortedAfterSwitch).toBe(true);
    expect(recreated.session).toMatchObject({
      sessionId: previous.sessionId, authorityEpoch: previous.authorityEpoch,
      workUnit: { id: workUnit.id, allowedPaths: ["src/new-workspace.ts"] },
      operations: [{ id: oldOperation.id, authorityEpoch: oldOperation.authorityEpoch, status: "authorized" }],
      userActionGrants: [{ id: availableGrantId, status: "consumed" }],
    });
    expect(recreated.session?.startedAtRevision).toBeGreaterThan(previous.startedAtRevision);
    expect(recreated.session?.operations[0]?.runtimeRevision).toBeGreaterThan(oldOperation.runtimeRevision);
    expect(result).toMatchObject({ status: "cancelled", observation: { stale: true } });
    expect(await coordinator.snapshot()).toEqual(recreated);
    expect(store.events().some(event => event.type === "OperationObserved")).toBe(false);
  },
);
