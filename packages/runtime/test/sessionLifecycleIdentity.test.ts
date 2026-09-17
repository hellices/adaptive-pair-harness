import { createRuntime, reduce } from "@adaptive-pair/session-core";
import { FakeClock, FakeIdSource } from "@adaptive-pair/testkit";
import { expect, it } from "vitest";
import { PairCoordinator } from "../src/coordinator.js";
import { InMemoryJournal } from "../src/journal.js";
import { FakeEffectPort } from "./fakes.js";

const fixture = () => {
  const store = new InMemoryJournal("workspace-1");
  const coordinator = new PairCoordinator({
    store, effects: new FakeEffectPort([]), clock: new FakeClock(),
    ids: new FakeIdSource(), streamId: "workspace-1",
  });
  const start = (commandId: string) => coordinator.dispatch({
    protocolVersion: 1, commandId, expectedRevision: store.snapshotNow().revision,
    actor: "human", type: "StartSession", sessionId: "reused-session", observedAt: 1,
  });
  return { store, coordinator, start };
};

it("derives session lifecycle identity from its committed start revision and retains it across observations", async () => {
  const { store, coordinator, start } = fixture();
  await coordinator.setPresence("observing", "workspace-1");
  const started = await start("first-start");
  const observed = await coordinator.observeWorkspace();

  expect(started.session).toMatchObject({ startedAtRevision: started.revision });
  expect(observed.revision).toBeGreaterThan(started.revision);
  expect(observed.session).toMatchObject({ startedAtRevision: started.revision });
  expect(reduce(createRuntime("workspace-1"), store.events())).toEqual(observed);
});

it("does not reuse lifecycle identity after Disable even if the session ID and epoch are reused", async () => {
  const { store, coordinator, start } = fixture();
  const original = await start("first-start");
  await coordinator.setPresence("off");
  await coordinator.setPresence("observing", "workspace-1");
  const recreated = await start("second-start");

  expect(recreated.revision).toBeGreaterThan(original.revision);
  expect(original.session).toMatchObject({ startedAtRevision: original.revision });
  expect(recreated.session).toMatchObject({
    sessionId: original.session?.sessionId,
    authorityEpoch: original.session?.authorityEpoch,
    startedAtRevision: recreated.revision,
  });
  expect(reduce(original, store.events())).toEqual(recreated);
});
