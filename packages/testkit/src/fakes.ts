import type {
  PairRuntimeSnapshot,
  PairSessionSnapshot,
} from "@adaptive-pair/protocol";

export const growthRuntime = (
  overrides: {
    readonly runtimeRevision?: number;
    readonly session?: Partial<PairSessionSnapshot>;
  } = {},
): PairRuntimeSnapshot => {
  const session: PairSessionSnapshot = {
    sessionId: "session-1",
    startedAtRevision: 0,
    authorityEpoch: 0,
    status: "active",
    mode: "growth",
    goal: "Practice retry behavior",
    criteria: ["The retry test passes"],
    learningAgreement: {
      learningGoals: ["Implement and debug retry state"],
      familiarAreas: [],
      humanOwnedCapabilities: ["implementation", "diagnosis", "repair"],
      delegatableWork: [],
      maximumHintLevel: 4,
      independentCheck: "Implement a varied timeout retry",
    },
    entrySnapshot: {
      workspaceId: "workspace-1",
      branch: "feature/retry",
      dirtyPaths: [],
      openPaths: ["src/retry.ts"],
      diagnostics: [],
      protectedPaths: [],
      capturedAt: 0,
    },
    workUnit: {
      id: "unit-1",
      objective: "Implement one retry transition",
      mode: "growth",
      learningValue: "high",
      capability: "implementation",
      owner: "human",
      allowedPaths: ["src/retry.ts"],
      acceptanceChecks: ["The retry test passes"],
      verificationPlan: "npm test",
      stoppingCondition: "One transition is green",
      baseline: {},
      status: "agreed",
    },
    assistance: undefined,
    operations: [],
    userActionGrants: [],
    ...overrides.session,
  };

  return {
    protocolVersion: 1,
    revision: overrides.runtimeRevision ?? 0,
    presence: {
      workspaceId: "workspace-1",
      observationRevision: 1,
      status: "engaged",
      activeSessionId: session.sessionId,
    },
    session,
  };
};
