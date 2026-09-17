import { type PairToolName } from "@adaptive-pair/harness";
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

const createBriefingRuntime = (): PairRuntimeSnapshot =>
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
    },
  });

const createBriefingPairRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 4,
    session: {
      authorityEpoch: 2,
      status: "briefing",
      mode: "pair",
      learningAgreement: undefined,
      entrySnapshot: createEntrySnapshot(3),
      workUnit: undefined,
      assistance: undefined,
      operations: [],
      userActionGrants: [],
    },
  });

const createBriefingUninitializedRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 2,
    session: {
      authorityEpoch: 1,
      status: "briefing",
      mode: undefined,
      learningAgreement: undefined,
      entrySnapshot: undefined,
      workUnit: undefined,
      assistance: undefined,
      operations: [],
      userActionGrants: [],
    },
  });

const createBriefingGrowthRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 5,
    session: {
      authorityEpoch: 2,
      status: "briefing",
      mode: "growth",
      learningAgreement: undefined,
      entrySnapshot: createEntrySnapshot(3),
      workUnit: undefined,
      assistance: undefined,
      operations: [],
      userActionGrants: [],
    },
  });

const createBriefingProposedRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 6,
    session: {
      authorityEpoch: 2,
      status: "briefing",
      mode: "growth",
      learningAgreement: createLearningAgreement(),
      entrySnapshot: createEntrySnapshot(3),
      workUnit: createWorkUnit({
        mode: "growth",
        learningValue: "high",
        capability: "diagnosis",
        owner: "human",
        status: "proposed",
      }),
      assistance: undefined,
      operations: [],
      userActionGrants: [],
    },
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

const inputForTool = (
  name: PairToolName,
  snapshot: PairRuntimeSnapshot,
): Readonly<Record<string, unknown>> => {
  const workUnitId = snapshot.session?.workUnit?.id ?? "unit-1";
  const mode = snapshot.session?.mode ?? "pair";

  switch (name) {
    case "pair_get_state":
    case "pair_close_session":
      return {};
    case "pair_capture_entry":
      return {
        entry: {
          ...createEntrySnapshot(42),
          branch: "feature/v2-growth-foundation-refreshed",
          dirtyPaths: ["packages/runtime/src/coordinator.ts"],
        },
      };
    case "pair_confirm_learning":
      return {
        agreement: createLearningAgreement(),
      };
    case "pair_select_mode":
      return {
        mode:
          snapshot.session?.mode === "growth" &&
          snapshot.session.learningAgreement === undefined
            ? "pair"
            : snapshot.session?.mode ?? "pair",
      };
    case "pair_read_scope":
      return { path: "packages/runtime/src" };
    case "pair_search_scope":
      return { query: "grantUserAction" };
    case "pair_record_attempt":
      return {
        workUnitId,
        summary: "Tried a bounded reproduction.",
        bypassed: false,
      };
    case "pair_record_hypothesis":
      return {
        workUnitId,
        summary: "The visible tool set does not match the current phase.",
        bypassed: false,
      };
    case "pair_request_hint":
      return { workUnitId, level: 1 };
    case "pair_reveal_solution":
      return { workUnitId };
    case "pair_propose_work_unit":
      return {
        workUnit: createWorkUnit({
          id: "unit-2",
          mode,
          capability: mode === "delivery" ? "verification" : "implementation",
          learningValue: mode === "growth" ? "high" : "mixed",
          owner: mode === "growth" ? "human" : "ai",
          status: "proposed",
        }),
      };
    case "pair_agree_work_unit":
      return { workUnitId };
    case "pair_apply_edit":
      return {
        targetPath: "packages/runtime/src/coordinator.ts",
        description: "Apply the agreed fix",
      };
    case "pair_run_verification":
      return { plan: "npm test" };
    case "pair_run_command":
      return { command: "npm test" };
    case "pair_accept_handoff":
    case "pair_record_transfer":
      throw new Error(`Hidden tool should not be visible: ${name}`);
  }
};

export { createActiveDeliveryAiRuntime,createActivePairAiRuntime,createBriefingGrowthRuntime,createBriefingPairRuntime,createBriefingProposedRuntime,createBriefingRuntime,createBriefingUninitializedRuntime,createClosedRuntime,createClosingRuntime,createEntrySnapshot,createGrowthAssistance,createInactiveRuntime,createLearningAgreement,createPausedRuntime,createReadyGrowthRuntime,createReconcilingRuntime,createWorkUnit,inputForTool };
