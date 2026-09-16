import type { PairCommand } from "@adaptive-pair/protocol";
import { expect, it } from "vitest";
import { createInterleavingFixture } from "./coordinatorInterleavingFixtures.js";
import { FakeEffectPort } from "./fakes.js";

it.each([0, 1])("does not grant when cancelled during state read %s", async skip => {
  const { coordinator, store } = createInterleavingFixture(new FakeEffectPort([]));
  const before = store.journal.snapshotNow();
  const reading = store.delayNextLoad(skip);
  const controller = new AbortController();
  const grant = coordinator.grantUserAction("pair_run_verification", controller.signal, {
    runtimeRevision: before.revision,
    authorityEpoch: before.session?.authorityEpoch,
  });
  await reading.reached;
  controller.abort(new Error("grant-cancelled"));
  reading.release();

  await expect(grant).rejects.toThrow("grant-cancelled");
  expect(store.journal.snapshotNow()).toEqual(before);
  expect(store.journal.events()).toEqual([]);
  await expect(coordinator.grantUserAction(
    "pair_run_verification", new AbortController().signal,
  )).resolves.toEqual(expect.any(String));
  expect(store.journal.snapshotNow().session?.userActionGrants).toHaveLength(1);
});

it("does not commit a cancelled grant queued behind an idempotent transition", async () => {
  const { coordinator, store } = createInterleavingFixture(new FakeEffectPort([]));
  const command: PairCommand = {
    protocolVersion: 1,
    commandId: "already-committed-grant",
    expectedRevision: 0,
    actor: "human",
    type: "GrantUserAction",
    grantId: "initial-grant",
    nativeToolName: "adaptive_pair_run_verification",
    observedAt: 1,
  };
  const before = await coordinator.dispatch(command);
  const eventsBefore = store.journal.events();
  const reading = store.delayNextLoad();
  const duplicate = coordinator.dispatch(command);
  await reading.reached;
  const controller = new AbortController();
  const grant = coordinator.grantUserAction("pair_run_verification", controller.signal, {
    runtimeRevision: before.revision,
    authorityEpoch: before.session?.authorityEpoch,
  });
  await coordinator.snapshot();
  controller.abort(new Error("queued-grant-cancelled"));
  reading.release();
  await duplicate;

  await expect(grant).rejects.toThrow("queued-grant-cancelled");
  expect(store.journal.snapshotNow()).toEqual(before);
  expect(store.journal.events()).toEqual(eventsBefore);
});
