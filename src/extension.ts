import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  status.name = "Adaptive Pair";
  status.text = "$(hubot) Pair: starting";
  status.show();
  context.subscriptions.push(status);
}

export function deactivate(): void {}
