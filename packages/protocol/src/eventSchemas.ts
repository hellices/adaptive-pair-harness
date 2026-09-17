import type { PairEvent } from "./events.js";
import {
  entrySnapshotSchema,
  hintLevelSchema,
  jsonObjectSchema,
  learningAgreementSchema,
  stringArraySchema,
  workUnitSchema,
} from "./payloadSchemas.js";

const counterSchema = {
  type: "integer",
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
} as const;

const operationSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    workUnitId: { type: "string" },
    toolName: { type: "string" },
    kind: { enum: ["read", "edit", "check"] },
    input: jsonObjectSchema,
    runtimeRevision: counterSchema,
    authorityEpoch: counterSchema,
    status: {
      enum: ["planned", "authorized", "started", "confirmed", "failed", "declined", "cancelled", "unknown"],
    },
    summary: { type: "string" },
    userActionGrantId: { type: "string" },
  },
  required: ["id", "workUnitId", "toolName", "kind", "input", "runtimeRevision", "authorityEpoch", "status"],
  additionalProperties: false,
} as const;

const createEventSchema = <Type extends PairEvent["type"]>(
  type: Type,
  properties: Record<string, unknown>,
  required: readonly string[],
) => ({
  type: "object",
  properties: {
    protocolVersion: { const: 1 },
    eventId: { type: "string" },
    commandId: { type: "string" },
    actor: { enum: ["human", "ai", "host", "policy"] },
    revision: counterSchema,
    recordedAt: { type: "number" },
    type: { const: type },
    ...properties,
  },
  required: ["protocolVersion", "eventId", "commandId", "actor", "revision", "recordedAt", "type", ...required],
  additionalProperties: false,
} as const);

const eventSchemas = {
  PresenceEnabled: createEventSchema("PresenceEnabled", { workspaceId: { type: "string" } }, ["workspaceId"]),
  PresenceChanged: createEventSchema(
    "PresenceChanged", { status: { enum: ["off", "observing", "engaged", "quiet", "paused"] } }, ["status"],
  ),
  WorkspaceObserved: createEventSchema("WorkspaceObserved", {}, []),
  SessionStarted: createEventSchema("SessionStarted", { sessionId: { type: "string" } }, ["sessionId"]),
  EntryCaptured: createEventSchema("EntryCaptured", { entry: entrySnapshotSchema }, ["entry"]),
  BriefConfirmed: createEventSchema(
    "BriefConfirmed", { goal: { type: "string" }, criteria: stringArraySchema }, ["goal", "criteria"],
  ),
  LearningConfirmed: createEventSchema("LearningConfirmed", { agreement: learningAgreementSchema }, ["agreement"]),
  ModeSelected: createEventSchema("ModeSelected", { mode: { enum: ["growth", "pair", "delivery"] } }, ["mode"]),
  WorkUnitProposed: createEventSchema("WorkUnitProposed", { workUnit: workUnitSchema }, ["workUnit"]),
  WorkUnitAgreed: createEventSchema("WorkUnitAgreed", { workUnitId: { type: "string" } }, ["workUnitId"]),
  AttemptRecorded: createEventSchema(
    "AttemptRecorded",
    { workUnitId: { type: "string" }, summary: { type: "string" }, bypassed: { type: "boolean" } },
    ["workUnitId", "summary", "bypassed"],
  ),
  HypothesisRecorded: createEventSchema(
    "HypothesisRecorded",
    { workUnitId: { type: "string" }, summary: { type: "string" }, bypassed: { type: "boolean" } },
    ["workUnitId", "summary", "bypassed"],
  ),
  HintRequested: createEventSchema(
    "HintRequested", { workUnitId: { type: "string" }, level: hintLevelSchema }, ["workUnitId", "level"],
  ),
  SolutionRevealAuthorized: createEventSchema(
    "SolutionRevealAuthorized", { workUnitId: { type: "string" }, previewOnly: { const: true } },
    ["workUnitId", "previewOnly"],
  ),
  UserActionGranted: createEventSchema(
    "UserActionGranted",
    {
      grantId: { type: "string" }, nativeToolName: { type: "string" },
      runtimeRevision: counterSchema, authorityEpoch: counterSchema,
    },
    ["grantId", "nativeToolName", "runtimeRevision"],
  ),
  UserActionConsumed: createEventSchema("UserActionConsumed", { grantId: { type: "string" } }, ["grantId"]),
  OperationAuthorized: createEventSchema("OperationAuthorized", { operation: operationSchema }, ["operation"]),
  OperationObserved: createEventSchema(
    "OperationObserved",
    {
      operationId: { type: "string" }, authorityEpoch: counterSchema,
      status: { enum: ["confirmed", "failed", "declined", "cancelled", "unknown"] },
      summary: { type: "string" }, observation: jsonObjectSchema,
    },
    ["operationId", "authorityEpoch", "status", "summary"],
  ),
  SessionPaused: createEventSchema(
    "SessionPaused", { reason: { type: "string" }, authorityEpoch: counterSchema }, ["reason", "authorityEpoch"],
  ),
  SessionResumed: createEventSchema("SessionResumed", { entry: entrySnapshotSchema }, ["entry"]),
  SessionClosed: createEventSchema("SessionClosed", {}, []),
} satisfies { [Type in PairEvent["type"]]: { properties: { type: { const: Type } } } };

export const pairEventSchema = { oneOf: Object.values(eventSchemas) } as const;
