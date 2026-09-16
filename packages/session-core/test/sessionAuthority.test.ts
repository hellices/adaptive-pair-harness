import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { expect, it } from "vitest";
import { createRuntime, createSession, decide, reduce } from "../src/index.js";
import {
  createActiveRuntime,
  createEntrySnapshot,
  createGrowthAgreement,
  createGrowthWorkUnit,
} from "./sessionCoreFixtures.js";

it("rejects AI-authored learning, mode, and work-unit agreements without a human grant", () => {
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
    decide(briefing, {
      protocolVersion: 1,
      commandId: "ai-learning",
      expectedRevision: briefing.revision,
      actor: "ai",
      type: "ConfirmLearning",
      agreement: createGrowthAgreement(),
      observedAt: 12,
    }),
  ).toThrow("USER_ACTION_REQUIRED");

  const withLearning = reduce(briefing, [
    {
      protocolVersion: 1,
      eventId: "human-learning:0",
      commandId: "human-learning",
      actor: "human",
      revision: 3,
      recordedAt: 12,
      type: "LearningConfirmed",
      agreement: createGrowthAgreement(),
    },
  ]);
  expect(() =>
    decide(withLearning, {
      protocolVersion: 1,
      commandId: "ai-mode",
      expectedRevision: withLearning.revision,
      actor: "ai",
      type: "SelectMode",
      mode: "growth",
      observedAt: 13,
    }),
  ).toThrow("USER_ACTION_REQUIRED");

  const withProposal = reduce(withLearning, [
    {
      protocolVersion: 1,
      eventId: "human-mode:0",
      commandId: "human-mode",
      actor: "human",
      revision: 4,
      recordedAt: 13,
      type: "ModeSelected",
      mode: "growth",
    },
    {
      protocolVersion: 1,
      eventId: "ai-proposal:0",
      commandId: "ai-proposal",
      actor: "ai",
      revision: 5,
      recordedAt: 14,
      type: "WorkUnitProposed",
      workUnit: createGrowthWorkUnit(),
    },
  ]);
  expect(() =>
    decide(withProposal, {
      protocolVersion: 1,
      commandId: "ai-agreement",
      expectedRevision: withProposal.revision,
      actor: "ai",
      type: "AgreeWorkUnit",
      workUnitId: "growth-wu-1",
      observedAt: 15,
    }),
  ).toThrow("USER_ACTION_REQUIRED");
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
