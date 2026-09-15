export type Demonstration = "demonstrated" | "not-demonstrated" | "not-assessed";

export type NextAssistance = "less" | "unchanged" | "more" | "not-assessed";

export interface GrowthOutcomeInput {
  readonly productVerified: boolean;
  readonly similarGeneration: Demonstration;
  readonly variedDebugging: Demonstration;
  readonly explanation: Demonstration;
  readonly meaningfulAuthorship: Demonstration;
  readonly nextAssistance: NextAssistance;
}

export interface GrowthOutcome extends GrowthOutcomeInput {
  readonly product: "verified" | "unverified";
  readonly growth: "verified" | "unverified";
}

/**
 * Derive the independent product and growth verdicts from observed inputs.
 *
 * Product verification and Growth verification are strictly independent. The
 * product verdict comes only from an observed product result, never from model
 * prose. Growth is `verified` only when all four demonstration fields are
 * `demonstrated`; a skipped transfer check ("not-assessed") never becomes
 * success. The next-assistance value is a separate, correctable proposal and
 * does not influence either verdict.
 */
export const summarizeGrowth = (input: GrowthOutcomeInput): GrowthOutcome => {
  const demonstrations: readonly Demonstration[] = [
    input.similarGeneration,
    input.variedDebugging,
    input.explanation,
    input.meaningfulAuthorship,
  ];

  const growthVerified = demonstrations.every(
    (value) => value === "demonstrated",
  );

  return {
    productVerified: input.productVerified,
    similarGeneration: input.similarGeneration,
    variedDebugging: input.variedDebugging,
    explanation: input.explanation,
    meaningfulAuthorship: input.meaningfulAuthorship,
    nextAssistance: input.nextAssistance,
    product: input.productVerified ? "verified" : "unverified",
    growth: growthVerified ? "verified" : "unverified",
  };
};
