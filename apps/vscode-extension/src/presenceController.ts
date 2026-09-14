import * as vscode from "vscode";
import { ObservationWindow } from "@adaptive-pair/presence";
import {
  EditEpisodeAggregator,
  type EditEpisode,
  type Scheduler,
} from "@adaptive-pair/evidence";
import type { PresenceStatus } from "@adaptive-pair/protocol";
import { SessionController } from "./sessionController.js";
import { StatusView } from "./statusView.js";
import {
  LocalJournal,
  JournalIntegrityError,
  NodeJournalFileSystem,
  type JournalEvent,
} from "./storageAdapter.js";
import {
  PairToolContext,
  type PairToolContextValues,
} from "./tools/pairToolContext.js";

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

export class PresenceController implements vscode.Disposable {
  private observationWindow = new ObservationWindow(OBSERVATION_CAPACITY);
  private documentListener: vscode.Disposable | undefined;
  private disposed = false;
  private journal: LocalJournal | undefined;
  private editAggregator: EditEpisodeAggregator | undefined;
  private readonly scheduler: Scheduler = {
    schedule: (delayMs, callback) => setTimeout(callback, delayMs),
    cancel: handle => {
      if (handle !== undefined) {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      }
    },
  };

  public constructor(
    private readonly sessionController: SessionController,
    private readonly statusView: StatusView,
    private readonly toolContext: PairToolContext,
  ) {
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
    this.detachObservationListener();
    this.editAggregator?.dispose();
    this.toolContext.dispose();
    this.statusView.dispose();
    this.sessionController.dispose();
  }

  private async enablePresence(): Promise<void> {
    if (!(await this.ensureTrustedWorkspace())) {
      return;
    }

    await this.applySnapshot(await this.sessionController.enablePresence());
  }

  private async stayQuiet(): Promise<void> {
    if (!(await this.ensureTrustedWorkspace())) {
      return;
    }

    await this.applySnapshot(await this.sessionController.stayQuiet());
  }

  private async pausePresence(): Promise<void> {
    this.toolContext.clear();
    this.detachObservationListener();
    const snapshot = await this.sessionController.pausePresence();
    this.statusView.render(snapshot.presence.status);
    await this.toolContext.accept(snapshot);
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

    this.toolContext.clear();
    this.detachObservationListener();
    this.observationWindow = new ObservationWindow(OBSERVATION_CAPACITY);
    const snapshot = this.sessionController.disablePresence();
    this.statusView.render(snapshot.presence.status);
    await this.toolContext.accept(snapshot);
  }

  private async startSession(): Promise<void> {
    if (!(await this.ensureTrustedWorkspace())) {
      return;
    }

    const snapshot = await this.sessionController.startSession();
    if (snapshot.session?.status === "paused") {
      await vscode.window.showInformationMessage(
        "Use Join Work in Progress to resume the paused Pair session.",
      );
    }
    await this.applySnapshot(snapshot);
  }

  private async joinInProgress(): Promise<void> {
    if (!(await this.ensureTrustedWorkspace())) {
      return;
    }

    await this.applySnapshot(await this.sessionController.joinInProgress());
  }

  private async applySnapshot(snapshot: ReturnType<SessionController["snapshotNow"]>): Promise<void> {
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

    this.documentListener = vscode.workspace.onDidChangeTextDocument(event => {
      if (!event.document.isDirty) {
        return;
      }

      this.observationWindow.record({
        kind: "edit-episode",
        summary: `Observed local change in ${vscode.workspace.asRelativePath(event.document.uri)}.`,
        observedAt: Date.now(),
      });
      this.sessionController.bumpObservationRevision();
      this.recordEditObservation(event);
    });
  }

  private detachObservationListener(): void {
    this.documentListener?.dispose();
    this.documentListener = undefined;
  }

  private initializeJournal(context: vscode.ExtensionContext): void {
    const storagePath = context.globalStorageUri?.fsPath;
    if (storagePath === undefined || storagePath.length === 0) {
      return;
    }

    this.journal = new LocalJournal(new NodeJournalFileSystem(), storagePath);
    this.editAggregator = new EditEpisodeAggregator(
      500,
      this.scheduler,
      episode => this.journalEditEpisode(episode),
    );

    void this.journal.replay().catch((error: unknown) => {
      if (error instanceof JournalIntegrityError) {
        void this.failClosed(error);
      }
    });
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
      if (error instanceof JournalIntegrityError) {
        void this.failClosed(error);
      }
    });
  }

  private async failClosed(error: JournalIntegrityError): Promise<void> {
    this.toolContext.clear();
    this.detachObservationListener();
    const snapshot = await this.sessionController.pausePresence();
    this.statusView.render(snapshot.presence.status);
    await this.toolContext.accept(snapshot);
    await vscode.window.showWarningMessage(
      `Adaptive Pair paused: local journal integrity check failed (${error.reason}).`,
    );
  }
}
