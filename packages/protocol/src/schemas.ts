import { Ajv } from "ajv";
import type { PairCommand } from "./commands.js";
import { immutableJsonSnapshot } from "./jsonSnapshot.js";
import { jsonValidationSnapshot } from "./jsonValidation.js";
import {
  entrySnapshotSchema,
  hintLevelSchema,
  jsonObjectSchema,
  learningAgreementSchema,
  stringArraySchema,
  workUnitSchema,
} from "./payloadSchemas.js";

const ajv = new Ajv({ allErrors: true, strict: true, ownProperties: true });

ajv.addKeyword({
  keyword: "allowUndefined",
  schemaType: "boolean",
  validate: (allowUndefined: boolean, value: unknown) =>
    allowUndefined === true ? value === undefined : value !== undefined,
});

const commandBaseProperties = {
  protocolVersion: { const: 1 },
  commandId: { type: "string" },
  expectedRevision: { type: "number" },
  actor: { enum: ["human", "ai", "host", "policy"] },
  observedAt: { type: "number" },
} as const;

const commandBaseRequired = [
  "protocolVersion",
  "commandId",
  "expectedRevision",
  "actor",
  "observedAt",
] as const;

const createCommandSchema = (
  type: PairCommand["type"],
  extraProperties: Record<string, unknown>,
  extraRequired: readonly string[],
) =>
  ({
    type: "object",
    properties: {
      ...commandBaseProperties,
      type: { const: type },
      ...extraProperties,
    },
    required: [...commandBaseRequired, "type", ...extraRequired],
    additionalProperties: false,
  }) as const;

const pairCommandSchema = {
  oneOf: [
    createCommandSchema(
      "EnablePresence",
      { workspaceId: { type: "string" } },
      ["workspaceId"],
    ),
    createCommandSchema(
      "SetPresence",
      { status: { enum: ["observing", "quiet", "paused", "off"] } },
      ["status"],
    ),
    createCommandSchema("ObserveWorkspace", {}, []),
    createCommandSchema(
      "StartSession",
      { sessionId: { type: "string" } },
      ["sessionId"],
    ),
    createCommandSchema(
      "CaptureEntry",
      {
        entry: entrySnapshotSchema,
        userActionGrantId: { type: "string" },
      },
      ["entry"],
    ),
    createCommandSchema(
      "ConfirmBrief",
      {
        goal: { type: "string" },
        criteria: stringArraySchema,
      },
      ["goal", "criteria"],
    ),
    createCommandSchema(
      "ConfirmLearning",
      {
        agreement: learningAgreementSchema,
        userActionGrantId: { type: "string" },
      },
      ["agreement"],
    ),
    createCommandSchema(
      "SelectMode",
      {
        mode: { enum: ["growth", "pair", "delivery"] },
        userActionGrantId: { type: "string" },
      },
      ["mode"],
    ),
    createCommandSchema(
      "ProposeWorkUnit",
      { workUnit: workUnitSchema },
      ["workUnit"],
    ),
    createCommandSchema(
      "AgreeWorkUnit",
      {
        workUnitId: { type: "string" },
        userActionGrantId: { type: "string" },
      },
      ["workUnitId"],
    ),
    createCommandSchema(
      "RecordAttempt",
      {
        workUnitId: { type: "string" },
        summary: { type: "string" },
        bypassed: { type: "boolean" },
        userActionGrantId: { type: "string" },
      },
      ["workUnitId", "summary", "bypassed"],
    ),
    createCommandSchema(
      "RecordHypothesis",
      {
        workUnitId: { type: "string" },
        summary: { type: "string" },
        bypassed: { type: "boolean" },
        userActionGrantId: { type: "string" },
      },
      ["workUnitId", "summary", "bypassed"],
    ),
    createCommandSchema(
      "RequestHint",
      {
        workUnitId: { type: "string" },
        level: hintLevelSchema,
        userActionGrantId: { type: "string" },
      },
      ["workUnitId", "level"],
    ),
    createCommandSchema(
      "AuthorizeSolutionReveal",
      {
        workUnitId: { type: "string" },
        previewOnly: { const: true },
        userActionGrantId: { type: "string" },
      },
      ["workUnitId", "previewOnly"],
    ),
    createCommandSchema(
      "RequestEditOperation",
      {
        workUnitId: { type: "string" },
        operationId: { type: "string" },
        targetPath: { type: "string" },
        description: { type: "string" },
      },
      ["workUnitId", "operationId", "targetPath", "description"],
    ),
    createCommandSchema(
      "PauseSession",
      { reason: { type: "string" } },
      ["reason"],
    ),
    createCommandSchema(
      "GrantUserAction",
      {
        grantId: { type: "string" },
        nativeToolName: { type: "string" },
      },
      ["grantId", "nativeToolName"],
    ),
    createCommandSchema(
      "AuthorizeOperation",
      {
        operationId: { type: "string" },
        toolName: { type: "string" },
        kind: { enum: ["read", "edit", "check"] },
        input: jsonObjectSchema,
        userActionGrantId: { type: "string" },
      },
      ["operationId", "toolName", "kind", "input"],
    ),
    createCommandSchema(
      "ObserveOperationResult",
      {
        operationId: { type: "string" },
        authorityEpoch: { type: "number" },
        status: {
          enum: ["confirmed", "failed", "declined", "cancelled", "unknown"],
        },
        summary: { type: "string" },
        observation: jsonObjectSchema,
      },
      ["operationId", "authorityEpoch", "status", "summary"],
    ),
    createCommandSchema(
      "ResumeSession",
      { entry: entrySnapshotSchema },
      ["entry"],
    ),
    createCommandSchema(
      "CloseSession",
      { userActionGrantId: { type: "string" } },
      [],
    ),
  ],
} as const;

const validatePairCommand = ajv.compile<PairCommand>(pairCommandSchema);

export const parsePairCommand = (value: unknown): PairCommand => {
  const snapshot = jsonValidationSnapshot(value, "command");

  if (!validatePairCommand(snapshot)) {
    const detail = ajv.errorsText(validatePairCommand.errors, {
      separator: "; ",
    });
    throw new Error(`Invalid Pair command: ${detail}`);
  }

  return immutableJsonSnapshot(snapshot);
};
