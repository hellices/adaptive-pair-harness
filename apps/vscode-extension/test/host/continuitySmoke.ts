import { strict as assert } from "node:assert";
import * as vscode from "vscode";
import {
  assertBaselineUnchanged,
  captureBaseline,
  GatedGrowthModel,
  sleep,
  waitFor,
  type HostSmokeContext,
} from "./smokeFixtures.js";

export const discardHintAfterPause = async (context: HostSmokeContext): Promise<void> => {
  const model = new GatedGrowthModel({
    level: 1,
    kind: "hint",
    text: "GATED_LATE_OUTPUT_MUST_NOT_APPEAR",
  });

  const turn = context.api.driveGrowthTurn({
    command: "hint",
    prompt: "one small hint please",
    grantConsent: true,
    model,
  });

  await waitFor(() => model.reached, "the in-flight hint model");
  await vscode.commands.executeCommand("adaptivePair.pausePresence");
  // State captured at pause time: the late result must change nothing at all.
  const paused = await context.api.coordinator.snapshot();
  model.open();
  const result = await turn;

  const text = result.emitted.join("\n");
  assert.ok(!text.includes("GATED_LATE_OUTPUT_MUST_NOT_APPEAR"), "Late output was emitted.");
  assert.ok(text.toLowerCase().includes("discarded"), "Stale turn was not reported.");

  const after = await context.api.coordinator.snapshot();
  assert.equal(after.revision, paused.revision, "The late result changed the runtime revision.");
  assert.deepEqual(
    after.session?.assistance,
    paused.session?.assistance,
    "The late result changed assistance state.",
  );
  assert.equal(context.api.getState().presenceStatus, "paused", "Presence did not pause.");
};

export const checkJournalRestart = async (context: HostSmokeContext): Promise<void> => {
  // Give the debounced edit aggregator time to flush the observed edit to the
  // durable on-disk journal, then prove a fresh controller reconciles it.
  let reconciled = await context.api.restartReconcile();
  const deadline = Date.now() + 10_000;
  while (reconciled.observationCount === 0 && Date.now() < deadline) {
    await sleep(100);
    reconciled = await context.api.restartReconcile();
  }
  assert.ok(
    reconciled.observationCount > 0,
    "A fresh activation did not reconcile any persisted episode from disk.",
  );
};

export const disableAndCheckCoexistence = async (context: HostSmokeContext): Promise<void> => {
  await context.api.performDisable();

  assert.equal(context.api.getState().presenceStatus, "off");
  const reconciled = await context.api.restartReconcile();
  assert.equal(reconciled.observationCount, 0, "Continuity was not cleared on disable.");

  assertBaselineUnchanged(context.baseline, await captureBaseline(), "after disable");

  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes("workbench.action.chat.open"), "Native Chat command lost.");

  // No outbound network call happened at any point beyond the controlled
  // probe calls this suite made itself.
  assert.equal(
    context.probe.count,
    context.controlledProbeCalls,
    `Unexpected outbound network calls: ${context.probe.calls.join(", ")}`,
  );
};
