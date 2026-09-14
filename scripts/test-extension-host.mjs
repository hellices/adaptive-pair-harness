// Isolated Extension Host smoke-test runner for the Adaptive Pair Stable
// preview. It never uses the developer's VS Code profile: it creates unique,
// throwaway user-data, extensions, logs, and fixture directories, disables
// Settings Sync and unrelated extensions, preserves artifacts on failure, and
// cleans only its own directories on success.
import { build } from "esbuild";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  downloadAndUnzipVSCode,
  runTests,
} from "@vscode/test-electron";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = resolve(repoRoot, "apps/vscode-extension");
const hostTestDir = resolve(extensionRoot, "test/host");
const compiledDir = resolve(extensionRoot, "dist/host-test");
// The isolated user-data directory holds a Unix domain socket whose absolute
// path must stay under the platform limit (~103 chars on macOS). A deep
// in-repo path overflows it, so runs live under a short, throwaway home-based
// root — never the developer's VS Code profile and never /tmp.
const runsRoot = resolve(homedir(), ".ap-host");
const REQUIRED_MAJOR = 1;
const REQUIRED_MINOR = 136;

const compileHostTests = async () => {
  await rm(compiledDir, { recursive: true, force: true });
  await mkdir(compiledDir, { recursive: true });
  await build({
    absWorkingDir: repoRoot,
    entryPoints: {
      index: join(hostTestDir, "index.ts"),
      smoke: join(hostTestDir, "smoke.ts"),
    },
    outdir: compiledDir,
    outExtension: { ".js": ".cjs" },
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode", "mocha"],
    sourcemap: false,
    logLevel: "warning",
  });
};

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
      const version = JSON.parse(await readFile(candidate.manifest, "utf8")).version;
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
    );
  }
};

const main = async () => {
  await compileHostTests();

  await mkdir(runsRoot, { recursive: true });
  const runDir = await mkdtemp(join(runsRoot, "run-"));
  const fixtureDir = join(runDir, "fixture");
  const userDataDir = join(runDir, "user-data");
  const extensionsDir = join(runDir, "extensions");
  const logsDir = join(runDir, "logs");
  await Promise.all([
    cp(join(hostTestDir, "fixture"), fixtureDir, { recursive: true }),
    mkdir(userDataDir, { recursive: true }),
    mkdir(extensionsDir, { recursive: true }),
    mkdir(logsDir, { recursive: true }),
  ]);

  const { executable, source } = await resolveVsCode();
  console.log(`[host-test] Using ${source}`);
  console.log(`[host-test] Run directory: ${runDir}`);

  try {
    await runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath: extensionRoot,
      extensionTestsPath: join(compiledDir, "index.cjs"),
      launchArgs: [
        fixtureDir,
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
        `--logsPath=${logsDir}`,
        "--disable-extensions",
        "--disable-workspace-trust",
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-updates",
        "--disable-telemetry",
        "--sync=off",
      ],
      extensionTestsEnv: {
        ADAPTIVE_PAIR_HOST_TEST: "1",
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
