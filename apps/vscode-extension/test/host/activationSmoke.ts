import { strict as assert } from "node:assert";
import { join } from "node:path";
import * as vscode from "vscode";
import {
  assertBaselineUnchanged,
  captureBaseline,
  MANIFEST_PARITY_FIELDS,
  waitFor,
  type HostSmokeContext,
} from "./smokeFixtures.js";

export const checkAdditiveActivation = async (context: HostSmokeContext): Promise<void> => {
  // The Stable manifest that actually ships carries no proposed API, no chat
  // session contribution, and no keybinding.
  assert.equal(
    context.productionManifest.enabledApiProposals,
    undefined,
    "enabledApiProposals present in the shipped manifest.",
  );
  assert.equal(
    context.productionManifest.contributes["chatSessions"],
    undefined,
    "chatSessions contributed by the shipped manifest.",
  );
  assert.equal(
    context.productionManifest.contributes["keybindings"],
    undefined,
    "keybindings contributed by the shipped manifest.",
  );

  // The host-test development manifest carries the shipped contribution
  // surface verbatim and redirects only `main`, so this run exercises exactly
  // what the VSIX contributes. (VS Code augments `packageJSON` with runtime
  // fields such as `id` and `extensionLocation`, so only declared manifest
  // fields are compared.)
  for (const field of MANIFEST_PARITY_FIELDS) {
    assert.deepEqual(
      context.hostManifest[field],
      context.productionManifest[field],
      `The host-test manifest diverges from the shipped manifest at ${field}.`,
    );
  }
  assert.equal(
    context.productionManifest.main,
    "./dist/extension.cjs",
    "The shipped manifest does not point at the production bundle.",
  );
  assert.equal(
    context.hostManifest.main,
    "./extension.cjs",
    "The host-test manifest does not point at the host-test bundle.",
  );

  for (const command of context.contributedCommands) {
    assert.ok(
      command.startsWith("adaptivePair."),
      `Adaptive Pair contributes a non-namespaced command: ${command}`,
    );
  }

  const after = await vscode.commands.getCommands(true);
  const afterSet = new Set(after);

  assert.deepEqual(
    [...context.activatedCommands].sort(),
    [...context.contributedCommands].sort(),
    "Activation did not register exactly the commands contributed by Adaptive Pair.",
  );

  for (const command of context.baselineCommands) {
    assert.ok(afterSet.has(command), `A baseline command disappeared: ${command}`);
  }
  for (const command of context.contributedCommands) {
    assert.ok(afterSet.has(command), `Adaptive Pair command missing: ${command}`);
  }
  assert.ok(afterSet.has("workbench.action.chat.open"), "Native Chat command missing.");

  assertBaselineUnchanged(context.baseline, await captureBaseline(), "after activation");
};

export const checkInactiveZero = (context: HostSmokeContext): void => {
  assert.deepEqual(context.api.activity(), {
    documentListeners: 0,
    timersScheduled: 0,
    workspaceReads: 0,
    modelRequests: 0,
  });
  assert.equal(context.api.getState().presenceStatus, "off");
  assert.equal(context.api.getState().documentListenerActive, false);

  // Observed, not assumed: the probe saw no outbound call at all.
  assert.equal(context.probe.count, 0, `Inactive network calls observed: ${context.probe.calls.join(", ")}`);

  // The probe is not vacuous: one controlled call through each wrapped entry
  // point is counted, with the downstream implementation short-circuited so
  // no traffic is emitted.
  const proof = context.probe.proveCountsWithoutNetwork();
  assert.equal(proof.before, 0);
  assert.equal(proof.after, 5);
  assert.deepEqual(proof.labels, [
    "fetch",
    "http.request",
    "http.get",
    "https.request",
    "https.get",
  ]);
  context.controlledProbeCalls = context.probe.count;
};

export const enableTrustedPresence = async (context: HostSmokeContext): Promise<void> => {
  // The runner launches with `--disable-workspace-trust`, which deterministically
  // establishes a trusted fixture for this run; the untrusted gate itself is
  // covered by the presence-controller unit tests, which drive the real
  // `ensureTrustedWorkspace` refusal path.
  assert.equal(vscode.workspace.isTrusted, true, "Fixture workspace is not trusted.");

  await vscode.commands.executeCommand("adaptivePair.enablePresence");

  assert.equal(context.api.getState().presenceStatus, "observing");
  // A live document listener now exists — the ledger counter is real, not fixed.
  assert.ok(context.api.activity().documentListeners >= 1, "Enable did not attach a listener.");
};

export const joinDirtyDeveloperWork = async (context: HostSmokeContext): Promise<void> => {
  const uri = vscode.Uri.file(join(context.workspaceRoot, "src/retry.ts"));
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document);
  const timersBefore = context.api.activity().timersScheduled;
  await editor.edit((builder) =>
    builder.insert(new vscode.Position(0, 0), "// developer work in progress\n"),
  );
  assert.equal(document.isDirty, true, "The TypeScript file is not dirty.");

  await vscode.commands.executeCommand("adaptivePair.joinInProgress");

  const snapshot = await context.api.coordinator.snapshot();
  assert.equal(snapshot.session?.status, "briefing", "Join did not enter briefing.");
  assert.ok(
    snapshot.session?.entrySnapshot?.dirtyPaths.includes("src/retry.ts"),
    "The dirty file was not captured in the entry snapshot.",
  );
  // Developer-owned: no work unit yet, and the AI cannot edit.
  assert.equal(context.api.getState().contextKeys["adaptivePair.aiCanEdit"], false);
  assert.ok(context.api.activity().workspaceReads >= 1, "Join did not read the workspace.");

  // The developer's own edit drives the real observation path, so the shared
  // production scheduler counter must move off zero too.
  await waitFor(
    () => context.api.activity().timersScheduled > timersBefore,
    "the observed edit to schedule an episode timer",
  );
  assert.ok(
    context.api.activity().timersScheduled > timersBefore,
    "Observing a developer edit scheduled no timer.",
  );
};
