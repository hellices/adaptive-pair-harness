import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { expect, it } from "vitest";
import { createRuntime, createSession, decide, reduce } from "../src/index.js";
import {
  createEditOperationRequest,
  createGrowthAgreement,
  createGrowthRuntime,
  createGrowthWorkUnit,
} from "./sessionCoreFixtures.js";

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
