import { describe, expect, it } from "vitest";
import {
  authorizeVisibleTool,
  issuePairUserActionGrant,
  nativeToolName,
  PAIR_NATIVE_TOOL_NAMES,
  type PairToolView,
  pairToolNameFromNative,
  PAIR_TOOL_CATALOG_VERSION,
  toolsFor,
} from "../src/index.js";
import { growthRuntime } from "@adaptive-pair/testkit";
import type { PairRuntimeSnapshot, PairSessionSnapshot, WorkUnit } from "@adaptive-pair/protocol";

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

describe("Pair tool policy", () => {
  it("shows no workspace mutation in Growth Mode", () => {
    const view = toolsFor(growthRuntime());

    expect(view.tools.map(tool => tool.name)).toContain("pair_request_hint");
    expect(view.tools.map(tool => tool.name)).not.toContain("pair_apply_edit");
    expect(view.tools.map(tool => tool.name)).not.toContain("pair_run_command");
  });

  it("projects representative phase-aware tool sets", () => {
    expect(toolsFor(createInactiveRuntime()).tools.map(tool => tool.name)).toEqual([
      "pair_get_state",
    ]);

    expect(
      toolsFor(
        createBriefingRuntime({
          mode: undefined,
          entrySnapshot: undefined,
        }),
      ).tools.map(tool => tool.name),
    ).toEqual([
      "pair_get_state",
      "pair_capture_entry",
      "pair_select_mode",
      "pair_close_session",
    ]);

    expect(
      toolsFor(createBriefingRuntime()).tools.map(tool => tool.name),
    ).toEqual([
      "pair_get_state",
      "pair_capture_entry",
      "pair_confirm_learning",
      "pair_select_mode",
      "pair_close_session",
    ]);

    expect(
      toolsFor(createBriefingPairRuntime()).tools.map(tool => tool.name),
    ).toEqual([
      "pair_get_state",
      "pair_capture_entry",
      "pair_select_mode",
      "pair_propose_work_unit",
      "pair_close_session",
    ]);

    expect(
      toolsFor(createBriefingGrowthRuntime()).tools.map(tool => tool.name),
    ).toEqual([
      "pair_get_state",
      "pair_capture_entry",
      "pair_confirm_learning",
      "pair_select_mode",
      "pair_close_session",
    ]);

    expect(
      toolsFor(
        createBriefingGrowthRuntime({
          learningAgreement: createLearningAgreement(),
        }),
      ).tools.map(tool => tool.name),
    ).toEqual([
      "pair_get_state",
      "pair_capture_entry",
      "pair_confirm_learning",
      "pair_select_mode",
      "pair_propose_work_unit",
      "pair_close_session",
    ]);

    expect(
      toolsFor(createBriefingProposedRuntime()).tools.map(tool => tool.name),
    ).toEqual([
      "pair_get_state",
      "pair_capture_entry",
      "pair_confirm_learning",
      "pair_propose_work_unit",
      "pair_agree_work_unit",
      "pair_close_session",
    ]);

    expect(
      toolsFor(createReadyGrowthRuntime()).tools.map(tool => tool.name),
    ).toEqual([
      "pair_get_state",
      "pair_read_scope",
      "pair_search_scope",
      "pair_record_attempt",
      "pair_record_hypothesis",
      "pair_request_hint",
      "pair_reveal_solution",
      "pair_run_verification",
      "pair_close_session",
    ]);

    expect(
      toolsFor(createActivePairAiRuntime()).tools.map(tool => tool.name),
    ).toEqual([
      "pair_get_state",
      "pair_read_scope",
      "pair_search_scope",
      "pair_apply_edit",
      "pair_run_verification",
      "pair_close_session",
    ]);

    expect(
      toolsFor(createActiveDeliveryAiRuntime()).tools.map(tool => tool.name),
    ).toEqual([
      "pair_get_state",
      "pair_read_scope",
      "pair_search_scope",
      "pair_apply_edit",
      "pair_run_verification",
      "pair_run_command",
      "pair_close_session",
    ]);

    expect(toolsFor(createPausedRuntime()).tools.map(tool => tool.name)).toEqual([
      "pair_get_state",
      "pair_close_session",
    ]);

    expect(
      toolsFor(createReconcilingRuntime()).tools.map(tool => tool.name),
    ).toEqual([
      "pair_get_state",
      "pair_close_session",
    ]);

    expect(
      toolsFor(createClosingRuntime()).tools.map(tool => tool.name),
    ).toEqual([
      "pair_get_state",
      "pair_close_session",
    ]);

    expect(toolsFor(createClosedRuntime()).tools.map(tool => tool.name)).toEqual([
      "pair_get_state",
    ]);
  });

  it("hides unimplemented handoff and transfer tools from visible projections", () => {
    const snapshots = [
      createBriefingRuntime(),
      createBriefingPairRuntime(),
      createBriefingGrowthRuntime(),
      createBriefingProposedRuntime(),
      createReadyGrowthRuntime(),
      createActivePairAiRuntime(),
      createActiveDeliveryAiRuntime(),
      createPausedRuntime(),
      createReconcilingRuntime(),
      createClosingRuntime(),
      createClosedRuntime(),
    ];

    for (const snapshot of snapshots) {
      const visibleNames = toolsFor(snapshot).tools.map(tool => tool.name);

      expect(visibleNames).not.toContain("pair_accept_handoff");
      expect(visibleNames).not.toContain("pair_record_transfer");
    }
  });

  it("binds the view to the current revision and authority epoch", () => {
    const view = toolsFor(
      growthRuntime({
        runtimeRevision: 8,
        session: { authorityEpoch: 3 },
      }),
    );

    expect(view).toMatchObject({
      runtimeRevision: 8,
      authorityEpoch: 3,
      catalogVersion: 1,
    });
  });

  it("maps every internal tool to one stable native name", () => {
    const view = toolsFor(growthRuntime());
    const names = view.tools.map(tool => nativeToolName(tool.name));

    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("adaptive_pair_get_state");
    expect(PAIR_NATIVE_TOOL_NAMES).toEqual([
      "adaptive_pair_get_state",
      "adaptive_pair_capture_entry",
      "adaptive_pair_confirm_learning",
      "adaptive_pair_select_mode",
      "adaptive_pair_read_scope",
      "adaptive_pair_search_scope",
      "adaptive_pair_record_attempt",
      "adaptive_pair_record_hypothesis",
      "adaptive_pair_request_hint",
      "adaptive_pair_reveal_solution",
      "adaptive_pair_propose_work_unit",
      "adaptive_pair_agree_work_unit",
      "adaptive_pair_accept_handoff",
      "adaptive_pair_apply_edit",
      "adaptive_pair_run_verification",
      "adaptive_pair_run_command",
      "adaptive_pair_record_transfer",
      "adaptive_pair_close_session",
    ]);
  });

  it("rejects hidden native workspace tool names", () => {
    expect(pairToolNameFromNative("workspace_edit")).toBeUndefined();
  });

  it("rejects stale runtime revisions and authority epochs", () => {
    const view = toolsFor(growthRuntime());

    expect(
      authorizeVisibleTool(view, {
        catalogVersion: PAIR_TOOL_CATALOG_VERSION,
        name: "pair_get_state",
        runtimeRevision: view.runtimeRevision + 1,
        authorityEpoch: view.authorityEpoch,
        owner: "human",
      }),
    ).toEqual({
      allowed: false,
      reason: "STALE_TOOL_VIEW",
    });

    expect(
      authorizeVisibleTool(view, {
        catalogVersion: PAIR_TOOL_CATALOG_VERSION,
        name: "pair_get_state",
        runtimeRevision: view.runtimeRevision,
        authorityEpoch: (view.authorityEpoch ?? 0) + 1,
        owner: "human",
      }),
    ).toEqual({
      allowed: false,
      reason: "STALE_TOOL_VIEW",
    });
  });

  it("rejects hidden tools even if a caller fabricates the name", () => {
    const view = toolsFor(growthRuntime());

    expect(
      authorizeVisibleTool(view, {
        catalogVersion: PAIR_TOOL_CATALOG_VERSION,
        name: "pair_apply_edit",
        runtimeRevision: view.runtimeRevision,
        authorityEpoch: view.authorityEpoch,
        owner: "ai",
      }),
    ).toEqual({
      allowed: false,
      reason: "TOOL_HIDDEN",
    });
  });

  it("rejects owner changes without a refreshed tool view", () => {
    const view = toolsFor(
      growthRuntime({
        session: {
          mode: "pair",
          workUnit: {
            id: "unit-1",
            objective: "Apply one bounded change",
            mode: "pair",
            learningValue: "mixed",
            capability: "implementation",
            owner: "ai",
            allowedPaths: ["src/retry.ts"],
            acceptanceChecks: ["npm test -- retry"],
            verificationPlan: "npm test -- retry",
            stoppingCondition: "The failing retry test is green",
            baseline: {},
            status: "agreed",
          },
        },
      }),
    );

    expect(view.tools.map(tool => tool.name)).toContain("pair_apply_edit");
    expect(
      authorizeVisibleTool(view, {
        catalogVersion: PAIR_TOOL_CATALOG_VERSION,
        name: "pair_apply_edit",
        runtimeRevision: view.runtimeRevision,
        authorityEpoch: view.authorityEpoch,
        owner: "human",
      }),
    ).toEqual({
      allowed: false,
      reason: "WRONG_OWNER",
    });
  });

  it("requires a matching one-shot user action for explicit tools", () => {
    const view = toolsFor(growthRuntime());

    expect(
      authorizeVisibleTool(view, {
        catalogVersion: PAIR_TOOL_CATALOG_VERSION,
        name: "pair_request_hint",
        runtimeRevision: view.runtimeRevision,
        authorityEpoch: view.authorityEpoch,
        owner: "human",
      }),
    ).toEqual({
      allowed: false,
      reason: "USER_ACTION_REQUIRED",
    });

    expect(
      authorizeVisibleTool(view, {
        catalogVersion: PAIR_TOOL_CATALOG_VERSION,
        name: "pair_request_hint",
        runtimeRevision: view.runtimeRevision,
        authorityEpoch: view.authorityEpoch,
        owner: "human",
        userAction: issuePairUserActionGrant({
          name: "pair_reveal_solution",
          runtimeRevision: view.runtimeRevision,
          authorityEpoch: view.authorityEpoch,
        }),
      }),
    ).toEqual({
      allowed: false,
      reason: "USER_ACTION_REQUIRED",
    });

    expect(
      authorizeVisibleTool(view, {
        catalogVersion: PAIR_TOOL_CATALOG_VERSION,
        name: "pair_request_hint",
        runtimeRevision: view.runtimeRevision,
        authorityEpoch: view.authorityEpoch,
        owner: "human",
        userAction: issuePairUserActionGrant({
          name: "pair_request_hint",
          runtimeRevision: view.runtimeRevision + 1,
          authorityEpoch: view.authorityEpoch,
        }),
      }),
    ).toEqual({
      allowed: false,
      reason: "USER_ACTION_REQUIRED",
    });

    expect(
      authorizeVisibleTool(view, {
        catalogVersion: PAIR_TOOL_CATALOG_VERSION,
        name: "pair_request_hint",
        runtimeRevision: view.runtimeRevision,
        authorityEpoch: view.authorityEpoch,
        owner: "human",
        userAction: issuePairUserActionGrant({
          name: "pair_request_hint",
          runtimeRevision: view.runtimeRevision,
          authorityEpoch: (view.authorityEpoch ?? 0) + 1,
        }),
      }),
    ).toEqual({
      allowed: false,
      reason: "USER_ACTION_REQUIRED",
    });
  });

  it("requires one-shot user action for learning, mode, and work-unit agreement", () => {
    const cases = [
      {
        view: toolsFor(createBriefingRuntime()),
        name: "pair_confirm_learning",
      },
      {
        view: toolsFor(createBriefingRuntime()),
        name: "pair_select_mode",
      },
      {
        view: toolsFor(createBriefingProposedRuntime()),
        name: "pair_agree_work_unit",
      },
    ] as const;

    for (const { view, name } of cases) {
      expect(view.tools.find(tool => tool.name === name)).toMatchObject({
        requiresExplicitUserAction: true,
      });
      expect(
        authorizeVisibleTool(view, {
          catalogVersion: PAIR_TOOL_CATALOG_VERSION,
          name,
          runtimeRevision: view.runtimeRevision,
          authorityEpoch: view.authorityEpoch,
          owner: "human",
        }),
      ).toEqual({
        allowed: false,
        reason: "USER_ACTION_REQUIRED",
      });
    }
  });

  it("rejects caller-forged lookalike grants", () => {
    const view = toolsFor(growthRuntime());

    expect(
      authorizeVisibleTool(view, {
        catalogVersion: PAIR_TOOL_CATALOG_VERSION,
        name: "pair_request_hint",
        runtimeRevision: view.runtimeRevision,
        authorityEpoch: view.authorityEpoch,
        owner: "human",
        userAction: {
          id: "grant-model-lookalike",
          nativeToolName: nativeToolName("pair_request_hint"),
          runtimeRevision: view.runtimeRevision,
          authorityEpoch: view.authorityEpoch,
          consumed: false,
        } as unknown as NonNullable<
          Parameters<typeof authorizeVisibleTool>[1]["userAction"]
        >,
      }),
    ).toEqual({
      allowed: false,
      reason: "USER_ACTION_REQUIRED",
    });
  });

  it("accepts a current matching one-shot user action", () => {
    const view = toolsFor(growthRuntime());
    const grant = issuePairUserActionGrant({
      name: "pair_request_hint",
      runtimeRevision: view.runtimeRevision,
      authorityEpoch: view.authorityEpoch,
    });
    const decision = authorizeVisibleTool(view, {
      catalogVersion: PAIR_TOOL_CATALOG_VERSION,
      name: "pair_request_hint",
      runtimeRevision: view.runtimeRevision,
      authorityEpoch: view.authorityEpoch,
      owner: "human",
      userAction: grant,
    });

    expect(decision.allowed).toBe(true);
    expect(decision).toMatchObject({
      allowed: true,
      descriptor: {
        name: "pair_request_hint",
      },
    });

    expect(
      authorizeVisibleTool(view, {
        catalogVersion: PAIR_TOOL_CATALOG_VERSION,
        name: "pair_request_hint",
        runtimeRevision: view.runtimeRevision,
        authorityEpoch: view.authorityEpoch,
        owner: "human",
        userAction: grant,
      }),
    ).toEqual({
      allowed: false,
      reason: "USER_ACTION_REQUIRED",
    });
  });

  it("rejects unsupported catalog versions", () => {
    const view = {
      ...toolsFor(growthRuntime()),
      catalogVersion: 999,
    } as unknown as PairToolView;

    expect(
      authorizeVisibleTool(view, {
        catalogVersion: 999,
        name: "pair_get_state",
        runtimeRevision: view.runtimeRevision,
        authorityEpoch: view.authorityEpoch,
        owner: "human",
      }),
    ).toEqual({
      allowed: false,
      reason: "UNSUPPORTED_TOOL_CATALOG_VERSION",
    });
  });
});
