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

const briefingRuntime = (
  runtimeRevision: number,
  session: Partial<PairSessionSnapshot> = {},
): PairRuntimeSnapshot => growthRuntime({
  runtimeRevision,
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

const aiRuntime = (
  runtimeRevision: number,
  status: PairSessionSnapshot["status"],
  mode: "pair" | "delivery",
  workUnit: Partial<WorkUnit> = {},
): PairRuntimeSnapshot => growthRuntime({
  runtimeRevision,
  session: {
    status,
    mode,
    learningAgreement: undefined,
    assistance: undefined,
    workUnit: createWorkUnit({
      mode,
      ...(mode === "delivery" ? { capability: "verification" } : {}),
      owner: "ai",
      ...workUnit,
    }),
  },
});

const createBriefingRuntime = (): PairRuntimeSnapshot => briefingRuntime(4);

const createReconcilingRuntime = (): PairRuntimeSnapshot =>
  aiRuntime(13, "reconciling", "pair", { status: "needs-reconcile" });

const growthWorkUnit = (status: WorkUnit["status"]): WorkUnit => createWorkUnit({
  mode: "growth", learningValue: "high", capability: "diagnosis", owner: "human", status,
});

/** Inactive, briefing, ready, active, paused, reconciling, closing and closed runtimes. */
const lifecycleRuntimes = (): readonly PairRuntimeSnapshot[] => [
  {
    protocolVersion: 1,
    revision: 0,
    presence: { workspaceId: "workspace-1", observationRevision: 0, status: "observing", activeSessionId: undefined },
    session: undefined,
  },
  briefingRuntime(2, { authorityEpoch: 1, entrySnapshot: undefined }),
  createBriefingRuntime(),
  briefingRuntime(4, { mode: "pair" }),
  briefingRuntime(5, { mode: "growth" }),
  briefingRuntime(6, {
    mode: "growth", learningAgreement: createLearningAgreement(), workUnit: growthWorkUnit("proposed"),
  }),
  growthRuntime({
    runtimeRevision: 7,
    session: {
      status: "ready",
      mode: "growth",
      assistance: { attempt: undefined, hypothesis: undefined, hint: undefined, solutionReveal: undefined },
      workUnit: growthWorkUnit("agreed"),
    },
  }),
  aiRuntime(9, "active", "pair"),
  aiRuntime(11, "active", "delivery"),
  aiRuntime(12, "paused", "pair"),
  createReconcilingRuntime(),
  aiRuntime(14, "closing", "delivery"),
  aiRuntime(15, "closed", "delivery"),
];

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

export {
  createBriefingRuntime,
  createEntrySnapshot,
  createLearningAgreement,
  createReconcilingRuntime,
  createWorkUnit,
  inputForTool,
  lifecycleRuntimes,
};
