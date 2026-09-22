import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseJsonObject, stringArrayField, stringField } from "./json.mjs";

export const NATIVE_HISTORY_VENDOR = "adaptive-pair-native-history-fixture";

export const nativeHistoryLaunchArguments = (platform = process.platform) => [
  "--enable-smoke-test-driver", ...(platform === "linux" ? ["--no-sandbox", "--disable-gpu-sandbox"] : []),
];

/** @param {Record<string, unknown>} manifest */
export const deriveNativeHistoryManifest = (manifest) => {
  assert.ok(stringField(manifest, "main"), "The production manifest needs a main entry.");
  assert.ok(!Object.hasOwn(manifest, "enabledApiProposals"), "The trial cannot enable proposed APIs.");
  const contributes = parseJsonObject(JSON.stringify(manifest.contributes ?? {}), "Production contributions");
  return {
    ...manifest,
    main: "./native-history.cjs",
    activationEvents: [...stringArrayField(manifest, "activationEvents"), "onStartupFinished"],
    contributes: {
      ...contributes,
      languageModelChatProviders: [{ vendor: NATIVE_HISTORY_VENDOR, displayName: "Adaptive Pair Offline Host Fixture" }],
    },
  };
};

/** @param {string} directory @param {NodeJS.ProcessEnv} [source] @returns {NodeJS.ProcessEnv} */
export const nativeHistoryEnvironment = (directory, source = process.env) => {
  const environment = Object.fromEntries([
    "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TMP", "TEMP", "DISPLAY",
    "XAUTHORITY", "SystemRoot", "WINDIR",
  ].flatMap(key => source[key] === undefined ? [] : [[key, source[key]]]));
  const home = join(directory, "home");
  const runtime = join(directory, "runtime");
  const busPath = encodeURIComponent(join(runtime, "unavailable-bus"))
    .replace(/[!'()~]/gu, character => `%${character.charCodeAt(0).toString(16)}`);
  return {
    ...environment, HOME: home, COPILOT_HOME: join(home, ".copilot"),
    XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"), XDG_CACHE_HOME: join(home, ".cache"),
    XDG_RUNTIME_DIR: runtime, DBUS_SESSION_BUS_ADDRESS: `unix:path=${busPath}`,
  };
};

/** @param {string} directory @param {NodeJS.ProcessEnv} [source] */
export const prepareNativeHistoryEnvironment = async (directory, source = process.env) => {
  await mkdir(join(directory, "runtime"), { mode: 0o700 });
  return nativeHistoryEnvironment(directory, source);
};

/** @param {Record<string, unknown>} seed @param {Record<string, unknown>} resumed */
export const verifyNativeHistoryReports = (seed, resumed) => {
  for (const report of [seed, resumed]) {
    assert.equal(report.status, "passed", "Both native launches must pass.");
    assert.ok(stringField(report, "bootId"), "Each process needs its own identity.");
    assert.ok(stringField(report, "hostVersion"), "The actual host version must be recorded.");
    assert.equal(report.modelCalls, 0, "Local checkpoint routes must make no model requests.");
    assert.equal(report.tokenCountCalls, 0, "Local checkpoint routes must make no token-count requests.");
    assert.deepEqual(report.proposals, [], "No API proposals may be enabled.");
    assert.deepEqual(report.copilotExtensions, [], "The fixture must not use an authenticated Copilot extension.");
  }
  assert.equal(seed.phase, "seed");
  assert.equal(resumed.phase, "resume");
  assert.notEqual(seed.bootId, resumed.bootId, "History must survive a separate extension process.");
  assert.equal(seed.hostVersion, resumed.hostVersion);
  assert.ok(stringField(seed, "resource"), "The driver must identify its synthetic native chat.");
  assert.equal(seed.resource, resumed.resource, "The same native chat must be reopened.");
  assert.ok(seed.checkpoint, "The seed must return an actual checkpoint.");
  assert.deepEqual(resumed.history, { status: "available", checkpoint: seed.checkpoint });
  assert.deepEqual(seed.verification, ["failed", "passed"]);
  assert.equal(resumed.initialPresence, "off");
  assert.equal(resumed.historyChangedRuntime, false);
  assert.equal(resumed.authorityRestored, false);
  assert.equal(resumed.freshHistory, "missing");
  return {
    hostVersion: seed.hostVersion, phases: ["seed", "resume"], separateProcesses: true,
    historicalCheckpointRestored: true, authorityRestored: false, freshChatHasNoCheckpoint: true,
    modelCalls: 0, tokenCountCalls: 0, verification: seed.verification,
  };
};
