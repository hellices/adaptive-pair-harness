import { describe, expect, it } from "vitest";
import { ActivityLedger } from "../src/activityLedger.js";

describe("ActivityLedger", () => {
  it("starts fully inactive with every counter at zero", () => {
    const ledger = new ActivityLedger();

    expect(ledger.snapshot()).toEqual({
      documentListeners: 0,
      timersScheduled: 0,
      workspaceReads: 0,
      modelRequests: 0,
      networkRequests: 0,
    });
    expect(ledger.isInactive()).toBe(true);
  });

  it("tracks the active document-listener count as attaches and detaches balance", () => {
    const ledger = new ActivityLedger();

    ledger.recordListenerAttached();
    expect(ledger.snapshot().documentListeners).toBe(1);
    expect(ledger.isInactive()).toBe(false);

    ledger.recordListenerDetached();
    expect(ledger.snapshot().documentListeners).toBe(0);
  });

  it("never drops the active listener count below zero", () => {
    const ledger = new ActivityLedger();

    ledger.recordListenerDetached();

    expect(ledger.snapshot().documentListeners).toBe(0);
  });

  it("counts scheduled timers cumulatively", () => {
    const ledger = new ActivityLedger();

    ledger.recordTimerScheduled();
    ledger.recordTimerScheduled();

    expect(ledger.snapshot().timersScheduled).toBe(2);
    expect(ledger.isInactive()).toBe(false);
  });

  it("counts workspace, model, and network reads independently", () => {
    const ledger = new ActivityLedger();

    ledger.recordWorkspaceRead();
    ledger.recordModelRequest();
    ledger.recordModelRequest();
    ledger.recordNetworkRequest();

    expect(ledger.snapshot()).toEqual({
      documentListeners: 0,
      timersScheduled: 0,
      workspaceReads: 1,
      modelRequests: 2,
      networkRequests: 1,
    });
    expect(ledger.isInactive()).toBe(false);
  });

  it("treats a lingering active listener as active even when only detaches remain balanced", () => {
    const ledger = new ActivityLedger();

    ledger.recordListenerAttached();
    ledger.recordWorkspaceRead();
    ledger.recordListenerDetached();

    // A cumulative workspace read keeps the ledger non-inactive even after the
    // listener is detached: prior activity must remain observable.
    expect(ledger.isInactive()).toBe(false);
    expect(ledger.snapshot().documentListeners).toBe(0);
    expect(ledger.snapshot().workspaceReads).toBe(1);
  });
});
