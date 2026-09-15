import * as vscode from "vscode";
import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";

const CONTEXT_KEYS = Object.freeze({
  presenceEnabled: "adaptivePair.presenceEnabled",
  sessionActive: "adaptivePair.sessionActive",
  mode: "adaptivePair.mode",
  aiCanEdit: "adaptivePair.aiCanEdit",
});

export type PairToolContextValues = Readonly<{
  [CONTEXT_KEYS.presenceEnabled]: boolean;
  [CONTEXT_KEYS.sessionActive]: boolean;
  [CONTEXT_KEYS.mode]: string;
  [CONTEXT_KEYS.aiCanEdit]: boolean;
}>;

const EMPTY_CONTEXT: PairToolContextValues = Object.freeze({
  [CONTEXT_KEYS.presenceEnabled]: false,
  [CONTEXT_KEYS.sessionActive]: false,
  [CONTEXT_KEYS.mode]: "",
  [CONTEXT_KEYS.aiCanEdit]: false,
});

const deriveContext = (
  snapshot: PairRuntimeSnapshot,
): PairToolContextValues => {
  const presenceEnabled =
    snapshot.presence.status !== "off" && snapshot.presence.status !== "paused";
  const session = snapshot.session;
  const sessionActive =
    presenceEnabled &&
    session !== undefined &&
    session.status !== "inactive" &&
    session.status !== "closed" &&
    session.status !== "paused";
  const mode = sessionActive ? (session?.mode ?? "") : "";
  const aiCanEdit =
    sessionActive &&
    (mode === "pair" || mode === "delivery") &&
    session?.workUnit?.owner === "ai" &&
    session.workUnit.status === "agreed";

  return Object.freeze({
    [CONTEXT_KEYS.presenceEnabled]: presenceEnabled,
    [CONTEXT_KEYS.sessionActive]: sessionActive,
    [CONTEXT_KEYS.mode]: mode,
    [CONTEXT_KEYS.aiCanEdit]: aiCanEdit,
  });
};

export class PairToolContext implements vscode.Disposable {
  private revision = -1;
  private disposed = false;
  private current = EMPTY_CONTEXT;

  public values(): PairToolContextValues {
    return this.current;
  }

  public clear(): void {
    if (this.disposed) {
      return;
    }

    this.revision = -1;
    this.current = EMPTY_CONTEXT;
    for (const [key, value] of Object.entries(EMPTY_CONTEXT)) {
      void vscode.commands.executeCommand("setContext", key, value);
    }
  }

  public async accept(snapshot: PairRuntimeSnapshot): Promise<void> {
    if (this.disposed || snapshot.revision < this.revision) {
      return;
    }

    this.revision = snapshot.revision;
    this.current = deriveContext(snapshot);
    await Promise.all(
      Object.entries(this.current).map(([key, value]) =>
        vscode.commands.executeCommand("setContext", key, value)
      ),
    );
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.clear();
    this.disposed = true;
  }
}
