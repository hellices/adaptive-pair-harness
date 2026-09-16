import { describe, expect, it, vi } from "vitest";
import { FakeClock, FakeIdSource, growthRuntime } from "@adaptive-pair/testkit";
import { InMemoryJournal, PairCoordinator } from "../src/index.js";
import { FakeEffectPort } from "./fakes.js";

const createCoordinator = (store: InMemoryJournal, effects = new FakeEffectPort([])) =>
  new PairCoordinator({ store, effects, clock: new FakeClock(), ids: new FakeIdSource(), streamId: "stream-1" });

describe("Pair presence command boundary", () => {
  it("commits workspace binding and Quiet as one atomic batch", async () => {
    const store = new InMemoryJournal("stream-1");
    const commit = vi.spyOn(store, "commit");
    const coordinator = createCoordinator(store);

    const snapshot = await coordinator.setPresence("quiet", "workspace-1");

    expect(snapshot.presence).toMatchObject({ workspaceId: "workspace-1", status: "quiet" });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0]?.[2].map(event => event.type)).toEqual(["PresenceEnabled", "PresenceChanged"]);
  });

  it("keeps command rejection from poisoning later transitions", async () => {
    const store = new InMemoryJournal("stream-1");
    const coordinator = createCoordinator(store);
    const invalid = coordinator.dispatch({
      protocolVersion: 1, commandId: "invalid", expectedRevision: 99,
      actor: "human", observedAt: 1, type: "StartSession", sessionId: "session-1",
    });
    const enabled = coordinator.setPresence("observing", "workspace-1");
    await expect(invalid).rejects.toThrow("STALE_REVISION");
    await expect(enabled).resolves.toMatchObject({ presence: { status: "observing" } });
  });

  it("uses store compare-and-swap across independent coordinators", async () => {
    const store = new InMemoryJournal("stream-1");
    const first = createCoordinator(store);
    const second = createCoordinator(store);
    const command = {
      protocolVersion: 1 as const, commandId: "first", expectedRevision: 0,
      actor: "human" as const, observedAt: 1, type: "StartSession" as const, sessionId: "first-session",
    };
    const results = await Promise.allSettled([
      first.dispatch(command),
      second.dispatch({ ...command, commandId: "second", sessionId: "second-session" }),
    ]);

    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(store.snapshotNow().session?.sessionId).toBe("first-session");
    expect((await store.load("stream-1")).seenCommandIds).toEqual(new Set(["first"]));
  });

  it("ignores observations after queued Disable and clears retained continuity payloads", async () => {
    const store = new InMemoryJournal("stream-1");
    const coordinator = createCoordinator(store);
    await coordinator.setPresence("observing", "workspace-1");
    await coordinator.dispatch({
      protocolVersion: 1, commandId: "start", expectedRevision: store.snapshotNow().revision,
      actor: "human", observedAt: 1, type: "StartSession", sessionId: "old-session",
    });
    await coordinator.observeWorkspace();
    const before = store.snapshotNow().revision;

    await Promise.all([coordinator.setPresence("off"), coordinator.observeWorkspace()]);

    expect(store.snapshotNow()).toMatchObject({
      revision: before + 1,
      presence: { status: "off", observationRevision: 0 },
      session: undefined,
    });
    expect(store.events().some(event => event.type === "SessionStarted")).toBe(false);
    expect((await store.load("stream-1")).seenCommandIds.has("start")).toBe(true);
  });

  it("does not hold the transition queue during effects or revive cleared state", async () => {
    const store = new InMemoryJournal("stream-1", growthRuntime());
    const effects = new FakeEffectPort([], { block: true, ignoreAbort: true });
    const coordinator = createCoordinator(store, effects);
    const signal = new AbortController().signal;
    const userActionId = await coordinator.grantUserAction("pair_run_verification", signal);
    const invocation = coordinator.invokeTool("pair_run_verification", { plan: "npm test" }, signal, { userActionId });
    await vi.waitFor(() => expect(effects.pendingCount()).toBe(1));

    const disabled = await coordinator.setPresence("off");
    await effects.releaseNext({ status: "confirmed", summary: "Too late" });

    await expect(invocation).resolves.toMatchObject({ status: "cancelled" });
    expect(await coordinator.snapshot()).toEqual(disabled);
    expect(disabled.session).toBeUndefined();
  });
});
