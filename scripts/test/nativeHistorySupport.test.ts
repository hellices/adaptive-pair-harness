import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runNativeHistorySmoke } from "../native-history-smoke.mjs";
import { deriveNativeHistoryManifest, nativeHistoryEnvironment, nativeHistoryLaunchArguments, prepareNativeHistoryEnvironment, verifyNativeHistoryReports } from "../native-history-support.mjs";

const seed = {
  status: "passed", phase: "seed", bootId: "first-process", hostVersion: "1.138.0",
  modelCalls: 0, tokenCountCalls: 0, proposals: [], copilotExtensions: [], resource: "vscode-chat-session://local/fixture",
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
  it("uses the existing test-electron sandbox flags only for isolated Linux launches", () => {
    expect(nativeHistoryLaunchArguments("linux")).toEqual(["--enable-smoke-test-driver", "--no-sandbox", "--disable-gpu-sandbox"]);
  });

  it("preserves native sandbox defaults on macOS", () => {
    expect(nativeHistoryLaunchArguments("darwin")).toEqual(["--enable-smoke-test-driver"]);
  });

  it("skips optional Windows restart proof without launching or claiming persistence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pair-native-skip-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await expect(runNativeHistorySmoke("unused-native-host", directory, "win32")).resolves.toEqual({
        status: "skipped", platform: "win32", reason: "Native restart proof requires POSIX process groups.",
      });
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/skipped.*win32.*not persistence evidence/iu));
      expect(await readdir(directory)).toEqual([]);
    } finally {
      log.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });

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
    const directory = join(tmpdir(), "owned-native-run");
    const environment = nativeHistoryEnvironment(directory, {
      PATH: "/fixture/node24", DISPLAY: ":99", HOME: "/real/home", GITHUB_TOKEN: "secret",
      NODE_OPTIONS: "--import secret-hook", VSCODE_IPC_HOOK_CLI: "/normal/profile/socket",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/ordinary/bus", XDG_RUNTIME_DIR: "/ordinary/runtime",
      WAYLAND_DISPLAY: "ordinary-wayland", XAUTHORITY: "/fixture/xvfb-auth",
    });
    expect(environment.PATH).toBe("/fixture/node24");
    expect(environment.DISPLAY).toBe(":99");
    expect(environment.XAUTHORITY).toBe("/fixture/xvfb-auth");
    expect(environment.HOME).toBe(join(directory, "home"));
    expect(environment.COPILOT_HOME).toBe(join(directory, "home", ".copilot"));
    expect(environment.XDG_RUNTIME_DIR).toBe(join(directory, "runtime"));
    expect(environment.DBUS_SESSION_BUS_ADDRESS?.startsWith("unix:path=")).toBe(true);
    expect(decodeURIComponent(environment.DBUS_SESSION_BUS_ADDRESS?.slice("unix:path=".length) ?? ""))
      .toBe(join(directory, "runtime", "unavailable-bus"));
    for (const name of ["GITHUB_TOKEN", "NODE_OPTIONS", "VSCODE_IPC_HOOK_CLI", "WAYLAND_DISPLAY"]) {
      expect(environment).not.toHaveProperty(name);
    }
  });

  it("escapes bus paths so caller directory names cannot add fallback addresses", () => {
    const directory = join(tmpdir(), "native,trial;autolaunch:='한'!");
    const address = nativeHistoryEnvironment(directory, {}).DBUS_SESSION_BUS_ADDRESS ?? "";
    expect(address).toMatch(/^unix:path=[A-Za-z0-9_%.*/-]+$/u);
    expect(decodeURIComponent(address.slice("unix:path=".length))).toBe(join(directory, "runtime", "unavailable-bus"));
  });

  it.skipIf(process.platform === "win32")("creates an owned private runtime directory without a bus socket", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pair-native-runtime-"));
    try {
      expect(prepareNativeHistoryEnvironment).toBeTypeOf("function");
      const environment = await prepareNativeHistoryEnvironment(directory, {});
      expect(environment.XDG_RUNTIME_DIR).toBe(join(directory, "runtime"));
      expect((await stat(join(directory, "runtime"))).mode & 0o777).toBe(0o700);
      expect(await readdir(join(directory, "runtime"))).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe("native restart evidence", () => {
  it("requires separate successful launches, matching actual history, and no recovered authority", () => {
    expect(verifyNativeHistoryReports(seed, resumed)).toMatchObject({
      hostVersion: "1.138.0", historicalCheckpointRestored: true, authorityRestored: false,
      modelCalls: 0, tokenCountCalls: 0, verification: ["failed", "passed"],
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

  it.each(["seed", "resume"] as const)("requires explicit zero model and token activity in %s", phase => {
    for (const metric of ["modelCalls", "tokenCountCalls"] as const) {
      for (const value of [undefined, 1]) {
        const changedSeed = phase === "seed" ? { ...seed, [metric]: value } : seed;
        const changedResume = phase === "resume" ? { ...resumed, [metric]: value } : resumed;
        expect(() => verifyNativeHistoryReports(changedSeed, changedResume)).toThrow();
      }
    }
  });
});
