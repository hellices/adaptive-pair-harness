import type { OperationRecord } from "@adaptive-pair/protocol";
import { describe, expect, it } from "vitest";
import {
  assessPairHandoff,
  type PairHandoffProposal,
} from "../src/index.js";
import {
  pairHandoffContext,
  pairOperation,
  pairRuntime,
  pairWorkUnit,
} from "./pairFixtures.js";

describe("Pair handoff preflight", () => {
  it.each(["agreed", "executing", "verifying", "completed"] as const)(
    "reports only readiness for baseline and human review of a %s unit",
    status => {
      expect(assessPairHandoff(pairHandoffContext({
        snapshot: pairRuntime(pairWorkUnit({ status })),
      }))).toEqual({ status: "ready-for-baseline-review" });
    },
  );

  it("allows human takeover preflight without claiming AI edit support", () => {
    const context = pairHandoffContext();
    expect(assessPairHandoff({
      ...context,
      snapshot: pairRuntime(pairWorkUnit({ owner: "ai", status: "agreed" })),
      proposal: { ...context.proposal, fromOwner: "ai", toOwner: "human" },
      editCapability: "unavailable",
    })).toEqual({ status: "ready-for-baseline-review" });
  });

  const mismatches: readonly [Partial<PairHandoffProposal>, string][] = [
    [{ sessionId: "other-session" }, "PAIR_HANDOFF_IDENTITY_MISMATCH"],
    [{ workUnitId: "other-unit" }, "PAIR_HANDOFF_IDENTITY_MISMATCH"],
    [{ fromOwner: "ai", toOwner: "human" }, "PAIR_HANDOFF_OWNER_MISMATCH"],
    [{ toOwner: "human" }, "PAIR_HANDOFF_OWNER_MISMATCH"],
    [{ runtimeRevision: 11 }, "PAIR_STALE_HANDOFF"],
    [{ authorityEpoch: 2 }, "PAIR_STALE_HANDOFF"],
  ];

  it.each(mismatches)("rejects a mismatched proposal %j", (override, reason) => {
    const context = pairHandoffContext();
    expect(assessPairHandoff({
      ...context,
      proposal: { ...context.proposal, ...override },
    })).toEqual({ status: "blocked", reason });
  });

  it("cannot substitute a policy result for stopped operation admission", () => {
    expect(assessPairHandoff(pairHandoffContext({ operationAdmission: "open" })))
      .toEqual({ status: "blocked", reason: "PAIR_ADMISSION_OPEN" });
  });

  const pendingStatuses: readonly OperationRecord["status"][] = [
    "planned", "authorized", "started",
  ];

  it.each(pendingStatuses)("waits for a %s operation to settle", status => {
    expect(assessPairHandoff(pairHandoffContext({
      snapshot: pairRuntime(undefined, [pairOperation({ status })]),
    }))).toEqual({ status: "blocked", reason: "PAIR_OPERATIONS_PENDING" });
  });

  it.each(["edit", "check"] as const)("requires reconciliation of an unknown %s", kind => {
    expect(assessPairHandoff(pairHandoffContext({
      snapshot: pairRuntime(undefined, [pairOperation({
        kind,
        toolName: kind === "edit" ? "pair_apply_edit" : "pair_run_verification",
        status: "unknown",
      })]),
    }))).toEqual({ status: "blocked", reason: "PAIR_RECONCILIATION_REQUIRED" });
  });

  it("does not discard an unresolved mutation from an earlier unit or epoch", () => {
    expect(assessPairHandoff(pairHandoffContext({
      snapshot: pairRuntime(undefined, [pairOperation({
        workUnitId: "earlier-unit", authorityEpoch: 2, status: "unknown",
      })]),
    }))).toEqual({ status: "blocked", reason: "PAIR_RECONCILIATION_REQUIRED" });
  });

  it("does not treat an unknown read as a completed or unknown mutation", () => {
    expect(assessPairHandoff(pairHandoffContext({
      snapshot: pairRuntime(undefined, [pairOperation({
        kind: "read", toolName: "pair_read_scope", status: "unknown",
      })]),
    }))).toEqual({ status: "ready-for-baseline-review" });
  });

  it.each(["confirmed", "failed", "declined", "cancelled"] as const)(
    "allows review after a terminal %s result",
    status => {
      expect(assessPairHandoff(pairHandoffContext({
        snapshot: pairRuntime(undefined, [pairOperation({ status })]),
      }))).toEqual({ status: "ready-for-baseline-review" });
    },
  );

  it("does not become ready while paused or awaiting reconciliation", () => {
    for (const status of ["paused", "reconciling", "closed"] as const) {
      const snapshot = pairRuntime();
      if (snapshot.session === undefined) {
        throw new Error("Missing test session");
      }
      expect(assessPairHandoff(pairHandoffContext({
        snapshot: { ...snapshot, session: { ...snapshot.session, status } },
      }))).toEqual({ status: "blocked", reason: "PAIR_NOT_OPERATIONAL" });
    }
  });

  it("rejects inactive or observing Presence and a different Presence session", () => {
    const snapshot = pairRuntime();
    for (const presence of [
      { ...snapshot.presence, status: "off" as const },
      { ...snapshot.presence, status: "paused" as const },
      { ...snapshot.presence, status: "observing" as const },
      { ...snapshot.presence, activeSessionId: "other-session" },
    ]) {
      expect(assessPairHandoff(pairHandoffContext({
        snapshot: { ...snapshot, presence },
      }))).toEqual({ status: "blocked", reason: "PAIR_NOT_OPERATIONAL" });
    }
  });

  it.each(["proposed", "paused", "needs-reconcile", "cancelled", "failed"] as const)(
    "does not hand off a non-operational %s unit",
    status => {
      expect(assessPairHandoff(pairHandoffContext({
        snapshot: pairRuntime(pairWorkUnit({ status })),
      }))).toEqual({ status: "blocked", reason: "PAIR_NOT_OPERATIONAL" });
    },
  );

  it("does not mistake missing or non-Pair session state for readiness", () => {
    const snapshot = pairRuntime();
    const session = snapshot.session;
    if (session === undefined) {
      throw new Error("Missing test session");
    }
    for (const candidate of [
      undefined,
      { ...session, workUnit: undefined },
      { ...session, mode: "growth" as const },
    ]) {
      expect(assessPairHandoff(pairHandoffContext({
        snapshot: { ...snapshot, session: candidate },
      }))).toEqual({ status: "blocked", reason: "PAIR_MODE_REQUIRED" });
    }
  });

  it("preserves a quiet developer's operational Pair session", () => {
    const snapshot = pairRuntime();
    expect(assessPairHandoff(pairHandoffContext({
      snapshot: { ...snapshot, presence: { ...snapshot.presence, status: "quiet" } },
    }))).toEqual({ status: "ready-for-baseline-review" });
  });

  it("does not grant AI ownership without the reviewed agreement and capability", () => {
    expect(assessPairHandoff(pairHandoffContext({ editCapability: "unavailable" })))
      .toEqual({ status: "blocked", reason: "PAIR_EDIT_CAPABILITY_REQUIRED" });
    expect(assessPairHandoff(pairHandoffContext({
      snapshot: pairRuntime(pairWorkUnit({ capability: "diagnosis", status: "agreed" })),
    }))).toEqual({ status: "blocked", reason: "PAIR_HUMAN_CAPABILITY_RESERVED" });
    const snapshot = pairRuntime();
    if (snapshot.session === undefined) {
      throw new Error("Missing test session");
    }
    expect(assessPairHandoff(pairHandoffContext({
      snapshot: {
        ...snapshot,
        session: { ...snapshot.session, learningAgreement: undefined },
      },
    }))).toEqual({ status: "blocked", reason: "PAIR_LEARNING_AGREEMENT_REQUIRED" });
  });

  it("refuses Growth and Delivery handoff assessments", () => {
    for (const mode of ["growth", "delivery"] as const) {
      expect(assessPairHandoff(pairHandoffContext({
        snapshot: pairRuntime(pairWorkUnit({ mode, status: "agreed" })),
      }))).toEqual({ status: "blocked", reason: "PAIR_MODE_REQUIRED" });
    }
  });

  it("does not change ownership, epoch, operations, or the proposal", () => {
    const context = pairHandoffContext();
    const before = JSON.stringify(context);
    Object.freeze(context.proposal);
    Object.freeze(context.snapshot.session?.workUnit);
    Object.freeze(context.snapshot.session?.operations);
    Object.freeze(context.snapshot.session);
    Object.freeze(context.snapshot);
    Object.freeze(context);
    expect(assessPairHandoff(context))
      .toEqual({ status: "ready-for-baseline-review" });
    expect(JSON.stringify(context)).toBe(before);
  });
});
