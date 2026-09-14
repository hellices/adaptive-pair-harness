/**
 * A small activity ledger that proves Adaptive Pair does nothing observable
 * before the developer explicitly enables Pair Presence.
 *
 * Each boundary that could touch the developer's environment (a document
 * listener, a timer, a workspace read, a model request, or a network request)
 * reports to this ledger. Inactive state must show every counter at zero; the
 * host smoke test asserts exactly that before enablement and then watches the
 * counters move once Presence is enabled, which proves the counters are wired
 * to real boundaries rather than hard-coded.
 */
export interface ActivitySnapshot {
  /** Currently attached text-document change listeners. */
  readonly documentListeners: number;
  /** Cumulative timers scheduled through the presence scheduler. */
  readonly timersScheduled: number;
  /** Cumulative workspace reads (folders, documents, diagnostics, git, paths). */
  readonly workspaceReads: number;
  /** Cumulative language-model requests dispatched from a Growth turn. */
  readonly modelRequests: number;
  /** Cumulative outbound network requests (none exist in this preview). */
  readonly networkRequests: number;
}

export class ActivityLedger {
  private documentListenersActive = 0;
  private timers = 0;
  private workspace = 0;
  private model = 0;
  private network = 0;

  public recordListenerAttached(): void {
    this.documentListenersActive += 1;
  }

  public recordListenerDetached(): void {
    this.documentListenersActive = Math.max(0, this.documentListenersActive - 1);
  }

  public recordTimerScheduled(): void {
    this.timers += 1;
  }

  public recordWorkspaceRead(): void {
    this.workspace += 1;
  }

  public recordModelRequest(): void {
    this.model += 1;
  }

  public recordNetworkRequest(): void {
    this.network += 1;
  }

  public snapshot(): ActivitySnapshot {
    return Object.freeze({
      documentListeners: this.documentListenersActive,
      timersScheduled: this.timers,
      workspaceReads: this.workspace,
      modelRequests: this.model,
      networkRequests: this.network,
    });
  }

  public isInactive(): boolean {
    return (
      this.documentListenersActive === 0 &&
      this.timers === 0 &&
      this.workspace === 0 &&
      this.model === 0 &&
      this.network === 0
    );
  }
}
