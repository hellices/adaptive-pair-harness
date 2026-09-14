import { Ajv } from "ajv";
import type { PairCommand } from "./commands.js";

const ajv = new Ajv({ allErrors: true, strict: true });

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

const stringArraySchema = {
  type: "array",
  items: { type: "string" },
} as const;

const capabilityCategorySchema = {
  enum: [
    "problem-framing",
    "design",
    "test",
    "implementation",
    "diagnosis",
    "repair",
    "verification",
  ],
} as const;

const hintLevelSchema = {
  enum: [0, 1, 2, 3, 4, 5],
} as const;

const learningAgreementSchema = {
  type: "object",
  properties: {
    learningGoals: stringArraySchema,
    familiarAreas: stringArraySchema,
    humanOwnedCapabilities: {
      type: "array",
      items: capabilityCategorySchema,
    },
    delegatableWork: stringArraySchema,
    maximumHintLevel: { enum: [0, 1, 2, 3, 4, 5] },
    independentCheck: { type: "string" },
  },
  required: [
    "learningGoals",
    "familiarAreas",
    "humanOwnedCapabilities",
    "delegatableWork",
    "maximumHintLevel",
    "independentCheck",
  ],
  additionalProperties: false,
} as const;

const entrySnapshotSchema = {
  type: "object",
  properties: {
    workspaceId: { type: "string" },
    branch: { type: "string" },
    dirtyPaths: stringArraySchema,
    openPaths: stringArraySchema,
    diagnostics: stringArraySchema,
    protectedPaths: stringArraySchema,
    capturedAt: { type: "number" },
  },
  required: [
    "workspaceId",
    "dirtyPaths",
    "openPaths",
    "diagnostics",
    "protectedPaths",
    "capturedAt",
  ],
  additionalProperties: false,
} as const;

const baselineSchema = {
  type: "object",
  propertyNames: { type: "string" },
  patternProperties: {
    ".*": { type: "string" },
  },
  additionalProperties: false,
} as const;

const workUnitSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    objective: { type: "string" },
    mode: { enum: ["growth", "pair", "delivery"] },
    learningValue: { enum: ["high", "mixed", "low"] },
    capability: capabilityCategorySchema,
    owner: { enum: ["human", "ai"] },
    allowedPaths: stringArraySchema,
    acceptanceChecks: stringArraySchema,
    verificationPlan: { type: "string" },
    stoppingCondition: { type: "string" },
    baseline: baselineSchema,
    status: {
      enum: [
        "proposed",
        "agreed",
        "executing",
        "verifying",
        "completed",
        "paused",
        "needs-reconcile",
        "cancelled",
        "failed",
      ],
    },
  },
  required: [
    "id",
    "objective",
    "mode",
    "learningValue",
    "capability",
    "owner",
    "allowedPaths",
    "acceptanceChecks",
    "verificationPlan",
    "stoppingCondition",
    "baseline",
    "status",
  ],
  additionalProperties: false,
} as const;

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
    createCommandSchema(
      "StartSession",
      { sessionId: { type: "string" } },
      ["sessionId"],
    ),
    createCommandSchema(
      "CaptureEntry",
      { entry: entrySnapshotSchema },
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
      { agreement: learningAgreementSchema },
      ["agreement"],
    ),
    createCommandSchema(
      "SelectMode",
      { mode: { enum: ["growth", "pair", "delivery"] } },
      ["mode"],
    ),
    createCommandSchema(
      "ProposeWorkUnit",
      { workUnit: workUnitSchema },
      ["workUnit"],
    ),
    createCommandSchema(
      "AgreeWorkUnit",
      { workUnitId: { type: "string" } },
      ["workUnitId"],
    ),
    createCommandSchema(
      "RecordAttempt",
      {
        workUnitId: { type: "string" },
        summary: { type: "string" },
        bypassed: { type: "boolean" },
      },
      ["workUnitId", "summary", "bypassed"],
    ),
    createCommandSchema(
      "RecordHypothesis",
      {
        workUnitId: { type: "string" },
        summary: { type: "string" },
        bypassed: { type: "boolean" },
      },
      ["workUnitId", "summary", "bypassed"],
    ),
    createCommandSchema(
      "RequestHint",
      {
        workUnitId: { type: "string" },
        level: hintLevelSchema,
      },
      ["workUnitId", "level"],
    ),
    createCommandSchema(
      "AuthorizeSolutionReveal",
      {
        workUnitId: { type: "string" },
        previewOnly: { const: true },
      },
      ["workUnitId", "previewOnly"],
    ),
    createCommandSchema(
      "PauseSession",
      { reason: { type: "string" } },
      ["reason"],
    ),
    createCommandSchema(
      "ResumeSession",
      { entry: entrySnapshotSchema },
      ["entry"],
    ),
    createCommandSchema("CloseSession", {}, []),
  ],
} as const;

const validatePairCommand = ajv.compile<PairCommand>(pairCommandSchema);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  Object.getPrototypeOf(value) === Object.prototype;

const jsonError = (reason: string) =>
  new Error(`Invalid Pair command: ${reason}`);

const assertJsonCompatible = (
  value: unknown,
  path = new WeakSet<object>(),
): void => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw jsonError("non-finite numbers are not allowed");
    }
    return;
  }

  if (typeof value === "undefined") {
    throw jsonError("undefined is not allowed");
  }

  if (typeof value === "bigint" || typeof value === "symbol") {
    throw jsonError(`unsupported ${typeof value} value`);
  }

  if (typeof value === "function") {
    throw jsonError("functions are not allowed");
  }

  if (Array.isArray(value)) {
    if (path.has(value)) {
      throw jsonError("circular references are not allowed");
    }
    path.add(value);

    try {
      for (const symbol of Object.getOwnPropertySymbols(value)) {
        throw jsonError(`symbol key ${String(symbol)} is not allowed`);
      }

      for (const name of Object.getOwnPropertyNames(value)) {
        if (name === "length") {
          continue;
        }

        if (!/^(0|[1-9]\d*)$/.test(name)) {
          throw jsonError(`non-index array property ${name} is not allowed`);
        }

        const descriptor = Object.getOwnPropertyDescriptor(value, name);
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
          throw jsonError(`array index ${name} must be a plain enumerable data property`);
        }

        assertJsonCompatible(descriptor.value, path);
      }

      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw jsonError(`sparse array holes are not allowed at index ${index}`);
        }
      }
    } finally {
      path.delete(value);
    }

    return;
  }

  if (typeof value === "object") {
    if (!isPlainObject(value)) {
      throw jsonError("only plain objects and arrays are allowed");
    }

    if (path.has(value)) {
      throw jsonError("circular references are not allowed");
    }
    path.add(value);

    try {
      for (const symbol of Object.getOwnPropertySymbols(value)) {
        throw jsonError(`symbol key ${String(symbol)} is not allowed`);
      }

      for (const name of Object.getOwnPropertyNames(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, name);
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
          throw jsonError(`property ${name} must be a plain enumerable data property`);
        }

        assertJsonCompatible(descriptor.value, path);
      }
    } finally {
      path.delete(value);
    }

    return;
  }

  throw jsonError("unsupported value");
};

function deepClone<Value>(value: Value): Value;
function deepClone(value: unknown): unknown {
  if (Array.isArray(value)) {
    const arrayValue: readonly unknown[] = value;
    return arrayValue.map((item) => deepClone(item));
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.keys(value).map((key) => [
        key,
        deepClone((value as Record<string, unknown>)[key]),
      ]),
    );
  }

  return value;
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value === "object" && value !== null) {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key as keyof typeof value]);
    }
    Object.freeze(value);
  }

  return value;
};

export const parsePairCommand = (value: unknown): PairCommand => {
  assertJsonCompatible(value);

  if (!validatePairCommand(value)) {
    const detail = ajv.errorsText(validatePairCommand.errors, {
      separator: "; ",
    });
    throw new Error(`Invalid Pair command: ${detail}`);
  }

  return deepFreeze(deepClone(value));
};
