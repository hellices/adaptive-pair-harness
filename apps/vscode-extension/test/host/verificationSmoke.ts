import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import type { GrowthModel } from "../../src/modelAdapter.js";
import {
  CORRECT_RETRY_MODULE,
  invokeWithAction,
  updateWorkspaceFoldersAndWait,
  waitFor,
  type HostSmokeContext,
} from "./smokeFixtures.js";

export const verifyHumanRepair = async (context: HostSmokeContext): Promise<void> => {
  const first = await invokeWithAction(context.api, "pair_run_verification", {
    script: "test",
    targetPaths: ["src/retry.mjs"],
  });
  assert.equal(first.status, "confirmed", `First verification status: ${first.status}`);
  assert.equal(first.observation["passed"], false, "First verification unexpectedly passed.");

  // The human applies their fix on disk (the AI never edits in Growth Mode).
  writeFileSync(join(context.workspaceRoot, "src/retry.mjs"), CORRECT_RETRY_MODULE, "utf8");

  const second = await invokeWithAction(context.api, "pair_run_verification", {
    script: "test",
    targetPaths: ["src/retry.mjs"],
  });
  assert.equal(second.status, "confirmed", `Second verification status: ${second.status}`);
  assert.equal(second.observation["passed"], true, "Second verification did not pass.");
};

export const checkDeterministicVerification = async (context: HostSmokeContext): Promise<void> => {
  let modelRequests = 0;
  const model: GrowthModel = {
    request: () => {
      modelRequests += 1;
      return Promise.resolve({
        level: 0,
        kind: "question",
        text: "unused",
      });
    },
  };
  const result = await context.api.driveGrowthTurn({
    command: "check",
    prompt: "",
    grantConsent: true,
    model,
  });

  const text = result.emitted.join("\n");
  assert.ok(/passed/u.test(text), `The /check route did not report a passed run: ${text}`);
  assert.ok(
    text.toLowerCase().includes("demonstrates no growth outcome"),
    "The /check route did not separate the product result from Growth outcomes.",
  );
  // Deterministic: the route runs the agreed script without any model turn.
  assert.equal(
    result.evaluations.length,
    0,
    "The /check route recorded a model-turn evaluation.",
  );
  assert.equal(modelRequests, 0, "The /check route called the model.");
};

export const rejectChangedWorkspaceRoot = async (context: HostSmokeContext): Promise<void> => {
  const replacementRoot = mkdtempSync(
    join(tmpdir(), "adaptive-pair-replacement-root-"),
  );
  const marker = join(replacementRoot, "unexpected-run.txt");
  writeFileSync(
    join(replacementRoot, "package.json"),
    JSON.stringify({
      private: true,
      scripts: {
        test:
          "node -e \"require('node:fs').writeFileSync('unexpected-run.txt', 'ran')\"",
      },
    }),
    "utf8",
  );
  const signal = new AbortController().signal;
  const userActionId = await context.api.coordinator.grantUserAction(
    "pair_run_verification",
    signal,
  );
  let replacementInserted = false;

  try {
    assert.equal(
      await updateWorkspaceFoldersAndWait(0, 0, {
        uri: vscode.Uri.file(replacementRoot),
        name: "replacement-root",
      }),
      true,
      "The host refused to insert a replacement first root.",
    );
    replacementInserted = true;
    await waitFor(
      () =>
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ===
        replacementRoot,
      "the replacement root to become first",
    );

    const result = await context.api.coordinator.invokeTool(
      "pair_run_verification",
      { script: "test", targetPaths: ["src/retry.mjs"] },
      signal,
      { userActionId },
    );

    assert.equal(
      result.status,
      "declined",
      `Verification used the replacement root: ${result.status}.`,
    );
    assert.equal(
      existsSync(marker),
      false,
      "The replacement workspace package script executed.",
    );
  } finally {
    if (replacementInserted) {
      assert.equal(
        await updateWorkspaceFoldersAndWait(0, 1),
        true,
        "The host refused to remove the replacement first root.",
      );
      await waitFor(
        () =>
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ===
          context.workspaceRoot,
        "the original fixture root to become first again",
      );
    }
    rmSync(replacementRoot, { recursive: true, force: true });
  }
};
