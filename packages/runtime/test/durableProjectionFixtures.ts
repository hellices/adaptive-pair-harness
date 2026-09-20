import {
  parseDurableJournal, type Actor, type DurableCommit, type EntrySnapshot,
  type LearningAgreement, type PairCommand, type PairRuntimeSnapshot, type WorkUnit,
} from "@adaptive-pair/protocol";
import { createRuntime, decide, reduce } from "@adaptive-pair/session-core";
import { expect } from "vitest";
import { createDurableProjector } from "../src/durableProjection.js";
import { replayDurableJournal } from "../src/durableReplay.js";
import type { DurableKeyIssuer, DurableState } from "../src/durableTypes.js";
import { durableKey, durableWire } from "./durableFixtures.js";

export const privateCanary = "PRIVATE_CANARY";
export const sourceWorkspace = `${privateCanary}/workspace`;
export const sourceSession = `${privateCanary}/session`;
export const sourceUnit = `${privateCanary}/work-unit`;
export const sourceOperation = `${privateCanary}/operation`;
export const sourceGrant = `${privateCanary}/grant`;

export const projectionEntry: EntrySnapshot = {
  workspaceId: sourceWorkspace, branch: `${privateCanary}/branch`,
  dirtyPaths: [`${privateCanary}/dirty`], openPaths: [`${privateCanary}/open`],
  diagnostics: [`${privateCanary}/diagnostic`], protectedPaths: [`${privateCanary}/protected`], capturedAt: 100,
};

export const projectionLearning: LearningAgreement = {
  learningGoals: [`${privateCanary}/goal`], familiarAreas: [`${privateCanary}/familiar`],
  humanOwnedCapabilities: ["implementation", "verification"], delegatableWork: [`${privateCanary}/delegate`],
  maximumHintLevel: 5, independentCheck: `${privateCanary}/independent`,
};

export const projectionWorkUnit: WorkUnit = {
  id: sourceUnit, objective: `${privateCanary}/objective`, mode: "growth", learningValue: "high",
  capability: "implementation", owner: "human", allowedPaths: [`${privateCanary}/allowed`],
  acceptanceChecks: [`${privateCanary}/check`], verificationPlan: `${privateCanary}/verification`,
  stoppingCondition: `${privateCanary}/stop`, baseline: { [`${privateCanary}/path`]: `${privateCanary}/hash` },
  status: "proposed",
};

type Payload<Command> = Command extends PairCommand
  ? Omit<Command, "protocolVersion" | "commandId" | "expectedRevision" | "actor" | "observedAt"> : never;
export type ProjectionCommand = Payload<PairCommand>;

export const admittedCandidate = (
  previous: PairRuntimeSnapshot, payload: ProjectionCommand,
  commandId = `${privateCanary}/command-${previous.revision}`, actor: Actor = "human",
) => {
  const command: PairCommand = {
    protocolVersion: 1, commandId, expectedRevision: previous.revision, actor, observedAt: 100, ...payload,
  };
  const events = decide(previous, command).events;
  return { previous, events, next: reduce(previous, events) };
};

export const keyIssuer = (first = 10_000): DurableKeyIssuer => {
  let sequence = first;
  return { next: () => durableKey(sequence++) };
};

const assistanceView = (live: PairRuntimeSnapshot) => {
  const assistance = live.session?.assistance;
  return assistance === undefined ? null : {
    attempt: assistance.attempt === undefined ? "none" : assistance.attempt.bypassed ? "bypassed" : "recorded",
    hypothesis: assistance.hypothesis === undefined ? "none" : assistance.hypothesis.bypassed ? "bypassed" : "recorded",
    hintLevel: assistance.hint?.level ?? null, solutionRevealed: assistance.solutionReveal !== undefined,
  };
};

export const expectRetainedParity = (state: DurableState, live: PairRuntimeSnapshot): void => {
  expect(state.presence).toBe(live.presence.status);
  const session = state.sessions.at(-1);
  if (live.session === undefined) {
    expect(session).toBeUndefined();
    return;
  }
  expect(session?.status).toBe(live.session.status);
  expect(session?.mode).toBe(live.session.mode ?? null);
  expect(session?.learningBoundary).toEqual(live.session.learningAgreement === undefined ? null : {
    humanOwnedCapabilities: live.session.learningAgreement.humanOwnedCapabilities,
    maximumHintLevel: live.session.learningAgreement.maximumHintLevel,
  });
  const unit = session?.workUnits.at(-1);
  const liveUnit = live.session.workUnit;
  if (liveUnit === undefined) expect(unit).toBeUndefined();
  else {
    expect(unit).toMatchObject({
      mode: liveUnit.mode, owner: liveUnit.owner, learningValue: liveUnit.learningValue,
      capability: liveUnit.capability, status: liveUnit.status, assistance: assistanceView(live),
    });
  }
  expect(session?.operations.map(operation => ({ kind: operation.kind, status: operation.status })))
    .toEqual(live.session.operations.map(operation => ({ kind: operation.kind, status: operation.status })));
};

export const projectionHarness = (issuer = keyIssuer()) => {
  const projector = createDurableProjector(issuer);
  let live = createRuntime(sourceWorkspace);
  const commits: DurableCommit[] = [];
  const eventTypes = new Set<string>();
  let sequence = 0;
  return {
    projector, commits, eventTypes,
    get live() { return live; },
    get sequence() { return sequence; },
    state: () => replayDurableJournal(parseDurableJournal(JSON.stringify(durableWire(commits)))),
    apply(payload: ProjectionCommand, actor: Actor = "human", commandId?: string) {
      const candidate = admittedCandidate(live, payload, commandId, actor);
      const projection = projector.project(live, candidate.events, sequence);
      if (projection.kind === "append") {
        commits.push(projection.commit);
        sequence += projection.commit.facts.length;
        projector.resolve(projection.commit.commitKey, "committed");
      }
      for (const event of candidate.events) eventTypes.add(event.type);
      live = candidate.next;
      if (projection.kind !== "erase") {
        const state = replayDurableJournal(parseDurableJournal(JSON.stringify(durableWire(commits))));
        expectRetainedParity(state, live);
      }
      return { candidate, projection };
    },
  };
};

export const enterProjectionBriefing = (harness: ReturnType<typeof projectionHarness>): void => {
  harness.apply({ type: "EnablePresence", workspaceId: sourceWorkspace });
  harness.apply({ type: "StartSession", sessionId: sourceSession });
  harness.apply({ type: "CaptureEntry", entry: projectionEntry });
  harness.apply({ type: "ConfirmLearning", agreement: projectionLearning });
  harness.apply({ type: "SelectMode", mode: "growth" });
};

export const enterProjectionReady = (harness: ReturnType<typeof projectionHarness>): void => {
  enterProjectionBriefing(harness);
  harness.apply({ type: "ProposeWorkUnit", workUnit: projectionWorkUnit });
  harness.apply({ type: "AgreeWorkUnit", workUnitId: sourceUnit });
};
