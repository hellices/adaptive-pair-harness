import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { expect, it } from "vitest";
import { createRuntime, createSession, decide, reduce } from "../src/index.js";
import { createEntrySnapshot, createWorkUnit } from "./sessionCoreFixtures.js";

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
