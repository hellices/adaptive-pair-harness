import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { finished } from "node:stream/promises";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { parseJsonObject, stringField } from "./json.mjs";
import { deriveNativeHistoryManifest, nativeHistoryLaunchArguments, prepareNativeHistoryEnvironment, verifyNativeHistoryReports } from "./native-history-support.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string} executable @param {string[]} args @param {NodeJS.ProcessEnv} environment @param {string} logPath */
export const runOwnedNativeHost = async (executable, args, environment, logPath) => {
  const log = createWriteStream(logPath, { flags: "wx" });
  const completedLog = finished(log).then(() => undefined,
    (error) => error instanceof Error ? error : new Error("Native log stream failed."));
  const child = spawn(executable, args, { detached: true, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  const state = { failed: false, closed: false, error: new Error("Native host failed.") };
  try {
    await new Promise((resolveExit, rejectExit) => {
      const stop = (error = new Error("Native history phase exceeded 180 seconds.")) => {
        if (state.failed || state.closed) { return; }
        state.failed = true;
        state.error = error;
        if (child.pid === undefined) { return; }
        try { process.kill(-child.pid, "SIGKILL"); }
        catch (signalError) {
          if (typeof signalError === "object" && signalError !== null && "code" in signalError && signalError.code === "ESRCH") { return; }
          clearTimeout(timeout);
          child.stdout.destroy();
          child.stderr.destroy();
          child.unref();
          rejectExit(new AggregateError([error, signalError], "Could not terminate the owned native host."));
        }
      };
      const timeout = setTimeout(stop, 180_000);
      log.once("error", stop);
      child.once("error", stop);
      child.once("close", (code, signal) => {
        state.closed = true;
        clearTimeout(timeout);
        if (state.failed) { rejectExit(state.error); }
        else if (code === 0) { resolveExit(undefined); }
        else { rejectExit(new Error(`Native history host exited with code ${String(code)} and signal ${String(signal)}.`)); }
      });
      child.stdout.pipe(log, { end: false });
      child.stderr.pipe(log, { end: false });
    });
  } catch (error) {
    state.failed = true;
    state.error = error instanceof Error ? error : new Error(String(error));
  } finally {
    child.stdout.unpipe(log);
    child.stderr.unpipe(log);
    log.end();
    await completedLog;
  }
  const logFailure = await completedLog;
  const failure = state.failed ? state.error : logFailure;
  if (failure) {
    const output = await readFile(logPath).catch(() => Buffer.from("Native host log is unavailable."));
    throw new Error(`${failure.message}\nNative host output:\n${output.subarray(-8192).toString("utf8")}`, { cause: failure });
  }
};

/** @param {string} executable @param {string} directory @param {NodeJS.ProcessEnv} environment @param {string} phase @param {string} [resource] */
const launchPhase = async (executable, directory, environment, phase, resource = "") => {
  const resultPath = join(directory, `${phase}.json`);
  await runOwnedNativeHost(executable, [
    ...nativeHistoryLaunchArguments(),
    join(directory, "workspace"), `--extensionDevelopmentPath=${join(directory, "extension")}`,
    `--user-data-dir=${join(directory, "profile")}`, `--extensions-dir=${join(directory, "extensions")}`,
    `--shared-data-dir=${join(directory, "shared")}`, `--logsPath=${join(directory, `${phase}-logs`)}`,
    "--disable-extensions", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes",
    "--disable-updates", "--disable-telemetry", "--disable-crash-reporter", "--skip-add-to-recently-opened",
    "--force-disable-user-env", "--use-inmemory-secretstorage", "--sync=off", "--locale=en", "--verbose",
  ], {
    ...environment, ADAPTIVE_PAIR_NATIVE_HISTORY_TEST: "1",
    ADAPTIVE_PAIR_NATIVE_HISTORY_PHASE: phase, ADAPTIVE_PAIR_NATIVE_HISTORY_RESULT: resultPath,
    ADAPTIVE_PAIR_NATIVE_HISTORY_RESOURCE: resource,
  }, join(directory, `${phase}.log`));
  const report = parseJsonObject(await readFile(resultPath, "utf8"), `Native ${phase} evidence`);
  assert.equal(report.status, "passed", `Native ${phase}: ${stringField(report, "error") ?? "no passing evidence"}`);
  return report;
};

/** @param {string} executable @param {string} ownedRunDirectory @param {NodeJS.Platform} [platform] */
export const runNativeHistorySmoke = async (executable, ownedRunDirectory, platform = process.platform) => {
  if (platform === "win32") {
    const reason = "Native restart proof requires POSIX process groups.";
    console.log(`[host-test] Native restart proof skipped on ${platform}: ${reason} This is not persistence evidence.`);
    return { status: "skipped", platform, reason };
  }
  const directory = join(ownedRunDirectory, "native-history");
  await mkdir(directory);
  const environment = await prepareNativeHistoryEnvironment(directory);
  for (const name of ["extension", "extensions", "shared", "home", "profile/User"]) {
    await mkdir(join(directory, name), { recursive: true });
  }
  await cp(join(repoRoot, "examples/growth-trial"), join(directory, "workspace"), { recursive: true });
  const manifest = parseJsonObject(await readFile(join(repoRoot, "apps/vscode-extension/package.json"), "utf8"), "Product manifest");
  await writeFile(join(directory, "extension/package.json"), `${JSON.stringify(deriveNativeHistoryManifest(manifest), null, 2)}\n`);
  await writeFile(join(directory, "profile/User/settings.json"), JSON.stringify({
    "telemetry.telemetryLevel": "off", "extensions.autoCheckUpdates": false, "extensions.autoUpdate": false,
    "workbench.startupEditor": "none", "chat.commandCenter.enabled": false, "chat.detectParticipant.enabled": false,
    "window.confirmBeforeClose": "never",
  }));
  await build({
    absWorkingDir: repoRoot, entryPoints: ["apps/vscode-extension/test/host/nativeHistoryExtension.host.ts"],
    outfile: join(directory, "extension/native-history.cjs"), bundle: true, platform: "node", format: "cjs",
    target: "node24", external: ["vscode"], sourcemap: false, logLevel: "warning",
  });
  console.log(`[host-test] Native restart proof: ${directory}`);
  const seeded = await launchPhase(executable, directory, environment, "seed");
  const resource = stringField(seeded, "resource");
  assert.ok(resource, "The seed must identify its own native chat.");
  const resumed = await launchPhase(executable, directory, environment, "resume", resource);
  const summary = verifyNativeHistoryReports(seeded, resumed);
  await writeFile(join(directory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`[host-test] Native restart proof passed: ${JSON.stringify(summary)}`);
};
