import type { LearningAgreement, WorkUnit } from "@adaptive-pair/protocol";

export type PairEditCapability = "unavailable" | "verified";

export interface PairWorkUnitPolicyContext {
  readonly learningAgreement: LearningAgreement;
  readonly editCapability: PairEditCapability;
}

export type PairWorkUnitRejection =
  | "PAIR_MODE_REQUIRED"
  | "PAIR_PROPOSAL_REQUIRED"
  | "PAIR_WORK_UNIT_ID_REQUIRED"
  | "PAIR_OBJECTIVE_REQUIRED"
  | "PAIR_SCOPE_REQUIRED"
  | "PAIR_ACCEPTANCE_REQUIRED"
  | "PAIR_VERIFICATION_REQUIRED"
  | "PAIR_STOPPING_CONDITION_REQUIRED"
  | "PAIR_HUMAN_CAPABILITY_RESERVED"
  | "PAIR_EDIT_CAPABILITY_REQUIRED";

export type PairWorkUnitAssessment =
  | {
      readonly admissible: true;
      readonly navigator: "human" | "ai";
      readonly requiresHumanFollowUp: boolean;
    }
  | { readonly admissible: false; readonly reason: PairWorkUnitRejection };

export const assessPairWorkUnit = (
  workUnit: WorkUnit,
  context: PairWorkUnitPolicyContext,
): PairWorkUnitAssessment => {
  if (workUnit.mode !== "pair") {
    return { admissible: false, reason: "PAIR_MODE_REQUIRED" };
  }
  if (workUnit.status !== "proposed") {
    return { admissible: false, reason: "PAIR_PROPOSAL_REQUIRED" };
  }
  if (workUnit.id.trim() === "") {
    return { admissible: false, reason: "PAIR_WORK_UNIT_ID_REQUIRED" };
  }
  if (workUnit.objective.trim() === "") {
    return { admissible: false, reason: "PAIR_OBJECTIVE_REQUIRED" };
  }
  if (workUnit.allowedPaths.length === 0 ||
      workUnit.allowedPaths.some(path => path.trim() === "")) {
    return { admissible: false, reason: "PAIR_SCOPE_REQUIRED" };
  }
  if (workUnit.acceptanceChecks.length === 0 ||
      workUnit.acceptanceChecks.some(check => check.trim() === "")) {
    return { admissible: false, reason: "PAIR_ACCEPTANCE_REQUIRED" };
  }
  if (workUnit.verificationPlan.trim() === "") {
    return { admissible: false, reason: "PAIR_VERIFICATION_REQUIRED" };
  }
  if (workUnit.stoppingCondition.trim() === "") {
    return { admissible: false, reason: "PAIR_STOPPING_CONDITION_REQUIRED" };
  }
  if (workUnit.owner === "ai" &&
      context.learningAgreement.humanOwnedCapabilities.includes(workUnit.capability)) {
    return { admissible: false, reason: "PAIR_HUMAN_CAPABILITY_RESERVED" };
  }
  if (workUnit.owner === "ai" && context.editCapability !== "verified") {
    return { admissible: false, reason: "PAIR_EDIT_CAPABILITY_REQUIRED" };
  }
  return {
    admissible: true,
    navigator: workUnit.owner === "human" ? "ai" : "human",
    requiresHumanFollowUp: workUnit.owner === "ai" && workUnit.learningValue !== "low",
  };
};
