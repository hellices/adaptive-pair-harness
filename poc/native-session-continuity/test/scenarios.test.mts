import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runScenario } from "../scenarios.js";
import type { FixtureMetadata, Invocation, ProbeApi, ProbeEvidence } from "../contracts.js";

const commands = vi.hoisted(() => ({ executeCommand: vi.fn<() => Promise<void>>() }));
vi.mock("vscode", () => ({ commands, Uri: { parse: (value: string) => ({ toString: () => value }) } }));

const resource = "vscode-chat-session://local/owned-fixture";
const participant = "adaptive-pair.native-continuity-probe";
const peerParticipant = "adaptive-pair.native-continuity-peer";
const seed: FixtureMetadata = {
  fixture: "adaptive-pair-native-continuity/v1", marker: "seed", bootKey: "previous-boot",
  authorityRestored: false, automaticReplayAllowed: false,
};

beforeEach(() => {
  vi.useFakeTimers();
  commands.executeCommand.mockReset();
  vi.stubEnv("AP_NATIVE_PHASE", "peer");
  vi.stubEnv("AP_NATIVE_RESOURCE", resource);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const invocation = (identity: string, prompt: string, history: Invocation["history"]): Invocation => ({
  participant: identity, prompt, history, bootKey: "current-boot", contextKeys: [], requestKeys: [],
  diagnosticSessionResource: { value: resource },
});

const exercise = async (peer: Invocation, own: Invocation): Promise<unknown> => {
  const invocations: Invocation[] = [];
  const queued = [peer, own];
  const api: ProbeApi = { getState: () => ({
    invocations, bootKey: "current-boot", modelCalls: 0, tokenCountCalls: 0, disposalApi: "fixture", disposalEvents: [],
  }) };
  commands.executeCommand.mockImplementation(() => {
    const next = queued.shift();
    if (!next) throw new Error("Unexpected fixture invocation.");
    invocations.push(next);
    return Promise.resolve();
  });
  const evidence: ProbeEvidence = { hostVersion: "1.138.0", nodeVersion: "24.18.1", phase: "peer" };
  const outcome = runScenario(api, evidence).then(() => undefined, (error: unknown) => error);
  await vi.runAllTimersAsync();
  return outcome;
};

it("accepts metadata isolation between the expected participants in the same native session", async () => {
  const result = await exercise(
    invocation(peerParticipant, "peer", []),
    invocation(participant, "after-peer", [{ participant, metadata: seed }]),
  );
  expect(result).toBeUndefined();
  expect(commands.executeCommand).toHaveBeenCalledTimes(2);
});

it.each(["peer-resource", "own-resource", "peer-participant", "own-participant"])(
  "rejects false isolation evidence from %s", async mismatch => {
    const peer = invocation(peerParticipant, "peer", []);
    const own = invocation(participant, "after-peer", [{ participant, metadata: seed }]);
    const changedPeer = mismatch === "peer-resource"
      ? { ...peer, diagnosticSessionResource: { value: "unrelated-session" } }
      : mismatch === "peer-participant" ? { ...peer, participant: "unrelated-participant" } : peer;
    const changedOwn = mismatch === "own-resource"
      ? { ...own, diagnosticSessionResource: { value: "unrelated-session" } }
      : mismatch === "own-participant" ? { ...own, participant: "unrelated-participant" } : own;
    const result = await exercise(changedPeer, changedOwn);
    expect(result).toBeInstanceOf(Error);
    expect(String(result)).toMatch(/original native session|expected participant/u);
  },
);
