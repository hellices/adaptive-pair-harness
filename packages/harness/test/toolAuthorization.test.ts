import { growthRuntime } from "@adaptive-pair/testkit";
import { expect, it } from "vitest";
import {
  authorizeVisibleTool,
  issuePairUserActionGrant,
  nativeToolName,
  PAIR_TOOL_CATALOG_VERSION,
  toolsFor,
} from "../src/index.js";
import { createBriefingProposedRuntime, createBriefingRuntime } from "./toolPolicyFixtures.js";

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
