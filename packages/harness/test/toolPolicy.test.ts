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

it("maps native tool names one-to-one and rejects foreign names", () => {
  expect(new Set(PAIR_NATIVE_TOOL_NAMES).size).toBe(PAIR_NATIVE_TOOL_NAMES.length);
  for (const nativeName of PAIR_NATIVE_TOOL_NAMES) {
    const name = pairToolNameFromNative(nativeName);

    expect(name === undefined ? undefined : nativeToolName(name)).toBe(nativeName);
  }
  expect(PAIR_NATIVE_TOOL_NAMES).toContain("adaptive_pair_get_state");
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
