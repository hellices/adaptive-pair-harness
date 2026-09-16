import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import * as vscode from "vscode";
import * as activationSmoke from "./activationSmoke.js";
import * as continuitySmoke from "./continuitySmoke.js";
import * as growthSmoke from "./growthSmoke.js";
import type { HostTestApi } from "./hostTestApi.js";
import { NetworkProbe, type NetworkCall } from "./networkProbe.js";
import {
  captureBaseline,
  commandModule,
  EXTENSION_ID,
  HOST_EXTENSION_STACK_MARKER,
  http,
  https,
  productionManifestPath,
  type CoexistenceBaseline,
  type ExtensionManifest,
  type HostExports,
  type HostSmokeContext,
  type RegisterCommand,
} from "./smokeFixtures.js";
import * as verificationSmoke from "./verificationSmoke.js";

suite("Adaptive Pair — isolated Extension Host smoke", () => {
  let api: HostTestApi;
  let workspaceRoot: string;
  let baseline: CoexistenceBaseline;
  let productionManifest: ExtensionManifest;
  let hostManifest: ExtensionManifest;
  let contributedCommands: string[];
  let activatedCommands: string[];
  let baselineCommands: Set<string>;
  let probe: NetworkProbe;
  let controlledProbeCalls = 0;

  const context: HostSmokeContext = {
    get api() { return api; },
    get workspaceRoot() { return workspaceRoot; },
    get baseline() { return baseline; },
    get productionManifest() { return productionManifest; },
    get hostManifest() { return hostManifest; },
    get contributedCommands() { return contributedCommands; },
    get activatedCommands() { return activatedCommands; },
    get baselineCommands() { return baselineCommands; },
    get probe() { return probe; },
    get controlledProbeCalls() { return controlledProbeCalls; },
    set controlledProbeCalls(value: number) { controlledProbeCalls = value; },
  };



  suiteSetup(async () => {
    // Scenario 1: a real outbound-network probe is installed before the
    // extension is ever activated, so the inactive window is observed rather
    // than asserted from an in-process counter.
    probe = new NetworkProbe({
      globals: globalThis as { fetch?: NetworkCall },
      http,
      https,
    });
    probe.install();

    baseline = await captureBaseline();
    baselineCommands = new Set(await vscode.commands.getCommands(true));

    productionManifest = JSON.parse(
      readFileSync(productionManifestPath, "utf8"),
    ) as ExtensionManifest;
    contributedCommands = (
      (productionManifest.contributes["commands"] as { command: string }[] | undefined) ?? []
    ).map((entry) => entry.command);

    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, "Adaptive Pair extension was not discovered in the host.");
    hostManifest = extension.packageJSON as ExtensionManifest;

    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "No fixture workspace folder was opened.");
    workspaceRoot = folder.uri.fsPath;

    activatedCommands = [];
    const originalRegisterCommand = commandModule.registerCommand;
    commandModule.registerCommand = ((...args: Parameters<RegisterCommand>) => {
      const stack = new Error().stack?.replaceAll("\\", "/") ?? "";
      if (stack.includes(HOST_EXTENSION_STACK_MARKER)) {
        activatedCommands.push(args[0]);
      }
      return originalRegisterCommand(...args);
    }) as RegisterCommand;

    let exports: HostExports;
    try {
      exports = (await extension.activate()) as HostExports;
    } finally {
      commandModule.registerCommand = originalRegisterCommand;
    }
    assert.ok(
      exports.__pairHostTest,
      "Host test API missing: the host-test entry point was not activated.",
    );
    api = exports.__pairHostTest;
  });



  suiteTeardown(() => {
    probe.restore();
  });

  test("2: installs and activates additively without changing the baseline", () => activationSmoke.checkAdditiveActivation(context));

  test("3: inactive state shows zero observation, timer, workspace, model, and network activity", () => activationSmoke.checkInactiveZero(context));

  test("4 & 5: opens the trusted fixture and enables Pair Presence", () => activationSmoke.enableTrustedPresence(context));

  test("6 & 7: joins a dirty in-progress TypeScript file that stays developer-owned", () => activationSmoke.joinDirtyDeveloperWork(context));

  test("8 & 9: starts Growth Mode; the instruction envelope and tool view share one revision", () => growthSmoke.agreeGrowthWork(context));

  test("10: apply_edit and run_command are unavailable and rejected in Growth", () => growthSmoke.rejectGrowthMutation(context));

  test("10a: public scope tools read and search the real agreed fixture", () => growthSmoke.checkNativeScopeTools());

  test("11: repository takeover injection does not change mode, consent, scope, or the hint ceiling", () => growthSmoke.rejectRepositoryTakeover(context));

  test("12: records a human attempt and diagnosis hypothesis", () => growthSmoke.recordHumanEvidence(context));

  test("13: runs a real fixture test that fails, then passes after the human edit", () => verificationSmoke.verifyHumanRepair(context));

  test("14: /check runs the agreed plan and reports only a product result", () => verificationSmoke.checkDeterministicVerification(context));

  test("15: starts a distinct transfer task recorded as started, never demonstrated", () => growthSmoke.startDistinctTransfer(context));

  test("16: withholds a transfer variation that restates the current objective", () => growthSmoke.withholdRepeatedTransfer(context));

  test("16a: refuses verification when the first root changes after authorization", () => verificationSmoke.rejectChangedWorkspaceRoot(context));

  test("17: pausing during an in-flight hint leaves state exactly unchanged", () => continuitySmoke.discardHintAfterPause(context));

  test("18: restarting reconciles the persisted journal", () => continuitySmoke.checkJournalRestart(context));

  test("19: disable clears Pair continuity while the baseline stays unchanged", () => continuitySmoke.disableAndCheckCoexistence(context));
});
