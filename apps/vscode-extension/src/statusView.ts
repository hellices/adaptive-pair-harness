import * as vscode from "vscode";
import type { PresenceStatus } from "@adaptive-pair/protocol";

const STATUS_TEXT: Readonly<Record<PresenceStatus, string>> = Object.freeze({
  observing: "$(eye) Pair: observing",
  engaged: "$(comment-discussion) Pair: engaged",
  quiet: "$(mute) Pair: quiet",
  paused: "$(debug-pause) Pair: paused",
  off: "$(circle-slash) Pair: off",
});

export class StatusView implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );

  public constructor() {
    this.item.command = "adaptivePair.enablePresence";
    this.item.tooltip = "Adaptive Pair Pair Presence";
    this.render("off");
    this.item.show();
  }

  public render(status: PresenceStatus): void {
    this.item.text = STATUS_TEXT[status];
  }

  public dispose(): void {
    this.item.dispose();
  }
}
