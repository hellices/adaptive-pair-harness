import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import * as vscode from "vscode";
import { createNativeCheckpoint } from "../../src/nativeCheckpoint.js";
import { requiredHistoryEnvironment, type NativeHistoryApi, type NativeHistoryInvocation } from "./nativeHistoryContracts.js";

const send = async (api: NativeHistoryApi, input: string): Promise<NativeHistoryInvocation> => {
  const count = api.invocations().length;
  await vscode.commands.executeCommand("workbench.action.chat.submit", { inputValue: `@pair ${input}` });
  const deadline = Date.now() + 30_000;
  while (api.invocations().length === count && Date.now() < deadline) { await delay(50); }
  assert.equal(api.invocations().length, count + 1, `No native callback completed for ${input}.`);
  await delay(250);
  const invocation = api.invocations().at(-1);
  assert.ok(invocation);
  return invocation;
};

const repairFixtureAsHuman = async (): Promise<void> => {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder);
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(join(folder.uri.fsPath, "src/retry.mjs")));
  const source = document.getText();
  assert.equal(source.split("attempt <= maxAttempts").length, 2);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(source.length)),
    source.replace("attempt <= maxAttempts", "attempt < maxAttempts"));
  assert.equal(await vscode.workspace.applyEdit(edit), true);
  assert.equal(await document.save(), true);
};

const seed = async (api: NativeHistoryApi): Promise<Record<string, unknown>> => {
  await vscode.commands.executeCommand("adaptivePair.enablePresence");
  await vscode.commands.executeCommand("adaptivePair.startSession");
  assert.equal(api.snapshot().session?.status, "briefing");
  assert.equal(api.snapshot().session?.workUnit, undefined);
  const cancelled = await send(api, "/setup");
  assert.match(cancelled.emitted.join("\n"), /cancelled/u);
  assert.equal(api.snapshot().session?.workUnit, undefined);
  const setup = await send(api, "/setup");
  assert.match(setup.emitted.join("\n"), /setup is complete/u);
  assert.deepEqual(api.metrics().setupConfirmations, [
    { stage: "learning", accepted: true }, { stage: "mode", accepted: false },
    { stage: "learning", accepted: true }, { stage: "mode", accepted: true }, { stage: "work-unit", accepted: true },
  ]);
  assert.equal(api.snapshot().session?.workUnit?.owner, "human");
  assert.equal(api.snapshot().session?.workUnit?.mode, "growth");
  const failed = await send(api, "/check");
  assert.match(failed.emitted.join("\n"), /Product result: \*\*failed\*\*/u);
  await send(api, "/attempt I ran the retry checks and found a boundary failure.");
  await send(api, "/hypothesis The attempt loop may execute beyond its allowed limit.");
  assert.ok(api.snapshot().session?.assistance?.attempt);
  assert.ok(api.snapshot().session?.assistance?.hypothesis);
  await repairFixtureAsHuman();
  const passed = await send(api, "/check");
  assert.match(passed.emitted.join("\n"), /Product result: \*\*passed\*\*/u);
  assert.equal(api.metrics().verificationConfirmations, 2);
  const declined = await send(api, "/checkpoint");
  assert.equal(declined.result?.metadata, undefined);
  assert.match(declined.emitted.join("\n"), /not saved/u);
  const saved = await send(api, "/checkpoint");
  const checkpoint = createNativeCheckpoint(saved.before);
  assert.ok(checkpoint);
  assert.deepEqual(saved.result?.metadata, { adaptivePairCheckpoint: checkpoint });
  assert.equal(api.metrics().checkpointConfirmations, 2);
  assert.deepEqual(saved.before, saved.after);
  return { resource: saved.resource, checkpoint, verification: ["failed", "passed"],
    setupCancellationObserved: true, checkpointDeclineObserved: true };
};

const resume = async (api: NativeHistoryApi): Promise<Record<string, unknown>> => {
  const resource = requiredHistoryEnvironment("ADAPTIVE_PAIR_NATIVE_HISTORY_RESOURCE");
  await vscode.commands.executeCommand("adaptivePair.enablePresence");
  await vscode.commands.executeCommand("workbench.action.chat.openSessionInEditorGroup", { resource: vscode.Uri.parse(resource) });
  const before = api.snapshot();
  const activityBefore = api.activity();
  const restored = await send(api, "/history");
  assert.equal(restored.resource, resource);
  assert.equal(restored.history.status, "available");
  assert.match(restored.emitted.join("\n"), /Historical Adaptive Pair checkpoint/u);
  assert.deepEqual(api.snapshot(), before);
  assert.deepEqual(api.activity(), activityBefore);
  assert.equal(before.session?.workUnit, undefined);
  assert.equal(before.session?.learningAgreement, undefined);
  assert.equal(before.session?.assistance, undefined);
  assert.equal(before.session?.userActionGrants.length ?? 0, 0);
  await vscode.commands.executeCommand("workbench.action.chat.newChat");
  const fresh = await send(api, "/history");
  assert.notEqual(fresh.resource, resource);
  assert.equal(fresh.history.status, "missing");
  assert.match(fresh.emitted.join("\n"), /No checkpoint/u);
  assert.deepEqual(api.snapshot(), before);
  return { resource, history: restored.history, historyChangedRuntime: false, authorityRestored: false,
    freshHistory: fresh.history.status };
};

export const runNativeHistoryDriver = async (api: NativeHistoryApi, context: vscode.ExtensionContext): Promise<void> => {
  const phase = requiredHistoryEnvironment("ADAPTIVE_PAIR_NATIVE_HISTORY_PHASE");
  const manifest = context.extension.packageJSON as { readonly enabledApiProposals?: readonly string[] };
  const evidence: Record<string, unknown> = {
    phase, bootId: api.bootId, hostVersion: vscode.version, nodeVersion: process.versions.node,
    initialPresence: api.snapshot().presence.status, proposals: manifest.enabledApiProposals ?? [],
    copilotExtensions: vscode.extensions.all.filter(extension => /copilot/iu.test(extension.id)).map(extension => extension.id),
  };
  try {
    assert.equal(evidence.initialPresence, "off");
    assert.deepEqual(api.activity(), { documentListeners: 0, timersScheduled: 0, workspaceReads: 0, modelRequests: 0 });
    assert.deepEqual(evidence.proposals, []);
    assert.deepEqual(evidence.copilotExtensions, []);
    const models = await vscode.lm.selectChatModels({ vendor: "adaptive-pair-native-history-fixture" });
    assert.equal(models.length, 1);
    const model = models[0];
    assert.ok(model);
    await vscode.commands.executeCommand("workbench.action.chat.open", { mode: "ask" });
    await vscode.commands.executeCommand("workbench.action.chat.changeModel", { id: model.id, vendor: model.vendor, family: model.family });
    if (phase === "seed") { Object.assign(evidence, await seed(api)); }
    else if (phase === "resume") { Object.assign(evidence, await resume(api)); }
    else { throw new Error(`Unknown native history phase: ${phase}`); }
    assert.equal(api.metrics().modelCalls, 0);
    assert.equal(api.activity().modelRequests, 0);
    evidence.status = "passed";
  } catch (error) {
    evidence.status = "failed";
    evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
    throw error;
  } finally {
    Object.assign(evidence, api.metrics());
    await writeFile(requiredHistoryEnvironment("ADAPTIVE_PAIR_NATIVE_HISTORY_RESULT"), `${JSON.stringify(evidence, null, 2)}\n`);
  }
};
