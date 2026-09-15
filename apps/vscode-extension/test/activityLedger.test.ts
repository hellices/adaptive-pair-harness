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

  it("counts workspace reads and model requests independently", () => {
    const ledger = new ActivityLedger();

    ledger.recordWorkspaceRead();
    ledger.recordModelRequest();
    ledger.recordModelRequest();

    expect(ledger.snapshot()).toEqual({
      documentListeners: 0,
      timersScheduled: 0,
      workspaceReads: 1,
      modelRequests: 2,
    });
    expect(ledger.isInactive()).toBe(false);
  });

  it("exposes no network counter, because no production network boundary exists", () => {
    const ledger = new ActivityLedger();

    // A counter nothing can increment proves nothing. Outbound network absence
    // is proved at runtime by the Extension Host network probe
    // (test/host/networkProbe.ts) instead.
    expect(Object.keys(ledger.snapshot())).toEqual([
      "documentListeners",
      "timersScheduled",
      "workspaceReads",
      "modelRequests",
    ]);
    expect("recordNetworkRequest" in ledger).toBe(false);
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
