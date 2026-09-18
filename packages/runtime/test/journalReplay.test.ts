import { expect, it } from "vitest";
import fc from "fast-check";
import { parsePairJournal, type PairEvent } from "@adaptive-pair/protocol";
import { createRuntime, reduce } from "@adaptive-pair/session-core";
import * as runtime from "../src/index.js";
import { replayPairJournal } from "../src/journalReplay.js";
import {
  authorizedEvent, briefingEvents, enabledEvents, enabledJournalText, historyText,
  journalEntry, journalEvent, journalText, observationCommits, observedEvent, readyEvents,
} from "./journalRecoveryFixtures.js";

const replayHistory = (events: readonly PairEvent[]) => replayPairJournal(parsePairJournal(historyText(events)));
const replayText = (text: string) => replayPairJournal(parsePairJournal(text));
const failWith = (text: string, code: string) => {
  expect(() => replayText(text)).toThrow(new Error(`Invalid Pair journal: ${code}`));
};

it("preserves a multi-command atomic commit", () => {
  const replay = replayPairJournal(parsePairJournal(enabledJournalText()));
  expect(replay.snapshot.revision).toBe(2);
  expect(replay.snapshot.presence.observationRevision).toBe(1);
  expect(replay.unsettledOperations).toEqual([]);
});

it("keeps replay private to the runtime implementation", () => {
  expect(runtime).not.toHaveProperty("replayPairJournal");
});

it("starts an empty history from the declared initial workspace at revision zero", () => {
  const replay = replayText(journalText([], { initialWorkspaceId: "different-workspace" }));
  expect(replay.snapshot).toEqual(createRuntime("different-workspace"));
  expect(replay.unsettledOperations).toEqual([]);
  expect(Object.isFrozen(replay)).toBe(true);
  expect(Object.isFrozen(replay.unsettledOperations)).toBe(true);
});

it("allows repeated command IDs inside an atomic commit", () => {
  const events = enabledEvents().map(event => ({ ...event, commandId: "atomic-command" }));
  expect(replayHistory(events).snapshot.revision).toBe(2);
});

it("rejects reusing any command from an earlier multi-command commit", () => {
  const first = enabledEvents();
  for (const previous of first) {
    const later = journalEvent(3, { type: "WorkspaceObserved" }, { actor: "host", commandId: previous.commandId });
    failWith(journalText([
      { expectedRevision: 0, events: first }, { expectedRevision: 2, events: [later] },
    ]), "DUPLICATE_COMMAND_ID");
  }
});

it.each(["within", "across"])("rejects duplicate event IDs %s commits", location => {
  const events = enabledEvents().map(event => ({ ...event, eventId: "duplicate-event" }));
  const commits = location === "within" ? [{ expectedRevision: 0, events }] :
    events.map((event, index) => ({ expectedRevision: index, events: [event] }));
  failWith(journalText(commits), "DUPLICATE_EVENT_ID");
});

it.each([1, 7])("rejects a nonzero initial expected revision %s", expectedRevision => {
  failWith(journalText([{ expectedRevision, events: enabledEvents() }]), "NON_CONTIGUOUS_REVISION");
});

it.each([0, 3])("rejects event revision %s instead of revision two", revision => {
  const events = enabledEvents().map((event, index) => index === 1 ? { ...event, revision } : event);
  failWith(historyText(events), "NON_CONTIGUOUS_REVISION");
});

it.each([0, 1, 3])("rejects a declared head of %s for two events", headRevision => {
  failWith(journalText([{ expectedRevision: 0, events: enabledEvents() }], { headRevision }), "HEAD_REVISION_MISMATCH");
});

it.each(["removed", "reordered", "duplicated"])("rejects %s batches", mutation => {
  const commits = observationCommits([1, 1]);
  const [first, second, third] = commits;
  if (first === undefined || second === undefined || third === undefined) throw new Error("Expected three commits");
  const changed = mutation === "removed" ? [first, third] :
    mutation === "reordered" ? [second, first, third] : [first, first, second, third];
  failWith(journalText(changed), "NON_CONTIGUOUS_REVISION");
});

it("rejects post-disable InMemoryJournal event tails instead of synthesizing a seed", async () => {
  const store = new runtime.InMemoryJournal("stream-1", createRuntime("workspace-1"));
  await store.commit("stream-1", 0, enabledEvents());
  await store.commit("stream-1", 2, [journalEvent(3, { type: "PresenceChanged", status: "off" })]);
  expect(store.events()).toHaveLength(1);
  for (const expectedRevision of [0, 2]) {
    failWith(journalText([{ expectedRevision, events: store.events() }], { headRevision: 3 }), "NON_CONTIGUOUS_REVISION");
  }
  expect(store.snapshotNow().revision).toBe(3);
});

it("matches existing reduction over generated complete observation histories", () => {
  fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 8 }), { maxLength: 12 }), sizes => {
    const commits = observationCommits(sizes);
    const events = commits.flatMap(commit => commit.events);
    const replay = replayText(journalText(commits));
    expect(replay.snapshot).toEqual(reduce(createRuntime("workspace-1"), events));
    expect(replay.snapshot.revision).toBe(events.length);
    expect(replay.unsettledOperations).toEqual([]);
  }), { numRuns: 100 });
});

it.each([
  ["revision", "NON_CONTIGUOUS_REVISION"],
  ["eventId", "DUPLICATE_EVENT_ID"],
  ["commandId", "DUPLICATE_COMMAND_ID"],
  ["boundary", "NON_CONTIGUOUS_REVISION"],
  ["head", "HEAD_REVISION_MISMATCH"],
])("rejects generated %s corruption", (mutation, code) => {
  fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 8 }), { minLength: 2, maxLength: 12 }), sizes => {
    const commits = observationCommits(sizes);
    const [first, second] = commits;
    const previous = first?.events[0];
    const current = second?.events[0];
    if (second === undefined || previous === undefined || current === undefined) throw new Error("Expected history");
    const changed: PairEvent = mutation === "revision" ? { ...current, revision: current.revision + 1 } :
      mutation === "eventId" ? { ...current, eventId: previous.eventId } :
        mutation === "commandId" ? { ...current, commandId: previous.commandId } : current;
    commits[1] = {
      expectedRevision: second.expectedRevision + (mutation === "boundary" ? 1 : 0),
      events: [changed, ...second.events.slice(1)],
    };
    const headRevision = commits.reduce((count, commit) => count + commit.events.length, 0) + (mutation === "head" ? 1 : 0);
    failWith(journalText(commits, { headRevision }), code);
  }), { numRuns: 100 });
});

it("accepts every currently supported event route without changing the reducer", () => {
  const events = [
    ...readyEvents(),
    journalEvent(9, { type: "AttemptRecorded", workUnitId: "unit-1", summary: "Attempt", bypassed: false }),
    journalEvent(10, { type: "HypothesisRecorded", workUnitId: "unit-1", summary: "Hypothesis", bypassed: false }),
    journalEvent(11, { type: "HintRequested", workUnitId: "unit-1", level: 1 }),
    journalEvent(12, { type: "SolutionRevealAuthorized", workUnitId: "unit-1", previewOnly: true }),
    journalEvent(13, {
      type: "UserActionGranted", grantId: "grant-1", nativeToolName: "adaptive_pair_check", runtimeRevision: 13, authorityEpoch: 0,
    }),
    authorizedEvent(14, { userActionGrantId: "grant-1" }),
    journalEvent(15, { type: "UserActionConsumed", grantId: "grant-1" }),
    observedEvent(16),
    journalEvent(17, { type: "SessionPaused", reason: "Pause", authorityEpoch: 1 }),
    journalEvent(18, { type: "PresenceChanged", status: "paused" }),
    journalEvent(19, { type: "SessionResumed", entry: journalEntry() }),
    journalEvent(20, { type: "SessionClosed" }),
    journalEvent(21, { type: "PresenceChanged", status: "off" }),
  ];
  expect(new Set(events.map(event => event.type)).size).toBe(20);
  expect(replayHistory(events).snapshot).toEqual(reduce(createRuntime("workspace-1"), events));
  expect(replayHistory(events).unsettledOperations).toEqual([]);
});

it("rejects shape-valid BriefConfirmed explicitly instead of adding a reducer route", () => {
  const events = [...briefingEvents(), journalEvent(4, { type: "BriefConfirmed", goal: "Goal", criteria: ["Check"] })];
  expect(parsePairJournal(historyText(events)).commits[0]?.events).toHaveLength(4);
  failWith(historyText(events), "UNSUPPORTED_REPLAY_EVENT");
});

it.each([
  [journalEvent(1, { type: "WorkspaceObserved" }, { actor: "host" })],
  [authorizedEvent(1)],
  [...readyEvents(), authorizedEvent(9, { runtimeRevision: 8 })],
  [...readyEvents(), authorizedEvent(9, { authorityEpoch: 1 })],
  [...readyEvents(), journalEvent(9, { type: "SessionPaused", reason: "Pause", authorityEpoch: 2 })],
  [...readyEvents(), authorizedEvent(9), observedEvent(10, "confirmed", "absent")],
  [...readyEvents(), authorizedEvent(9), authorizedEvent(10)],
  [...readyEvents(), authorizedEvent(9), observedEvent(10, "unknown"), observedEvent(11)],
])("wraps invalid reducer state or epoch sequence %#", (...events) => {
  failWith(historyText(events), "INVALID_EVENT_SEQUENCE");
});

it("keeps reducibility distinct from command admission and authenticated consent", () => {
  const event = journalEvent(1, { type: "SessionStarted", sessionId: "ai-recorded" }, { actor: "ai" });
  const replay = replayHistory([event]);
  expect(replay.snapshot).toEqual(reduce(createRuntime("workspace-1"), [event]));
  expect(replay.snapshot.session?.status).toBe("briefing");
  expect(replay.snapshot.session?.userActionGrants).toEqual([]);
});

it("allows rebind only after the core-required reset", () => {
  failWith(historyText([
    ...enabledEvents(), journalEvent(3, { type: "PresenceEnabled", workspaceId: "workspace-2" }),
  ]), "INVALID_EVENT_SEQUENCE");
  const events = [
    ...enabledEvents(), journalEvent(3, { type: "PresenceChanged", status: "off" }),
    ...enabledEvents(3, "workspace-2"),
  ];
  expect(replayHistory(events).snapshot.presence.workspaceId).toBe("workspace-2");
});

it.each((["read", "edit", "check"] as const).flatMap(kind =>
  (["planned", "authorized", "started", "unknown"] as const).map(status => ({ kind, status })),
))("preserves recorded $status $kind work", ({ kind, status }) => {
  const replay = replayHistory([...readyEvents(), authorizedEvent(9, { kind, status })]);
  expect(replay.unsettledOperations).toEqual([{
    sessionStartedAtRevision: 3, workspaceId: "workspace-1", operationId: "operation-1", kind, recordedStatus: status,
  }]);
  expect(Object.isFrozen(replay.unsettledOperations[0])).toBe(true);
});

it.each((["read", "edit", "check"] as const).flatMap(kind =>
  (["confirmed", "failed", "declined", "cancelled"] as const).map(status => ({ kind, status })),
))("removes only the $kind operation with recorded $status observation", ({ kind, status }) => {
  const replay = replayHistory([
    ...readyEvents(), authorizedEvent(9, { kind }), authorizedEvent(10, { id: "other-operation", kind }), observedEvent(11, status),
  ]);
  expect(replay.unsettledOperations).toEqual([{
    sessionStartedAtRevision: 3, workspaceId: "workspace-1", operationId: "other-operation", kind, recordedStatus: "authorized",
  }]);
});

it("retains an unknown observation as unfinished historical work", () => {
  const replay = replayHistory([...readyEvents(), authorizedEvent(9), observedEvent(10, "unknown")]);
  expect(replay.unsettledOperations[0]?.recordedStatus).toBe("unknown");
  expect(replay.snapshot.session?.operations[0]?.status).toBe("unknown");
});

it.each(["confirmed", "failed", "declined", "cancelled"] as const)(
  "does not create a warning for a recorded terminal %s operation", status => {
    expect(replayHistory([...readyEvents(), authorizedEvent(9, { status })]).unsettledOperations).toEqual([]);
  },
);

it.each(["close", "disable", "rebind"])("keeps unresolved warnings after %s", boundary => {
  const events = [...readyEvents(), authorizedEvent(9, { status: "started" })];
  if (boundary === "close") events.push(journalEvent(10, { type: "SessionClosed" }));
  else events.push(journalEvent(10, { type: "PresenceChanged", status: "off" }));
  if (boundary === "rebind") events.push(...enabledEvents(10, "workspace-2"));
  const replay = replayHistory(events);
  expect(replay.unsettledOperations).toEqual([{
    sessionStartedAtRevision: 3, workspaceId: "workspace-1", operationId: "operation-1", kind: "check", recordedStatus: "started",
  }]);
});

it.each(["workspace-1", "workspace-2"])("separates reused IDs across disable and restart in %s", workspaceId => {
  const events = [
    ...readyEvents(), authorizedEvent(9, { status: "started" }),
    journalEvent(10, { type: "PresenceChanged", status: "off" }),
    ...readyEvents(10, workspaceId), authorizedEvent(19),
  ];
  const oldWarning = {
    sessionStartedAtRevision: 3, workspaceId: "workspace-1", operationId: "operation-1", kind: "check", recordedStatus: "started",
  };
  const replay = replayHistory(events);
  expect(replay.snapshot.session?.sessionId).toBe("session-1");
  expect(replay.unsettledOperations).toEqual([oldWarning, {
    sessionStartedAtRevision: 13, workspaceId, operationId: "operation-1", kind: "check", recordedStatus: "authorized",
  }]);
  expect(replayHistory([...events, observedEvent(20)]).unsettledOperations).toEqual([oldWarning]);
});

it("publishes no partial replay or retained state when a later event is invalid", () => {
  const valid = [...readyEvents(), authorizedEvent(9)];
  let published: ReturnType<typeof replayPairJournal> | undefined;
  expect(() => {
    published = replayHistory([...valid, observedEvent(10, "confirmed", "absent")]);
  }).toThrow(new Error("Invalid Pair journal: INVALID_EVENT_SEQUENCE"));
  expect(published).toBeUndefined();
  expect(replayText(journalText([])).unsettledOperations).toEqual([]);
  expect(replayHistory(valid).unsettledOperations).toHaveLength(1);
});

it("does not mutate caller-supplied parsed commits or events", () => {
  const journal = parsePairJournal(historyText([...readyEvents(), authorizedEvent(9)]));
  const before = JSON.stringify(journal);
  replayPairJournal(journal);
  expect(JSON.stringify(journal)).toBe(before);
  expect(Object.isFrozen(journal.commits[0]?.events)).toBe(true);
});
