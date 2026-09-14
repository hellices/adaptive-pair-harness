import { describe, expect, it } from "vitest";
import { validateGrowthWorkUnit } from "../src/index.js";

const createGrowthWorkUnit = () => ({
  id: "wu-1",
  objective: "Implement retry state",
  mode: "growth" as const,
  learningValue: "high" as const,
  capability: "implementation" as const,
  owner: "human" as const,
  allowedPaths: ["src/retry.ts"],
  acceptanceChecks: ["retry test passes"],
  verificationPlan: "npm test",
  stoppingCondition: "one behavior is green",
  baseline: {},
  status: "proposed" as const,
});

describe("Growth Mode", () => {
  it("requires a human edit owner", () => {
    expect(() =>
      validateGrowthWorkUnit({
        ...createGrowthWorkUnit(),
        owner: "ai",
      }),
    ).toThrow("GROWTH_REQUIRES_HUMAN_OWNER");
  });

  it("requires meaningful learning value", () => {
    expect(() =>
      validateGrowthWorkUnit({
        ...createGrowthWorkUnit(),
        learningValue: "low",
      }),
    ).toThrow("GROWTH_REQUIRES_LEARNING_VALUE");
  });

  it("requires at least one acceptance check", () => {
    expect(() =>
      validateGrowthWorkUnit({
        ...createGrowthWorkUnit(),
        acceptanceChecks: [],
      }),
    ).toThrow("GROWTH_REQUIRES_CHECK");
  });

  it("does not change Pair or Delivery ownership rules", () => {
    expect(() =>
      validateGrowthWorkUnit({
        ...createGrowthWorkUnit(),
        mode: "pair",
        owner: "ai",
      }),
    ).not.toThrow();
  });
});
