import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { expect, it } from "vitest";
import { createRuntime, createSession, decide, reduce } from "../src/index.js";
import {
  command,
  createEditOperationRequest,
  createGrowthAgreement,
  createGrowthRuntime,
  createGrowthWorkUnit,
  event,
  expectDecisionAndReplayRejection,
} from "./sessionCoreFixtures.js";

const attempt = (revision: number, summary: string) =>
  event("AttemptRecorded", revision, { workUnitId: "growth-wu-1", summary, bypassed: false });
const reveal = (revision: number) =>
  event("SolutionRevealAuthorized", revision, { workUnitId: "growth-wu-1", previewOnly: true });
const expectHintRejected = (runtime: PairRuntimeSnapshot, level: 2 | 3 | 5, code: string) =>
  expectDecisionAndReplayRejection(
    runtime,
    command("RequestHint", runtime.revision, { workUnitId: "growth-wu-1", level }),
    event("HintRequested", runtime.revision + 1, { workUnitId: "growth-wu-1", level }),
    code,
  );

it("records growth agreement, work-unit, attempt, hypothesis, hint, and reveal state", () => {
  const revealAuthorized = reduce(createGrowthRuntime(), [
    attempt(7, "Tried to move the retry increment before the return."),
    event("HypothesisRecorded", 8, {
      workUnitId: "growth-wu-1",
      summary: "The failure path exits before retryCount changes.",
      bypassed: false,
    }),
    reveal(9),
  ]);

  const decision = decide(revealAuthorized, command("RequestHint", 9, { workUnitId: "growth-wu-1", level: 2 }));
  expect(decision.events).toEqual([event("HintRequested", 10, { workUnitId: "growth-wu-1", level: 2 })]);

  const next = reduce(revealAuthorized, decision.events);

  expect(next.session).toMatchObject({
    status: "active",
    mode: "growth",
    learningAgreement: createGrowthAgreement(),
    workUnit: { ...createGrowthWorkUnit(), status: "agreed" },
    assistance: {
      attempt: { summary: "Tried to move the retry increment before the return.", bypassed: false, recordedAt: 16 },
      hypothesis: { summary: "The failure path exits before retryCount changes.", bypassed: false, recordedAt: 17 },
      hint: { level: 2, recordedAt: 19 },
      solutionReveal: { previewOnly: true, recordedAt: 18 },
    },
  });
  expect(Object.isFrozen(next.session?.assistance)).toBe(true);
});

it("rejects hint escalation beyond the learning agreement", () => {
  expectHintRejected(createGrowthRuntime(), 3, "HINT_EXCEEDS_AGREEMENT");
});

it("rejects direct hints before an attempt or bypass", () => {
  expectHintRejected(createGrowthRuntime(), 2, "HINT_REQUIRES_ATTEMPT");
});

it("rejects level 5 hints without explicit reveal authorization", () => {
  const runtime = reduce(createGrowthRuntime(createGrowthAgreement({ maximumHintLevel: 5 })), [
    attempt(7, "Tried one failing branch already."),
  ]);
  expectHintRejected(runtime, 5, "HINT_REQUIRES_REVEAL");
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
  const runtime = reduce(createGrowthRuntime(createGrowthAgreement({ maximumHintLevel: 5 })), [reveal(7)]);
  expectHintRejected(runtime, 3, "HINT_REQUIRES_ATTEMPT");
});
