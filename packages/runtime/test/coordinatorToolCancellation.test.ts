import { nativeToolName, toolsFor, type PairToolName } from "@adaptive-pair/harness";
import type { PairCommand } from "@adaptive-pair/protocol";
import { describe, expect, it } from "vitest";
import { inputForTool } from "./coordinatorFixtures.js";
import { createInterleavingFixture } from "./coordinatorInterleavingFixtures.js";
import { FakeEffectPort } from "./fakes.js";

const prepareTool = async (name: PairToolName) => {
  const effects = new FakeEffectPort([]);
  const fixture = createInterleavingFixture(effects);
  const snapshot = fixture.store.journal.snapshotNow();
  const descriptor = toolsFor(snapshot).tools.find(candidate => candidate.name === name);
  const userActionId = descriptor?.requiresExplicitUserAction === true
    ? await fixture.coordinator.grantUserAction(name, new AbortController().signal)
    : undefined;
  return {
    ...fixture,
    effects,
    input: inputForTool(name, snapshot),
    options: userActionId === undefined ? {} : { userActionId },
  };
};

describe.each([
  "pair_record_attempt",
  "pair_record_hypothesis",
  "pair_request_hint",
] as const)("cancelled local %s commands", name => {
  it.each([0, 1])("does not consume a grant or change state during read %s", async skip => {
    const { coordinator, store, effects, input, options } = await prepareTool(name);
    const before = store.journal.snapshotNow();
    const eventsBefore = store.journal.events();
    const reading = store.delayNextLoad(skip);
    const controller = new AbortController();
    const invocation = coordinator.invokeTool(name, input, controller.signal, options);
    await reading.reached;
    controller.abort(new Error("local-command-cancelled"));
    reading.release();

    await expect(invocation).rejects.toThrow("local-command-cancelled");
    expect(store.journal.snapshotNow()).toEqual(before);
    expect(store.journal.events()).toEqual(eventsBefore);
    expect(effects.calls).toEqual([]);
  });

  it("does not commit after cancellation behind an idempotent transition", async () => {
    const { coordinator, store, effects, input, options } = await prepareTool(name);
    const before = store.journal.snapshotNow();
    const eventsBefore = store.journal.events();
    const grantEvent = eventsBefore[0];
    if (grantEvent === undefined || options.userActionId === undefined) {
      throw new Error("Expected the prepared human-action grant");
    }
    const duplicateCommand: PairCommand = {
      protocolVersion: 1,
      commandId: grantEvent.commandId,
      expectedRevision: 0,
      actor: "human",
      type: "GrantUserAction",
      grantId: options.userActionId,
      nativeToolName: nativeToolName(name),
      observedAt: 1,
    };
    const reading = store.delayNextLoad();
    const barrier = coordinator.dispatch(duplicateCommand);
    await reading.reached;
    const controller = new AbortController();
    const invocation = coordinator.invokeTool(name, input, controller.signal, options);
    await coordinator.snapshot();
    controller.abort(new Error("queued-command-cancelled"));
    reading.release();
    await barrier;

    await expect(invocation).rejects.toThrow("queued-command-cancelled");
    expect(store.journal.snapshotNow()).toEqual(before);
    expect(store.journal.events()).toEqual(eventsBefore);
    expect(effects.calls).toEqual([]);
  });

  it("retains valid uncancelled local actions", async () => {
    const { coordinator, store, effects, input, options } = await prepareTool(name);
    const before = store.journal.snapshotNow();

    await expect(coordinator.invokeTool(
      name, input, new AbortController().signal, options,
    )).resolves.toMatchObject({ status: "confirmed" });
    expect(store.journal.snapshotNow().revision).toBeGreaterThan(before.revision);
    expect(store.journal.snapshotNow().session?.userActionGrants.at(-1)?.status).toBe("consumed");
    expect(effects.calls).toEqual([]);
  });
});

describe.each(["pair_read_scope", "pair_run_verification"] as const)("cancelled %s authorization", name => {
  it.each([0, 1])("does not authorize an operation during read %s", async skip => {
    const { coordinator, store, effects, input, options } = await prepareTool(name);
    const before = store.journal.snapshotNow();
    const eventsBefore = store.journal.events();
    const reading = store.delayNextLoad(skip);
    const controller = new AbortController();
    const invocation = coordinator.invokeTool(name, input, controller.signal, options);
    await reading.reached;
    controller.abort(new Error("authorization-cancelled"));
    reading.release();

    await expect(invocation).rejects.toThrow("authorization-cancelled");
    expect(store.journal.snapshotNow()).toEqual(before);
    expect(store.journal.events()).toEqual(eventsBefore);
    expect(effects.calls).toEqual([]);
  });
});

it("does not return a state query cancelled while its snapshot is pending", async () => {
  const { coordinator, store, effects } = await prepareTool("pair_get_state");
  const before = store.journal.snapshotNow();
  const reading = store.delayNextLoad();
  const controller = new AbortController();
  const invocation = coordinator.invokeTool("pair_get_state", {}, controller.signal);
  await reading.reached;
  controller.abort(new Error("state-query-cancelled"));
  reading.release();

  await expect(invocation).rejects.toThrow("state-query-cancelled");
  expect(store.journal.snapshotNow()).toEqual(before);
  expect(effects.calls).toEqual([]);
});

it("does not roll back an action committed before cancellation", async () => {
  const { coordinator, store, input, options } = await prepareTool("pair_record_attempt");
  const acknowledgement = store.delayCommit("AttemptRecorded");
  const controller = new AbortController();
  const invocation = coordinator.invokeTool("pair_record_attempt", input, controller.signal, options);
  const committed = await acknowledgement.reached;
  controller.abort(new Error("cancelled-after-commit"));
  acknowledgement.release();

  await expect(invocation).resolves.toMatchObject({ status: "confirmed", runtimeRevision: committed.revision });
  expect(store.journal.snapshotNow()).toEqual(committed);
});
