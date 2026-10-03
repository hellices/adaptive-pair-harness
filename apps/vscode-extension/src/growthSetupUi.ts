import { realpath, stat } from "node:fs/promises";
import { relative } from "node:path";
import * as vscode from "vscode";
import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import type { ActivityLedger } from "./activityLedger.js";
import {
  isSetupText, normalizeGrowthSetupInput, normalizeGrowthSetupPath,
  type GrowthSetupInput, type GrowthSetupStage, type GrowthSetupUi,
} from "./growthSetup.js";
import { withinRoot } from "./workspacePaths.js";

const prompt = async (
  options: vscode.InputBoxOptions,
  signal: AbortSignal,
): Promise<string | undefined> => {
  const cancellation = new vscode.CancellationTokenSource();
  const cancel = (): void => cancellation.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) { cancel(); }
  try {
    return await vscode.window.showInputBox({ ...options, ignoreFocusOut: true }, cancellation.token);
  } finally {
    signal.removeEventListener("abort", cancel);
    cancellation.dispose();
  }
};

const validateText = (value: string): string | undefined =>
  isSetupText(value) ? undefined : "Enter 1–300 characters on one line.";

export class VscodeGrowthSetupUi implements GrowthSetupUi {
  public constructor(
    private readonly snapshotNow: () => PairRuntimeSnapshot,
    private readonly ledger?: ActivityLedger,
  ) {}

  private current(observed: PairRuntimeSnapshot, signal: AbortSignal): boolean {
    const current = this.snapshotNow();
    return !signal.aborted && current.presence.status !== "off" && current.presence.status !== "paused" &&
      current.revision === observed.revision && current.presence.workspaceId === observed.presence.workspaceId &&
      current.session?.sessionId === observed.session?.sessionId &&
      current.session?.startedAtRevision === observed.session?.startedAtRevision &&
      vscode.workspace.isTrusted &&
      vscode.workspace.workspaceFolders?.[0]?.uri.toString() === observed.presence.workspaceId;
  }

  private async selectFile(
    root: vscode.Uri,
    signal: AbortSignal,
    current: () => boolean,
  ): Promise<string | undefined> {
    const selection = await vscode.window.showOpenDialog({
      title: "Adaptive Pair: Select one Growth file", defaultUri: root,
      canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
      openLabel: "Use this file for Growth",
    });
    if (!current() || selection?.length !== 1) { return undefined; }
    const selected = selection[0];
    if (selected?.scheme !== "file" || !withinRoot(root.fsPath, selected.fsPath)) { return undefined; }
    const relativePath = relative(root.fsPath, selected.fsPath).replace(/\\/gu, "/");
    if (normalizeGrowthSetupPath(relativePath) === undefined) { return undefined; }
    signal.throwIfAborted();
    this.ledger?.recordWorkspaceRead();
    const canonicalRoot = await realpath(root.fsPath);
    if (!current()) { return undefined; }
    this.ledger?.recordWorkspaceRead();
    const canonicalFile = await realpath(selected.fsPath);
    if (!current() || !withinRoot(canonicalRoot, canonicalFile)) { return undefined; }
    const allowedPath = normalizeGrowthSetupPath(relative(canonicalRoot, canonicalFile).replace(/\\/gu, "/"));
    if (allowedPath === undefined) { return undefined; }
    this.ledger?.recordWorkspaceRead();
    const file = await stat(canonicalFile);
    return current() && file.isFile() ? allowedPath : undefined;
  }

  public async collect(signal: AbortSignal): Promise<GrowthSetupInput | undefined> {
    const observed = this.snapshotNow();
    const current = (): boolean => this.current(observed, signal);
    if (!current()) { return undefined; }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (root?.scheme !== "file") { return undefined; }
    const objective = await prompt({
      title: "Adaptive Pair: Growth objective", prompt: "What will you implement or repair yourself?",
      validateInput: validateText,
    }, signal);
    if (!current() || objective === undefined || !isSetupText(objective)) { return undefined; }
    const allowedPath = await this.selectFile(root, signal, current);
    if (!current() || allowedPath === undefined) { return undefined; }
    const independentCheck = await prompt({
      title: "Adaptive Pair: Independent variation",
      prompt: "What changed case will you try independently afterward?",
      value: "Repeat the task with a different edge case and verify it independently",
      validateInput: validateText,
    }, signal);
    if (!current() || independentCheck === undefined || !isSetupText(independentCheck)) { return undefined; }
    const verificationPlan = await prompt({
      title: "Adaptive Pair: Verification plan", value: "npm test",
      prompt: "Name a root test/check/lint/typecheck/build script. Running it requires a separate confirmation.",
      validateInput: value => normalizeGrowthSetupInput({ objective, allowedPath, independentCheck, verificationPlan: value })
        === undefined ? "Use an allowlisted package script, such as npm test or npm run check." : undefined,
    }, signal);
    if (!current() || verificationPlan === undefined) { return undefined; }
    return normalizeGrowthSetupInput({ objective, allowedPath, independentCheck, verificationPlan });
  }

  public async confirm(stage: GrowthSetupStage, description: string, signal: AbortSignal): Promise<boolean> {
    const observed = this.snapshotNow();
    if (!this.current(observed, signal)) { return false; }
    const result = await vscode.window.showWarningMessage(
      `Adaptive Pair ${stage} confirmation\n${description}`, { modal: true }, "Continue once",
    );
    return this.current(observed, signal) && result === "Continue once";
  }
}
