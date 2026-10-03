import { expect, it } from "vitest";
import { parsePairJournal, type PairEvent } from "@adaptive-pair/protocol";
import { createRuntime, reduce } from "@adaptive-pair/session-core";
import * as runtime from "../src/index.js";
import { replayPairJournal } from "../src/journalReplay.js";
import {
  authorizedEvent, briefingEvents, enabledEvents, historyText,
  journalEntry, journalEvent, journalText, observedEvent, readyEvents,
} from "./journalRecoveryFixtures.js";

const replayHistory = (events: readonly PairEvent[]) => replayPairJournal(parsePairJournal(historyText(events)));
const replayText = (text: string) => replayPairJournal(parsePairJournal(text));
const failWith = (text: string, code: string) => {
  expect(() => replayText(text)).toThrow(new Error(`Invalid Pair journal: ${code}`));
};

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

it("rejects duplicate event IDs across commits", () => {
  const events = enabledEvents().map(event => ({ ...event, eventId: "duplicate-event" }));
  failWith(journalText(events.map((event, index) => ({ expectedRevision: index, events: [event] }))), "DUPLICATE_EVENT_ID");
});

it("rejects a nonzero initial expected revision", () => {
  failWith(journalText([{ expectedRevision: 1, events: enabledEvents() }]), "NON_CONTIGUOUS_REVISION");
});

it("rejects an event revision that skips the next revision", () => {
  const events = enabledEvents().map((event, index) => index === 1 ? { ...event, revision: 3 } : event);
  failWith(historyText(events), "NON_CONTIGUOUS_REVISION");
});

it("rejects a declared head that differs from the replayed revision", () => {
  failWith(journalText([{ expectedRevision: 0, events: enabledEvents() }], { headRevision: 3 }), "HEAD_REVISION_MISMATCH");
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
  [...readyEvents(), authorizedEvent(9, { runtimeRevision: 8 })],
  [...readyEvents(), authorizedEvent(9, { authorityEpoch: 1 })],
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

it.each([
  { kind: "read", status: "planned" }, { kind: "edit", status: "authorized" },
  { kind: "check", status: "started" }, { kind: "read", status: "unknown" },
] as const)("preserves recorded $status $kind work", ({ kind, status }) => {
  const replay = replayHistory([...readyEvents(), authorizedEvent(9, { kind, status })]);
  expect(replay.unsettledOperations).toEqual([{
    sessionStartedAtRevision: 3, workspaceId: "workspace-1", operationId: "operation-1", kind, recordedStatus: status,
  }]);
  expect(Object.isFrozen(replay.unsettledOperations[0])).toBe(true);
});

it("removes only the operation with a recorded terminal observation", () => {
  const replay = replayHistory([
    ...readyEvents(), authorizedEvent(9), authorizedEvent(10, { id: "other-operation" }), observedEvent(11, "failed"),
  ]);
  expect(replay.unsettledOperations).toEqual([{
    sessionStartedAtRevision: 3, workspaceId: "workspace-1", operationId: "other-operation", kind: "check", recordedStatus: "authorized",
  }]);
});

it("keeps unresolved warnings after close", () => {
  const replay = replayHistory([...readyEvents(), authorizedEvent(9, { status: "started" }), journalEvent(10, { type: "SessionClosed" })]);
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
