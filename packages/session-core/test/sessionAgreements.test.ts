import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { expect, it } from "vitest";
import { createRuntime, createSession, decide, reduce } from "../src/index.js";
import {
  createEntrySnapshot,
  createGrowthAgreement,
  createGrowthWorkUnit,
} from "./sessionCoreFixtures.js";

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
