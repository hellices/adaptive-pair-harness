import { describe, expect, it } from "vitest";
import { summarizeGrowth } from "../src/index.js";

describe("Growth outcome", () => {
  it("does not turn skipped transfer into success", () => {
    expect(
      summarizeGrowth({
        productVerified: true,
        similarGeneration: "not-assessed",
        variedDebugging: "not-assessed",
        explanation: "demonstrated",
        meaningfulAuthorship: "demonstrated",
        nextAssistance: "unchanged",
      }),
    ).toMatchObject({
      product: "verified",
      growth: "unverified",
    });
  });

  it("verifies growth only when all four demonstration fields are demonstrated", () => {
    expect(
      summarizeGrowth({
        productVerified: true,
        similarGeneration: "demonstrated",
        variedDebugging: "demonstrated",
        explanation: "demonstrated",
        meaningfulAuthorship: "demonstrated",
        nextAssistance: "less",
      }),
    ).toMatchObject({ product: "verified", growth: "verified" });
  });

  it("keeps growth unverified when a single demonstration is missing", () => {
    expect(
      summarizeGrowth({
        productVerified: true,
        similarGeneration: "demonstrated",
        variedDebugging: "not-demonstrated",
        explanation: "demonstrated",
        meaningfulAuthorship: "demonstrated",
        nextAssistance: "unchanged",
      }).growth,
    ).toBe("unverified");
  });

  it("keeps product and growth independent when the product is unverified", () => {
    const outcome = summarizeGrowth({
      productVerified: false,
      similarGeneration: "demonstrated",
      variedDebugging: "demonstrated",
      explanation: "demonstrated",
      meaningfulAuthorship: "demonstrated",
      nextAssistance: "less",
    });
    expect(outcome.product).toBe("unverified");
    expect(outcome.growth).toBe("verified");
  });

  it("preserves the next-assistance proposal as a separate field", () => {
    expect(
      summarizeGrowth({
        productVerified: false,
        similarGeneration: "not-assessed",
        variedDebugging: "not-assessed",
        explanation: "not-assessed",
        meaningfulAuthorship: "not-assessed",
        nextAssistance: "more",
      }).nextAssistance,
    ).toBe("more");
  });
});
