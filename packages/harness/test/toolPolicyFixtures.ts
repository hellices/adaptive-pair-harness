import type { PairRuntimeSnapshot, PairSessionSnapshot, WorkUnit } from "@adaptive-pair/protocol";
import { growthRuntime } from "@adaptive-pair/testkit";

const createEntrySnapshot = (
  capturedAt: number,
): NonNullable<PairSessionSnapshot["entrySnapshot"]> => ({
  workspaceId: "workspace-1",
  branch: "feature/v2-growth-foundation",
  dirtyPaths: [],
  openPaths: ["packages/runtime/src/coordinator.ts"],
  diagnostics: [],
  protectedPaths: [],
  capturedAt,
});

const createGrowthAssistance = (): NonNullable<PairSessionSnapshot["assistance"]> => ({
  attempt: undefined,
  hypothesis: undefined,
  hint: undefined,
  solutionReveal: undefined,
});

const createLearningAgreement = (): NonNullable<PairSessionSnapshot["learningAgreement"]> => ({
  learningGoals: ["Validate the runtime tool projection"],
  familiarAreas: [],
  humanOwnedCapabilities: ["diagnosis", "implementation"],
  delegatableWork: [],
  maximumHintLevel: 2,
  independentCheck: "Recreate the projection without help",
});

const createWorkUnit = (
  overrides: Partial<WorkUnit>,
): WorkUnit => ({
  id: "unit-1",
  objective: "Complete the current bounded task",
  mode: "pair",
  learningValue: "mixed",
  capability: "implementation",
  owner: "human",
  allowedPaths: ["packages/runtime/src/coordinator.ts"],
  acceptanceChecks: ["npm test"],
  verificationPlan: "npm test",
  stoppingCondition: "The changed tests stay green",
  baseline: {},
  status: "agreed",
  ...overrides,
});

const createInactiveRuntime = (): PairRuntimeSnapshot => ({
  protocolVersion: 1,
  revision: 0,
  presence: {
    workspaceId: "workspace-1",
    observationRevision: 0,
    status: "observing",
    activeSessionId: undefined,
  },
  session: undefined,
});

const createBriefingRuntime = (
  session: Partial<PairSessionSnapshot> = {},
): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 4,
    session: {
      authorityEpoch: 2,
      status: "briefing",
      mode: undefined,
      learningAgreement: undefined,
      entrySnapshot: createEntrySnapshot(3),
      workUnit: undefined,
      assistance: undefined,
      operations: [],
      userActionGrants: [],
      ...session,
    },
  });

const createBriefingPairRuntime = (): PairRuntimeSnapshot =>
  createBriefingRuntime({
    mode: "pair",
  });

const createBriefingGrowthRuntime = (
  session: Partial<PairSessionSnapshot> = {},
): PairRuntimeSnapshot =>
  createBriefingRuntime({
    mode: "growth",
    learningAgreement: undefined,
    ...session,
  });

const createBriefingProposedRuntime = (): PairRuntimeSnapshot =>
  createBriefingGrowthRuntime({
    learningAgreement: createLearningAgreement(),
    workUnit: createWorkUnit({
      mode: "growth",
      learningValue: "high",
      capability: "diagnosis",
      owner: "human",
      status: "proposed",
    }),
  });

const createReadyGrowthRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 7,
    session: {
      status: "ready",
      mode: "growth",
      assistance: createGrowthAssistance(),
      workUnit: createWorkUnit({
        mode: "growth",
        learningValue: "high",
        capability: "diagnosis",
        owner: "human",
      }),
    },
  });

const createActivePairAiRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 9,
    session: {
      status: "active",
      mode: "pair",
      learningAgreement: undefined,
      assistance: undefined,
      workUnit: createWorkUnit({
        mode: "pair",
        owner: "ai",
      }),
    },
  });

const createActiveDeliveryAiRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 11,
    session: {
      status: "active",
      mode: "delivery",
      learningAgreement: undefined,
      assistance: undefined,
      workUnit: createWorkUnit({
        mode: "delivery",
        capability: "verification",
        owner: "ai",
      }),
    },
  });

const createPausedRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 12,
    session: {
      status: "paused",
      mode: "pair",
      learningAgreement: undefined,
      assistance: undefined,
      workUnit: createWorkUnit({
        mode: "pair",
        owner: "ai",
      }),
    },
  });

const createReconcilingRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 13,
    session: {
      status: "reconciling",
      mode: "pair",
      learningAgreement: undefined,
      assistance: undefined,
      workUnit: createWorkUnit({
        mode: "pair",
        owner: "ai",
        status: "needs-reconcile",
      }),
    },
  });

const createClosingRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 14,
    session: {
      status: "closing",
      mode: "delivery",
      learningAgreement: undefined,
      assistance: undefined,
      workUnit: createWorkUnit({
        mode: "delivery",
        capability: "verification",
        owner: "ai",
      }),
    },
  });

const createClosedRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 15,
    session: {
      status: "closed",
      mode: "delivery",
      learningAgreement: undefined,
      assistance: undefined,
      workUnit: createWorkUnit({
        mode: "delivery",
        capability: "verification",
        owner: "ai",
      }),
    },
  });

export { createActiveDeliveryAiRuntime,createActivePairAiRuntime,createBriefingGrowthRuntime,createBriefingPairRuntime,createBriefingProposedRuntime,createBriefingRuntime,createClosedRuntime,createClosingRuntime,createEntrySnapshot,createGrowthAssistance,createInactiveRuntime,createLearningAgreement,createPausedRuntime,createReadyGrowthRuntime,createReconcilingRuntime,createWorkUnit };
