import type { OperationRecord } from "@adaptive-pair/protocol";
import { expect, it } from "vitest";
import { createPresence, createRuntime, createSession, decide, reduce } from "../src/index.js";
import {
  command,
  createActiveRuntime,
  createEntrySnapshot,
  createGrowthAgreement,
  createWorkUnit,
  event,
} from "./sessionCoreFixtures.js";

it("creates frozen initial snapshots", () => {
  const presence = createPresence("workspace-1");
  const session = createSession("session-1");
  const runtime = createRuntime("workspace-1");

  expect(presence).toEqual({
    workspaceId: "workspace-1",
    observationRevision: 0,
    status: "off",
    activeSessionId: undefined,
  });
  expect(Object.isFrozen(presence)).toBe(true);

  expect(session).toMatchObject({
    sessionId: "session-1",
    authorityEpoch: 0,
    status: "inactive",
    mode: undefined,
    goal: undefined,
    learningAgreement: undefined,
    entrySnapshot: undefined,
    workUnit: undefined,
    assistance: undefined,
  });
  expect(session.criteria).toEqual([]);
  expect(session.operations).toEqual([]);
  expect(session.userActionGrants).toEqual([]);
  expect(Object.isFrozen(session)).toBe(true);
  expect(Object.isFrozen(session.criteria)).toBe(true);
  expect(Object.isFrozen(session.operations)).toBe(true);
  expect(Object.isFrozen(session.userActionGrants)).toBe(true);

  expect(runtime).toEqual({
    protocolVersion: 1,
    revision: 0,
    presence,
    session: undefined,
  });
  expect(Object.isFrozen(runtime)).toBe(true);
});

it("rejects stale commands", () => {
  const runtime = createRuntime("workspace-1");

  expect(() => decide(runtime, command("CloseSession", 2, {}))).toThrow("STALE_REVISION");
});

it("starts a session with sequential immutable events", () => {
  const runtime = createRuntime("workspace-1");

  const decision = decide(runtime, command("StartSession", 0, { sessionId: "session-1" }));

  expect(decision.events).toEqual([event("SessionStarted", 1, { sessionId: "session-1" })]);
  expect(Object.isFrozen(decision)).toBe(true);
  expect(Object.isFrozen(decision.events)).toBe(true);
  expect(Object.isFrozen(decision.events[0])).toBe(true);

  const next = reduce(runtime, decision.events);

  expect(next).toEqual({
    protocolVersion: 1,
    revision: 1,
    presence: {
      workspaceId: "workspace-1",
      observationRevision: 0,
      status: "engaged",
      activeSessionId: "session-1",
    },
    session: {
      sessionId: "session-1",
      startedAtRevision: 1,
      authorityEpoch: 0,
      status: "briefing",
      mode: undefined,
      goal: undefined,
      criteria: [],
      learningAgreement: undefined,
      entrySnapshot: undefined,
      workUnit: undefined,
      assistance: undefined,
      operations: [],
      userActionGrants: [],
    },
  });
  expect(Object.isFrozen(next)).toBe(true);
  expect(Object.isFrozen(next.presence)).toBe(true);
  expect(Object.isFrozen(next.session)).toBe(true);
});

it("rejects starting a session when one already exists", () => {
  const runtime = createActiveRuntime();

  expect(() => reduce(runtime, [event("SessionStarted", 1, { sessionId: "session-2" })]))
    .toThrow("SESSION_ALREADY_STARTED");
});

it("enforces strict event revision ordering", () => {
  expect(() => reduce(createRuntime("workspace-1"), [event("SessionStarted", 2, { sessionId: "session-1" })]))
    .toThrow("INVALID_EVENT_REVISION");
});

it("rejects unsupported commands and events", () => {
  expect(() => decide(createActiveRuntime(), command("ConfirmBrief", 0, { goal: "later task", criteria: [] })))
    .toThrow("UNSUPPORTED_COMMAND:ConfirmBrief");
  expect(() => reduce(createRuntime("workspace-1"), [event("BriefConfirmed", 1, { goal: "later task", criteria: [] })]))
    .toThrow("UNSUPPORTED_EVENT:BriefConfirmed");
});

it("deep-clones nested session data in reduced output", () => {
  const operation: OperationRecord = {
    id: "op-1", workUnitId: "wu-1", toolName: "pair_read_scope", kind: "read", input: { path: "src/a.ts" },
    runtimeRevision: 0, authorityEpoch: 0, status: "planned", summary: undefined, userActionGrantId: undefined,
  };
  const assistance = {
    attempt: { summary: "Tried editing the guard", bypassed: false, recordedAt: 11 },
    hypothesis: { summary: "The return happens too early", bypassed: false, recordedAt: 12 },
    hint: { level: 2 as const, recordedAt: 13 },
    solutionReveal: { previewOnly: true as const, recordedAt: 14 },
  };
  const active = createActiveRuntime();
  const session = {
    ...active.session!, criteria: ["criterion-1"], entrySnapshot: createEntrySnapshot(),
    learningAgreement: createGrowthAgreement(), workUnit: createWorkUnit(), assistance, operations: [operation],
  };
  const next = reduce({ ...active, session }, [event("SessionClosed", 1, {})]);

  const routes = [
    [session.criteria, next.session?.criteria],
    [session.entrySnapshot.dirtyPaths, next.session?.entrySnapshot?.dirtyPaths],
    [session.operations, next.session?.operations],
    [session.learningAgreement.learningGoals, next.session?.learningAgreement?.learningGoals],
    [session.workUnit.allowedPaths, next.session?.workUnit?.allowedPaths],
  ] as const;
  for (const [input, output] of routes) {
    const expected = [...input];
    (input as unknown[]).push("caller mutation");
    expect(output).toEqual(expected);
  }
  expect(next.session?.assistance).toEqual(assistance);
  for (const value of [
    next.session?.entrySnapshot, next.session?.learningAgreement, next.session?.workUnit,
    next.session?.assistance, next.session?.operations[0],
  ]) {
    expect(value !== undefined && Object.isFrozen(value)).toBe(true);
  }
});
