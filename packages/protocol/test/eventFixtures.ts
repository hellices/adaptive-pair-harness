import type { PairEvent } from "../src/index.js";
import { createAgreement, createEntry, createWorkUnit } from "./commandFixtures.js";

const eventBase = {
  protocolVersion: 1,
  eventId: "event-1",
  commandId: "command-1",
  actor: "host",
  revision: 1,
  recordedAt: 100,
} as const;

export const createEventFixtures = () => ({
  PresenceEnabled: {
    ...eventBase, type: "PresenceEnabled", workspaceId: "workspace-1",
  },
  PresenceChanged: {
    ...eventBase, type: "PresenceChanged", status: "engaged",
  },
  WorkspaceObserved: { ...eventBase, type: "WorkspaceObserved" },
  SessionStarted: {
    ...eventBase, type: "SessionStarted", sessionId: "session-1",
  },
  EntryCaptured: {
    ...eventBase, type: "EntryCaptured", entry: createEntry("main"),
  },
  BriefConfirmed: {
    ...eventBase, type: "BriefConfirmed", goal: "Validate events", criteria: ["Tests pass"],
  },
  LearningConfirmed: {
    ...eventBase, type: "LearningConfirmed", agreement: createAgreement(),
  },
  ModeSelected: { ...eventBase, type: "ModeSelected", mode: "growth" },
  WorkUnitProposed: {
    ...eventBase, type: "WorkUnitProposed", workUnit: createWorkUnit(),
  },
  WorkUnitAgreed: { ...eventBase, type: "WorkUnitAgreed", workUnitId: "wu-1" },
  AttemptRecorded: {
    ...eventBase, type: "AttemptRecorded", workUnitId: "wu-1", summary: "Tried a fix", bypassed: false,
  },
  HypothesisRecorded: {
    ...eventBase, type: "HypothesisRecorded", workUnitId: "wu-1", summary: "Check the guard", bypassed: true,
  },
  HintRequested: { ...eventBase, type: "HintRequested", workUnitId: "wu-1", level: 2 },
  SolutionRevealAuthorized: {
    ...eventBase, type: "SolutionRevealAuthorized", workUnitId: "wu-1", previewOnly: true,
  },
  UserActionGranted: {
    ...eventBase,
    type: "UserActionGranted",
    grantId: "grant-1",
    nativeToolName: "adaptive_pair_check",
    runtimeRevision: 1,
    authorityEpoch: undefined,
  },
  UserActionConsumed: { ...eventBase, type: "UserActionConsumed", grantId: "grant-1" },
  OperationAuthorized: {
    ...eventBase,
    type: "OperationAuthorized",
    operation: {
      id: "operation-1",
      workUnitId: "wu-1",
      toolName: "pair_check",
      kind: "check",
      input: { command: "npm test", arguments: ["--run"], options: { quiet: true } },
      runtimeRevision: 1,
      authorityEpoch: 0,
      status: "authorized",
      summary: undefined,
      userActionGrantId: undefined,
    },
  },
  OperationObserved: {
    ...eventBase,
    type: "OperationObserved",
    operationId: "operation-1",
    authorityEpoch: 0,
    status: "confirmed",
    summary: "Tests passed",
    observation: { exitCode: 0, checks: ["protocol"], detail: { skipped: null } },
  },
  SessionPaused: {
    ...eventBase, type: "SessionPaused", reason: "Human requested pause", authorityEpoch: 1,
  },
  SessionResumed: { ...eventBase, type: "SessionResumed", entry: createEntry() },
  SessionClosed: { ...eventBase, type: "SessionClosed" },
} satisfies { [Type in PairEvent["type"]]: Extract<PairEvent, { type: Type }> });

export const toWireEvent = (event: PairEvent): Record<string, unknown> =>
  JSON.parse(JSON.stringify(event)) as Record<string, unknown>;

export const requiredEventPayloads = {
  PresenceEnabled: ["workspaceId"],
  PresenceChanged: ["status"],
  WorkspaceObserved: [],
  SessionStarted: ["sessionId"],
  EntryCaptured: ["entry"],
  BriefConfirmed: ["goal", "criteria"],
  LearningConfirmed: ["agreement"],
  ModeSelected: ["mode"],
  WorkUnitProposed: ["workUnit"],
  WorkUnitAgreed: ["workUnitId"],
  AttemptRecorded: ["workUnitId", "summary", "bypassed"],
  HypothesisRecorded: ["workUnitId", "summary", "bypassed"],
  HintRequested: ["workUnitId", "level"],
  SolutionRevealAuthorized: ["workUnitId", "previewOnly"],
  UserActionGranted: ["grantId", "nativeToolName", "runtimeRevision"],
  UserActionConsumed: ["grantId"],
  OperationAuthorized: ["operation"],
  OperationObserved: ["operationId", "authorityEpoch", "status", "summary"],
  SessionPaused: ["reason", "authorityEpoch"],
  SessionResumed: ["entry"],
  SessionClosed: [],
} satisfies Record<PairEvent["type"], readonly string[]>;
