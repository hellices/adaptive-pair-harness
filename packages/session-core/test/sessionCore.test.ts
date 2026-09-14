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

const createGrowthAgreement = (
  overrides: Partial<{
    learningGoals: readonly string[];
    familiarAreas: readonly string[];
    humanOwnedCapabilities: readonly ("implementation" | "verification")[];
    delegatableWork: readonly string[];
    maximumHintLevel: 0 | 1 | 2 | 3 | 4 | 5;
    independentCheck: string;
  }> = {},
) => ({
  learningGoals: ["Practice retry-state debugging"],
  familiarAreas: ["test harness"],
  humanOwnedCapabilities: ["implementation", "verification"] as const,
  delegatableWork: ["search for related tests"],
  maximumHintLevel: 2 as const,
  independentCheck: "Solve one similar retry bug without AI edits",
  ...overrides,
});

const createGrowthWorkUnit = () => ({
  id: "growth-wu-1",
  objective: "Repair the retry guard",
  mode: "growth" as const,
  learningValue: "high" as const,
  capability: "implementation" as const,
  owner: "human" as const,
  allowedPaths: ["src/current.ts"],
  acceptanceChecks: ["npm test -- retry"],
  verificationPlan: "Run the retry suite",
  stoppingCondition: "one retry behavior is green",
  baseline: { "src/current.ts": "abc123" },
  status: "proposed" as const,
});

const createEditOperationRequest = (
  overrides: Partial<{
    commandId: string;
    expectedRevision: number;
    actor: "human" | "ai";
    workUnitId: string;
    operationId: string;
    targetPath: string;
    description: string;
    observedAt: number;
  }> = {},
) => ({
  protocolVersion: 1 as const,
  commandId: "cmd-edit-operation",
  expectedRevision: 0,
  actor: "ai" as const,
  type: "RequestEditOperation" as const,
  workUnitId: "growth-wu-1",
  operationId: "op-1",
  targetPath: "src/current.ts",
  description: "Apply the agreed retry-guard edit",
  observedAt: 16,
  ...overrides,
});

const createGrowthRuntime = (
  agreement = createGrowthAgreement(),
): PairRuntimeSnapshot =>
  reduce(createRuntime("workspace-1"), [
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
    {
      protocolVersion: 1,
      eventId: "cmd-entry:0",
      commandId: "cmd-entry",
      actor: "human",
      revision: 2,
      recordedAt: 11,
      type: "EntryCaptured",
      entry: createEntrySnapshot(),
    },
    {
      protocolVersion: 1,
      eventId: "cmd-learning:0",
      commandId: "cmd-learning",
      actor: "human",
      revision: 3,
      recordedAt: 12,
      type: "LearningConfirmed",
      agreement,
    },
    {
      protocolVersion: 1,
      eventId: "cmd-mode:0",
      commandId: "cmd-mode",
      actor: "human",
      revision: 4,
      recordedAt: 13,
      type: "ModeSelected",
      mode: "growth",
    },
    {
      protocolVersion: 1,
      eventId: "cmd-propose:0",
      commandId: "cmd-propose",
      actor: "human",
      revision: 5,
      recordedAt: 14,
      type: "WorkUnitProposed",
      workUnit: createGrowthWorkUnit(),
    },
    {
      protocolVersion: 1,
      eventId: "cmd-agree:0",
      commandId: "cmd-agree",
      actor: "human",
      revision: 6,
      recordedAt: 15,
      type: "WorkUnitAgreed",
      workUnitId: "growth-wu-1",
    },
  ]);

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

  it("rejects confirming learning before an entry snapshot in decisions and direct events", () => {
    const runtime = reduce(createRuntime("workspace-1"), [
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

    expect(() =>
      decide(runtime, {
        protocolVersion: 1,
        commandId: "cmd-learning",
        expectedRevision: 1,
        actor: "human",
        type: "ConfirmLearning",
        agreement: createGrowthAgreement(),
        observedAt: 11,
      }),
    ).toThrow("LEARNING_REQUIRES_ENTRY");

    expect(() =>
      reduce(runtime, [
        {
          protocolVersion: 1,
          eventId: "cmd-learning:0",
          commandId: "cmd-learning",
          actor: "human",
          revision: 2,
          recordedAt: 11,
          type: "LearningConfirmed",
          agreement: createGrowthAgreement(),
        },
      ]),
    ).toThrow("LEARNING_REQUIRES_ENTRY");
  });

  it("rejects selecting Growth mode without a learning agreement", () => {
    const runtime = reduce(createRuntime("workspace-1"), [
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
      {
        protocolVersion: 1,
        eventId: "cmd-entry:0",
        commandId: "cmd-entry",
        actor: "human",
        revision: 2,
        recordedAt: 11,
        type: "EntryCaptured",
        entry: createEntrySnapshot(),
      },
    ]);

    expect(() =>
      decide(runtime, {
        protocolVersion: 1,
        commandId: "cmd-mode",
        expectedRevision: 2,
        actor: "human",
        type: "SelectMode",
        mode: "growth",
        observedAt: 12,
      }),
    ).toThrow("MODE_REQUIRES_LEARNING_AGREEMENT");

    expect(() =>
      reduce(runtime, [
        {
          protocolVersion: 1,
          eventId: "cmd-mode:0",
          commandId: "cmd-mode",
          actor: "human",
          revision: 3,
          recordedAt: 12,
          type: "ModeSelected",
          mode: "growth",
        },
      ]),
    ).toThrow("MODE_REQUIRES_LEARNING_AGREEMENT");
  });

  it("rejects AI-owned Growth work units in decisions and direct events", () => {
    const runtime = reduce(createRuntime("workspace-1"), [
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
      {
        protocolVersion: 1,
        eventId: "cmd-entry:0",
        commandId: "cmd-entry",
        actor: "human",
        revision: 2,
        recordedAt: 11,
        type: "EntryCaptured",
        entry: createEntrySnapshot(),
      },
      {
        protocolVersion: 1,
        eventId: "cmd-learning:0",
        commandId: "cmd-learning",
        actor: "human",
        revision: 3,
        recordedAt: 12,
        type: "LearningConfirmed",
        agreement: createGrowthAgreement(),
      },
      {
        protocolVersion: 1,
        eventId: "cmd-mode:0",
        commandId: "cmd-mode",
        actor: "human",
        revision: 4,
        recordedAt: 13,
        type: "ModeSelected",
        mode: "growth",
      },
    ]);

    expect(() =>
      decide(runtime, {
        protocolVersion: 1,
        commandId: "cmd-propose",
        expectedRevision: 4,
        actor: "human",
        type: "ProposeWorkUnit",
        workUnit: {
          ...createGrowthWorkUnit(),
          owner: "ai",
        },
        observedAt: 14,
      }),
    ).toThrow("GROWTH_REQUIRES_HUMAN_OWNER");

    expect(() =>
      reduce(runtime, [
        {
          protocolVersion: 1,
          eventId: "cmd-propose:0",
          commandId: "cmd-propose",
          actor: "human",
          revision: 5,
          recordedAt: 14,
          type: "WorkUnitProposed",
          workUnit: {
            ...createGrowthWorkUnit(),
            owner: "ai",
          },
        },
      ]),
    ).toThrow("GROWTH_REQUIRES_HUMAN_OWNER");
  });

  it.each(["growth", "pair", "delivery"] as const)(
    "rejects work-unit proposals before an entry snapshot in %s mode",
    mode => {
      const workUnit =
        mode === "growth"
          ? createGrowthWorkUnit()
          : {
              ...createGrowthWorkUnit(),
              mode,
              learningValue: "mixed" as const,
              owner: "ai" as const,
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
          status: "briefing",
          mode,
          learningAgreement:
            mode === "growth" ? createGrowthAgreement() : undefined,
        },
      };

      expect(() =>
        decide(runtime, {
          protocolVersion: 1,
          commandId: `cmd-propose-before-entry-${mode}`,
          expectedRevision: 0,
          actor: "human",
          type: "ProposeWorkUnit",
          workUnit,
          observedAt: 14,
        }),
      ).toThrow("WORK_UNIT_REQUIRES_ENTRY");

      expect(() =>
        reduce(runtime, [
          {
            protocolVersion: 1,
            eventId: `cmd-propose-before-entry-${mode}:0`,
            commandId: `cmd-propose-before-entry-${mode}`,
            actor: "human",
            revision: 1,
            recordedAt: 14,
            type: "WorkUnitProposed",
            workUnit,
          },
        ]),
      ).toThrow("WORK_UNIT_REQUIRES_ENTRY");
    },
  );

  it("rejects work-unit agreement without an entry snapshot on malformed sessions", () => {
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
        status: "briefing",
        mode: "pair",
        workUnit: {
          ...createGrowthWorkUnit(),
          mode: "pair",
          learningValue: "mixed",
          owner: "ai",
        },
      },
    };

    expect(() =>
      decide(runtime, {
        protocolVersion: 1,
        commandId: "cmd-agree-before-entry",
        expectedRevision: 0,
        actor: "human",
        type: "AgreeWorkUnit",
        workUnitId: "growth-wu-1",
        observedAt: 15,
      }),
    ).toThrow("WORK_UNIT_REQUIRES_ENTRY");

    expect(() =>
      reduce(runtime, [
        {
          protocolVersion: 1,
          eventId: "cmd-agree-before-entry:0",
          commandId: "cmd-agree-before-entry",
          actor: "human",
          revision: 1,
          recordedAt: 15,
          type: "WorkUnitAgreed",
          workUnitId: "growth-wu-1",
        },
      ]),
    ).toThrow("WORK_UNIT_REQUIRES_ENTRY");
  });

  it("rejects mode changes while a work unit is still attached", () => {
    const runtime = reduce(
      reduce(
        reduce(createRuntime("workspace-1"), [
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
          {
            protocolVersion: 1,
            eventId: "cmd-entry:0",
            commandId: "cmd-entry",
            actor: "human",
            revision: 2,
            recordedAt: 11,
            type: "EntryCaptured",
            entry: createEntrySnapshot(),
          },
          {
            protocolVersion: 1,
            eventId: "cmd-mode:0",
            commandId: "cmd-mode",
            actor: "human",
            revision: 3,
            recordedAt: 12,
            type: "ModeSelected",
            mode: "pair",
          },
        ]),
        [
          {
            protocolVersion: 1,
            eventId: "cmd-propose:0",
            commandId: "cmd-propose",
            actor: "human",
            revision: 4,
            recordedAt: 13,
            type: "WorkUnitProposed",
            workUnit: {
              ...createGrowthWorkUnit(),
              mode: "pair",
              learningValue: "mixed",
              owner: "ai",
            },
          },
        ],
      ),
      [
        {
          protocolVersion: 1,
          eventId: "cmd-learning:0",
          commandId: "cmd-learning",
          actor: "human",
          revision: 5,
          recordedAt: 14,
          type: "LearningConfirmed",
          agreement: createGrowthAgreement(),
        },
      ],
    );

    expect(() =>
      decide(runtime, {
        protocolVersion: 1,
        commandId: "cmd-mode-2",
        expectedRevision: 5,
        actor: "human",
        type: "SelectMode",
        mode: "growth",
        observedAt: 15,
      }),
    ).toThrow("MODE_CHANGE_REQUIRES_NEW_WORK_UNIT");

    expect(() =>
      reduce(runtime, [
        {
          protocolVersion: 1,
          eventId: "cmd-mode-2:0",
          commandId: "cmd-mode-2",
          actor: "human",
          revision: 6,
          recordedAt: 15,
          type: "ModeSelected",
          mode: "growth",
        },
      ]),
    ).toThrow("MODE_CHANGE_REQUIRES_NEW_WORK_UNIT");
  });

  it("records growth agreement, work-unit, attempt, hypothesis, hint, and reveal state", () => {
    const runtime = createGrowthRuntime();

    const attempted = reduce(runtime, [
      {
        protocolVersion: 1,
        eventId: "cmd-attempt:0",
        commandId: "cmd-attempt",
        actor: "human",
        revision: 7,
        recordedAt: 16,
        type: "AttemptRecorded",
        workUnitId: "growth-wu-1",
        summary: "Tried to move the retry increment before the return.",
        bypassed: false,
      },
    ]);
    const diagnosed = reduce(attempted, [
      {
        protocolVersion: 1,
        eventId: "cmd-hypothesis:0",
        commandId: "cmd-hypothesis",
        actor: "human",
        revision: 8,
        recordedAt: 17,
        type: "HypothesisRecorded",
        workUnitId: "growth-wu-1",
        summary: "The failure path exits before retryCount changes.",
        bypassed: false,
      },
    ]);
    const revealAuthorized = reduce(diagnosed, [
      {
        protocolVersion: 1,
        eventId: "cmd-reveal:0",
        commandId: "cmd-reveal",
        actor: "human",
        revision: 9,
        recordedAt: 18,
        type: "SolutionRevealAuthorized",
        workUnitId: "growth-wu-1",
        previewOnly: true,
      },
    ]);

    const decision = decide(revealAuthorized, {
      protocolVersion: 1,
      commandId: "cmd-hint",
      expectedRevision: 9,
      actor: "human",
      type: "RequestHint",
      workUnitId: "growth-wu-1",
      level: 2,
      observedAt: 19,
    });

    expect(decision.events).toEqual([
      {
        protocolVersion: 1,
        eventId: "cmd-hint:0",
        commandId: "cmd-hint",
        actor: "human",
        revision: 10,
        recordedAt: 19,
        type: "HintRequested",
        workUnitId: "growth-wu-1",
        level: 2,
      },
    ]);

    const next = reduce(revealAuthorized, decision.events);

    expect(next.session).toMatchObject({
      status: "active",
      mode: "growth",
      learningAgreement: createGrowthAgreement(),
      workUnit: {
        ...createGrowthWorkUnit(),
        status: "agreed",
      },
      assistance: {
        attempt: {
          summary: "Tried to move the retry increment before the return.",
          bypassed: false,
          recordedAt: 16,
        },
        hypothesis: {
          summary: "The failure path exits before retryCount changes.",
          bypassed: false,
          recordedAt: 17,
        },
        hint: {
          level: 2,
          recordedAt: 19,
        },
        solutionReveal: {
          previewOnly: true,
          recordedAt: 18,
        },
      },
    });
    expect(next.session?.assistance).toBeDefined();
    expect(Object.isFrozen(next.session?.assistance)).toBe(true);
  });

  it("rejects hint escalation beyond the learning agreement", () => {
    const runtime = createGrowthRuntime();

    expect(() =>
      decide(runtime, {
        protocolVersion: 1,
        commandId: "cmd-hint",
        expectedRevision: 6,
        actor: "human",
        type: "RequestHint",
        workUnitId: "growth-wu-1",
        level: 3,
        observedAt: 16,
      }),
    ).toThrow("HINT_EXCEEDS_AGREEMENT");

    expect(() =>
      reduce(runtime, [
        {
          protocolVersion: 1,
          eventId: "cmd-hint:0",
          commandId: "cmd-hint",
          actor: "human",
          revision: 7,
          recordedAt: 16,
          type: "HintRequested",
          workUnitId: "growth-wu-1",
          level: 3,
        },
      ]),
    ).toThrow("HINT_EXCEEDS_AGREEMENT");
  });

  it("rejects direct hints before an attempt or bypass", () => {
    const runtime = createGrowthRuntime();

    expect(() =>
      decide(runtime, {
        protocolVersion: 1,
        commandId: "cmd-hint",
        expectedRevision: 6,
        actor: "human",
        type: "RequestHint",
        workUnitId: "growth-wu-1",
        level: 2,
        observedAt: 16,
      }),
    ).toThrow("HINT_REQUIRES_ATTEMPT");

    expect(() =>
      reduce(runtime, [
        {
          protocolVersion: 1,
          eventId: "cmd-hint:0",
          commandId: "cmd-hint",
          actor: "human",
          revision: 7,
          recordedAt: 16,
          type: "HintRequested",
          workUnitId: "growth-wu-1",
          level: 2,
        },
      ]),
    ).toThrow("HINT_REQUIRES_ATTEMPT");
  });

  it("rejects level 5 hints without explicit reveal authorization", () => {
    const runtime = reduce(createGrowthRuntime(createGrowthAgreement({ maximumHintLevel: 5 })), [
      {
        protocolVersion: 1,
        eventId: "cmd-attempt:0",
        commandId: "cmd-attempt",
        actor: "human",
        revision: 7,
        recordedAt: 16,
        type: "AttemptRecorded",
        workUnitId: "growth-wu-1",
        summary: "Tried one failing branch already.",
        bypassed: false,
      },
    ]);

    expect(() =>
      decide(runtime, {
        protocolVersion: 1,
        commandId: "cmd-hint",
        expectedRevision: 7,
        actor: "human",
        type: "RequestHint",
        workUnitId: "growth-wu-1",
        level: 5,
        observedAt: 17,
      }),
    ).toThrow("HINT_REQUIRES_REVEAL");

    expect(() =>
      reduce(runtime, [
        {
          protocolVersion: 1,
          eventId: "cmd-hint:0",
          commandId: "cmd-hint",
          actor: "human",
          revision: 8,
          recordedAt: 17,
          type: "HintRequested",
          workUnitId: "growth-wu-1",
          level: 5,
        },
      ]),
    ).toThrow("HINT_REQUIRES_REVEAL");
  });

  it("rejects AI edit-operation requests in Growth before state changes", () => {
    const runtime = createGrowthRuntime();

    for (const actor of ["ai", "human"] as const) {
      expect(() =>
        decide(
          runtime,
          createEditOperationRequest({
            commandId: `cmd-edit-operation-${actor}`,
            expectedRevision: runtime.revision,
            actor,
          }),
        ),
      ).toThrow("GROWTH_AI_MUTATION_FORBIDDEN");
    }

    expect(runtime.revision).toBe(6);
    expect(runtime.session?.status).toBe("ready");
    expect(runtime.session?.operations).toEqual([]);
  });

  it.each([undefined, "pair", "delivery"] as const)(
    "returns a stable unsupported error for edit-operation requests outside Growth (%s)",
    mode => {
      const runtime: PairRuntimeSnapshot =
        mode === undefined
          ? createRuntime("workspace-1")
          : {
              ...createRuntime("workspace-1"),
              presence: {
                workspaceId: "workspace-1",
                observationRevision: 0,
                status: "engaged",
                activeSessionId: "session-1",
              },
              session: {
                ...createSession("session-1"),
                status: "briefing",
                mode,
              },
            };

      expect(() =>
        decide(
          runtime,
          createEditOperationRequest({
            commandId: `cmd-edit-operation-${mode ?? "uninitialized"}`,
            expectedRevision: runtime.revision,
          }),
        ),
      ).toThrow("EDIT_OPERATION_UNSUPPORTED");
    },
  );

  it("still requires an attempt or explicit bypass after reveal authorization", () => {
    const runtime = reduce(createGrowthRuntime(createGrowthAgreement({ maximumHintLevel: 5 })), [
      {
        protocolVersion: 1,
        eventId: "cmd-reveal:0",
        commandId: "cmd-reveal",
        actor: "human",
        revision: 7,
        recordedAt: 16,
        type: "SolutionRevealAuthorized",
        workUnitId: "growth-wu-1",
        previewOnly: true,
      },
    ]);

    expect(() =>
      decide(runtime, {
        protocolVersion: 1,
        commandId: "cmd-hint-after-reveal",
        expectedRevision: 7,
        actor: "human",
        type: "RequestHint",
        workUnitId: "growth-wu-1",
        level: 3,
        observedAt: 17,
      }),
    ).toThrow("HINT_REQUIRES_ATTEMPT");

    expect(() =>
      reduce(runtime, [
        {
          protocolVersion: 1,
          eventId: "cmd-hint-after-reveal:0",
          commandId: "cmd-hint-after-reveal",
          actor: "human",
          revision: 8,
          recordedAt: 17,
          type: "HintRequested",
          workUnitId: "growth-wu-1",
          level: 3,
        },
      ]),
    ).toThrow("HINT_REQUIRES_ATTEMPT");
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
        toolName: "pair_read_scope",
        kind: "read",
        input: {
          path: "src/a.ts",
        },
        runtimeRevision: 0,
        authorityEpoch: 0,
        status: "planned",
        summary: undefined,
        userActionGrantId: undefined,
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
        assistance: {
          attempt: {
            summary: "Tried editing the guard",
            bypassed: false,
            recordedAt: 11,
          },
          hypothesis: {
            summary: "The return happens too early",
            bypassed: false,
            recordedAt: 12,
          },
          hint: {
            level: 2,
            recordedAt: 13,
          },
          solutionReveal: {
            previewOnly: true,
            recordedAt: 14,
          },
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
      toolName: "pair_apply_edit",
      kind: "edit",
      input: {
        targetPath: "src/a.ts",
      },
      runtimeRevision: 0,
      authorityEpoch: 0,
      status: "authorized",
      summary: undefined,
      userActionGrantId: undefined,
    });
    learningGoals.push("goal-2");
    allowedPaths.push("test");

    expect(next.session?.criteria).toEqual(["criterion-1"]);
    expect(next.session?.entrySnapshot?.dirtyPaths).toEqual(["src/a.ts"]);
    expect(next.session?.operations).toEqual([
      {
        id: "op-1",
        workUnitId: "wu-1",
        toolName: "pair_read_scope",
        kind: "read",
        input: {
          path: "src/a.ts",
        },
        runtimeRevision: 0,
        authorityEpoch: 0,
        status: "planned",
        summary: undefined,
        userActionGrantId: undefined,
      },
    ]);
    expect(next.session?.learningAgreement?.learningGoals).toEqual(["goal-1"]);
    expect(next.session?.workUnit?.allowedPaths).toEqual(["src"]);
    expect(next.session?.assistance).toEqual({
      attempt: {
        summary: "Tried editing the guard",
        bypassed: false,
        recordedAt: 11,
      },
      hypothesis: {
        summary: "The return happens too early",
        bypassed: false,
        recordedAt: 12,
      },
      hint: {
        level: 2,
        recordedAt: 13,
      },
      solutionReveal: {
        previewOnly: true,
        recordedAt: 14,
      },
    });
    expect(Object.isFrozen(next.session?.entrySnapshot)).toBe(true);
    expect(Object.isFrozen(next.session?.learningAgreement)).toBe(true);
    expect(Object.isFrozen(next.session?.workUnit)).toBe(true);
    expect(Object.isFrozen(next.session?.assistance)).toBe(true);
    expect(Object.isFrozen(next.session?.operations[0])).toBe(true);
  });
});
