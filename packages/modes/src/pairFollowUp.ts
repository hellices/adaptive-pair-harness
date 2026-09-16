import type { CapabilityCategory, WorkUnit } from "@adaptive-pair/protocol";

export interface PairHumanFollowUp {
  readonly sourceWorkUnitId: string;
  readonly capability: CapabilityCategory;
}

export type PairSuccessorAssessment =
  | { readonly admissible: true }
  | {
      readonly admissible: false;
      readonly reason:
        | "PAIR_MODE_REQUIRED"
        | "PAIR_PROPOSAL_REQUIRED"
        | "PAIR_HUMAN_FOLLOW_UP_REQUIRED"
        | "PAIR_RELATED_UNIT_REQUIRED";
    };

export type PairObservedVerification = "passed" | "failed" | "not-run";

export const humanFollowUpFor = (
  workUnit: WorkUnit,
): PairHumanFollowUp | undefined => {
  if (workUnit.mode !== "pair" || workUnit.owner !== "ai" ||
      workUnit.learningValue === "low" || workUnit.status === "proposed") {
    return undefined;
  }
  return Object.freeze({
    sourceWorkUnitId: workUnit.id,
    capability: workUnit.capability,
  });
};

export const assessPairSuccessor = (
  workUnit: WorkUnit,
  requirement: PairHumanFollowUp | undefined,
  relatedToWorkUnitId: string | undefined,
): PairSuccessorAssessment => {
  if (workUnit.mode !== "pair") {
    return { admissible: false, reason: "PAIR_MODE_REQUIRED" };
  }
  if (workUnit.status !== "proposed") {
    return { admissible: false, reason: "PAIR_PROPOSAL_REQUIRED" };
  }
  if (requirement === undefined) {
    return { admissible: true };
  }
  if (workUnit.owner !== "human" || workUnit.learningValue === "low") {
    return { admissible: false, reason: "PAIR_HUMAN_FOLLOW_UP_REQUIRED" };
  }
  if (relatedToWorkUnitId !== requirement.sourceWorkUnitId ||
      workUnit.id === requirement.sourceWorkUnitId) {
    return { admissible: false, reason: "PAIR_RELATED_UNIT_REQUIRED" };
  }
  return { admissible: true };
};

export const isPairHumanFollowUpSatisfied = (
  workUnit: WorkUnit,
  requirement: PairHumanFollowUp | undefined,
  relatedToWorkUnitId: string | undefined,
  verification: PairObservedVerification,
): boolean =>
  requirement !== undefined &&
  workUnit.mode === "pair" &&
  workUnit.owner === "human" &&
  workUnit.learningValue !== "low" &&
  workUnit.status === "completed" &&
  workUnit.id !== requirement.sourceWorkUnitId &&
  relatedToWorkUnitId === requirement.sourceWorkUnitId &&
  verification === "passed";
