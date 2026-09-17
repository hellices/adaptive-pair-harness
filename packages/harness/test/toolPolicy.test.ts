import { growthRuntime } from "@adaptive-pair/testkit";
import { expect, it } from "vitest";
import {
  authorizeVisibleTool,
  nativeToolName,
  PAIR_NATIVE_TOOL_NAMES,
  pairToolNameFromNative,
  toolsFor,
  type PairToolView,
} from "../src/index.js";
import {
  createActiveDeliveryAiRuntime,
  createActivePairAiRuntime,
  createBriefingGrowthRuntime,
  createBriefingPairRuntime,
  createBriefingProposedRuntime,
  createBriefingRuntime,
  createClosedRuntime,
  createClosingRuntime,
  createInactiveRuntime,
  createLearningAgreement,
  createPausedRuntime,
  createReadyGrowthRuntime,
  createReconcilingRuntime,
} from "./toolPolicyFixtures.js";

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
