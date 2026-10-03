import { describe, expect, it } from "vitest";
import { summarizeGrowth, type GrowthOutcomeInput } from "../src/index.js";

const allDemonstrated: GrowthOutcomeInput = {
  productVerified: true,
  similarGeneration: "demonstrated",
  variedDebugging: "demonstrated",
  explanation: "demonstrated",
  meaningfulAuthorship: "demonstrated",
  nextAssistance: "less",
};

describe("Growth outcome", () => {
  it("verifies growth only when all four demonstration fields are demonstrated", () => {
    expect(summarizeGrowth(allDemonstrated)).toMatchObject({
      product: "verified",
      growth: "verified",
    });
  });

  it.each([
    "similarGeneration",
    "variedDebugging",
    "explanation",
    "meaningfulAuthorship",
  ] as const)("does not verify growth when %s is not assessed", field => {
    expect(
      summarizeGrowth({ ...allDemonstrated, [field]: "not-assessed" }).growth,
    ).toBe("unverified");
  });

  it("keeps product, growth, and the next-assistance proposal independent", () => {
    expect(
      summarizeGrowth({
        ...allDemonstrated,
        productVerified: false,
        nextAssistance: "more",
      }),
    ).toEqual({
      ...allDemonstrated,
      productVerified: false,
      nextAssistance: "more",
      product: "unverified",
      growth: "verified",
    });
  });
});
