import { describe, expect, it } from "vitest";
import { deriveNativeHistoryManifest, nativeHistoryEnvironment, verifyNativeHistoryReports } from "../native-history-support.mjs";

const seed = {
  status: "passed", phase: "seed", bootId: "first-process", hostVersion: "1.138.0",
  modelCalls: 0, proposals: [], copilotExtensions: [], resource: "vscode-chat-session://local/fixture",
  checkpoint: { format: "adaptive-pair-native-checkpoint", version: 1, mode: "growth", workUnitStatus: "agreed",
    maximumHintLevel: 4, attempt: "recorded", hypothesis: "recorded", hintLevel: null, solutionRevealed: false },
  verification: ["failed", "passed"],
};
const resumed = {
  ...seed, phase: "resume", bootId: "second-process", initialPresence: "off",
  history: { status: "available", checkpoint: seed.checkpoint },
  historyChangedRuntime: false, authorityRestored: false, freshHistory: "missing",
};

describe("native history host isolation", () => {
  it("preserves product contributions and uses only a test-local fixture model", () => {
    const manifest = {
      main: "./dist/extension.cjs", activationEvents: ["onCommand:adaptivePair.enablePresence"],
      contributes: { chatParticipants: [{ id: "adaptivePair.chat" }], commands: [{ command: "adaptivePair.enablePresence" }] },
    };
    const original = structuredClone(manifest);
    const derived = deriveNativeHistoryManifest(manifest);
    expect(derived.main).toBe("./native-history.cjs");
    expect(derived.contributes).toMatchObject(manifest.contributes);
    expect(derived.contributes.languageModelChatProviders).toEqual([
      { vendor: "adaptive-pair-native-history-fixture", displayName: "Adaptive Pair Offline Host Fixture" },
    ]);
    expect(derived.activationEvents).toEqual([...manifest.activationEvents, "onStartupFinished"]);
    expect(derived).not.toHaveProperty("enabledApiProposals");
    expect(manifest).toEqual(original);
  });

  it("rejects a production manifest with proposed APIs", () => {
    expect(() => deriveNativeHistoryManifest({ main: "./extension.cjs", enabledApiProposals: ["chatParticipantPrivate"] }))
      .toThrow(/proposed/u);
  });

  it("does not inherit credentials, normal profile IPC, or global Node hooks", () => {
    const environment = nativeHistoryEnvironment("/owned/run", {
      PATH: "/fixture/node24", DISPLAY: ":99", HOME: "/real/home", GITHUB_TOKEN: "secret",
      NODE_OPTIONS: "--import secret-hook", VSCODE_IPC_HOOK_CLI: "/normal/profile/socket",
    });
    expect(environment.PATH).toBe("/fixture/node24");
    expect(environment.DISPLAY).toBe(":99");
    expect(environment.HOME).toBe("/owned/run/home");
    expect(environment.COPILOT_HOME).toBe("/owned/run/home/.copilot");
    for (const name of ["GITHUB_TOKEN", "NODE_OPTIONS", "VSCODE_IPC_HOOK_CLI"]) {
      expect(environment).not.toHaveProperty(name);
    }
  });
});

describe("native restart evidence", () => {
  it("requires separate successful launches, matching actual history, and no recovered authority", () => {
    expect(verifyNativeHistoryReports(seed, resumed)).toMatchObject({
      hostVersion: "1.138.0", historicalCheckpointRestored: true, authorityRestored: false,
      modelCalls: 0, verification: ["failed", "passed"],
    });
  });

  it.each([
    { bootId: seed.bootId }, { status: "failed" }, { phase: "seed" }, { modelCalls: 1 },
    { proposals: ["chatParticipantPrivate"] }, { copilotExtensions: ["github.copilot-chat"] },
    { history: { status: "missing" } }, { historyChangedRuntime: true }, { authorityRestored: true },
    { initialPresence: "observing" }, { freshHistory: "available" }, { resource: "another-chat" },
  ])("rejects insufficient or unsafe evidence: %j", change => {
    expect(() => verifyNativeHistoryReports(seed, { ...resumed, ...change })).toThrow();
  });

  it("rejects a run without the expected real failing-to-passing verification", () => {
    expect(() => verifyNativeHistoryReports({ ...seed, verification: ["passed"] }, resumed)).toThrow();
  });
});
