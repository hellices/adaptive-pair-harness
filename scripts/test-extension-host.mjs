import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryPath = await realpath(fileURLToPath(new URL("..", import.meta.url)));
const temporaryPrefix = "adaptive-pair-host-";
let ownedRoot;

const exists = async (filePath) => {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
};

const resolveExecutable = async (candidate) => {
  let executable = path.resolve(candidate);
  if (process.platform === "win32" && path.extname(executable).toLowerCase() === ".cmd") {
    const names = { "code.cmd": "Code.exe", "code-insiders.cmd": "Code - Insiders.exe" };
    const name = names[path.basename(executable).toLowerCase()];
    if (name === undefined) throw new Error(`Unsupported VS Code command wrapper: ${executable}. Point VSCODE_EXECUTABLE_PATH at the application executable.`);
    executable = path.resolve(path.dirname(executable), "..", name);
  }
  if (!(await exists(executable))) return undefined;
  executable = await realpath(executable);
  if (process.platform === "win32") {
    try {
      await stat(path.join(path.dirname(executable), "data"));
      throw new Error(`Refusing portable installation ${executable}: its data directory can override isolation.`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return executable;
};

const findExecutable = async () => {
  const override = process.env.VSCODE_EXECUTABLE_PATH;
  if (override !== undefined) {
    const executable = override.trim() && await resolveExecutable(override.trim());
    if (!executable) throw new Error(`VSCODE_EXECUTABLE_PATH does not identify an installed application: ${JSON.stringify(override)}`);
    return executable;
  }
  const localAppData = process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local");
  const installationRoots = process.platform === "win32" ? [
    path.join(localAppData, "Programs"),
    process.env.ProgramFiles ?? "C:\\Program Files",
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
  ] : [];
  for (const [directory, executableName] of [
    ["Microsoft VS Code Insiders", "Code - Insiders.exe"],
    ["Microsoft VS Code", "Code.exe"],
  ]) {
    for (const installationRoot of installationRoots) {
      const executable = await resolveExecutable(path.join(installationRoot, directory, executableName));
      if (executable !== undefined) return executable;
    }
  }
  throw new Error("No installed VS Code found. Set VSCODE_EXECUTABLE_PATH to an existing executable or Windows code[-insiders].cmd. This runner never installs an IDE or dependencies.");
};

const isolatedEnvironment = (root, runId) => {
  const allowed = new Set([
    "path", "pathext", "systemroot", "windir", "systemdrive", "comspec",
    "programfiles", "programfiles(x86)", "programw6432", "processor_architecture",
    "number_of_processors", "lang", "lc_all", "lc_ctype", "tz", "display", "wayland_display",
  ]);
  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([name, value]) => value !== undefined && allowed.has(name.toLowerCase())));
  const pathKey = Object.keys(environment).find((name) => name.toLowerCase() === "path") ?? "PATH";
  environment[pathKey] = `${path.dirname(process.execPath)}${path.delimiter}${environment[pathKey] ?? ""}`;
  const home = path.join(root, "home");
  return {
    ...environment,
    HOME: home,
    USERPROFILE: home,
    ...(process.platform === "win32" ? { HOMEDRIVE: path.parse(home).root.slice(0, 2), HOMEPATH: home.slice(2) } : {}),
    APPDATA: path.join(root, "app-data"),
    LOCALAPPDATA: path.join(root, "local-app-data"),
    XDG_CONFIG_HOME: path.join(root, "home", ".config"),
    XDG_CACHE_HOME: path.join(root, "home", ".cache"),
    XDG_DATA_HOME: path.join(root, "home", ".local", "share"),
    TEMP: path.join(root, "tmp"),
    TMP: path.join(root, "tmp"),
    TMPDIR: path.join(root, "tmp"),
    npm_config_cache: path.join(root, "npm-cache"),
    npm_config_userconfig: path.join(root, "empty.npmrc"),
    npm_config_globalconfig: path.join(root, "empty-global.npmrc"),
    npm_config_update_notifier: "false",
    npm_config_audit: "false",
    npm_config_fund: "false",
    ADAPTIVE_PAIR_HOST_TEST_ROOT: root,
    ADAPTIVE_PAIR_HOST_TEST_RUN_ID: runId,
  };
};

const createFixture = async (root, runId, extensionId) => {
  const workspacePath = path.join(root, "workspace");
  await Promise.all([
    "workspace", "user-data/User", "extensions", "home", "app-data", "local-app-data", "tmp", "npm-cache",
  ].map((directory) => mkdir(path.join(root, directory), { recursive: true })));
  const files = {
    "target.txt": "disk baseline\nsecond line\n",
    "untouched.txt": "unrelated disk baseline\n",
    "denied.txt": "denied disk baseline\n",
    "stale.txt": "stale disk baseline\n",
    "approval-race.txt": "approval race disk baseline\n",
    "unread.txt": "unread disk baseline\n",
    "unopened.txt": "unopened disk baseline\n",
    ".env": "SMOKE_ONLY_SECRET=synthetic-not-a-real-credential\n",
    "package.json": JSON.stringify({
      name: "adaptive-pair-host-fixture", version: "1.0.0", private: true,
      scripts: {
        check: "node validate.cjs pass",
        test: "node validate.cjs fail",
        lint: "node validate.cjs denied",
      },
    }, null, 2),
    "validate.cjs": [
      'const { appendFileSync, readFileSync } = require("node:fs");',
      'const path = require("node:path");',
      'const mode = process.argv[2];',
      'appendFileSync(path.join(__dirname, "check-runs.txt"), `${mode}\\n`);',
      'if (readFileSync(path.join(__dirname, "target.txt"), "utf8") !== "pair edit saved\\nsecond line\\n") {',
      '  console.error("[fixture-check] wrong saved contents exit=23");',
      '  process.exitCode = 23;',
      '} else if (mode === "pass") {',
      '  console.log("[fixture-check] pass exit=0");',
      '} else if (mode === "fail") {',
      '  console.error("[fixture-check] fail exit=7");',
      '  process.exitCode = 7;',
      '} else {',
      '  console.error("[fixture-check] unapproved invocation exit=29");',
      '  process.exitCode = 29;',
      '}',
      '',
    ].join("\n"),
  };
  await Promise.all(Object.entries(files).map(([name, contents]) => writeFile(path.join(workspacePath, name), contents)));
  await writeFile(path.join(root, "outside.txt"), "outside-root smoke sentinel\n");
  await writeFile(path.join(root, "empty.npmrc"), "");
  await writeFile(path.join(root, "empty-global.npmrc"), "");
  await writeFile(path.join(root, "fixture.json"), JSON.stringify({
    runId, repositoryPath, workspacePath, extensionId,
  }, null, 2));
  await writeFile(path.join(root, "user-data", "User", "settings.json"), JSON.stringify({
    "adaptivePair.enabled": false,
    "adaptivePair.model.provider": "local-template",
    "telemetry.telemetryLevel": "off",
    "update.mode": "none",
    "extensions.autoUpdate": false,
    "extensions.autoCheckUpdates": false,
    "extensions.ignoreRecommendations": true,
    "workbench.enableExperiments": false,
    "workbench.startupEditor": "none",
    "window.restoreWindows": "none",
    "files.hotExit": "off",
    "files.autoSave": "off",
    "files.eol": "\n",
    "editor.formatOnSave": false,
    "git.enabled": false,
    "npm.autoDetect": "off",
    "task.autoDetect": "off",
    "typescript.disableAutomaticTypeAcquisition": true,
    "security.workspace.trust.enabled": false,
  }, null, 2));
  return workspacePath;
};

const stopOwnedHost = async (child, output) => {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  output(`[host-runner] Terminating only spawned host PID ${child.pid} and its children.\n`);
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    return;
  }
  await new Promise((resolve) => {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    const killer = spawn(path.join(systemRoot, "System32", "taskkill.exe"),
      ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true, shell: false, env: { SystemRoot: systemRoot }, stdio: ["ignore", "pipe", "pipe"],
      });
    const timer = setTimeout(() => {
      killer.kill();
      killer.stdout.destroy();
      killer.stderr.destroy();
      killer.unref();
      resolve();
    }, 5_000);
    killer.stdout.on("data", output);
    killer.stderr.on("data", output);
    killer.once("error", (error) => { output(`${error.stack ?? error}\n`); clearTimeout(timer); resolve(); });
    killer.once("close", () => { clearTimeout(timer); resolve(); });
  });
};

const runHost = (executable, args, environment, timeoutMs, output) => new Promise((resolve) => {
  const child = spawn(executable, args, {
    cwd: repositoryPath,
    env: environment,
    windowsHide: true,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let reason;
  let settled = false;
  let terminationTimer;
  const finish = (code, signal, error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    clearTimeout(terminationTimer);
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
    child.stdout.destroy();
    child.stderr.destroy();
    child.unref();
    resolve({ pid: child.pid, code, signal, reason, error: error?.stack ?? error?.message });
  };
  const stop = async (stopReason) => {
    if (reason !== undefined || settled) return;
    reason = stopReason;
    output(`[host-runner] ${stopReason}\n`);
    try { await stopOwnedHost(child, output); } catch (error) { output(`${error.stack ?? error}\n`); }
    if (!settled) terminationTimer = setTimeout(() => finish(child.exitCode, child.signalCode), 2_000);
  };
  const onInterrupt = () => { void stop("Interrupted by SIGINT"); };
  const onTerminate = () => { void stop("Interrupted by SIGTERM"); };
  const timer = setTimeout(() => { void stop(`Timeout after ${timeoutMs}ms`); }, timeoutMs);
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  child.stdout.on("data", output);
  child.stderr.on("data", output);
  child.once("error", (error) => finish(null, null, error));
  child.once("close", (code, signal) => finish(code, signal));
});

const main = async () => {
  const timeoutMs = Number(process.env.VSCODE_HOST_TEST_TIMEOUT_MS ?? 120_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000) {
    throw new Error("VSCODE_HOST_TEST_TIMEOUT_MS must be an integer between 1000 and 600000.");
  }
  const executable = await findExecutable();
  const manifest = JSON.parse(await readFile(path.join(repositoryPath, "package.json"), "utf8"));
  const testPath = path.join(repositoryPath, "dist", "test", "host", "smoke.js");
  for (const compiled of [testPath, path.resolve(repositoryPath, manifest.main), path.join(repositoryPath, "dist", "src", "vscode", "pairWorkspaceTools.js")]) {
    if (!(await exists(compiled))) throw new Error(`Missing compiled artifact: ${compiled}. Wait for the workspace-tools implementation, then run npm run compile using the existing dependencies; no installation was attempted.`);
  }
  const temporaryParent = await realpath(tmpdir());
  ownedRoot = await realpath(await mkdtemp(path.join(temporaryParent, temporaryPrefix)));
  const runId = randomUUID();
  console.log(`[host-runner] Isolated diagnostics: ${ownedRoot}`);
  const workspacePath = await createFixture(ownedRoot, runId, `${manifest.publisher}.${manifest.name}`);
  const args = [
    "--new-window", "--disable-extensions", "--disable-updates", "--disable-telemetry",
    "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust", "--disable-gpu",
    "--password-store=basic",
    `--user-data-dir=${path.join(ownedRoot, "user-data")}`,
    `--extensions-dir=${path.join(ownedRoot, "extensions")}`,
    `--extensionDevelopmentPath=${repositoryPath}`,
    `--extensionTestsPath=${testPath}`,
    workspacePath,
  ];
  await writeFile(path.join(ownedRoot, "launch.json"), JSON.stringify({ executable, args, runId, timeoutMs }, null, 2));
  const logPath = path.join(ownedRoot, "host.log");
  const output = (chunk) => { appendFileSync(logPath, chunk); process.stdout.write(chunk); };
  output(`[host-runner] Command: ${[executable, ...args].map((argument) => JSON.stringify(argument)).join(" ")}\n`);
  const exit = await runHost(executable, args, isolatedEnvironment(ownedRoot, runId), timeoutMs, output);
  await writeFile(path.join(ownedRoot, "exit.json"), JSON.stringify(exit, null, 2));
  output(`[host-runner] Exit: ${JSON.stringify(exit)}\n`);
  try { output(await readFile(path.join(ownedRoot, "smoke.log"), "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (exit.code !== 0 || exit.reason !== undefined || exit.error !== undefined) {
    if (Number.isInteger(exit.code) && exit.code > 0 && exit.code <= 255) process.exitCode = exit.code;
    throw new Error(`Extension host failed: ${JSON.stringify(exit)}`);
  }
  const result = JSON.parse(await readFile(path.join(ownedRoot, "smoke-result.json"), "utf8"));
  if (result.runId !== runId || result.extensionId !== `${manifest.publisher}.${manifest.name}` || result.status !== "passed" || !Array.isArray(result.passed) || result.passed.length === 0) {
    throw new Error(`No matching successful real-host report: ${JSON.stringify(result)}`);
  }
  output(`[host-runner] PASS ${result.passed.length} checks on VS Code ${result.vscodeVersion}; host exit 0. No real LLM or approval UI was exercised.\n`);
  if (process.env.VSCODE_HOST_TEST_KEEP_ARTIFACTS === "1") {
    output(`[host-runner] Preserved successful report: ${path.join(ownedRoot, "smoke-result.json")}\n`);
    return;
  }
  const resolved = await realpath(ownedRoot);
  if (resolved !== ownedRoot || path.dirname(resolved) !== temporaryParent || !path.basename(resolved).startsWith(temporaryPrefix) || (await lstat(ownedRoot)).isSymbolicLink()) {
    throw new Error(`Refusing cleanup outside the exact owned temporary directory: ${ownedRoot}`);
  }
  try {
    await rm(resolved, { recursive: true, force: false, maxRetries: 5, retryDelay: 200 });
    console.log("[host-runner] Removed only the successful run's isolated temporary directory.");
  } catch (error) {
    console.warn(`[host-runner] Tests passed; temporary cleanup incomplete at ${ownedRoot}: ${error.message}`);
  }
};

try {
  await main();
} catch (error) {
  console.error(`[host-runner] FAIL ${error.stack ?? error}`);
  if (ownedRoot !== undefined) console.error(`[host-runner] Preserved failure diagnostics and fixture: ${ownedRoot}`);
  process.exitCode ||= 1;
}
