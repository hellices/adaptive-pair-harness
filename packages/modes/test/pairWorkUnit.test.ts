import type { WorkUnit } from "@adaptive-pair/protocol";
import { describe, expect, it } from "vitest";
import { assessPairWorkUnit } from "../src/index.js";
import { pairPolicyContext, pairWorkUnit } from "./pairFixtures.js";

describe("Pair work-unit policy", () => {
  it("admits a human owner without an AI edit capability", () => {
    expect(assessPairWorkUnit(pairWorkUnit(), pairPolicyContext())).toEqual({
      admissible: true,
      navigator: "ai",
      requiresHumanFollowUp: false,
    });
  });

  it("refuses AI ownership when bounded edits are unavailable", () => {
    expect(assessPairWorkUnit(
      pairWorkUnit({ owner: "ai" }),
      pairPolicyContext(),
    )).toEqual({ admissible: false, reason: "PAIR_EDIT_CAPABILITY_REQUIRED" });
  });

  it.each(["high", "mixed"] as const)("describes the human unit after %s-value AI work", learningValue => {
    expect(assessPairWorkUnit(
      pairWorkUnit({ owner: "ai", learningValue }),
      pairPolicyContext({ editCapability: "verified" }),
    )).toEqual({
      admissible: true,
      navigator: "human",
      requiresHumanFollowUp: true,
    });
  });

  it("does not classify mechanical AI work as a new learning obligation", () => {
    expect(assessPairWorkUnit(
      pairWorkUnit({ owner: "ai", learningValue: "low" }),
      pairPolicyContext({ editCapability: "verified" }),
    )).toEqual({
      admissible: true,
      navigator: "human",
      requiresHumanFollowUp: false,
    });
  });

  it("does not let capability support override human-reserved practice", () => {
    expect(assessPairWorkUnit(
      pairWorkUnit({ owner: "ai", capability: "diagnosis" }),
      pairPolicyContext({ editCapability: "verified" }),
    )).toEqual({ admissible: false, reason: "PAIR_HUMAN_CAPABILITY_RESERVED" });
  });

  const invalidUnits: readonly [Partial<WorkUnit>, string][] = [
    [{ mode: "growth" }, "PAIR_MODE_REQUIRED"],
    [{ mode: "delivery" }, "PAIR_MODE_REQUIRED"],
    [{ status: "agreed" }, "PAIR_PROPOSAL_REQUIRED"],
    [{ id: "" }, "PAIR_WORK_UNIT_ID_REQUIRED"],
    [{ id: " " }, "PAIR_WORK_UNIT_ID_REQUIRED"],
    [{ objective: " " }, "PAIR_OBJECTIVE_REQUIRED"],
    [{ allowedPaths: [] }, "PAIR_SCOPE_REQUIRED"],
    [{ allowedPaths: [" "] }, "PAIR_SCOPE_REQUIRED"],
    [{ acceptanceChecks: [] }, "PAIR_ACCEPTANCE_REQUIRED"],
    [{ acceptanceChecks: [" "] }, "PAIR_ACCEPTANCE_REQUIRED"],
    [{ verificationPlan: " " }, "PAIR_VERIFICATION_REQUIRED"],
    [{ stoppingCondition: " " }, "PAIR_STOPPING_CONDITION_REQUIRED"],
  ];

  it.each(invalidUnits)("rejects an incomplete or non-Pair proposal %j", (override, reason) => {
    expect(assessPairWorkUnit(pairWorkUnit(override), pairPolicyContext()))
      .toEqual({ admissible: false, reason });
  });

  it("does not change the unit, agreement, or capability facts", () => {
    const workUnit = pairWorkUnit();
    const context = pairPolicyContext();
    const before = JSON.stringify({ workUnit, context });
    Object.freeze(workUnit.allowedPaths);
    Object.freeze(workUnit.acceptanceChecks);
    Object.freeze(workUnit);
    Object.freeze(context.learningAgreement.humanOwnedCapabilities);
    Object.freeze(context.learningAgreement);
    Object.freeze(context);
    assessPairWorkUnit(workUnit, context);
    expect(JSON.stringify({ workUnit, context })).toBe(before);
  });
});
