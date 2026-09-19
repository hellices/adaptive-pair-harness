import { createRuntime } from "@adaptive-pair/session-core";
import { expect, it, vi } from "vitest";
import { createDurableProjector } from "../src/durableProjection.js";
import type { DurableProjectionResolution } from "../src/durableTypes.js";
import { durableKey } from "./durableFixtures.js";
import {
  admittedCandidate, enterProjectionBriefing, keyIssuer, privateCanary, projectionHarness,
  projectionWorkUnit, sourceSession, sourceWorkspace,
} from "./durableProjectionFixtures.js";

const fail = (code: string): Error => new Error(`Invalid Pair durable projection: ${code}`);

const prepareEnable = () => {
  const projector = createDurableProjector(keyIssuer());
  const candidate = admittedCandidate(createRuntime(sourceWorkspace), { type: "EnablePresence", workspaceId: sourceWorkspace });
  const projection = projector.project(candidate.previous, candidate.events, 0);
  if (projection.kind !== "append") throw new Error("expected append");
  return { projector, candidate, projection };
};

it("rejects different admitted commands reusing one ID inside their first atomic batch", () => {
  const issuer = keyIssuer();
  const next = vi.fn(() => issuer.next());
  const projector = createDurableProjector({ next });
  const first = admittedCandidate(createRuntime(sourceWorkspace),
    { type: "EnablePresence", workspaceId: sourceWorkspace }, "same-batch-id");
  const second = admittedCandidate(first.next, { type: "StartSession", sessionId: sourceSession }, "same-batch-id");
  expect(first.events[0]?.eventId).toBe(second.events[0]?.eventId);
  expect(() => projector.project(first.previous, Object.freeze([...first.events, ...second.events]), 0))
    .toThrow(fail("COMMAND_REUSE"));
  expect(next).not.toHaveBeenCalled();
});

it.each(["pending", "unknown", "", undefined, null, false])("rejects runtime outcomes outside the closed resolution union %#", outcome => {
  const { projector, candidate, projection } = prepareEnable();
  expect(() => projector.resolve(projection.commit.commitKey, outcome as DurableProjectionResolution))
    .toThrow(fail("RESOLUTION_MISMATCH"));
  expect(projector.project(candidate.previous, candidate.events, 0)).toBe(projection);
});

it("requires explicit resolution of the exact pending key, not equal head and live counters", () => {
  const { projector, candidate, projection } = prepareEnable();
  const next = admittedCandidate(candidate.next, { type: "StartSession", sessionId: sourceSession });
  expect(() => projector.project(next.previous, next.events, projection.commit.facts.length))
    .toThrow(fail("CANDIDATE_PENDING"));
  expect(() => projector.resolve(durableKey(9), "committed")).toThrow(fail("RESOLUTION_MISMATCH"));
  projector.resolve(projection.commit.commitKey, "indeterminate");
  expect(projector.project(candidate.previous, candidate.events, 0)).toBe(projection);
  expect(() => projector.project(next.previous, next.events, projection.commit.facts.length))
    .toThrow(fail("CANDIDATE_PENDING"));
  projector.resolve(projection.commit.commitKey, "committed");
  expect(projector.project(next.previous, next.events, projection.commit.facts.length).kind).toBe("append");
});

it("supports exact retry and replacement only after a definite noncommit resolution", () => {
  const { projector, candidate, projection } = prepareEnable();
  projector.resolve(projection.commit.commitKey, "not-committed");
  expect(projector.project(candidate.previous, candidate.events, 0)).toBe(projection);
  projector.resolve(projection.commit.commitKey, "not-committed");
  const alternative = admittedCandidate(candidate.previous, { type: "EnablePresence", workspaceId: sourceWorkspace }, "replacement");
  const replacement = projector.project(alternative.previous, alternative.events, 0);
  if (replacement.kind !== "append") throw new Error("expected replacement");
  expect(replacement.commit.commitKey).not.toBe(projection.commit.commitKey);
  expect(() => projector.project(candidate.previous, candidate.events, 0)).toThrow(fail("CANDIDATE_PENDING"));
  projector.resolve(replacement.commit.commitKey, "committed");
  expect(() => projector.project(candidate.previous, candidate.events, 0)).toThrow(fail("STALE_CANDIDATE"));
});

it("never downgrades a committed result and makes identical resolution idempotent", () => {
  const { projector, projection } = prepareEnable();
  projector.resolve(projection.commit.commitKey, "committed");
  expect(() => projector.resolve(projection.commit.commitKey, "committed")).not.toThrow();
  expect(() => projector.resolve(projection.commit.commitKey, "not-committed"))
    .toThrow(fail("RESOLUTION_MISMATCH"));
});

it("rejects reparsed copies as retries rather than comparing minimized executable inputs", () => {
  const { projector, candidate } = prepareEnable();
  const equivalent = admittedCandidate(candidate.previous, { type: "EnablePresence", workspaceId: sourceWorkspace });
  expect(() => projector.project(candidate.previous, equivalent.events, 0)).toThrow(fail("COMMAND_REUSE"));
  expect(() => projector.project(candidate.previous, candidate.events, 1)).toThrow(fail("COMMAND_REUSE"));
});

it("retires before historical receipt lookup and clears all external serialization surface", () => {
  const harness = projectionHarness();
  const first = harness.apply({ type: "EnablePresence", workspaceId: sourceWorkspace });
  harness.apply({ type: "SetPresence", status: "off" });
  expect(() => harness.projector.project(first.candidate.previous, first.candidate.events, 0))
    .toThrow(fail("PROJECTOR_RETIRED"));
  expect(JSON.stringify(harness.projector)).toBe("{}");
});

it("does not reserve keys, receipts, or bindings when preparation fails", () => {
  const next = vi.fn<() => string>()
    .mockReturnValueOnce(durableKey(100))
    .mockImplementationOnce(() => { throw new Error(privateCanary); })
    .mockReturnValueOnce(durableKey(100))
    .mockReturnValueOnce(durableKey(101));
  const projector = createDurableProjector({ next });
  const candidate = admittedCandidate(createRuntime(sourceWorkspace), { type: "EnablePresence", workspaceId: sourceWorkspace });
  expect(() => projector.project(candidate.previous, candidate.events, 0)).toThrow(fail("KEY_ISSUER_FAILED"));
  expect(projector.project(candidate.previous, candidate.events, 0).kind).toBe("append");
});

it("requires frozen source objects for reference-based retry identity", () => {
  const projector = createDurableProjector(keyIssuer());
  const candidate = admittedCandidate(createRuntime(sourceWorkspace), { type: "EnablePresence", workspaceId: sourceWorkspace });
  expect(() => projector.project(candidate.previous, [...candidate.events], 0)).toThrow(fail("INVALID_CANDIDATE"));
  expect(() => projector.project({ ...candidate.previous }, candidate.events, 0)).toThrow(fail("INVALID_CANDIDATE"));
});

it.each([-0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])("rejects unsafe expected sequence %#", sequence => {
  const candidate = admittedCandidate(createRuntime(sourceWorkspace), { type: "EnablePresence", workspaceId: sourceWorkspace });
  expect(() => createDurableProjector(keyIssuer()).project(candidate.previous, candidate.events, sequence))
    .toThrow(fail("INVALID_SEQUENCE"));
});

it("does not adopt a skipped sequence or an unprojected retained change", () => {
  const { projector, candidate, projection } = prepareEnable();
  projector.resolve(projection.commit.commitKey, "committed");
  const next = admittedCandidate(candidate.next, { type: "StartSession", sessionId: sourceSession });
  expect(() => projector.project(next.previous, next.events, 2)).toThrow(fail("SEQUENCE_MISMATCH"));
  const hidden = admittedCandidate(candidate.next, { type: "SetPresence", status: "quiet" });
  const afterHidden = admittedCandidate(hidden.next, { type: "StartSession", sessionId: sourceSession });
  expect(() => projector.project(afterHidden.previous, afterHidden.events, 1)).toThrow(fail("PREVIOUS_STATE_MISMATCH"));
});

it("does not retain oversized source identities or allocate keys for them", () => {
  const next = vi.fn(() => durableKey(100));
  const candidate = admittedCandidate(createRuntime(sourceWorkspace),
    { type: "EnablePresence", workspaceId: sourceWorkspace }, "x".repeat(1_048_577));
  expect(() => createDurableProjector({ next }).project(candidate.previous, candidate.events, 0))
    .toThrow(fail("LIMIT_EXCEEDED"));
  expect(next).not.toHaveBeenCalled();
});

it("bounds repeated source-ID text retained by distinct failed candidates", () => {
  const issuer = keyIssuer();
  const next = vi.fn(() => issuer.next());
  const harness = projectionHarness({ next });
  enterProjectionBriefing(harness);
  for (let index = 0; index < 3; index += 1) {
    const candidate = admittedCandidate(harness.live, {
      type: "ProposeWorkUnit", workUnit: { ...projectionWorkUnit, id: "private-unit".repeat(42_000) },
    }, `different-candidate-${index}`);
    if (index === 2) {
      const allocations = next.mock.calls.length;
      expect(() => harness.projector.project(candidate.previous, candidate.events, harness.sequence))
        .toThrow(fail("LIMIT_EXCEEDED"));
      expect(next).toHaveBeenCalledTimes(allocations);
    } else {
      const projection = harness.projector.project(candidate.previous, candidate.events, harness.sequence);
      if (projection.kind !== "append") throw new Error("expected prepared candidate");
      harness.projector.resolve(projection.commit.commitKey, "not-committed");
    }
  }
});

it("bounds retained generation receipts and facts without evicting old retries", () => {
  const issuer = keyIssuer();
  const next = vi.fn(() => issuer.next());
  const projector = createDurableProjector({ next });
  let live = createRuntime(sourceWorkspace);
  const first = admittedCandidate(live, { type: "EnablePresence", workspaceId: sourceWorkspace });
  for (let index = 0; index < 1_024; index += 1) {
    const candidate = index === 0 ? first : admittedCandidate(live, {
      type: "SetPresence", status: index % 2 === 0 ? "paused" : "quiet",
    });
    const projection = projector.project(candidate.previous, candidate.events, index);
    if (projection.kind !== "append") throw new Error("expected bounded append");
    expect(projection.commit.facts).toHaveLength(1);
    projector.resolve(projection.commit.commitKey, "committed");
    live = candidate.next;
  }
  const allocations = next.mock.calls.length;
  const overflow = admittedCandidate(live, { type: "SetPresence", status: "paused" });
  expect(() => projector.project(overflow.previous, overflow.events, 1_024)).toThrow(fail("LIMIT_EXCEEDED"));
  expect(next).toHaveBeenCalledTimes(allocations);
  expect(projector.project(first.previous, first.events, 0).kind).toBe("append");
});
