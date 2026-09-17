
const createEntry = (branch?: string) => ({
  workspaceId: "workspace-1",
  ...(branch === undefined ? {} : { branch }),
  dirtyPaths: ["packages/protocol/src/index.ts"],
  openPaths: ["packages/protocol/test/protocol.test.ts"],
  diagnostics: ["packages/protocol/src/index.ts:1:1 warning"],
  protectedPaths: [".env"],
  capturedAt: 200,
});

const createAgreement = () => ({
  learningGoals: ["Understand the protocol boundary"],
  familiarAreas: ["Task 1 toolchain"],
  humanOwnedCapabilities: ["problem-framing", "verification"] as const,
  delegatableWork: ["schema implementation"],
  maximumHintLevel: 2 as const,
  independentCheck: "Run targeted protocol tests before commit",
});

const createWorkUnit = () => ({
  id: "wu-1",
  objective: "Define the durable protocol contract",
  mode: "growth" as const,
  learningValue: "high" as const,
  capability: "design" as const,
  owner: "human" as const,
  allowedPaths: ["packages/protocol/src"],
  acceptanceChecks: ["npx vitest run packages/protocol/test/protocol.test.ts"],
  verificationPlan: "Run protocol tests and typecheck",
  stoppingCondition: "All command variants parse successfully",
  baseline: {
    "packages/protocol/src/index.ts": "abc123",
  },
  status: "proposed" as const,
});

const createEditOperation = () => ({
  workUnitId: "wu-1",
  operationId: "op-1",
  targetPath: "packages/protocol/src/index.ts",
  description: "Apply the agreed protocol export edit",
});

export { createAgreement,createEditOperation,createEntry,createWorkUnit };
