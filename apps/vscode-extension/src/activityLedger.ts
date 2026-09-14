/**
 * A small activity ledger that proves Adaptive Pair does nothing observable
 * before the developer explicitly enables Pair Presence.
 *
 * Every boundary counted here is a real one this extension can cross: a
 * document listener, a timer, a workspace read, or a language-model request.
 * Inactive state must show every counter at zero; the host smoke test asserts
 * exactly that before enablement and then watches the counters move once
 * Presence is enabled, which proves they are wired to real boundaries rather
 * than hard-coded.
 *
 * There is deliberately no network counter: the extension has no outbound
 * network boundary to instrument, so outbound absence is proved at runtime by
 * the Extension Host network probe (test/host/networkProbe.ts) rather than by a
 * counter that nothing could ever increment.
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
}

export class ActivityLedger {
  private documentListenersActive = 0;
  private timers = 0;
  private workspace = 0;
  private model = 0;

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

  public snapshot(): ActivitySnapshot {
    return Object.freeze({
      documentListeners: this.documentListenersActive,
      timersScheduled: this.timers,
      workspaceReads: this.workspace,
      modelRequests: this.model,
    });
  }

  public isInactive(): boolean {
    return (
      this.documentListenersActive === 0 &&
      this.timers === 0 &&
      this.workspace === 0 &&
      this.model === 0
    );
  }
}
