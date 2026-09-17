import type {
  LearningAgreement,
  OperationRecord,
  PairRuntimeSnapshot,
  WorkUnit,
} from "@adaptive-pair/protocol";
import type { PairHandoffContext } from "../src/pairHandoff.js";
import type { PairWorkUnitPolicyContext } from "../src/pairWorkUnit.js";

export const pairWorkUnit = (overrides: Partial<WorkUnit> = {}): WorkUnit => ({
  id: "unit-pair-1",
  objective: "Implement a bounded retry transition",
  mode: "pair",
  learningValue: "high",
  capability: "implementation",
  owner: "human",
  allowedPaths: ["src/retry.ts"],
  acceptanceChecks: ["The retry transition test passes"],
  verificationPlan: "npm test",
  stoppingCondition: "One transition is verified",
  baseline: {},
  status: "proposed",
  ...overrides,
});

export const pairAgreement = (
  overrides: Partial<LearningAgreement> = {},
): LearningAgreement => ({
  learningGoals: ["Implement and diagnose retry behavior"],
  familiarAreas: [],
  humanOwnedCapabilities: ["diagnosis"],
  delegatableWork: ["Mechanical test setup"],
  maximumHintLevel: 4,
  independentCheck: "Implement a distinct timeout transition",
  ...overrides,
});

export const pairPolicyContext = (
  overrides: Partial<PairWorkUnitPolicyContext> = {},
): PairWorkUnitPolicyContext => ({
  learningAgreement: pairAgreement(),
  editCapability: "unavailable",
  ...overrides,
});

export const pairRuntime = (
  workUnit: WorkUnit = pairWorkUnit({ status: "agreed" }),
  operations: readonly OperationRecord[] = [],
): PairRuntimeSnapshot => ({
  protocolVersion: 1,
  revision: 12,
  presence: {
    workspaceId: "workspace-1",
    observationRevision: 1,
    status: "engaged",
    activeSessionId: "session-1",
  },
  session: {
    sessionId: "session-1",
    startedAtRevision: 0,
    authorityEpoch: 3,
    status: "ready",
    mode: "pair",
    goal: "Implement retry behavior together",
    criteria: ["The retry check passes"],
    learningAgreement: pairAgreement(),
    entrySnapshot: {
      workspaceId: "workspace-1",
      dirtyPaths: [],
      openPaths: ["src/retry.ts"],
      diagnostics: [],
      protectedPaths: [],
      capturedAt: 0,
    },
    workUnit,
    assistance: undefined,
    operations,
    userActionGrants: [],
  },
});

export const pairOperation = (
  overrides: Partial<OperationRecord> = {},
): OperationRecord => ({
  id: "operation-1",
  workUnitId: "unit-pair-1",
  toolName: "pair_apply_edit",
  kind: "edit",
  input: {},
  runtimeRevision: 12,
  authorityEpoch: 3,
  status: "authorized",
  summary: undefined,
  userActionGrantId: undefined,
  ...overrides,
});

export const pairHandoffContext = (
  overrides: Partial<PairHandoffContext> = {},
): PairHandoffContext => ({
  snapshot: pairRuntime(),
  proposal: {
    sessionId: "session-1",
    workUnitId: "unit-pair-1",
    fromOwner: "human",
    toOwner: "ai",
    runtimeRevision: 12,
    authorityEpoch: 3,
  },
  operationAdmission: "stopped",
  editCapability: "verified",
  ...overrides,
});
