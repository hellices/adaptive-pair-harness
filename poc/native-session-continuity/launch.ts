import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { type Phase, type ProbeEvidence } from "./contracts.js";
import { createProbeEnvironment, type IsolatedRun } from "./isolation.js";
import { runOwnedHost } from "./process.js";

const allocatePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No isolated loopback port was allocated.");
  await new Promise<void>(resolveClose => server.close(() => resolveClose()));
  return address.port;
};

export const launchPhase = async (
  run: IsolatedRun, extensionRoot: string, phase: Phase, resource?: string,
): Promise<ProbeEvidence> => {
  const resultPath = join(run.directory, `${phase}.json`);
  const debugPort = await allocatePort();
  await runOwnedHost(process.env.VSCODE_EXECUTABLE_PATH
    ?? "/Applications/Visual Studio Code.app/Contents/MacOS/Code", [
      run.workspace,
      `--extensionDevelopmentPath=${extensionRoot}`,
      `--user-data-dir=${run.userData}`,
      `--shared-data-dir=${join(run.directory, "shared")}`,
      `--extensions-dir=${join(run.directory, "extensions")}`,
      `--remote-debugging-port=${debugPort}`, "--remote-debugging-address=127.0.0.1", "--locale=en",
      "--disable-extensions", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes",
      "--disable-updates", "--disable-telemetry", "--disable-crash-reporter", "--skip-add-to-recently-opened",
      "--force-disable-user-env", "--use-inmemory-secretstorage", "--sync=off",
    ], {
      ...createProbeEnvironment(run),
      AP_NATIVE_DRIVER: "1", AP_NATIVE_PHASE: phase, AP_NATIVE_RESULT: resultPath,
      AP_NATIVE_RESOURCE: resource ?? "", AP_NATIVE_DEBUG_PORT: String(debugPort),
      AP_NATIVE_WINDOW_TOKEN: run.windowToken,
    }, join(run.directory, `${phase}.log`), phase);
  const result = JSON.parse(await readFile(resultPath, "utf8")) as ProbeEvidence;
  console.log(JSON.stringify({ phase, status: result.status, hostVersion: result.hostVersion,
    invocations: result.state?.invocations.length, modelCalls: result.state?.modelCalls, error: result.error }));
  if (result.phase !== phase || result.status !== "passed" || !result.state) {
    throw new Error(`Native ${phase}: ${result.error ?? "missing or invalid evidence"}`);
  }
  if (!Array.isArray(result.enabledApiProposals) || result.enabledApiProposals.length !== 0) {
    throw new Error(`Native ${phase}: missing or enabled API proposal evidence.`);
  }
  return result;
};
