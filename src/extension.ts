import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  const notReadyMessage = "Adaptive Pair navigator runtime is not active until Task 6.";

  const registerCommand = (command: string): void => {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, () => {
        void vscode.window.showInformationMessage(notReadyMessage);
      }),
    );
  };

  registerCommand("adaptivePair.toggle");
  registerCommand("adaptivePair.reviewCurrentBlock");
  registerCommand("adaptivePair.setApiKey");

  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  status.name = "Adaptive Pair";
  status.text = "$(hubot) Pair: runtime inactive";
  status.show();
  context.subscriptions.push(status);
}

export function deactivate(): void {}
