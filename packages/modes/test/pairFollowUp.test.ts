import type { WorkUnit } from "@adaptive-pair/protocol";
import { describe, expect, it } from "vitest";
import {
  assessPairSuccessor,
  humanFollowUpFor,
  isPairHumanFollowUpSatisfied,
} from "../src/index.js";
import { pairWorkUnit } from "./pairFixtures.js";

const requirement = Object.freeze({
  sourceWorkUnitId: "ai-unit-1",
  capability: "implementation" as const,
});

describe("Pair human follow-up policy", () => {
  it.each(["high", "mixed"] as const)("describes a requirement for agreed %s-value AI work", learningValue => {
    expect(humanFollowUpFor(pairWorkUnit({
      id: "ai-unit-1", owner: "ai", status: "agreed", learningValue,
    }))).toEqual(requirement);
  });

  it("also retains the requirement after interrupted or failed accepted AI work", () => {
    for (const status of ["paused", "needs-reconcile", "cancelled", "failed"] as const) {
      expect(humanFollowUpFor(pairWorkUnit({
        id: "ai-unit-1", owner: "ai", status,
      }))).toEqual(requirement);
    }
  });

  it("does not create a requirement from a mere proposal, human unit, or mechanical work", () => {
    const units = [
      pairWorkUnit({ owner: "ai", status: "proposed" }),
      pairWorkUnit({ owner: "human", status: "completed" }),
      pairWorkUnit({ owner: "ai", learningValue: "low", status: "completed" }),
      pairWorkUnit({ owner: "ai", mode: "delivery", status: "completed" }),
    ];
    for (const workUnit of units) {
      expect(humanFollowUpFor(workUnit)).toBeUndefined();
    }
  });

  it("admits the first unit without fabricating a predecessor", () => {
    expect(assessPairSuccessor(pairWorkUnit(), undefined, undefined))
      .toEqual({ admissible: true });
  });

  it.each(["growth", "delivery"] as const)("does not admit a %s successor through Pair policy", mode => {
    expect(assessPairSuccessor(pairWorkUnit({ mode }), undefined, undefined))
      .toEqual({ admissible: false, reason: "PAIR_MODE_REQUIRED" });
  });

  it("does not treat an existing unit as a new successor proposal", () => {
    expect(assessPairSuccessor(pairWorkUnit({ status: "completed" }), undefined, undefined))
      .toEqual({ admissible: false, reason: "PAIR_PROPOSAL_REQUIRED" });
  });

  it("does not allow an AI or mechanical unit to bypass the outstanding human unit", () => {
    for (const workUnit of [
      pairWorkUnit({ owner: "ai" }),
      pairWorkUnit({ owner: "human", learningValue: "low" }),
      pairWorkUnit({ owner: "ai", learningValue: "low" }),
    ]) {
      expect(assessPairSuccessor(workUnit, requirement, "ai-unit-1"))
        .toEqual({ admissible: false, reason: "PAIR_HUMAN_FOLLOW_UP_REQUIRED" });
    }
  });

  it("requires an explicit relationship rather than guessing from the objective", () => {
    expect(assessPairSuccessor(pairWorkUnit(), requirement, undefined))
      .toEqual({ admissible: false, reason: "PAIR_RELATED_UNIT_REQUIRED" });
    expect(assessPairSuccessor(pairWorkUnit(), requirement, "other-ai-unit"))
      .toEqual({ admissible: false, reason: "PAIR_RELATED_UNIT_REQUIRED" });
  });

  it("requires a distinct human unit", () => {
    expect(assessPairSuccessor(
      pairWorkUnit({ id: "ai-unit-1" }), requirement, "ai-unit-1",
    )).toEqual({ admissible: false, reason: "PAIR_RELATED_UNIT_REQUIRED" });
  });

  it("allows explicitly related work in another capability category", () => {
    expect(assessPairSuccessor(
      pairWorkUnit({ capability: "repair" }), requirement, "ai-unit-1",
    )).toEqual({ admissible: true });
  });

  it("does not discharge the requirement at admission or from a failed check", () => {
    expect(isPairHumanFollowUpSatisfied(
      pairWorkUnit(), requirement, "ai-unit-1", "passed",
    )).toBe(false);
    expect(isPairHumanFollowUpSatisfied(
      pairWorkUnit({ status: "completed" }), requirement, "ai-unit-1", "failed",
    )).toBe(false);
    expect(isPairHumanFollowUpSatisfied(
      pairWorkUnit({ status: "completed" }), requirement, "ai-unit-1", "not-run",
    )).toBe(false);
  });

  it("recognizes a completed, observed, learning-relevant human successor", () => {
    expect(isPairHumanFollowUpSatisfied(
      pairWorkUnit({ status: "completed", capability: "repair" }),
      requirement,
      "ai-unit-1",
      "passed",
    )).toBe(true);
    expect(requirement.sourceWorkUnitId).toBe("ai-unit-1");
  });

  const nonSatisfying: readonly Partial<WorkUnit>[] = [
    { owner: "ai" },
    { learningValue: "low" },
    { mode: "growth" },
    { mode: "delivery" },
    { id: "ai-unit-1" },
  ];

  it.each(nonSatisfying)("does not count an invalid human successor %j", override => {
    expect(isPairHumanFollowUpSatisfied(
      pairWorkUnit({ status: "completed", ...override }),
      requirement,
      "ai-unit-1",
      "passed",
    )).toBe(false);
  });

  it("requires a real outstanding requirement and matching relationship", () => {
    expect(isPairHumanFollowUpSatisfied(
      pairWorkUnit({ status: "completed" }), undefined, "ai-unit-1", "passed",
    )).toBe(false);
    expect(isPairHumanFollowUpSatisfied(
      pairWorkUnit({ status: "completed" }), requirement, "other-unit", "passed",
    )).toBe(false);
  });

  it("does not change the proposed unit or requirement", () => {
    const workUnit = Object.freeze(pairWorkUnit());
    const before = JSON.stringify({ workUnit, requirement });
    assessPairSuccessor(workUnit, requirement, "ai-unit-1");
    expect(JSON.stringify({ workUnit, requirement })).toBe(before);
  });
});
