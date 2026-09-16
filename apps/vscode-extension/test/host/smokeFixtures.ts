import type { LearningAgreement, WorkUnit } from "@adaptive-pair/protocol";
import type { GrowthResponse } from "@adaptive-pair/restraint";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import * as vscode from "vscode";
import type { GrowthModel } from "../../src/modelAdapter.js";
import type { HostTestApi } from "./hostTestApi.js";
import { NetworkProbe, type HttpModuleLike } from "./networkProbe.js";

const EXTENSION_ID = "adaptive-pair.adaptive-pair";

// The probe must wrap the live CommonJS module objects the Extension Host and
// this extension actually call, not a bundler's read-only namespace copy.
const requireHostModule = createRequire(__filename);
const http = requireHostModule("node:http") as HttpModuleLike;
const https = requireHostModule("node:https") as HttpModuleLike;
type RegisterCommand = typeof vscode.commands.registerCommand;
const commandModule = (
  requireHostModule("vscode") as {
    readonly commands: { registerCommand: RegisterCommand };
  }
).commands;
const HOST_EXTENSION_STACK_MARKER =
  "/apps/vscode-extension/.host-test/extension.cjs";

/** Registered native settings that must be byte-identical across the session. */
const NATIVE_SETTINGS = [
  "editor.fontSize",
  "editor.tabSize",
  "workbench.colorTheme",
  "git.enabled",
  "chat.commandCenter.enabled",
  // Default-selection settings a coexisting assistant would plausibly own.
  "editor.defaultFormatter",
  "editor.suggestSelection",
  "workbench.editorAssociations",
  "chat.detectParticipant.enabled",
] as const;

interface ExtensionManifest {
  readonly main?: string;
  readonly enabledApiProposals?: unknown;
  readonly contributes: Record<string, unknown>;
  readonly [field: string]: unknown;
}

/** Declared manifest fields that must match the shipped manifest exactly. */
const MANIFEST_PARITY_FIELDS = [
  "name",
  "publisher",
  "version",
  "engines",
  "activationEvents",
  "contributes",
  "enabledApiProposals",
] as const;

interface HostExports {
  readonly __pairHostTest?: HostTestApi;
}

interface CoexistenceBaseline {
  readonly settingsFile: string;
  readonly keybindingsFile: string;
  readonly sessionHistoryFile: string;
  readonly settings: readonly string[];
  readonly sessionTargetCommands: readonly string[];
}

const requiredEnv = (name: string): string => {
  const value = process.env[name];
  assert.ok(
    value !== undefined && value.length > 0,
    `The host runner did not provide ${name}.`,
  );
  return value;
};

const userDataDir = requiredEnv("ADAPTIVE_PAIR_HOST_USER_DATA");
const settingsPath = join(userDataDir, "User", "settings.json");
const keybindingsPath = join(userDataDir, "User", "keybindings.json");
const sessionHistoryPath = requiredEnv("ADAPTIVE_PAIR_HOST_SESSION_HISTORY");
const productionManifestPath = requiredEnv("ADAPTIVE_PAIR_PRODUCTION_MANIFEST");

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (
  condition: () => boolean,
  description: string,
  timeoutMs = 8_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}.`);
    }
    await sleep(25);
  }
};

const updateWorkspaceFoldersAndWait = async (
  start: number,
  deleteCount: number | undefined,
  ...foldersToAdd: { readonly uri: vscode.Uri; readonly name?: string }[]
): Promise<boolean> => {
  let timeout: NodeJS.Timeout | undefined;
  let listener: vscode.Disposable | undefined;
  const changed = new Promise<void>((resolve, reject) => {
    timeout = setTimeout(() => {
      listener?.dispose();
      reject(new Error("Timed out waiting for the workspace-folder change event."));
    }, 8_000);
    listener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      listener?.dispose();
      resolve();
    });
  });

  const accepted = vscode.workspace.updateWorkspaceFolders(
    start,
    deleteCount,
    ...foldersToAdd,
  );
  if (!accepted) {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    listener?.dispose();
    return false;
  }
  await changed;
  return true;
};

const hashFile = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

const inspectNativeSettings = (): string[] =>
  NATIVE_SETTINGS.map((key) =>
    JSON.stringify(vscode.workspace.getConfiguration().inspect(key) ?? null),
  );

/**
 * The host's own chat/session command surface — the "Session Target" command
 * set a coexisting assistant relies on. Adaptive Pair's namespaced commands are
 * excluded so the comparison isolates native commands only.
 */
const sessionTargetCommands = (commands: readonly string[]): string[] =>
  commands
    .filter((id) => /chat|session/iu.test(id))
    .filter((id) => !id.startsWith("adaptivePair."))
    .sort();

const captureBaseline = async (): Promise<CoexistenceBaseline> => ({
  settingsFile: hashFile(settingsPath),
  keybindingsFile: hashFile(keybindingsPath),
  sessionHistoryFile: hashFile(sessionHistoryPath),
  settings: inspectNativeSettings(),
  sessionTargetCommands: sessionTargetCommands(await vscode.commands.getCommands(true)),
});

const assertBaselineUnchanged = (
  baseline: CoexistenceBaseline,
  actual: CoexistenceBaseline,
  phase: string,
): void => {
  assert.equal(actual.settingsFile, baseline.settingsFile, `${phase}: settings.json changed.`);
  assert.equal(
    actual.keybindingsFile,
    baseline.keybindingsFile,
    `${phase}: keybindings.json changed.`,
  );
  assert.equal(
    actual.sessionHistoryFile,
    baseline.sessionHistoryFile,
    `${phase}: the existing session-history file changed.`,
  );
  assert.deepEqual(actual.settings, baseline.settings, `${phase}: a native setting changed.`);
  const actualSessionTargetCommands = new Set(actual.sessionTargetCommands);
  for (const command of baseline.sessionTargetCommands) {
    assert.ok(
      actualSessionTargetCommands.has(command),
      `${phase}: baseline native Session Target command disappeared: ${command}`,
    );
  }
};

const learningAgreement: LearningAgreement = {
  learningGoals: ["Implement retry control flow"],
  familiarAreas: [],
  humanOwnedCapabilities: ["implementation", "diagnosis", "repair"],
  delegatableWork: [],
  maximumHintLevel: 4,
  independentCheck: "Implement a varied retry with backoff",
};

const growthWorkUnit: WorkUnit = {
  id: "unit-retry",
  objective: "Fix the retry loop so it honors max",
  mode: "growth",
  learningValue: "high",
  capability: "implementation",
  owner: "human",
  allowedPaths: ["src/retry.mjs"],
  acceptanceChecks: ["The retry fixture check passes"],
  verificationPlan: "npm test",
  stoppingCondition: "retry honors max attempts",
  baseline: {},
  status: "proposed",
};

const CORRECT_RETRY_MODULE = `// Human-applied fix: the retry loop now honors max attempts.
export function retryUntil(action, max) {
  let attempts = 0;
  while (attempts < max) {
    attempts += 1;
    if (action(attempts)) {
      return attempts;
    }
  }
  return -1;
}
`;

class GatedGrowthModel implements GrowthModel {
  public reached = false;
  private release!: () => void;
  private readonly gate = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  public constructor(private readonly response: GrowthResponse) {}

  public async request(): Promise<GrowthResponse> {
    this.reached = true;
    await this.gate;
    return this.response;
  }

  public open(): void {
    this.release();
  }
}

const staticModel = (response: GrowthResponse): GrowthModel => ({
  request: () => Promise.resolve(response),
});

const invokeWithAction = async (
  api: HostTestApi,
  name: Parameters<HostTestApi["coordinator"]["invokeTool"]>[0],
  input: Readonly<Record<string, unknown>>,
): Promise<Awaited<ReturnType<HostTestApi["coordinator"]["invokeTool"]>>> => {
  const signal = new AbortController().signal;
  const userActionId = await api.coordinator.grantUserAction(name, signal);
  return api.coordinator.invokeTool(name, input, signal, { userActionId });
};

export interface HostSmokeContext {
  api: HostTestApi;
  workspaceRoot: string;
  baseline: CoexistenceBaseline;
  productionManifest: ExtensionManifest;
  hostManifest: ExtensionManifest;
  contributedCommands: string[];
  activatedCommands: string[];
  baselineCommands: Set<string>;
  probe: NetworkProbe;
  controlledProbeCalls: number;
}

export { assertBaselineUnchanged,captureBaseline,commandModule,CORRECT_RETRY_MODULE,EXTENSION_ID,GatedGrowthModel,growthWorkUnit,hashFile,HOST_EXTENSION_STACK_MARKER,http,https,inspectNativeSettings,invokeWithAction,keybindingsPath,learningAgreement,MANIFEST_PARITY_FIELDS,NATIVE_SETTINGS,productionManifestPath,requiredEnv,requireHostModule,sessionHistoryPath,sessionTargetCommands,settingsPath,sleep,staticModel,updateWorkspaceFoldersAndWait,userDataDir,waitFor,type CoexistenceBaseline,type ExtensionManifest,type HostExports,type RegisterCommand };
