import { describe, expect, it } from "vitest";
import type {
  EntrySnapshot,
  OperationRecord,
  PairEvent,
  PairRuntimeSnapshot,
} from "@adaptive-pair/protocol";
import { createPresence, createRuntime, createSession, decide, reduce } from "../src/index.js";

const createActiveRuntime = (): PairRuntimeSnapshot => ({
  ...createRuntime("workspace-1"),
  presence: {
    ...createRuntime("workspace-1").presence,
    status: "engaged",
    activeSessionId: "session-1",
  },
  session: {
    ...createSession("session-1"),
    status: "active",
  },
});

const createEntrySnapshot = (
  overrides: Partial<EntrySnapshot> = {},
): EntrySnapshot => ({
  workspaceId: "workspace-1",
  dirtyPaths: ["src/current.ts"],
  openPaths: ["src/current.ts"],
  diagnostics: ["src/current.ts:1:1 warning"],
  protectedPaths: ["README.md"],
  capturedAt: 12,
  ...overrides,
});

const createWorkUnit = () => ({
  id: "wu-1",
  objective: "Reconcile paused work",
  mode: "pair" as const,
  learningValue: "mixed" as const,
  capability: "implementation" as const,
  owner: "ai" as const,
  allowedPaths: ["src"],
  acceptanceChecks: ["npm test"],
  verificationPlan: "Run focused tests",
  stoppingCondition: "Work is reconciled",
  baseline: { "src/current.ts": "abc123" },
  status: "agreed" as const,
});

describe("session core", () => {
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
    });
    expect(session.criteria).toEqual([]);
    expect(session.operations).toEqual([]);
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(session.criteria)).toBe(true);
    expect(Object.isFrozen(session.operations)).toBe(true);

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

    expect(() =>
      decide(runtime, {
        protocolVersion: 1,
        commandId: "cmd-1",
        expectedRevision: 2,
        actor: "human",
        type: "CloseSession",
        observedAt: 10,
      }),
    ).toThrow("STALE_REVISION");
  });

  it("starts a session with sequential immutable events", () => {
    const runtime = createRuntime("workspace-1");

    const decision = decide(runtime, {
      protocolVersion: 1,
      commandId: "cmd-start",
      expectedRevision: 0,
      actor: "human",
      type: "StartSession",
      sessionId: "session-1",
      observedAt: 10,
    });

    expect(decision.events).toEqual([
      {
        protocolVersion: 1,
        eventId: "cmd-start:0",
        commandId: "cmd-start",
        actor: "human",
        revision: 1,
        recordedAt: 10,
        type: "SessionStarted",
        sessionId: "session-1",
      },
    ]);
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
        authorityEpoch: 0,
        status: "briefing",
        mode: undefined,
        goal: undefined,
        criteria: [],
        learningAgreement: undefined,
        entrySnapshot: undefined,
        workUnit: undefined,
        operations: [],
      },
    });
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.presence)).toBe(true);
    expect(Object.isFrozen(next.session)).toBe(true);
  });

  it("rejects starting a session when one already exists", () => {
    const runtime = createActiveRuntime();

    expect(() =>
      reduce(runtime, [
        {
          protocolVersion: 1,
          eventId: "cmd-start:0",
          commandId: "cmd-start",
          actor: "human",
          revision: 1,
          recordedAt: 10,
          type: "SessionStarted",
          sessionId: "session-2",
        },
      ]),
    ).toThrow("SESSION_ALREADY_STARTED");
  });

  it("increments authority before pausing", () => {
    const runtime = createActiveRuntime();

    const decision = decide(runtime, {
      protocolVersion: 1,
      commandId: "cmd-pause",
      expectedRevision: 0,
      actor: "human",
      type: "PauseSession",
      reason: "takeover",
      observedAt: 10,
    });

    const next = reduce(runtime, decision.events);

    expect(next.session?.status).toBe("paused");
    expect(next.session?.authorityEpoch).toBe(1);
    expect(next.presence.status).toBe("paused");
    expect(next.presence.activeSessionId).toBe("session-1");
  });

  it("captures entry snapshots only during briefing and preserves protections", () => {
    const briefing = reduce(createRuntime("workspace-1"), [
      {
        protocolVersion: 1,
        eventId: "cmd-start:0",
        commandId: "cmd-start",
        actor: "human",
        revision: 1,
        recordedAt: 10,
        type: "SessionStarted",
        sessionId: "session-1",
      },
    ]);

    const firstDecision = decide(briefing, {
      protocolVersion: 1,
      commandId: "cmd-entry-1",
      expectedRevision: 1,
      actor: "human",
      type: "CaptureEntry",
      entry: createEntrySnapshot({
        dirtyPaths: ["src/a.ts", "src/a.ts"],
        openPaths: ["src/a.ts"],
        protectedPaths: ["docs/notes.md"],
        diagnostics: ["diag-1", "diag-1", "diag-2"],
        capturedAt: 11,
      }),
      observedAt: 11,
    });

    expect(firstDecision.events).toEqual([
      {
        protocolVersion: 1,
        eventId: "cmd-entry-1:0",
        commandId: "cmd-entry-1",
        actor: "human",
        revision: 2,
        recordedAt: 11,
        type: "EntryCaptured",
        entry: {
          workspaceId: "workspace-1",
          dirtyPaths: ["src/a.ts"],
          openPaths: ["src/a.ts"],
          diagnostics: ["diag-1", "diag-2"],
          protectedPaths: ["docs/notes.md", "src/a.ts"],
          capturedAt: 11,
        },
      },
    ]);

    const captured = reduce(briefing, firstDecision.events);
    const second = reduce(captured, [
      {
        protocolVersion: 1,
        eventId: "cmd-entry-2:0",
        commandId: "cmd-entry-2",
        actor: "human",
        revision: 3,
        recordedAt: 12,
        type: "EntryCaptured",
        entry: createEntrySnapshot({
          dirtyPaths: ["src/b.ts"],
          openPaths: ["src/b.ts", "src/flow.ts"],
          protectedPaths: ["README.md"],
          capturedAt: 12,
        }),
      },
    ]);

    expect(captured.session?.status).toBe("briefing");
    expect(captured.session?.entrySnapshot).toEqual({
      workspaceId: "workspace-1",
      dirtyPaths: ["src/a.ts"],
      openPaths: ["src/a.ts"],
      diagnostics: ["diag-1", "diag-2"],
      protectedPaths: ["docs/notes.md", "src/a.ts"],
      capturedAt: 11,
    });
    expect(second.session?.entrySnapshot?.protectedPaths).toEqual([
      "README.md",
      "docs/notes.md",
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("rejects entry capture outside briefing in decisions and direct events", () => {
    const invalidStates = [
      createRuntime("workspace-1"),
      {
        ...createRuntime("workspace-1"),
        presence: {
          workspaceId: "workspace-1",
          observationRevision: 0,
          status: "engaged" as const,
          activeSessionId: "session-1",
        },
        session: {
          ...createSession("session-1"),
          status: "active" as const,
        },
      },
      {
        ...createRuntime("workspace-1"),
        presence: {
          workspaceId: "workspace-1",
          observationRevision: 0,
          status: "paused" as const,
          activeSessionId: "session-1",
        },
        session: {
          ...createSession("session-1"),
          status: "paused" as const,
        },
      },
    ] satisfies PairRuntimeSnapshot[];

    for (const [index, runtime] of invalidStates.entries()) {
      expect(() =>
        decide(runtime, {
          protocolVersion: 1,
          commandId: `cmd-invalid-entry-${index}`,
          expectedRevision: runtime.revision,
          actor: "human",
          type: "CaptureEntry",
          entry: createEntrySnapshot(),
          observedAt: 10,
        }),
      ).toThrow("SESSION_NOT_BRIEFING");

      expect(() =>
        reduce(runtime, [
          {
            protocolVersion: 1,
            eventId: `cmd-invalid-entry-${index}:0`,
            commandId: `cmd-invalid-entry-${index}`,
            actor: "human",
            revision: runtime.revision + 1,
            recordedAt: 10,
            type: "EntryCaptured",
            entry: createEntrySnapshot(),
          },
        ]),
      ).toThrow("SESSION_NOT_BRIEFING");
    }
  });

  it("rejects pausing sessions that are not ready, active, or reconciling", () => {
    const statuses = ["inactive", "briefing", "paused", "closed"] as const;

    for (const status of statuses) {
      const runtime: PairRuntimeSnapshot = {
        ...createRuntime("workspace-1"),
        presence: {
          workspaceId: "workspace-1",
          observationRevision: 0,
          status: "engaged",
          activeSessionId: "session-1",
        },
        session: {
          ...createSession("session-1"),
          status,
        },
      };

      expect(() =>
        reduce(runtime, [
          {
            protocolVersion: 1,
            eventId: "cmd-pause:0",
            commandId: "cmd-pause",
            actor: "human",
            revision: 1,
            recordedAt: 10,
            type: "SessionPaused",
            reason: "takeover",
            authorityEpoch: 1,
          },
        ]),
      ).toThrow("SESSION_NOT_PAUSABLE");
    }
  });

  it("resumes paused sessions into reconciling without lowering authority", () => {
    const runtime: PairRuntimeSnapshot = {
      ...createRuntime("workspace-1"),
      presence: {
        workspaceId: "workspace-1",
        observationRevision: 0,
        status: "paused",
        activeSessionId: "session-1",
      },
      session: {
        ...createSession("session-1"),
        authorityEpoch: 3,
        status: "paused",
        entrySnapshot: createEntrySnapshot({
          dirtyPaths: ["src/dirty.ts"],
          openPaths: ["src/dirty.ts"],
          protectedPaths: ["docs/notes.md"],
          capturedAt: 9,
        }),
        workUnit: createWorkUnit(),
      },
    };

    const decision = decide(runtime, {
      protocolVersion: 1,
      commandId: "cmd-resume",
      expectedRevision: 0,
      actor: "human",
      type: "ResumeSession",
      entry: createEntrySnapshot({
        branch: "feature/task-4",
        dirtyPaths: ["src/current.ts"],
        openPaths: ["src/current.ts", "src/helper.ts"],
        protectedPaths: ["README.md"],
        capturedAt: 20,
      }),
      observedAt: 20,
    });

    expect(decision.events).toEqual([
      {
        protocolVersion: 1,
        eventId: "cmd-resume:0",
        commandId: "cmd-resume",
        actor: "human",
        revision: 1,
        recordedAt: 20,
        type: "SessionResumed",
        entry: {
          workspaceId: "workspace-1",
          branch: "feature/task-4",
          dirtyPaths: ["src/current.ts"],
          openPaths: ["src/current.ts", "src/helper.ts"],
          diagnostics: ["src/current.ts:1:1 warning"],
          protectedPaths: [
            "README.md",
            "docs/notes.md",
            "src/current.ts",
            "src/dirty.ts",
          ],
          capturedAt: 20,
        },
      },
    ]);

    const resumed = reduce(runtime, decision.events);

    expect(resumed.session).toMatchObject({
      sessionId: "session-1",
      authorityEpoch: 3,
      status: "reconciling",
      workUnit: {
        ...createWorkUnit(),
        status: "needs-reconcile",
      },
      entrySnapshot: {
        workspaceId: "workspace-1",
        branch: "feature/task-4",
        dirtyPaths: ["src/current.ts"],
        openPaths: ["src/current.ts", "src/helper.ts"],
        diagnostics: ["src/current.ts:1:1 warning"],
        protectedPaths: [
          "README.md",
          "docs/notes.md",
          "src/current.ts",
          "src/dirty.ts",
        ],
        capturedAt: 20,
      },
    });
    expect(resumed.presence.status).toBe("engaged");
    expect(resumed.presence.activeSessionId).toBe("session-1");
  });

  it("rejects resuming sessions that are not paused in decisions and direct events", () => {
    const invalidStates = [
      createRuntime("workspace-1"),
      {
        ...createRuntime("workspace-1"),
        presence: {
          workspaceId: "workspace-1",
          observationRevision: 0,
          status: "engaged" as const,
          activeSessionId: "session-1",
        },
        session: {
          ...createSession("session-1"),
          status: "briefing" as const,
        },
      },
      {
        ...createRuntime("workspace-1"),
        presence: {
          workspaceId: "workspace-1",
          observationRevision: 0,
          status: "engaged" as const,
          activeSessionId: "session-1",
        },
        session: {
          ...createSession("session-1"),
          status: "reconciling" as const,
        },
      },
    ] satisfies PairRuntimeSnapshot[];

    for (const [index, runtime] of invalidStates.entries()) {
      expect(() =>
        decide(runtime, {
          protocolVersion: 1,
          commandId: `cmd-invalid-resume-${index}`,
          expectedRevision: runtime.revision,
          actor: "human",
          type: "ResumeSession",
          entry: createEntrySnapshot(),
          observedAt: 10,
        }),
      ).toThrow("SESSION_NOT_PAUSED");

      expect(() =>
        reduce(runtime, [
          {
            protocolVersion: 1,
            eventId: `cmd-invalid-resume-${index}:0`,
            commandId: `cmd-invalid-resume-${index}`,
            actor: "human",
            revision: runtime.revision + 1,
            recordedAt: 10,
            type: "SessionResumed",
            entry: createEntrySnapshot(),
          },
        ]),
      ).toThrow("SESSION_NOT_PAUSED");
    }
  });

  it("blocks work-unit agreement while reconciling", () => {
    const runtime: PairRuntimeSnapshot = {
      ...createRuntime("workspace-1"),
      presence: {
        workspaceId: "workspace-1",
        observationRevision: 0,
        status: "engaged",
        activeSessionId: "session-1",
      },
      session: {
        ...createSession("session-1"),
        status: "reconciling",
        workUnit: {
          ...createWorkUnit(),
          status: "needs-reconcile",
        },
      },
    };

    expect(() =>
      decide(runtime, {
        protocolVersion: 1,
        commandId: "cmd-agree",
        expectedRevision: 0,
        actor: "human",
        type: "AgreeWorkUnit",
        workUnitId: "wu-1",
        observedAt: 10,
      }),
    ).toThrow("SESSION_RECONCILING");

    expect(() =>
      reduce(runtime, [
        {
          protocolVersion: 1,
          eventId: "cmd-agree:0",
          commandId: "cmd-agree",
          actor: "human",
          revision: 1,
          recordedAt: 10,
          type: "WorkUnitAgreed",
          workUnitId: "wu-1",
        },
      ]),
    ).toThrow("SESSION_RECONCILING");
  });

  it("rejects paused events that do not advance authority", () => {
    const runtime: PairRuntimeSnapshot = {
      ...createActiveRuntime(),
      session: {
        ...createActiveRuntime().session!,
        authorityEpoch: 3,
      },
    };

    expect(() =>
      reduce(runtime, [
        {
          protocolVersion: 1,
          eventId: "cmd-pause:0",
          commandId: "cmd-pause",
          actor: "human",
          revision: 1,
          recordedAt: 10,
          type: "SessionPaused",
          reason: "takeover",
          authorityEpoch: 3,
        },
      ]),
    ).toThrow("INVALID_AUTHORITY_EPOCH");
  });

  it("rejects closing an already closed session", () => {
    const runtime: PairRuntimeSnapshot = {
      ...createActiveRuntime(),
      session: {
        ...createSession("session-1"),
        status: "closed",
      },
    };

    expect(() =>
      reduce(runtime, [
        {
          protocolVersion: 1,
          eventId: "cmd-close:0",
          commandId: "cmd-close",
          actor: "human",
          revision: 1,
          recordedAt: 10,
          type: "SessionClosed",
        },
      ]),
    ).toThrow("SESSION_ALREADY_CLOSED");
  });

  it("enforces strict event revision ordering", () => {
    const runtime = createRuntime("workspace-1");
    const staleEvent: PairEvent = {
      protocolVersion: 1,
      eventId: "cmd-start:0",
      commandId: "cmd-start",
      actor: "human",
      revision: 2,
      recordedAt: 10,
      type: "SessionStarted",
      sessionId: "session-1",
    };

    expect(() => reduce(runtime, [staleEvent])).toThrow("INVALID_EVENT_REVISION");
  });

  it("rejects unsupported commands and events", () => {
    const runtime = createActiveRuntime();
    const unsupportedEvent = {
      protocolVersion: 1,
      eventId: "cmd-unknown:0",
      commandId: "cmd-unknown",
      actor: "human",
      revision: 1,
      recordedAt: 10,
      type: "PresenceChanged",
      status: "observing",
    } satisfies PairEvent;

    expect(() =>
      decide(runtime, {
        protocolVersion: 1,
        commandId: "cmd-unsupported",
        expectedRevision: runtime.revision,
        actor: "human",
        type: "ConfirmBrief",
        goal: "later task",
        criteria: [],
        observedAt: 10,
      }),
    ).toThrow("UNSUPPORTED_COMMAND:ConfirmBrief");
    expect(() => reduce(createRuntime("workspace-1"), [unsupportedEvent])).toThrow(
      "UNSUPPORTED_EVENT:PresenceChanged",
    );
  });

  it("closes a session and returns presence to observing", () => {
    const runtime = createActiveRuntime();
    const started = reduce(
      runtime,
      [
        {
          protocolVersion: 1,
          eventId: "cmd-close:0",
          commandId: "cmd-close",
          actor: "policy",
          revision: 1,
          recordedAt: 11,
          type: "SessionClosed",
        },
      ],
    );

    expect(started.session?.status).toBe("closed");
    expect(started.presence.status).toBe("observing");
    expect(started.presence.activeSessionId).toBe(undefined);
  });

  it("deep-clones nested session data in reduced output", () => {
    const dirtyPaths = ["src/a.ts"];
    const criteria = ["criterion-1"];
    const operations: OperationRecord[] = [
      {
        id: "op-1",
        workUnitId: "wu-1",
        kind: "read",
        authorityEpoch: 0,
        status: "planned",
      },
    ];
    const learningGoals = ["goal-1"];
    const allowedPaths = ["src"];
    const entrySnapshot = {
      workspaceId: "workspace-1",
      dirtyPaths,
      openPaths: ["src/a.ts"],
      diagnostics: ["src/a.ts:1:1 warning"],
      protectedPaths: ["src/a.ts"],
      capturedAt: 12,
    };
    const runtime: PairRuntimeSnapshot = {
      ...createRuntime("workspace-1"),
      presence: {
        workspaceId: "workspace-1",
        observationRevision: 0,
        status: "engaged",
        activeSessionId: "session-1",
      },
      session: {
        ...createSession("session-1"),
        status: "active",
        criteria,
        entrySnapshot,
        learningAgreement: {
          learningGoals,
          familiarAreas: ["area-1"],
          humanOwnedCapabilities: ["verification"],
          delegatableWork: ["work-1"],
          maximumHintLevel: 2,
          independentCheck: "check-1",
        },
        workUnit: {
          id: "wu-1",
          objective: "objective-1",
          mode: "pair",
          learningValue: "mixed",
          capability: "implementation",
          owner: "human",
          allowedPaths,
          acceptanceChecks: ["npm test"],
          verificationPlan: "verify",
          stoppingCondition: "stop",
          baseline: { "src/a.ts": "abc" },
          status: "agreed",
        },
        operations,
      },
    };

    const next = reduce(runtime, [
      {
        protocolVersion: 1,
        eventId: "cmd-close:0",
        commandId: "cmd-close",
        actor: "human",
        revision: 1,
        recordedAt: 13,
        type: "SessionClosed",
      },
    ]);

    dirtyPaths.push("src/b.ts");
    criteria.push("criterion-2");
    operations.push({
      id: "op-2",
      workUnitId: "wu-1",
      kind: "edit",
      authorityEpoch: 0,
      status: "authorized",
    });
    learningGoals.push("goal-2");
    allowedPaths.push("test");

    expect(next.session?.criteria).toEqual(["criterion-1"]);
    expect(next.session?.entrySnapshot?.dirtyPaths).toEqual(["src/a.ts"]);
    expect(next.session?.operations).toEqual([
      {
        id: "op-1",
        workUnitId: "wu-1",
        kind: "read",
        authorityEpoch: 0,
        status: "planned",
      },
    ]);
    expect(next.session?.learningAgreement?.learningGoals).toEqual(["goal-1"]);
    expect(next.session?.workUnit?.allowedPaths).toEqual(["src"]);
    expect(Object.isFrozen(next.session?.entrySnapshot)).toBe(true);
    expect(Object.isFrozen(next.session?.learningAgreement)).toBe(true);
    expect(Object.isFrozen(next.session?.workUnit)).toBe(true);
    expect(Object.isFrozen(next.session?.operations[0])).toBe(true);
  });
});
