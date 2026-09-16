import { EditEpisodeAggregator, type EditEpisode, type Scheduler } from "@adaptive-pair/evidence";
import { ObservationWindow } from "@adaptive-pair/presence";
import type { PresenceStatus } from "@adaptive-pair/protocol";
import * as vscode from "vscode";
import { ActivityLedger } from "./activityLedger.js";
import { observationScheduler } from "./observationScheduler.js";
import { SessionController } from "./sessionController.js";
import { StatusView } from "./statusView.js";
import {
  JournalIntegrityError,
  LocalJournal,
  NodeJournalFileSystem,
  type JournalEvent,
  type JournalFileSystem,
} from "./storageAdapter.js";
import { PairToolContext, type PairToolContextValues } from "./tools/pairToolContext.js";

export interface AdaptivePairExtensionApi {
  getState(): {
    readonly presenceStatus: PresenceStatus;
    readonly sessionStatus: string;
    readonly runtimeRevision: number;
    readonly observationCount: number;
    readonly documentListenerActive: boolean;
    readonly contextKeys: PairToolContextValues;
  };
}

const OBSERVATION_CAPACITY = 50;

export interface PresenceControllerOptions {
  readonly scheduler?: Scheduler;
  readonly journalFileSystem?: JournalFileSystem;
  readonly ledger?: ActivityLedger;
}

export class PresenceController implements vscode.Disposable {
  private observationWindow = new ObservationWindow(OBSERVATION_CAPACITY);
  private documentListener: vscode.Disposable | undefined;
  private disposed = false;
  private lifecycleGeneration = 0;
  private journal: LocalJournal | undefined;
  private editAggregator: EditEpisodeAggregator | undefined;
  private journalRestorationGeneration = 0;
  private readonly journalFileSystem: JournalFileSystem;
  private readonly scheduler: Scheduler;
  private readonly ledger: ActivityLedger | undefined;

  public constructor(
    private readonly sessionController: SessionController,
    private readonly statusView: StatusView,
    private readonly toolContext: PairToolContext,
    options: PresenceControllerOptions = {},
  ) {
    this.ledger = options.ledger;
    this.journalFileSystem =
      options.journalFileSystem ?? new NodeJournalFileSystem();
    this.scheduler = observationScheduler(options.scheduler, this.ledger);
    this.toolContext.clear();
    this.statusView.render("off");
  }

  public register(context: vscode.ExtensionContext): void {
    this.initializeJournal(context);
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "adaptivePair.enablePresence",
        async () => await this.enablePresence(),
      ),
      vscode.commands.registerCommand(
        "adaptivePair.stayQuiet",
        async () => await this.stayQuiet(),
      ),
      vscode.commands.registerCommand(
        "adaptivePair.pausePresence",
        async () => await this.pausePresence(),
      ),
      vscode.commands.registerCommand(
        "adaptivePair.disablePresence",
        async () => await this.disablePresence(),
      ),
      vscode.commands.registerCommand(
        "adaptivePair.startSession",
        async () => await this.startSession(),
      ),
      vscode.commands.registerCommand(
        "adaptivePair.joinInProgress",
        async () => await this.joinInProgress(),
      ),
      this,
    );
  }

  public getState(): {
    readonly presenceStatus: PresenceStatus;
    readonly sessionStatus: string;
    readonly runtimeRevision: number;
    readonly observationCount: number;
    readonly documentListenerActive: boolean;
    readonly contextKeys: PairToolContextValues;
  } {
    const snapshot = this.sessionController.snapshotNow();
    return {
      presenceStatus: snapshot.presence.status,
      sessionStatus: snapshot.session?.status ?? "inactive",
      runtimeRevision: snapshot.revision,
      observationCount: this.observationWindow.snapshot().length,
      documentListenerActive: this.documentListener !== undefined,
      contextKeys: this.toolContext.values(),
    };
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.lifecycleGeneration += 1;
    this.detachObservationListener();
    this.editAggregator?.dispose();
    this.toolContext.dispose();
    this.statusView.dispose();
    this.sessionController.dispose();
  }

  private enablePresence(): Promise<void> {
    return this.runTrustedAction("enablePresence");
  }

  private stayQuiet(): Promise<void> {
    return this.runTrustedAction("stayQuiet");
  }

  private async pausePresence(): Promise<void> {
    this.lifecycleGeneration += 1;
    this.editAggregator?.clear();
    this.toolContext.clear();
    this.detachObservationListener();
    await this.sessionController.pausePresence();
    await this.applyCurrentSnapshot();
  }

  private async disablePresence(): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      "Disable Adaptive Pair Presence and clear local continuity?",
      { modal: true },
      "Disable and clear",
    );
    if (choice != "Disable and clear") {
      return;
    }

    await this.performDisable();
  }

  /**
   * Disable Pair Presence and clear local continuity. This is the runtime
   * effect of the disable command with the interactive confirmation already
   * resolved; the host smoke test invokes it directly to avoid a blocking modal
   * while exercising the real clearing and journal-deletion path.
   */
  public async performDisable(): Promise<void> {
    this.lifecycleGeneration += 1;
    this.journalRestorationGeneration += 1;
    this.editAggregator?.clear();
    this.toolContext.clear();
    this.detachObservationListener();
    this.observationWindow = new ObservationWindow(OBSERVATION_CAPACITY);
    await this.sessionController.disablePresence();
    await this.clearJournal();
    await this.applyCurrentSnapshot();
  }

  /**
   * Initialize this controller's journal against an existing storage directory
   * and reconcile the persisted edit episodes, without registering any command
   * or listener. The host smoke test uses this on a fresh controller to prove
   * that a restart reconciles the durable on-disk journal.
   */
  public async reconcileFromStorage(storagePath: string): Promise<void> {
    this.journal = new LocalJournal(this.journalFileSystem, storagePath);
    this.editAggregator = new EditEpisodeAggregator(
      500,
      this.scheduler,
      episode => this.journalEditEpisode(episode),
    );
    await this.reconcileJournal();
  }

  private startSession(): Promise<void> {
    return this.runTrustedAction("startSession");
  }

  private joinInProgress(): Promise<void> {
    return this.runTrustedAction("joinInProgress");
  }

  private async runTrustedAction(
    action: "enablePresence" | "stayQuiet" | "startSession" | "joinInProgress",
  ): Promise<void> {
    const generation = this.lifecycleGeneration;
    if (
      this.disposed ||
      !(await this.ensureTrustedWorkspace()) ||
      !this.isCurrentGeneration(generation)
    ) {
      return;
    }

    try {
      await this.sessionController[action]();
      if (!this.isCurrentGeneration(generation)) {
        return;
      }
      if (action === "startSession" && this.sessionController.snapshotNow().session?.status === "paused") {
        await vscode.window.showInformationMessage(
          "Use Join Work in Progress to resume the paused Pair session.",
        );
      }
      if (this.isCurrentGeneration(generation)) {
        await this.applyCurrentSnapshot();
      }
    } catch (error) {
      if (this.isCurrentGeneration(generation)) {
        throw error;
      }
    }
  }

  private isCurrentGeneration(generation: number): boolean {
    return !this.disposed && generation === this.lifecycleGeneration;
  }

  private async applyCurrentSnapshot(): Promise<void> {
    if (this.disposed) {
      return;
    }
    const snapshot = this.sessionController.snapshotNow();
    this.statusView.render(snapshot.presence.status);
    if (snapshot.presence.status === "off" || snapshot.presence.status === "paused") {
      this.detachObservationListener();
    } else {
      this.ensureObservationListener();
    }
    await this.toolContext.accept(snapshot);
  }

  private async ensureTrustedWorkspace(): Promise<boolean> {
    if (vscode.workspace.isTrusted) {
      return true;
    }

    this.toolContext.clear();
    this.detachObservationListener();
    this.statusView.render("off");
    await vscode.window.showWarningMessage(
      "Adaptive Pair requires a trusted workspace before enabling Pair Presence.",
    );
    return false;
  }

  private ensureObservationListener(): void {
    if (this.documentListener !== undefined) {
      return;
    }

    const generation = this.lifecycleGeneration;
    this.documentListener = vscode.workspace.onDidChangeTextDocument(event => {
      const status = this.sessionController.snapshotNow().presence.status;
      if (
        !this.isCurrentGeneration(generation) ||
        status === "off" || status === "paused" ||
        event.contentChanges.length === 0
      ) {
        return;
      }

      if (vscode.workspace.getWorkspaceFolder(event.document.uri) === undefined) {
        return;
      }

      this.observationWindow.record({
        kind: "edit-episode",
        summary: `Observed local change in ${vscode.workspace.asRelativePath(event.document.uri)}.`,
        observedAt: Date.now(),
      });
      void this.sessionController.bumpObservationRevision()
        .catch(() => {
          if (this.isCurrentGeneration(generation)) {
            return this.failClosed("state-commit", "workspace observation");
          }
        })
        .catch(() => {
          this.toolContext.clear();
          this.detachObservationListener();
        });
      this.recordEditObservation(event);
    });
    this.ledger?.recordListenerAttached();
  }

  private detachObservationListener(): void {
    if (this.documentListener === undefined) {
      return;
    }
    this.documentListener.dispose();
    this.documentListener = undefined;
    this.ledger?.recordListenerDetached();
  }

  private initializeJournal(context: vscode.ExtensionContext): void {
    const storagePath = context.globalStorageUri?.fsPath;
    if (storagePath === undefined || storagePath.length === 0) {
      return;
    }

    this.journal = new LocalJournal(this.journalFileSystem, storagePath);
    this.editAggregator = new EditEpisodeAggregator(
      500,
      this.scheduler,
      episode => this.journalEditEpisode(episode),
    );

    void this.reconcileJournal();
  }

  /**
   * Replay the persisted journal after a restart and reconcile durable edit
   * episodes back into the observation window so Pair continuity survives a host
   * reload. Reading the extension's own global storage is not a workspace read
   * and attaches no listener, timer, model, or network activity.
   */
  private async reconcileJournal(): Promise<void> {
    const journal = this.journal;
    if (journal === undefined) {
      return;
    }
    const restorationGeneration = this.journalRestorationGeneration;

    let events: readonly JournalEvent[];
    try {
      events = await journal.replay();
    } catch (error: unknown) {
      this.handleJournalFailure(error);
      return;
    }

    if (restorationGeneration !== this.journalRestorationGeneration) {
      return;
    }

    for (const event of events) {
      if (event.type !== "edit-episode") {
        continue;
      }
      const uri =
        typeof event.payload.uri === "string" ? event.payload.uri : "a tracked file";
      this.observationWindow.record({
        kind: "edit-episode",
        summary: `Reconciled a persisted local change in ${uri}.`,
        observedAt: event.capturedAt,
      });
    }
  }

  private async clearJournal(): Promise<void> {
    const journal = this.journal;
    if (journal === undefined) {
      return;
    }
    try {
      await journal.clear();
    } catch (error: unknown) {
      this.handleJournalFailure(error);
    }
  }

  private recordEditObservation(event: vscode.TextDocumentChangeEvent): void {
    const aggregator = this.editAggregator;
    if (aggregator === undefined) {
      return;
    }

    const version =
      typeof event.document.version === "number" ? event.document.version : 0;
    const changedRanges = event.contentChanges.map(change => ({
      startLine: change.range.start.line,
      endLine: change.range.end.line,
    }));

    aggregator.record({
      uri: vscode.workspace.asRelativePath(event.document.uri, false),
      languageId: event.document.languageId ?? "plaintext",
      previousVersion: Math.max(0, version - 1),
      currentVersion: version,
      changedRanges,
      observedAt: Date.now(),
    });
  }

  private journalEditEpisode(episode: EditEpisode): void {
    const event: JournalEvent = {
      type: "edit-episode",
      capturedAt: episode.observedAt,
      payload: {
        uri: episode.uri,
        languageId: episode.languageId,
        previousVersion: episode.previousVersion,
        currentVersion: episode.currentVersion,
        changedRanges: episode.changedRanges.map(range => ({
          startLine: range.startLine,
          endLine: range.endLine,
        })),
      },
    };

    this.appendJournalEvent(event);
  }

  private appendJournalEvent(event: JournalEvent): void {
    const journal = this.journal;
    if (journal === undefined) {
      return;
    }

    void journal.append(event).catch((error: unknown) => {
      this.handleJournalFailure(error);
    });
  }

  private handleJournalFailure(error: unknown): void {
    const reason =
      error instanceof JournalIntegrityError
        ? `integrity:${error.reason}`
        : "io-error";
    void this.failClosed(reason);
  }

  private async failClosed(reason: string, source = "local journal"): Promise<void> {
    await this.pausePresence();
    if (this.disposed) {
      return;
    }
    await vscode.window.showWarningMessage(
      `Adaptive Pair paused: ${source} unavailable (${reason}).`,
    );
  }
}
