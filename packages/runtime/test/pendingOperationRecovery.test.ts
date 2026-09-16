import { expect, it } from "vitest";
import { beginReplacement, replacementScenarios } from "./pendingOperationFixtures.js";

const failureCases = replacementScenarios.flatMap(scenario =>
  [true, false].map(reuseOperationId => ({ ...scenario, reuseOperationId })),
);

it.each(failureCases)(
  "$tool via $route to $destination preserves cancellation after old effect rejection (reuse=$reuseOperationId)",
  async scenario => {
    const { fixture, previous, replacement } = await beginReplacement(scenario, scenario.reuseOperationId);
    try {
      const beforeFailure = fixture.store.snapshotNow();
      const eventsBeforeFailure = fixture.store.events();
      fixture.finish(previous.call, true);
      const oldResult = await previous.settled;
      const afterFailure = fixture.store.snapshotNow();
      const eventsAfterFailure = fixture.store.events();
      const prematureAbort = replacement.call.signal.aborted;
      await fixture.stop("pause-command");
      const replacementAbortedByPause = replacement.call.signal.aborted;
      fixture.finish(replacement.call);
      await replacement.settled;

      expect(oldResult).toMatchObject({ status: "rejected", error: { message: "OLD_EFFECT_FAILED" } });
      expect(afterFailure).toEqual(beforeFailure);
      expect(eventsAfterFailure).toEqual(eventsBeforeFailure);
      expect(prematureAbort).toBe(false);
      expect(fixture.calls).toHaveLength(2);
      expect(replacementAbortedByPause).toBe(true);
    } finally {
      await fixture.finishAll();
    }
  },
);

const recoveryCases = ["dispatch", "setPresence"].flatMap(route =>
  ["workspace-A", "workspace-B"].flatMap(destination => [true, false].map(reuseOperationId => ({
    tool: "pair_read_scope" as const,
    route: route as "dispatch" | "setPresence",
    destination: destination as "workspace-A" | "workspace-B",
    reuseOperationId,
  }))),
);

it.each(recoveryCases)(
  "old recovered read via $route to $destination cannot orphan a pending replacement (reuse=$reuseOperationId)",
  async scenario => {
    const { fixture, previous, replacement } = await beginReplacement(scenario, scenario.reuseOperationId, true);
    try {
      const beforeRecoverySettlement = fixture.store.snapshotNow();
      const eventsBeforeRecoverySettlement = fixture.store.events();
      fixture.finish(previous.call);
      const oldResult = await previous.settled;
      const afterRecoverySettlement = fixture.store.snapshotNow();
      const eventsAfterRecoverySettlement = fixture.store.events();
      const prematureAbort = replacement.call.signal.aborted;
      await fixture.stop(scenario.route === "dispatch" ? "pause-command" : "off");
      const replacementAbortedByBoundary = replacement.call.signal.aborted;
      fixture.finish(replacement.call);
      await replacement.settled;

      expect(oldResult).toEqual({ status: "fulfilled", value: beforeRecoverySettlement });
      expect(afterRecoverySettlement).toEqual(beforeRecoverySettlement);
      expect(eventsAfterRecoverySettlement).toEqual(eventsBeforeRecoverySettlement);
      expect(replacement.call.request.authorityEpoch).toBe(previous.call.request.authorityEpoch);
      expect(replacement.call.request.runtimeRevision).toBeGreaterThan(previous.call.request.runtimeRevision);
      expect(previous.call.signal.aborted).toBe(true);
      expect(prematureAbort).toBe(false);
      expect(fixture.calls).toHaveLength(2);
      expect(replacementAbortedByBoundary).toBe(true);
    } finally {
      await fixture.finishAll();
    }
  },
);

const retryCases = [false, true].flatMap(recovery =>
  ["workspace-A", "workspace-B"].flatMap(destination => [true, false].map(reuseOperationId => ({
    tool: "pair_read_scope" as const,
    route: "setPresence" as const,
    destination: destination as "workspace-A" | "workspace-B",
    recovery,
    reuseOperationId,
  }))),
);

it.each(retryCases)(
  "does not redispatch an already-running replacement in $destination (oldRecovery=$recovery, reuse=$reuseOperationId)",
  async scenario => {
    const { fixture, previous, replacement } = await beginReplacement(
      scenario, scenario.reuseOperationId, scenario.recovery,
    );
    try {
      fixture.finish(previous.call);
      await previous.settled;
      const pendingBeforeReconcile = fixture.store.snapshotNow().session?.operations[0]?.status;
      const replacementStillRunning = !replacement.call.signal.aborted;
      const reconciling = fixture.coordinator.reconcile();
      const outcome = await Promise.race([
        reconciling.then(() => ({ status: "skipped" as const })),
        fixture.waitForCall(2).then(call => ({ status: "redispatched" as const, call })),
      ]);
      if (outcome.status === "redispatched") fixture.finish(outcome.call);
      await reconciling;
      fixture.finish(replacement.call);
      const newResult = await replacement.settled;

      expect(pendingBeforeReconcile).toBe("authorized");
      expect(replacementStillRunning).toBe(true);
      expect({
        effectCalls: fixture.calls.length,
        recoveryAdmission: outcome.status,
        requests: fixture.calls.map(call => ({
          workspaceId: call.request.workspaceId,
          operationId: call.request.operationId,
          runtimeRevision: call.request.runtimeRevision,
          paths: call.request.allowedPaths,
        })),
      }).toEqual({
        effectCalls: 2,
        recoveryAdmission: "skipped",
        requests: [previous, replacement].map(({ call }) => ({
          workspaceId: call.request.workspaceId,
          operationId: call.request.operationId,
          runtimeRevision: call.request.runtimeRevision,
          paths: call.request.allowedPaths,
        })),
      });
      expect(newResult).toMatchObject({ status: "fulfilled", value: { status: "confirmed" } });
    } finally {
      await fixture.finishAll();
    }
  },
);
