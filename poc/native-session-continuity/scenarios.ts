import * as vscode from "vscode";
import { strict as assert } from "node:assert";
import { confirmOwnedDeletion, waitForNativeFork } from "./dialog.js";
import { requiredEnvironment, type Invocation, type ProbeApi, type ProbeEvidence } from "./contracts.js";

const waitFor = async (condition: () => boolean, description: string): Promise<void> => {
  const deadline = Date.now() + 12000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${description}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};

const send = async (api: ProbeApi, prompt: string): Promise<Invocation> => {
  const count = api.getState().invocations.length;
  await vscode.commands.executeCommand("workbench.action.chat.submit", { inputValue: prompt });
  await waitFor(() => api.getState().invocations.length === count + 1, "native participant invocation");
  await new Promise(resolve => setTimeout(resolve, 250));
  const invocation = api.getState().invocations.at(-1);
  assert.ok(invocation);
  return invocation;
};

const hasMarker = (invocation: Invocation, marker: string): boolean =>
  invocation.history.some(turn => turn.metadata?.marker === marker);

export const runScenario = async (api: ProbeApi, evidence: ProbeEvidence): Promise<void> => {
  const phase = requiredEnvironment("AP_NATIVE_PHASE");
  const resourceText = process.env.AP_NATIVE_RESOURCE;
  const resource = resourceText ? vscode.Uri.parse(resourceText) : undefined;
  if (phase === "delete") {
    assert.ok(resource);
    const deletion = vscode.commands.executeCommand("agentSession.delete", { resource, providerType: "local" });
    evidence.deletion = await confirmOwnedDeletion();
    await deletion;
    return;
  }
  if (phase === "peer") {
    assert.ok(resource, "The peer phase requires the original native session.");
    const peer = await send(api, "@nativepeer peer");
    assert.equal(peer.participant, "adaptive-pair.native-continuity-peer", "The expected participant was not invoked.");
    assert.equal(peer.diagnosticSessionResource.value, resource.toString(), "The peer must use the original native session.");
    assert.equal(hasMarker(peer, "seed"), false, "Another participant received the probe's metadata.");
    const own = await send(api, "@nativeprobe after-peer");
    assert.equal(own.participant, "adaptive-pair.native-continuity-probe", "The expected participant was not invoked.");
    assert.equal(own.diagnosticSessionResource.value, resource.toString(), "The probe must use the original native session.");
    assert.ok(hasMarker(own, "seed"));
    assert.equal(hasMarker(own, "peer"), false, "The probe received the peer's metadata.");
    return;
  }
  if (phase === "fork") {
    assert.ok(resource);
    await vscode.commands.executeCommand("workbench.action.chat.forkConversation", resource);
    await waitForNativeFork();
  }
  if (phase === "fresh") await vscode.commands.executeCommand("workbench.action.chat.newChat");
  const invocation = await send(api, `@nativeprobe ${phase}`);
  if (["resume", "fork", "fork-after-delete"].includes(phase)) {
    assert.ok(hasMarker(invocation, "seed"), "The native history did not restore seed metadata.");
    assert.ok(invocation.history.every(turn => turn.metadata?.bootKey !== invocation.bootKey),
      "Historical metadata must come from a different extension process.");
  }
  if (phase === "resume" || phase === "fork-after-delete") {
    assert.equal(invocation.diagnosticSessionResource.value, resource?.toString());
  }
  if (phase === "fork") assert.notEqual(invocation.diagnosticSessionResource.value, resource?.toString());
  if (phase === "fresh" || phase === "seed") assert.deepEqual(invocation.history, []);
};
