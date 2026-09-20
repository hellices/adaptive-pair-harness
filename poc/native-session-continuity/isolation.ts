import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface IsolatedRun {
  readonly directory: string;
  readonly workspace: string;
  readonly userData: string;
}

export const createProbeEnvironment = (run: IsolatedRun): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TMP", "TEMP",
    "DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS",
  ]) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  const home = join(run.directory, "home");
  return {
    ...environment, HOME: home, COPILOT_HOME: join(home, ".copilot"),
    XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"), XDG_CACHE_HOME: join(home, ".cache"),
  };
};

export const createIsolatedRun = async (): Promise<IsolatedRun> => {
  if (process.platform === "win32") throw new Error("This POSIX process-group probe has not been ported to Windows.");
  const root = join(homedir(), ".ap-native");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "run-"));
  const workspace = join(directory, "workspace");
  const userData = join(directory, "user");
  await mkdir(workspace);
  await mkdir(join(userData, "User"), { recursive: true });
  for (const name of ["extensions", "shared", "home"]) await mkdir(join(directory, name));
  await writeFile(join(workspace, "fixture.txt"), "Synthetic native session continuity fixture.\n");
  await writeFile(join(userData, "User", "settings.json"), JSON.stringify({
    "chat.commandCenter.enabled": false,
    "telemetry.telemetryLevel": "off",
    "workbench.startupEditor": "none",
    "extensions.autoCheckUpdates": false,
    "extensions.autoUpdate": false,
    "window.dialogStyle": "custom",
  }));
  return { directory, workspace, userData };
};

export const inspectOwnedPayloads = async (run: IsolatedRun, resourceText: string): Promise<readonly string[]> => {
  const resource = new URL(resourceText);
  if (resource.protocol !== "vscode-chat-session:" || resource.hostname !== "local") {
    throw new Error("The probe can inspect only its synthetic native Local session.");
  }
  const identifier = Buffer.from(resource.pathname.slice(1), "base64").toString("utf8");
  if (!/^[a-f0-9-]{36}$/u.test(identifier)) throw new Error("Unexpected synthetic session identifier.");
  const root = join(run.userData, "User", "workspaceStorage");
  const payloads: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const suffix of ["json", "jsonl"]) {
      try {
        payloads.push(await readFile(join(root, entry.name, "chatSessions", `${identifier}.${suffix}`), "utf8"));
      } catch (error) {
        if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") throw error;
      }
    }
  }
  return payloads;
};
