import * as vscode from "vscode";
import type {
  EntrySnapshot,
  PairCommand,
  PairRuntimeSnapshot,
  PairSessionSnapshot,
  PresenceStatus,
} from "@adaptive-pair/protocol";
import { WorkspaceContext } from "./workspaceContext.js";
import { VscodeWorkspaceContextAccess } from "./workspaceContextAccess.js";
import {
  PairCoordinator,
  type Clock,
  type EffectPort,
  type EffectRequest,
  type EffectResult,
  type IdSource,
  type PairCoordinatorPort,
  type PairStore,
} from "@adaptive-pair/runtime";

const PLACEHOLDER_WORKSPACE_ID = "adaptive-pair:workspace";

type DispatchablePairCommand = {
  [Type in PairCommand["type"]]: Omit<
    Extract<PairCommand, { readonly type: Type }>,
    "protocolVersion" | "commandId" | "expectedRevision" | "actor" | "observedAt"
  >;
}[PairCommand["type"]];

const freezeSnapshot = (snapshot: PairRuntimeSnapshot): PairRuntimeSnapshot => {
  const cloned = structuredClone(snapshot);

  if (cloned.session?.entrySnapshot !== undefined) {
    Object.freeze(cloned.session.entrySnapshot.dirtyPaths);
    Object.freeze(cloned.session.entrySnapshot.openPaths);
    Object.freeze(cloned.session.entrySnapshot.diagnostics);
    Object.freeze(cloned.session.entrySnapshot.protectedPaths);
    Object.freeze(cloned.session.entrySnapshot);
  }

  if (cloned.session?.learningAgreement !== undefined) {
    Object.freeze(cloned.session.learningAgreement.learningGoals);
    Object.freeze(cloned.session.learningAgreement.familiarAreas);
    Object.freeze(cloned.session.learningAgreement.humanOwnedCapabilities);
    Object.freeze(cloned.session.learningAgreement.delegatableWork);
    Object.freeze(cloned.session.learningAgreement);
  }

  if (cloned.session?.workUnit !== undefined) {
    Object.freeze(cloned.session.workUnit.allowedPaths);
    Object.freeze(cloned.session.workUnit.acceptanceChecks);
    Object.freeze(cloned.session.workUnit.baseline);
    Object.freeze(cloned.session.workUnit);
  }

  if (cloned.session !== undefined) {
    Object.freeze(cloned.session.criteria);
    Object.freeze(cloned.session.operations);
    Object.freeze(cloned.session.userActionGrants);
    Object.freeze(cloned.session.assistance ?? {});
    Object.freeze(cloned.session);
  }

  Object.freeze(cloned.presence);
  return Object.freeze(cloned);
};

const createRuntimeSnapshot = (workspaceId: string): PairRuntimeSnapshot =>
  freezeSnapshot({
    protocolVersion: 1,
    revision: 0,
    presence: {
      workspaceId,
      observationRevision: 0,
      status: "off",
      activeSessionId: undefined,
    },
    session: undefined,
  });

const hasLiveSession = (
  session: PairSessionSnapshot | undefined,
): session is PairSessionSnapshot =>
  session !== undefined &&
  session.status !== "inactive" &&
  session.status !== "closed";

const isPausableSession = (
  session: PairSessionSnapshot | undefined,
): session is PairSessionSnapshot =>
  session !== undefined &&
  (session.status === "ready" ||
    session.status === "active" ||
    session.status === "reconciling");

class MemoryPairStore implements PairStore {
  private snapshotValue: PairRuntimeSnapshot;
  private readonly commandIds = new Set<string>();

  public constructor(initialSnapshot: PairRuntimeSnapshot) {
    this.snapshotValue = freezeSnapshot(initialSnapshot);
  }

  public snapshotNow(): PairRuntimeSnapshot {
    return this.snapshotValue;
  }

  public replace(snapshot: PairRuntimeSnapshot): PairRuntimeSnapshot {
    this.snapshotValue = freezeSnapshot(snapshot);
    return this.snapshotValue;
  }

  public load(streamId: string): Promise<{
    readonly snapshot: PairRuntimeSnapshot;
    readonly seenCommandIds: ReadonlySet<string>;
  }> {
    void streamId;
    return Promise.resolve({
      snapshot: this.snapshotNow(),
      seenCommandIds: new Set(this.commandIds),
    });
  }

  public append(
    streamId: string,
    events: readonly {
      readonly commandId: string;
    }[],
  ): Promise<void> {
    void streamId;
    for (const event of events) {
      this.commandIds.add(event.commandId);
    }
    return Promise.resolve();
  }

  public saveSnapshot(
    streamId: string,
    snapshot: PairRuntimeSnapshot,
  ): Promise<void> {
    void streamId;
    this.replace(snapshot);
    return Promise.resolve();
  }
}

class StableShellEffectPort implements EffectPort {
  public execute(
    request: EffectRequest,
    signal: AbortSignal,
  ): Promise<EffectResult> {
    signal.throwIfAborted();
    return Promise.resolve({
      operationId: request.operationId,
      status: "declined",
      summary: `${request.toolName} is not implemented in the Stable Pair Presence shell yet.`,
      observation: {
        closed: true,
        kind: request.kind,
      },
      sensitiveData: false,
      partial: false,
    });
  }
}

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

export class SessionController implements vscode.Disposable {
  private readonly store = new MemoryPairStore(
    createRuntimeSnapshot(PLACEHOLDER_WORKSPACE_ID),
  );
  private readonly ids = new IncrementingIds();
  private readonly clock = new SystemClock();
  private readonly coordinatorPort: PairCoordinatorPort = new PairCoordinator({
    store: this.store,
    effects: new StableShellEffectPort(),
    clock: this.clock,
    ids: this.ids,
    streamId: PLACEHOLDER_WORKSPACE_ID,
  });
  private readonly workspaceContext = new WorkspaceContext(
    new VscodeWorkspaceContextAccess(this.clock),
  );

  public coordinator(): PairCoordinatorPort {
    return this.coordinatorPort;
  }

  public snapshotNow(): PairRuntimeSnapshot {
    return this.store.snapshotNow();
  }

  public async snapshot(): Promise<PairRuntimeSnapshot> {
    return await this.coordinatorPort.snapshot();
  }

  public enablePresence(): Promise<PairRuntimeSnapshot> {
    const current = this.ensureWorkspaceIdentity();
    if (current.session?.status === "paused") {
      return Promise.resolve(current);
    }

    if (
      current.presence.status === "observing" ||
      current.presence.status === "engaged" ||
      current.presence.status === "quiet"
    ) {
      return Promise.resolve(current);
    }

    const status = hasLiveSession(current.session) ? "engaged" : "observing";
    return Promise.resolve(this.replacePresence(current, status));
  }

  public async stayQuiet(): Promise<PairRuntimeSnapshot> {
    let current = this.ensureWorkspaceIdentity();
    if (current.session?.status === "paused") {
      return current;
    }

    if (current.presence.status === "off") {
      current = await this.enablePresence();
    }

    if (current.presence.status === "quiet") {
      return current;
    }

    return this.replacePresence(current, "quiet");
  }

  public async pausePresence(): Promise<PairRuntimeSnapshot> {
    const current = this.snapshotNow();
    if (current.presence.status === "paused") {
      return current;
    }

    if (isPausableSession(current.session)) {
      await this.dispatch({
        type: "PauseSession",
        reason: "The developer paused Pair Presence.",
      });
      return this.snapshotNow();
    }

    if (current.presence.status === "off") {
      return current;
    }

    return this.replacePresence(current, "paused");
  }

  public async startSession(): Promise<PairRuntimeSnapshot> {
    let current = this.ensureWorkspaceIdentity();
    if (current.session?.status === "paused") {
      return current;
    }

    if (hasLiveSession(current.session)) {
      if (
        current.presence.status === "off" ||
        current.presence.status === "paused"
      ) {
        current = this.replacePresence(current, "engaged");
      }
      return current;
    }

    if (current.presence.status === "off" || current.presence.status === "paused") {
      this.replacePresence(current, "observing");
    }

    await this.dispatch({
      type: "StartSession",
      sessionId: this.ids.next("session"),
    });
    return this.snapshotNow();
  }

  public async joinInProgress(): Promise<PairRuntimeSnapshot> {
    let current = this.ensureWorkspaceIdentity();

    if (current.session?.status === "paused") {
      await this.dispatch({
        type: "ResumeSession",
        entry: await this.createEntrySnapshot(),
      });
      return this.snapshotNow();
    }

    if (!hasLiveSession(current.session)) {
      current = await this.startSession();
    } else if (current.presence.status === "paused") {
      current = this.replacePresence(current, "engaged");
    }

    if (current.session?.status === "briefing") {
      await this.dispatch({
        type: "CaptureEntry",
        entry: await this.createEntrySnapshot(),
      });
      return this.snapshotNow();
    }

    return current;
  }

  public bumpObservationRevision(): PairRuntimeSnapshot {
    const current = this.snapshotNow();
    if (current.presence.status === "off" || current.presence.status === "paused") {
      return current;
    }

    return this.store.replace({
      ...current,
      revision: current.revision + 1,
      presence: {
        ...current.presence,
        observationRevision: current.presence.observationRevision + 1,
      },
    });
  }

  public disablePresence(): PairRuntimeSnapshot {
    const workspaceId = this.snapshotNow().presence.workspaceId;
    return this.store.replace(createRuntimeSnapshot(workspaceId));
  }

  public dispose(): void {}

  private ensureWorkspaceIdentity(): PairRuntimeSnapshot {
    const current = this.snapshotNow();
    const workspaceId = this.resolveWorkspaceId();
    if (current.presence.workspaceId === workspaceId) {
      return current;
    }

    return this.store.replace({
      ...current,
      revision: current.revision + 1,
      presence: {
        ...current.presence,
        workspaceId,
      },
    });
  }

  private resolveWorkspaceId(): string {
    const firstFolder = vscode.workspace.workspaceFolders?.[0];
    return firstFolder?.uri.toString() ?? PLACEHOLDER_WORKSPACE_ID;
  }

  private replacePresence(
    snapshot: PairRuntimeSnapshot,
    status: PresenceStatus,
  ): PairRuntimeSnapshot {
    return this.store.replace({
      ...snapshot,
      revision: snapshot.revision + 1,
      presence: {
        ...snapshot.presence,
        status,
        activeSessionId:
          status === "off"
            ? undefined
            : snapshot.session?.sessionId ?? snapshot.presence.activeSessionId,
      },
    });
  }

  private async dispatch(
    command: DispatchablePairCommand,
  ): Promise<void> {
    await this.coordinatorPort.dispatch({
      ...command,
      protocolVersion: 1,
      commandId: this.ids.next("command"),
      expectedRevision: this.snapshotNow().revision,
      actor: "human",
      observedAt: this.clock.now(),
    });
  }

  private async createEntrySnapshot(): Promise<EntrySnapshot> {
    return await this.workspaceContext.capture();
  }
}
