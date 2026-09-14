// Isolated Extension Host smoke-test runner for the Adaptive Pair Stable
// preview. It never uses the developer's VS Code profile: it creates unique,
// throwaway user-data, extensions, logs, and fixture directories, seeds a
// deterministic coexistence baseline, disables Settings Sync and unrelated
// extensions, preserves artifacts on failure, and cleans only its own
// directories on success.
//
// The host runs the separate host-test entry point staged in
// `apps/vscode-extension/.host-test`, never the production bundle, so no
// released build can contain a test hook.
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";
import { parseJsonObject, stringField } from "./json.mjs";
import {
  buildHostTestExtension,
  PRODUCTION_MANIFEST_PATH,
  selectStaleRunDirectories,
} from "./host-test-support.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = resolve(repoRoot, "apps/vscode-extension");
const hostTestDir = resolve(extensionRoot, "test/host");
// The isolated user-data directory holds a Unix domain socket whose absolute
// path must stay under the platform limit (~103 chars on macOS). A deep
// in-repo path overflows it, so runs live under a short, throwaway home-based
// root — never the developer's VS Code profile and never /tmp.
const runsRoot = resolve(homedir(), ".ap-host");
const RUN_RETENTION_MS = 24 * 60 * 60 * 1000;
const REQUIRED_MAJOR = 1;
const REQUIRED_MINOR = 136;

/**
 * The clean-profile coexistence baseline seeded before activation. These are
 * real, registered VS Code settings plus an isolated keybinding and a mock
 * existing session-history file; the smoke test hashes all of them before
 * activation, after activation, and after disable.
 */
const SEEDED_SETTINGS = {
  "editor.fontSize": 15,
  "editor.tabSize": 3,
  "editor.defaultFormatter": null,
  "editor.suggestSelection": "recentlyUsed",
  "workbench.colorTheme": "Default Dark Modern",
  "workbench.editorAssociations": { "*.apfixture": "default" },
  "git.enabled": true,
  "chat.commandCenter.enabled": false,
  "chat.detectParticipant.enabled": false,
};

const SEEDED_KEYBINDINGS = [
  {
    key: "ctrl+alt+shift+f9",
    command: "workbench.action.chat.open",
    when: "editorTextFocus",
  },
  {
    key: "ctrl+alt+shift+f10",
    command: "workbench.action.files.save",
  },
];

const SEEDED_SESSION_HISTORY = {
  version: 1,
  sessions: [
    {
      id: "pre-existing-session",
      title: "Existing chat session from before Adaptive Pair",
      createdAt: "2026-01-01T00:00:00.000Z",
      messages: [{ role: "user", text: "unchanged history entry" }],
    },
  ],
};

/** @param {string | undefined} version */
const isCompatible = (version) => {
  const match = /^(\d+)\.(\d+)\./u.exec(version ?? "");
  if (match === null) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > REQUIRED_MAJOR || (major === REQUIRED_MAJOR && minor >= REQUIRED_MINOR);
};

const installedCandidates = () => {
  if (process.platform === "darwin") {
    return [
      {
        executable: "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
        manifest:
          "/Applications/Visual Studio Code.app/Contents/Resources/app/package.json",
      },
    ];
  }
  if (process.platform === "linux") {
    return [
      { executable: "/usr/share/code/code", manifest: "/usr/share/code/resources/app/package.json" },
      { executable: "/usr/bin/code", manifest: "/usr/share/code/resources/app/package.json" },
    ];
  }
  return [];
};

const detectInstalled = async () => {
  for (const candidate of installedCandidates()) {
    if (!existsSync(candidate.executable) || !existsSync(candidate.manifest)) {
      continue;
    }
    try {
      const parsed = parseJsonObject(
        await readFile(candidate.manifest, "utf8"),
        `The VS Code manifest at ${candidate.manifest}`,
      );
      const version = stringField(parsed, "version");
      if (isCompatible(version)) {
        return { executable: candidate.executable, source: `installed VS Code ${version}` };
      }
    } catch {
      // Ignore unreadable manifests and fall through.
    }
  }
  return undefined;
};

const resolveVsCode = async () => {
  const envPath = process.env.VSCODE_EXECUTABLE_PATH;
  if (envPath !== undefined && envPath.length > 0) {
    if (!existsSync(envPath)) {
      throw new Error(`VSCODE_EXECUTABLE_PATH is set but does not exist: ${envPath}`);
    }
    return { executable: envPath, source: `VSCODE_EXECUTABLE_PATH (${envPath})` };
  }

  const requestedVersion = process.env.ADAPTIVE_PAIR_HOST_VERSION;
  if (requestedVersion !== undefined && requestedVersion.length > 0) {
    const executable = await downloadAndUnzipVSCode(requestedVersion);
    return { executable, source: `downloaded VS Code ${requestedVersion}` };
  }

  const installed = await detectInstalled();
  if (installed !== undefined) {
    return installed;
  }

  try {
    const executable = await downloadAndUnzipVSCode("stable");
    return { executable, source: "downloaded VS Code stable" };
  } catch (error) {
    throw new Error(
      "No compatible VS Code executable found. Set VSCODE_EXECUTABLE_PATH, set " +
        "ADAPTIVE_PAIR_HOST_VERSION to download a version, or install VS Code " +
        `>= ${REQUIRED_MAJOR}.${REQUIRED_MINOR}. Download failed: ${String(error)}`,
      { cause: error },
    );
  }
};

/**
 * Remove only this runner's own abandoned run directories: entries named
 * `run-*` directly under `~/.ap-host`, older than one day. Each candidate is
 * re-resolved and re-inspected before deletion, and anything that resolves
 * outside `~/.ap-host` or is not a directory is skipped.
 */
const pruneStaleRuns = async () => {
  if (!existsSync(runsRoot)) {
    return;
  }
  const entries = await readdir(runsRoot, { withFileTypes: true });
  const inspected = [];
  for (const entry of entries) {
    const candidate = resolve(runsRoot, entry.name);
    if (dirname(candidate) !== runsRoot || basename(candidate) !== entry.name) {
      continue;
    }
    const info = await stat(candidate);
    inspected.push({
      name: entry.name,
      isDirectory: info.isDirectory(),
      mtimeMs: info.mtimeMs,
    });
  }

  const stale = selectStaleRunDirectories(inspected, {
    now: Date.now(),
    maxAgeMs: RUN_RETENTION_MS,
  });
  for (const name of stale) {
    const target = resolve(runsRoot, name);
    if (dirname(target) !== runsRoot) {
      continue;
    }
    await rm(target, { recursive: true, force: true });
    console.log(`[host-test] Pruned stale run directory: ${target}`);
  }
};

/** @param {string} userDataDir */
const seedCoexistenceBaseline = async (userDataDir) => {
  const userDir = join(userDataDir, "User");
  const historyPath = join(userDir, "adaptive-pair-host-test", "session-history.json");
  await mkdir(dirname(historyPath), { recursive: true });
  await writeFile(
    join(userDir, "settings.json"),
    `${JSON.stringify(SEEDED_SETTINGS, undefined, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(userDir, "keybindings.json"),
    `${JSON.stringify(SEEDED_KEYBINDINGS, undefined, 2)}\n`,
    "utf8",
  );
  await writeFile(
    historyPath,
    `${JSON.stringify(SEEDED_SESSION_HISTORY, undefined, 2)}\n`,
    "utf8",
  );
  return { settingsPath: join(userDir, "settings.json"), historyPath };
};

const main = async () => {
  const { stagingDir, testsPath } = await buildHostTestExtension();

  await mkdir(runsRoot, { recursive: true });
  await pruneStaleRuns();
  const runDir = await mkdtemp(join(runsRoot, "run-"));
  const fixtureDir = join(runDir, "fixture");
  const userDataDir = join(runDir, "user-data");
  const extensionsDir = join(runDir, "extensions");
  const logsDir = join(runDir, "logs");
  await Promise.all([
    cp(join(hostTestDir, "fixture"), fixtureDir, { recursive: true }),
    mkdir(join(userDataDir, "User"), { recursive: true }),
    mkdir(extensionsDir, { recursive: true }),
    mkdir(logsDir, { recursive: true }),
  ]);
  const { historyPath } = await seedCoexistenceBaseline(userDataDir);

  const { executable, source } = await resolveVsCode();
  console.log(`[host-test] Using ${source}`);
  console.log(`[host-test] Run directory: ${runDir}`);

  try {
    await runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath: stagingDir,
      extensionTestsPath: testsPath,
      launchArgs: [
        fixtureDir,
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
        `--logsPath=${logsDir}`,
        "--disable-extensions",
        // Deterministically establishes the trusted fixture for this run; the
        // untrusted gate is covered separately by the presence-controller unit
        // tests, which drive the real `ensureTrustedWorkspace` path.
        "--disable-workspace-trust",
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-updates",
        "--disable-telemetry",
        "--sync=off",
      ],
      extensionTestsEnv: {
        ADAPTIVE_PAIR_HOST_TEST: "1",
        ADAPTIVE_PAIR_HOST_USER_DATA: userDataDir,
        ADAPTIVE_PAIR_HOST_SESSION_HISTORY: historyPath,
        ADAPTIVE_PAIR_PRODUCTION_MANIFEST: PRODUCTION_MANIFEST_PATH,
      },
    });
  } catch (error) {
    console.error("[host-test] Smoke tests failed.");
    console.error(`[host-test] Preserved artifacts at: ${runDir}`);
    console.error(String(error));
    process.exitCode = 1;
    return;
  }

  if (process.env.VSCODE_HOST_TEST_KEEP_ARTIFACTS === "1") {
    console.log(`[host-test] Passed. Artifacts kept at: ${runDir}`);
  } else {
    await rm(runDir, { recursive: true, force: true });
    console.log("[host-test] Passed. Cleaned isolated run directory.");
  }
};

await main();
