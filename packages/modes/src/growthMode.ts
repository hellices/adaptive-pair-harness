import type { WorkUnit } from "@adaptive-pair/protocol";

export const validateGrowthWorkUnit = (workUnit: WorkUnit): void => {
  if (workUnit.mode !== "growth") {
    return;
  }

  if (workUnit.owner !== "human") {
    throw new Error("GROWTH_REQUIRES_HUMAN_OWNER");
  }

  if (workUnit.learningValue === "low") {
    throw new Error("GROWTH_REQUIRES_LEARNING_VALUE");
  }

  if (workUnit.acceptanceChecks.length === 0) {
    throw new Error("GROWTH_REQUIRES_CHECK");
  }
};
