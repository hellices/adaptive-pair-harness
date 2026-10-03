import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchPhase } from "./launch.js";
import { createIsolatedRun, inspectOwnedPayloads } from "./isolation.js";
import { type ProbeEvidence } from "./contracts.js";

const extensionRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const run = await createIsolatedRun();
console.log(`Native continuity artifacts: ${run.directory}`);

const resourceFrom = (result: ProbeEvidence): string => {
  const resource = result.state?.invocations[0]?.diagnosticSessionResource.value;
  assert.ok(resource, "The diagnostic-only driver could not locate its synthetic session.");
  return resource;
};

try {
  const seeded = await launchPhase(run, extensionRoot, "seed");
  const resource = resourceFrom(seeded);
  const stored = await inspectOwnedPayloads(run, resource);
  const physicalSeedWitness = stored.some(payload => payload.includes("adaptive-pair-native-continuity/v1"));
  assert.ok(physicalSeedWitness,
    "The seed must be physically persisted by the native host, not only an in-memory test service.");
  const resumed = await launchPhase(run, extensionRoot, "resume", resource);
  const forked = await launchPhase(run, extensionRoot, "fork", resource);
  const forkResource = resourceFrom(forked);
  for (const restored of [resumed, forked]) {
    const marker = restored.state?.invocations[0]?.history.find(turn => turn.metadata?.marker === "seed");
    assert.equal(marker?.metadata?.bootKey, seeded.state?.bootKey);
  }
  const peer = await launchPhase(run, extensionRoot, "peer", resource);
  const deleted = await launchPhase(run, extensionRoot, "delete", resource);
  const originalPayloadRemoved = (await inspectOwnedPayloads(run, resource)).length === 0;
  assert.ok(originalPayloadRemoved, "Native deletion did not remove the original payload.");
  const forkPayloadRetained = (await inspectOwnedPayloads(run, forkResource)).length > 0;
  assert.ok(forkPayloadRetained, "Deleting the original unexpectedly removed the fork.");
  const retained = await launchPhase(run, extensionRoot, "fork-after-delete", forkResource);
  const fresh = await launchPhase(run, extensionRoot, "fresh");
  const phases = [seeded, resumed, forked, peer, deleted, retained, fresh];
  const summary = {
    hostVersion: seeded.hostVersion, nodeVersion: seeded.nodeVersion, platform: process.platform, architecture: process.arch,
    phases: phases.map(result => ({ phase: result.phase, status: result.status })),
    physicalSeedWitness, originalPayloadRemoved, forkPayloadRetained,
    allBootKeysDistinct: new Set(phases.map(result => result.state?.bootKey)).size === phases.length,
    totalModelCalls: phases.reduce((total, result) => total + (result.state?.modelCalls ?? 0), 0),
    totalTokenCountCalls: phases.reduce((total, result) => total + (result.state?.tokenCountCalls ?? NaN), 0),
    copilotExtensionsLoaded: phases.some(result => (result.copilot?.length ?? 0) > 0),
    proposalsEnabled: phases.some(result => (result.enabledApiProposals?.length ?? 1) > 0),
  };
  assert.equal(summary.allBootKeysDistinct, true);
  assert.equal(summary.totalModelCalls, 0);
  assert.ok(Number.isSafeInteger(summary.totalTokenCountCalls) && summary.totalTokenCountCalls >= 0);
  assert.equal(summary.copilotExtensionsLoaded, false);
  assert.equal(summary.proposalsEnabled, false);
  await writeFile(join(run.directory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
