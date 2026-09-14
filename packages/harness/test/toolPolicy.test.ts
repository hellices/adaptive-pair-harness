import { describe, expect, it } from "vitest";
import {
  authorizeVisibleTool,
  nativeToolName,
  PAIR_NATIVE_TOOL_NAMES,
  type PairToolView,
  pairToolNameFromNative,
  PAIR_TOOL_CATALOG_VERSION,
  toolsFor,
} from "../src/index.js";
import { growthRuntime } from "@adaptive-pair/testkit";

describe("Pair tool policy", () => {
  it("shows no workspace mutation in Growth Mode", () => {
    const view = toolsFor(growthRuntime());

    expect(view.tools.map(tool => tool.name)).toContain("pair_request_hint");
    expect(view.tools.map(tool => tool.name)).not.toContain("pair_apply_edit");
    expect(view.tools.map(tool => tool.name)).not.toContain("pair_run_command");
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
      "adaptive_pair_read_scope",
      "adaptive_pair_search_scope",
      "adaptive_pair_record_attempt",
      "adaptive_pair_record_hypothesis",
      "adaptive_pair_request_hint",
      "adaptive_pair_reveal_solution",
      "adaptive_pair_propose_work_unit",
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
        userAction: {
          id: "grant-1",
          nativeToolName: nativeToolName("pair_reveal_solution"),
          runtimeRevision: view.runtimeRevision,
          authorityEpoch: view.authorityEpoch,
          consumed: false,
        },
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
        userAction: {
          id: "grant-2",
          nativeToolName: nativeToolName("pair_request_hint"),
          runtimeRevision: view.runtimeRevision + 1,
          authorityEpoch: view.authorityEpoch,
          consumed: false,
        },
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
        userAction: {
          id: "grant-3",
          nativeToolName: nativeToolName("pair_request_hint"),
          runtimeRevision: view.runtimeRevision,
          authorityEpoch: (view.authorityEpoch ?? 0) + 1,
          consumed: false,
        },
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
        userAction: {
          id: "grant-4",
          nativeToolName: nativeToolName("pair_request_hint"),
          runtimeRevision: view.runtimeRevision,
          authorityEpoch: view.authorityEpoch,
          consumed: true,
        },
      }),
    ).toEqual({
      allowed: false,
      reason: "USER_ACTION_REQUIRED",
    });
  });

  it("accepts a current matching one-shot user action", () => {
    const view = toolsFor(growthRuntime());
    const decision = authorizeVisibleTool(view, {
      catalogVersion: PAIR_TOOL_CATALOG_VERSION,
      name: "pair_request_hint",
      runtimeRevision: view.runtimeRevision,
      authorityEpoch: view.authorityEpoch,
      owner: "human",
      userAction: {
        id: "grant-5",
        nativeToolName: nativeToolName("pair_request_hint"),
        runtimeRevision: view.runtimeRevision,
        authorityEpoch: view.authorityEpoch,
        consumed: false,
      },
    });

    expect(decision.allowed).toBe(true);
    expect(decision).toMatchObject({
      allowed: true,
      descriptor: {
        name: "pair_request_hint",
      },
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
