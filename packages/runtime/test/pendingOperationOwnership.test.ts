import { expect, it } from "vitest";
import { beginReplacement, replacementScenarios } from "./pendingOperationFixtures.js";

const ownershipCases = replacementScenarios.flatMap(scenario =>
  ["paused", "off"].flatMap(boundary => [true, false].map(reuseOperationId => ({
    ...scenario, boundary: boundary as "paused" | "off", reuseOperationId,
  }))),
);

it.each(ownershipCases)(
  "$tool via $route to $destination keeps $boundary cancellation after old settlement (reuse=$reuseOperationId)",
  async scenario => {
    const { fixture, previous, replacement, previousSnapshot } = await beginReplacement(
      scenario, scenario.reuseOperationId,
    );
    try {
      const beforeOldSettlement = fixture.store.snapshotNow();
      const eventsBeforeOldSettlement = fixture.store.events();
      fixture.finish(previous.call);
      const oldResult = await previous.settled;
      const afterOldSettlement = fixture.store.snapshotNow();
      const eventsAfterOldSettlement = fixture.store.events();
      const prematureAbort = replacement.call.signal.aborted;
      await fixture.stop(scenario.boundary);
      const replacementAbortedByBoundary = replacement.call.signal.aborted;
      fixture.finish(replacement.call);
      const newResult = await replacement.settled;

      expect(oldResult).toMatchObject({ status: "fulfilled", value: { status: "cancelled", observation: { stale: true } } });
      expect(newResult).toMatchObject({ status: "fulfilled", value: { status: "cancelled" } });
      expect(afterOldSettlement).toEqual(beforeOldSettlement);
      expect(previous.call.signal.aborted).toBe(true);
      expect(beforeOldSettlement.session?.sessionId).toBe(previousSnapshot.session?.sessionId);
      expect(beforeOldSettlement.session?.startedAtRevision).toBeGreaterThan(previousSnapshot.session?.startedAtRevision ?? -1);
      expect(replacement.call.request.authorityEpoch).toBe(previous.call.request.authorityEpoch);
      expect(replacement.call.request.runtimeRevision).toBeGreaterThan(previous.call.request.runtimeRevision);
      expect(replacement.call.request.allowedPaths).toEqual(["src/replacement.ts"]);
      expect(previous.call.request.allowedPaths).toEqual(["src/original.ts"]);
      expect(fixture.calls).toHaveLength(2);
      expect(eventsAfterOldSettlement).toEqual(eventsBeforeOldSettlement);
      expect({
        operationId: replacement.call.request.operationId,
        oldRuntimeRevision: previous.call.request.runtimeRevision,
        replacementRuntimeRevision: replacement.call.request.runtimeRevision,
        prematureAbort,
        replacementAbortedByBoundary,
      }).toEqual({
        operationId: replacement.call.request.operationId,
        oldRuntimeRevision: previous.call.request.runtimeRevision,
        replacementRuntimeRevision: replacement.call.request.runtimeRevision,
        prematureAbort: false,
        replacementAbortedByBoundary: true,
      });
    } finally {
      await fixture.finishAll();
    }
  },
);

it.each(replacementScenarios)(
  "$tool via $route to $destination preserves replacement-first completion",
  async scenario => {
    const { fixture, previous, replacement } = await beginReplacement(scenario);
    try {
      fixture.finish(replacement.call);
      const newResult = await replacement.settled;
      const beforeOldSettlement = await fixture.store.load("stream-1");
      const eventsBeforeOldSettlement = fixture.store.events();
      fixture.finish(previous.call);
      const oldResult = await previous.settled;

      expect(newResult).toMatchObject({ status: "fulfilled", value: { status: "confirmed", observation: { workspaceId: scenario.destination } } });
      expect(oldResult).toMatchObject({ status: "fulfilled", value: { status: "cancelled", observation: { stale: true } } });
      expect(await fixture.store.load("stream-1")).toEqual(beforeOldSettlement);
      expect(fixture.store.events()).toEqual(eventsBeforeOldSettlement);
      expect(fixture.store.events().filter(event => event.type === "OperationObserved")).toHaveLength(1);
      expect(fixture.calls).toHaveLength(2);
    } finally {
      await fixture.finishAll();
    }
  },
);

it.each(replacementScenarios)(
  "$tool via $route to $destination preserves Pause before old settlement",
  async scenario => {
    const { fixture, previous, replacement } = await beginReplacement(scenario);
    try {
      await fixture.stop("pause-command");
      const replacementAbortedByPause = replacement.call.signal.aborted;
      const paused = fixture.store.snapshotNow();
      const pausedEvents = fixture.store.events();
      fixture.finish(previous.call);
      await previous.settled;
      fixture.finish(replacement.call);
      await replacement.settled;

      expect(replacementAbortedByPause).toBe(true);
      expect(fixture.store.snapshotNow()).toEqual(paused);
      expect(fixture.calls).toHaveLength(2);
      expect(fixture.store.events()).toEqual(pausedEvents);
    } finally {
      await fixture.finishAll();
    }
  },
);
