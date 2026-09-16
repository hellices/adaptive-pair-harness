import * as vscode from "vscode";
import type {
  PairCommand,
  PairRuntimeSnapshot,
  PairSessionSnapshot,
} from "@adaptive-pair/protocol";
import {
  InMemoryJournal,
  PairCoordinator,
  type Clock,
  type EffectPort,
  type IdSource,
  type PairCoordinatorPort,
  type PairPresencePort,
} from "@adaptive-pair/runtime";
import { WorkspaceContext } from "./workspaceContext.js";
import { VscodeWorkspaceContextAccess } from "./workspaceContextAccess.js";
import { ActivityLedger } from "./activityLedger.js";
import { StableEffectPort } from "./stableEffectPort.js";

const PLACEHOLDER_WORKSPACE_ID = "adaptive-pair:workspace";

type DispatchablePairCommand = {
  [Type in PairCommand["type"]]: Omit<
    Extract<PairCommand, { readonly type: Type }>,
    "protocolVersion" | "commandId" | "expectedRevision" | "actor" | "observedAt"
  >;
}[PairCommand["type"]];

const hasLiveSession = (
  session: PairSessionSnapshot | undefined,
): session is PairSessionSnapshot =>
  session !== undefined && session.status !== "inactive" && session.status !== "closed";

class SystemClock implements Clock {
  public now(): number {
    return Date.now();
  }
}

class IncrementingIds implements IdSource {
  private nextValue = 0;

  public next(prefix: string): string {
    this.nextValue += 1;
    return `${prefix}-${this.nextValue}`;
  }
}

export interface SessionControllerOptions {
  readonly effects?: EffectPort;
  readonly ledger?: ActivityLedger;
}

export class SessionController implements vscode.Disposable {
  private readonly store = new InMemoryJournal(PLACEHOLDER_WORKSPACE_ID);
  private readonly ids = new IncrementingIds();
  private readonly clock = new SystemClock();
  private readonly ledger: ActivityLedger | undefined;
  private readonly coordinatorPort: PairCoordinatorPort & PairPresencePort;
  private readonly workspaceContext: WorkspaceContext;
  private captureLifetime = new AbortController();
  private disposed = false;

  public constructor(options: SessionControllerOptions = {}) {
    this.ledger = options.ledger;
    this.coordinatorPort = new PairCoordinator({
      store: this.store,
      effects: options.effects ?? new StableEffectPort(),
      clock: this.clock,
      ids: this.ids,
      streamId: PLACEHOLDER_WORKSPACE_ID,
    });
    this.workspaceContext = new WorkspaceContext(
      new VscodeWorkspaceContextAccess(this.clock, options.ledger),
    );
  }

  public coordinator(): PairCoordinatorPort {
    return this.coordinatorPort;
  }

  public snapshotNow(): PairRuntimeSnapshot {
    return this.store.snapshotNow();
  }

  public snapshot(): Promise<PairRuntimeSnapshot> {
    return this.coordinatorPort.snapshot();
  }

  public enablePresence(): Promise<PairRuntimeSnapshot> {
    this.ensureUsable();
    return this.coordinatorPort.setPresence("observing", this.resolveWorkspaceId());
  }

  public stayQuiet(): Promise<PairRuntimeSnapshot> {
    this.ensureUsable();
    return this.coordinatorPort.setPresence("quiet", this.resolveWorkspaceId());
  }

  public pausePresence(): Promise<PairRuntimeSnapshot> {
    this.invalidateCapture();
    return this.coordinatorPort.setPresence("paused");
  }

  public async startSession(): Promise<PairRuntimeSnapshot> {
    const signal = this.captureLifetime.signal;
    const current = await this.enablePresence();
    signal.throwIfAborted();
    return this.startIfNeeded(current);
  }

  public async joinInProgress(): Promise<PairRuntimeSnapshot> {
    const signal = this.captureLifetime.signal;
    let current = await this.enablePresence();
    signal.throwIfAborted();

    if (current.session?.status === "paused") {
      return this.dispatchEntry("ResumeSession", current, signal);
    }

    current = await this.startIfNeeded(current);
    signal.throwIfAborted();
    if (current.session?.status === "briefing") {
      return this.dispatchEntry("CaptureEntry", current, signal);
    }
    return current;
  }

  public bumpObservationRevision(): Promise<PairRuntimeSnapshot> {
    return this.coordinatorPort.observeWorkspace();
  }

  public disablePresence(): Promise<PairRuntimeSnapshot> {
    this.invalidateCapture();
    return this.coordinatorPort.setPresence("off");
  }

  public dispose(): void {
    this.disposed = true;
    this.captureLifetime.abort(new Error("SESSION_ACTION_CANCELLED"));
  }

  private ensureUsable(): void {
    if (this.disposed) {
      throw new Error("SESSION_CONTROLLER_DISPOSED");
    }
  }

  private invalidateCapture(): void {
    this.captureLifetime.abort(new Error("SESSION_ACTION_CANCELLED"));
    this.captureLifetime = new AbortController();
  }

  private async dispatchEntry(
    type: "ResumeSession" | "CaptureEntry",
    snapshot: PairRuntimeSnapshot,
    signal: AbortSignal,
  ): Promise<PairRuntimeSnapshot> {
    const entry = await this.workspaceContext.capture(signal);
    signal.throwIfAborted();
    return this.dispatch({ type, entry }, snapshot);
  }

  private startIfNeeded(snapshot: PairRuntimeSnapshot): Promise<PairRuntimeSnapshot> {
    if (hasLiveSession(snapshot.session)) {
      return Promise.resolve(snapshot);
    }
    return this.dispatch({ type: "StartSession", sessionId: this.ids.next("session") }, snapshot);
  }

  private resolveWorkspaceId(): string {
    this.ledger?.recordWorkspaceRead();
    const firstFolder = vscode.workspace.workspaceFolders?.[0];
    return firstFolder?.uri.toString() ?? PLACEHOLDER_WORKSPACE_ID;
  }

  private dispatch(
    command: DispatchablePairCommand,
    snapshot: PairRuntimeSnapshot,
  ): Promise<PairRuntimeSnapshot> {
    return this.coordinatorPort.dispatch({
      ...command,
      protocolVersion: 1,
      commandId: this.ids.next("command"),
      expectedRevision: snapshot.revision,
      actor: "human",
      observedAt: this.clock.now(),
    });
  }
}
