import type { HintLevel } from "./hintPolicy.js";

export interface GrowthResponse {
  readonly level: HintLevel;
  readonly kind:
    | "question"
    | "hint"
    | "pseudocode"
    | "analogy"
    | "solution-preview";
  readonly text: string;
}

export type GuardedResponse =
  | {
      readonly accepted: true;
      readonly response: GrowthResponse;
    }
  | {
      readonly accepted: false;
      readonly reason: "TARGET_SOLUTION_WITHHELD";
    };

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const containsTargetImplementation = (
  text: string,
  identifier: string,
): boolean => {
  const escaped = escapeRegExp(identifier);

  return new RegExp(
    [
      `(?:function|class|interface|type|enum)\\s+${escaped}\\b`,
      `(?:const|let|var)\\s+${escaped}\\b`,
      `\\b${escaped}\\s*[:=]\\s*(?:async\\s*)?(?:\\(|function\\b)`,
      `\\b${escaped}\\s*\\(`,
      `\`\`\`[\\s\\S]*?\\b${escaped}\\b[\\s\\S]*?\`\`\``,
    ].join("|"),
    "u",
  ).test(text);
};

export const guardGrowthResponse = (
  response: GrowthResponse,
  context: {
    readonly revealAuthorized: boolean;
    readonly targetIdentifiers: readonly string[];
  },
): GuardedResponse => {
  if (response.level === 5 && !context.revealAuthorized) {
    return {
      accepted: false,
      reason: "TARGET_SOLUTION_WITHHELD",
    };
  }

  const targetSolution =
    /```(?:diff|patch)/iu.test(response.text) ||
    context.targetIdentifiers.some(identifier =>
      identifier.length > 0 && containsTargetImplementation(response.text, identifier)
    );

  if (response.level < 5 && targetSolution) {
    return {
      accepted: false,
      reason: "TARGET_SOLUTION_WITHHELD",
    };
  }

  return {
    accepted: true,
    response: Object.freeze({ ...response }),
  };
};
