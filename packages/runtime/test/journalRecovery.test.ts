import { expect, expectTypeOf, it } from "vitest";
import { createRuntime } from "@adaptive-pair/session-core";
import type { PairEvent } from "@adaptive-pair/protocol";
import {
  InMemoryJournal, inspectPairJournal, type JournalExpectation, type JournalRecoveryReport,
} from "../src/index.js";
import {
  authorizedEvent, briefingEvents, enabledEvents, enabledJournalText, historyText,
  journalEntry, journalEvent, journalText, observationCommits, observedEvent, readyEvents,
} from "./journalRecoveryFixtures.js";

const expectation: JournalExpectation = Object.freeze({ streamId: "stream-1", workspaceId: "workspace-1" });
const secret = "private-journal-inspection-sentinel";
const invalidPrivateEvent = { ...journalEvent(1, { type: "SessionClosed" }), secret };
const reportKeys = [
  "formatVersion", "streamId", "workspaceId", "headRevision", "commitCount", "eventCount",
  "historicalSession", "unsettledOperations", "authorityRestored", "automaticReplayAllowed",
].sort();
const warningKeys = ["sessionStartedAtRevision", "workspaceId", "operationId", "kind", "recordedStatus"].sort();

const grantEvent = (revision: number): PairEvent => journalEvent(revision, {
  type: "UserActionGranted", grantId: secret, nativeToolName: "adaptive_pair_check", runtimeRevision: revision, authorityEpoch: 0,
});

const privateEvents = (): PairEvent[] => [
  ...readyEvents().map(event => event.type === "EntryCaptured" ? {
    ...event, entry: { ...event.entry, diagnostics: [secret], dirtyPaths: [secret] },
  } : event),
  grantEvent(9),
  authorizedEvent(10, { input: { source: secret, nested: { diagnostics: [secret] } }, summary: secret, userActionGrantId: secret }),
  journalEvent(11, {
    type: "OperationObserved", operationId: "operation-1", authorityEpoch: 0, status: "unknown",
    summary: secret, observation: { source: secret, diagnostics: [secret] },
  }),
];

it("reports history without granting any restoration or replay authority", () => {
  const report = inspectPairJournal(enabledJournalText(), {
    streamId: "stream-1", workspaceId: "workspace-1",
  });
  expect(report).toMatchObject({
    headRevision: 2, commitCount: 1, eventCount: 2,
    authorityRestored: false, automaticReplayAllowed: false,
  });
  expect(report).not.toHaveProperty("snapshot");
  expect(report).not.toHaveProperty("events");
  expect(report).not.toHaveProperty("userActionGrants");
  expect(Object.isFrozen(report)).toBe(true);
});

it("reports the exact empty-history metadata without synthesizing a session", () => {
  const report: JournalRecoveryReport = inspectPairJournal(journalText([]), expectation);
  expect(report).toStrictEqual({
    formatVersion: 1, streamId: "stream-1", workspaceId: "workspace-1", headRevision: 0,
    commitCount: 0, eventCount: 0, historicalSession: undefined, unsettledOperations: [],
    authorityRestored: false, automaticReplayAllowed: false,
  });
  expectTypeOf(report.authorityRestored).toEqualTypeOf<false>();
  expectTypeOf(report.automaticReplayAllowed).toEqualTypeOf<false>();
});

it("counts atomic commits separately from their events and commands", () => {
  const report = inspectPairJournal(journalText(observationCommits([2, 3])), expectation);
  expect(report).toMatchObject({ headRevision: 6, commitCount: 3, eventCount: 6 });
});

it("rejects the wrong stream before trying to reduce the history", () => {
  const invalidSequence = historyText([journalEvent(1, { type: "WorkspaceObserved" }, { actor: "host" })]);
  expect(() => inspectPairJournal(invalidSequence, { ...expectation, streamId: "other-stream" }))
    .toThrow(new Error("Invalid Pair journal: STREAM_MISMATCH"));
});

it("rejects a final workspace mismatch", () => {
  expect(() => inspectPairJournal(enabledJournalText(), { ...expectation, workspaceId: "other-workspace" }))
    .toThrow(new Error("Invalid Pair journal: WORKSPACE_MISMATCH"));
});

it("compares the final workspace rather than equating it to the stream or initial workspace", () => {
  const text = journalText([{ expectedRevision: 0, events: enabledEvents() }], { initialWorkspaceId: "prior-workspace" });
  expect(inspectPairJournal(text, expectation)).toMatchObject({ streamId: "stream-1", workspaceId: "workspace-1" });
});

it("accepts a legal reset and rebind only for the expected final workspace", () => {
  const events = [
    ...readyEvents(), authorizedEvent(9), journalEvent(10, { type: "PresenceChanged", status: "off" }),
    ...enabledEvents(10, "workspace-2"),
  ];
  const report = inspectPairJournal(historyText(events), { ...expectation, workspaceId: "workspace-2" });
  expect(report.workspaceId).toBe("workspace-2");
  expect(report.historicalSession).toBeUndefined();
  expect(report.unsettledOperations[0]?.workspaceId).toBe("workspace-1");
  expect(() => inspectPairJournal(historyText(events), expectation))
    .toThrow(new Error("Invalid Pair journal: WORKSPACE_MISMATCH"));
});

it.each([
  { name: "empty", events: [], status: undefined },
  { name: "enabled", events: enabledEvents(), status: undefined },
  { name: "briefing", events: briefingEvents(), status: "briefing" },
  { name: "ready", events: readyEvents(), status: "ready" },
  { name: "paused", events: [...readyEvents(), journalEvent(9, { type: "SessionPaused", reason: "Pause", authorityEpoch: 1 })], status: "paused" },
  { name: "reconciling", events: [
    ...readyEvents(), journalEvent(9, { type: "SessionPaused", reason: "Pause", authorityEpoch: 1 }),
    journalEvent(10, { type: "SessionResumed", entry: journalEntry() }),
  ], status: "reconciling" },
  { name: "closed", events: [...readyEvents(), journalEvent(9, { type: "SessionClosed" })], status: "closed" },
  { name: "grant-bearing", events: [...readyEvents(), grantEvent(9)], status: "ready" },
  { name: "unsettled", events: [...readyEvents(), authorizedEvent(9)], status: "ready" },
  { name: "unknown", events: [...readyEvents(), authorizedEvent(9), observedEvent(10, "unknown")], status: "ready" },
  { name: "disabled", events: [...readyEvents(), authorizedEvent(9), journalEvent(10, { type: "PresenceChanged", status: "off" })], status: undefined },
])("never restores authority for $name history", ({ events, status }) => {
  const report = inspectPairJournal(historyText(events), expectation);
  expect(report.authorityRestored).toBe(false);
  expect(report.automaticReplayAllowed).toBe(false);
  expect(report.historicalSession?.status).toBe(status);
  expect(Object.keys(report).sort()).toEqual(reportKeys);
  if (report.historicalSession !== undefined) {
    expect(Object.keys(report.historicalSession).sort()).toEqual(["sessionId", "startedAtRevision", "status"]);
    expect(report.historicalSession.startedAtRevision).toBe(3);
  }
  for (const warning of report.unsettledOperations) expect(Object.keys(warning).sort()).toEqual(warningKeys);
});

it.each(["planned", "authorized", "started", "unknown"] as const)(
  "does not rewrite recorded %s work as cancelled on close or disable", status => {
    const events = [...readyEvents(), authorizedEvent(9, { status }), journalEvent(10, { type: "SessionClosed" })];
    const closed = inspectPairJournal(historyText(events), expectation);
    expect(closed.unsettledOperations[0]?.recordedStatus).toBe(status);
    const disabled = inspectPairJournal(historyText([
      ...events, journalEvent(11, { type: "PresenceChanged", status: "off" }),
    ]), expectation);
    expect(disabled.unsettledOperations).toEqual(closed.unsettledOperations);
  },
);

it("does not confuse a newly settled operation with an older reused ID", () => {
  const events = [
    ...readyEvents(), authorizedEvent(9, { status: "started" }),
    journalEvent(10, { type: "PresenceChanged", status: "off" }),
    ...readyEvents(10, "workspace-2"), authorizedEvent(19), observedEvent(20),
  ];
  const report = inspectPairJournal(historyText(events), { ...expectation, workspaceId: "workspace-2" });
  expect(report.historicalSession).toEqual({ sessionId: "session-1", startedAtRevision: 13, status: "ready" });
  expect(report.unsettledOperations).toEqual([{
    sessionStartedAtRevision: 3, workspaceId: "workspace-1", operationId: "operation-1", kind: "check", recordedStatus: "started",
  }]);
});

it("publishes no input, source, summary, diagnostic or grant data", () => {
  const text = historyText(privateEvents());
  expect(text).toContain(secret);
  const report = inspectPairJournal(text, expectation);
  expect(Object.keys(report).sort()).toEqual(reportKeys);
  expect(JSON.stringify(report)).not.toContain(secret);
  expect(report.unsettledOperations).toEqual([{
    sessionStartedAtRevision: 3, workspaceId: "workspace-1", operationId: "operation-1", kind: "check", recordedStatus: "unknown",
  }]);
  expect(report).not.toHaveProperty("snapshot");
  expect(report).not.toHaveProperty("events");
  expect(report).not.toHaveProperty("userActionGrants");
  expect(report).not.toHaveProperty("authorityEpoch");
});

it("freezes every returned metadata object and creates detached reports per call", () => {
  const text = historyText([...readyEvents(), authorizedEvent(9)]);
  const report = inspectPairJournal(text, expectation);
  const repeated = inspectPairJournal(text, expectation);
  expect(repeated).toEqual(report);
  expect(repeated).not.toBe(report);
  expect(repeated.historicalSession).not.toBe(report.historicalSession);
  expect(repeated.unsettledOperations).not.toBe(report.unsettledOperations);
  expect(repeated.unsettledOperations[0]).not.toBe(report.unsettledOperations[0]);
  for (const value of [report, report.historicalSession, report.unsettledOperations, ...report.unsettledOperations]) {
    expect(Object.isFrozen(value)).toBe(true);
  }
  const historicalSession = report.historicalSession;
  const operation = report.unsettledOperations[0];
  if (historicalSession === undefined || operation === undefined) throw new Error("Expected historical metadata");
  expect(Reflect.set(report, "authorityRestored", true)).toBe(false);
  expect(Reflect.set(historicalSession, "status", "closed")).toBe(false);
  expect(Reflect.set(report.unsettledOperations, "length", 0)).toBe(false);
  expect(Reflect.set(operation, "recordedStatus", "cancelled")).toBe(false);
});

it.each([
  { name: "text", value: { secret }, code: "INVALID_TEXT" },
  { name: "JSON", value: `{"secret":"${secret}"`, code: "INVALID_JSON" },
  { name: "envelope", value: JSON.stringify({ secret }), code: "INVALID_ENVELOPE" },
  { name: "event", value: historyText([invalidPrivateEvent]), code: "INVALID_EVENT" },
  { name: "reducer", value: historyText([...privateEvents(), observedEvent(12, "confirmed", secret)]), code: "INVALID_EVENT_SEQUENCE" },
  { name: "unsupported event", value: historyText([
    ...briefingEvents(), journalEvent(4, { type: "BriefConfirmed", goal: secret, criteria: [secret] }),
  ]), code: "UNSUPPORTED_REPLAY_EVENT" },
  { name: "head", value: journalText([{ expectedRevision: 0, events: privateEvents() }], { headRevision: 12 }), code: "HEAD_REVISION_MISMATCH" },
])("rejects a private $name failure without payload, cause or partial report", ({ value, code }) => {
  let published: JournalRecoveryReport | undefined;
  let error: unknown;
  try {
    published = inspectPairJournal(value, expectation);
  } catch (caught) {
    error = caught;
  }
  expect(published).toBeUndefined();
  expect(error).toEqual(new Error(`Invalid Pair journal: ${code}`));
  expect(error).not.toHaveProperty("cause");
  expect(error).not.toHaveProperty("historicalSession");
  expect(error).not.toHaveProperty("unsettledOperations");
  expect(String(error)).not.toContain(secret);
  expect(JSON.stringify(error)).not.toContain(secret);
  expect(inspectPairJournal(journalText([]), expectation).unsettledOperations).toEqual([]);
  expect(inspectPairJournal(enabledJournalText(), expectation).eventCount).toBe(2);
});

it("does not retain event or command identifiers between separate inspections", () => {
  const first = inspectPairJournal(enabledJournalText(), expectation);
  const second = inspectPairJournal(enabledJournalText(), expectation);
  expect(second).toEqual(first);
  const other = inspectPairJournal(journalText([{ expectedRevision: 0, events: enabledEvents() }], {
    streamId: "other-stream",
  }), { ...expectation, streamId: "other-stream" });
  expect(other.eventCount).toBe(2);
});

it("cannot admit a caller-provided checkpoint or seed snapshot", () => {
  const input = JSON.parse(enabledJournalText()) as Record<string, unknown>;
  expect(() => inspectPairJournal(JSON.stringify({ ...input, initialSnapshot: createRuntime("workspace-1") }), expectation))
    .toThrow(new Error("Invalid Pair journal: INVALID_ENVELOPE"));
});

it("leaves a live journal and its available grants unchanged", async () => {
  const live = new InMemoryJournal("live-stream", createRuntime("workspace-1"));
  await live.commit("live-stream", 0, [...readyEvents(), grantEvent(9)]);
  const before = await live.load("live-stream");
  const eventsBefore = live.events();
  inspectPairJournal(historyText(privateEvents()), expectation);
  expect(() => inspectPairJournal("invalid", expectation)).toThrow(new Error("Invalid Pair journal: INVALID_JSON"));
  const after = await live.load("live-stream");
  expect(after).toEqual(before);
  expect(after.snapshot).toBe(before.snapshot);
  expect(after.snapshot.session?.userActionGrants[0]?.status).toBe("available");
  expect(live.events()).toEqual(eventsBefore);
});
