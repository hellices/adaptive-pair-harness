import { parsePairEvent, type PairEvent } from "@adaptive-pair/protocol";
import { createRuntime } from "@adaptive-pair/session-core";
import { expect, it, vi } from "vitest";
import { createDurableProjector } from "../src/durableProjection.js";
import { durableKey } from "./durableFixtures.js";
import {
  admittedCandidate, enterProjectionBriefing, enterProjectionReady, keyIssuer, privateCanary,
  projectionEntry, projectionHarness, projectionLearning, projectionWorkUnit,
  sourceGrant, sourceOperation, sourceSession, sourceUnit, sourceWorkspace,
} from "./durableProjectionFixtures.js";

const fail = (code: string): Error => new Error(`Invalid Pair durable projection: ${code}`);

it("does not allocate durable identity for an empty candidate", () => {
  const next = vi.fn(() => { throw new Error("unexpected allocation"); });
  const projector = createDurableProjector({ next });
  expect(projector.project(createRuntime(sourceWorkspace), [], 0)).toEqual({ kind: "omitted" });
  expect(next).not.toHaveBeenCalled();
});

it("projects every admitted source route and all retained side effects without private content", () => {
  const issuer = keyIssuer();
  const next = vi.fn(() => issuer.next());
  const harness = projectionHarness({ next });
  harness.apply({ type: "EnablePresence", workspaceId: sourceWorkspace });
  harness.apply({ type: "ObserveWorkspace" }, "host");
  harness.apply({ type: "StartSession", sessionId: sourceSession });
  harness.apply({ type: "SetPresence", status: "quiet" });
  const allocationCount = next.mock.calls.length;
  expect(harness.apply({
    type: "GrantUserAction", grantId: sourceGrant, nativeToolName: "adaptive_pair_capture_entry",
  }).projection.kind).toBe("omitted");
  expect(next).toHaveBeenCalledTimes(allocationCount);
  const captured = harness.apply({ type: "CaptureEntry", entry: projectionEntry, userActionGrantId: sourceGrant }, "ai");
  expect(captured.projection).toMatchObject({ kind: "append", commit: { facts: [
    { type: "PresenceRecorded", status: "engaged" },
  ] } });
  harness.apply({ type: "ConfirmLearning", agreement: projectionLearning });
  harness.apply({ type: "SelectMode", mode: "growth" });
  harness.apply({ type: "ProposeWorkUnit", workUnit: projectionWorkUnit });
  harness.apply({ type: "AgreeWorkUnit", workUnitId: sourceUnit });
  const attempt = harness.apply({ type: "RecordAttempt", workUnitId: sourceUnit, summary: `${privateCanary}/attempt`, bypassed: false });
  const attemptFacts = attempt.projection.kind === "append" ? attempt.projection.commit.facts : [];
  expect(attemptFacts).toContainEqual(expect.objectContaining({ type: "SessionStatusRecorded", status: "active" }));
  expect(attemptFacts).toContainEqual(expect.objectContaining({ type: "AssistanceRecorded", attempt: "recorded" }));
  harness.apply({ type: "RecordHypothesis", workUnitId: sourceUnit, summary: `${privateCanary}/hypothesis`, bypassed: true });
  harness.apply({ type: "RequestHint", workUnitId: sourceUnit, level: 3 });
  harness.apply({ type: "AuthorizeSolutionReveal", workUnitId: sourceUnit, previewOnly: true });
  harness.apply({ type: "RequestHint", workUnitId: sourceUnit, level: 5 });
  harness.apply({
    type: "AuthorizeOperation", operationId: sourceOperation, toolName: `${privateCanary}/tool`, kind: "read",
    input: { path: `${privateCanary}/source`, credential: `${privateCanary}/secret`, nested: { source: privateCanary } },
  });
  harness.apply({
    type: "ObserveOperationResult", operationId: sourceOperation, authorityEpoch: harness.live.session!.authorityEpoch,
    status: "unknown", summary: `${privateCanary}/result`, observation: { diagnostic: privateCanary },
  }, "host");
  harness.apply({ type: "PauseSession", reason: `${privateCanary}/reason` });
  const resumed = harness.apply({ type: "ResumeSession", entry: projectionEntry });
  const resumedFacts = resumed.projection.kind === "append" ? resumed.projection.commit.facts : [];
  expect(resumedFacts).toContainEqual(expect.objectContaining({ type: "WorkUnitStatusRecorded", status: "needs-reconcile" }));
  harness.apply({ type: "CloseSession" });
  expect([...harness.eventTypes].sort()).toEqual([
    "PresenceEnabled", "PresenceChanged", "WorkspaceObserved", "SessionStarted", "EntryCaptured", "LearningConfirmed",
    "ModeSelected", "WorkUnitProposed", "WorkUnitAgreed", "AttemptRecorded", "HypothesisRecorded", "HintRequested",
    "SolutionRevealAuthorized", "UserActionGranted", "UserActionConsumed", "OperationAuthorized", "OperationObserved",
    "SessionPaused", "SessionResumed", "SessionClosed",
  ].sort());
  expect(harness.state().sessions[0]?.operations[0]?.status).toBe("unknown");
  const text = JSON.stringify({ commits: harness.commits, state: harness.state() });
  expect(text).not.toContain(privateCanary);
  expect(text).not.toContain("userActionGrant");
  expect(text).not.toContain("authorityEpoch");
  expect(text).not.toContain("undefined");
  const issued = new Set(next.mock.results.map(result => result.value as string));
  const keys = text.match(/[0-9a-f]{32}/gu) ?? [];
  expect(keys.length).toBeGreaterThan(0);
  for (const key of keys) expect(issued.has(key)).toBe(true);
});

it("does not allocate keys or durable deduplication for omitted source batches", () => {
  const issuer = keyIssuer();
  const next = vi.fn(() => issuer.next());
  const harness = projectionHarness({ next });
  harness.apply({ type: "EnablePresence", workspaceId: sourceWorkspace });
  const allocationCount = next.mock.calls.length;
  harness.apply({ type: "ObserveWorkspace" }, "host", "omitted-command");
  harness.apply({ type: "ObserveWorkspace" }, "host", "omitted-command");
  expect(next).toHaveBeenCalledTimes(allocationCount);
  expect(harness.commits).toHaveLength(1);
});

it("preserves legitimate multievent commands including recorded pause outcomes", () => {
  const harness = projectionHarness();
  enterProjectionReady(harness);
  harness.apply({ type: "AuthorizeOperation", operationId: sourceOperation, toolName: "pair_read_file", kind: "read", input: {} });
  const paused = harness.apply({ type: "PauseSession", reason: privateCanary });
  expect(paused.candidate.events.map(event => event.type)).toEqual(["OperationObserved", "SessionPaused"]);
  expect(new Set(paused.candidate.events.map(event => event.commandId)).size).toBe(1);
  expect(paused.projection.kind === "append" ? paused.projection.commit.commandKeys.length : 0).toBe(1);
  expect(harness.state().sessions[0]?.operations[0]?.status).toBe("cancelled");
});

it("preserves every command in a multicommand atomic candidate", () => {
  const projector = createDurableProjector(keyIssuer());
  const first = admittedCandidate(createRuntime(sourceWorkspace), { type: "EnablePresence", workspaceId: sourceWorkspace });
  const second = admittedCandidate(first.next, { type: "StartSession", sessionId: sourceSession });
  const events = Object.freeze([...first.events, ...second.events]);
  const result = projector.project(first.previous, events, 0);
  expect(result).toMatchObject({ kind: "append", commit: { expectedSequence: 0 } });
  if (result.kind !== "append") throw new Error("expected append");
  expect(result.commit.commandKeys).toHaveLength(2);
  expect(result.commit.facts.map(fact => fact.type)).toEqual(["PresenceRecorded", "SessionOpened", "PresenceRecorded"]);
  expect(projector.project(first.previous, Object.freeze([...events]), 0)).toBe(result);
});

it("returns stable original receipts after later appends without rolling bindings back", () => {
  const harness = projectionHarness();
  const first = harness.apply({ type: "EnablePresence", workspaceId: sourceWorkspace });
  harness.apply({ type: "StartSession", sessionId: sourceSession });
  expect(harness.projector.project(first.candidate.previous, first.candidate.events, 0)).toBe(first.projection);
  harness.apply({ type: "CaptureEntry", entry: projectionEntry });
  harness.apply({ type: "ConfirmLearning", agreement: projectionLearning });
});

it("rejects changed executable input under the same command even when durable fields match", () => {
  const harness = projectionHarness();
  enterProjectionReady(harness);
  const previous = harness.live;
  const sequence = harness.sequence;
  const command = { type: "AuthorizeOperation", operationId: sourceOperation, toolName: "pair_read_file", kind: "read" } as const;
  const first = admittedCandidate(previous, { ...command, input: { path: "PRIVATE_A" } }, "same-source-command");
  const changed = admittedCandidate(previous, { ...command, input: { path: "PRIVATE_B" } }, "same-source-command");
  const projection = harness.projector.project(previous, first.events, sequence);
  expect(() => harness.projector.project(previous, changed.events, sequence)).toThrow(fail("COMMAND_REUSE"));
  expect(harness.projector.project(previous, first.events, sequence)).toBe(projection);
});

it.each([true, false])("projects assistance bypass flags precisely (%s)", bypassed => {
  const harness = projectionHarness();
  enterProjectionReady(harness);
  harness.apply({ type: "RecordAttempt", workUnitId: sourceUnit, summary: privateCanary, bypassed });
  harness.apply({ type: "RecordHypothesis", workUnitId: sourceUnit, summary: privateCanary, bypassed: !bypassed });
  expect(harness.state().sessions[0]?.workUnits[0]?.assistance).toMatchObject({
    attempt: bypassed ? "bypassed" : "recorded", hypothesis: bypassed ? "recorded" : "bypassed",
  });
});

it("allocates a new work-unit lifetime even when a source proposal reuses its ID", () => {
  const harness = projectionHarness();
  enterProjectionBriefing(harness);
  harness.apply({ type: "ProposeWorkUnit", workUnit: projectionWorkUnit });
  harness.apply({ type: "ProposeWorkUnit", workUnit: { ...projectionWorkUnit, capability: "test" } });
  harness.apply({ type: "AgreeWorkUnit", workUnitId: sourceUnit });
  const units = harness.state().sessions[0]?.workUnits;
  expect(units?.map(unit => unit.status)).toEqual(["proposed", "agreed"]);
  expect(units?.map(unit => unit.capability)).toEqual(["implementation", "test"]);
  expect(units?.[0]?.workUnitKey).not.toBe(units?.[1]?.workUnitKey);
});

it.each(["pair", "delivery"] as const)("records %s classification without granting a product route", mode => {
  const harness = projectionHarness();
  harness.apply({ type: "EnablePresence", workspaceId: sourceWorkspace });
  harness.apply({ type: "StartSession", sessionId: sourceSession });
  harness.apply({ type: "CaptureEntry", entry: projectionEntry });
  harness.apply({ type: "SelectMode", mode });
  harness.apply({ type: "ProposeWorkUnit", workUnit: { ...projectionWorkUnit, mode, owner: "ai", learningValue: "low" } });
  harness.apply({ type: "AgreeWorkUnit", workUnitId: sourceUnit });
  expect(harness.state().sessions[0]?.workUnits[0]).toMatchObject({ mode, owner: "ai", learningValue: "low" });
});

it("turns an off-containing batch into an erasure barrier without allocating or retaining its prefix", () => {
  const next = vi.fn(() => { throw new Error("unexpected allocation"); });
  const projector = createDurableProjector({ next });
  const first = admittedCandidate(createRuntime(sourceWorkspace), { type: "EnablePresence", workspaceId: sourceWorkspace });
  const second = admittedCandidate(first.next, { type: "SetPresence", status: "off" });
  const events = Object.freeze([...first.events, ...second.events]);
  expect(projector.project(first.previous, events, 0)).toEqual({ kind: "erase" });
  expect(projector.project(first.previous, events, 0)).toEqual({ kind: "erase" });
  expect(next).not.toHaveBeenCalled();
  expect(() => projector.project(first.previous, first.events, 0)).toThrow(fail("PROJECTOR_RETIRED"));
});

it("rejects mixed erasure and reenablement instead of silently losing post-disable facts", () => {
  const projector = createDurableProjector(keyIssuer());
  const first = admittedCandidate(createRuntime(sourceWorkspace), { type: "EnablePresence", workspaceId: sourceWorkspace });
  const disabled = admittedCandidate(first.next, { type: "SetPresence", status: "off" });
  const second = admittedCandidate(disabled.next, { type: "EnablePresence", workspaceId: sourceWorkspace });
  expect(disabled.events).toHaveLength(1);
  expect(() => projector.project(first.previous, Object.freeze([...first.events, ...disabled.events, ...second.events]), 0))
    .toThrow(fail("MIXED_ERASURE"));
});

it("uses fresh lifetimes for reused session and operation IDs in a new generation", () => {
  const issuer = keyIssuer();
  const first = projectionHarness(issuer);
  const second = projectionHarness(issuer);
  for (const harness of [first, second]) {
    enterProjectionReady(harness);
    harness.apply({ type: "AuthorizeOperation", operationId: sourceOperation, toolName: "pair_read_file", kind: "read", input: {} });
  }
  const retired = first.state().sessions[0];
  const fresh = second.state().sessions[0];
  expect(retired?.sessionKey).not.toBe(fresh?.sessionKey);
  expect(retired?.operations[0]?.operationKey).not.toBe(fresh?.operations[0]?.operationKey);
  first.apply({ type: "SetPresence", status: "off" });
  second.apply({ type: "CloseSession" });
});

it("rejects the unsupported BriefConfirmed source event with a fixed error", () => {
  const previous = createRuntime(sourceWorkspace);
  const event = parsePairEvent({
    protocolVersion: 1, eventId: privateCanary, commandId: privateCanary, actor: "human", revision: 1, recordedAt: 100,
    type: "BriefConfirmed", goal: privateCanary, criteria: [privateCanary],
  });
  expect(() => createDurableProjector(keyIssuer()).project(previous, Object.freeze([event]), 0))
    .toThrow(fail("UNSUPPORTED_EVENT"));
});

it("rejects missing lifetime mappings instead of adopting a live snapshot as durable origin", () => {
  const harness = projectionHarness();
  enterProjectionReady(harness);
  const candidate = admittedCandidate(harness.live, { type: "RecordAttempt", workUnitId: sourceUnit, summary: privateCanary, bypassed: false });
  expect(() => createDurableProjector(keyIssuer()).project(candidate.previous, candidate.events, 0))
    .toThrow(fail("MISSING_LIFETIME_MAPPING"));
});

it.each(["bad", "F".repeat(32), "f".repeat(31), "f".repeat(33)])("rejects malformed issued keys %#", key => {
  const candidate = admittedCandidate(createRuntime(sourceWorkspace), { type: "EnablePresence", workspaceId: sourceWorkspace });
  expect(() => createDurableProjector({ next: () => key }).project(candidate.previous, candidate.events, 0))
    .toThrow(fail("INVALID_KEY"));
});

it("rejects issuer collisions and does not expose an issuer's private exception", () => {
  const candidate = admittedCandidate(createRuntime(sourceWorkspace), { type: "EnablePresence", workspaceId: sourceWorkspace });
  expect(() => createDurableProjector({ next: () => durableKey(1) }).project(candidate.previous, candidate.events, 0))
    .toThrow(fail("KEY_COLLISION"));
  try {
    createDurableProjector({ next: () => { throw new Error(privateCanary); } }).project(candidate.previous, candidate.events, 0);
    expect.fail("expected issuer failure");
  } catch (error) {
    expect((error as Error).message).toBe(fail("KEY_ISSUER_FAILED").message);
    expect((error as Error).cause).toBeUndefined();
  }
});

it("sanitizes invalid source reduction without allocating keys", () => {
  const next = vi.fn(() => durableKey(1));
  const candidate = admittedCandidate(createRuntime(sourceWorkspace), { type: "EnablePresence", workspaceId: sourceWorkspace });
  const badEvent = Object.freeze({ ...candidate.events[0], revision: 3 }) as PairEvent;
  expect(() => createDurableProjector({ next }).project(candidate.previous, Object.freeze([badEvent]), 0))
    .toThrow(fail("INVALID_CANDIDATE"));
  expect(next).not.toHaveBeenCalled();
});
