export const stringArraySchema = {
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

export const hintLevelSchema = {
  enum: [0, 1, 2, 3, 4, 5],
} as const;

export const learningAgreementSchema = {
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

export const entrySnapshotSchema = {
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

export const jsonObjectSchema = {
  type: "object",
  propertyNames: { type: "string" },
  additionalProperties: true,
} as const;

export const workUnitSchema = {
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
