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
      readonly reason:
        | "HINT_LEVEL_EXCEEDED"
        | "RESPONSE_CLASS_EXCEEDED"
        | "TARGET_SOLUTION_WITHHELD";
    };

const MINIMUM_LEVEL_BY_KIND: Readonly<Record<GrowthResponse["kind"], HintLevel>> =
  Object.freeze({
    question: 0,
    hint: 2,
    pseudocode: 4,
    analogy: 4,
    "solution-preview": 5,
  });

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const containsTargetImplementation = (
  text: string,
  identifier: string,
): boolean => {
  const escaped = escapeRegExp(identifier);
  const targetName = `${escaped}[A-Za-z0-9_$]*`;

  return new RegExp(
    [
      `(?:function|class|interface|type|enum)\\s+${targetName}\\b`,
      `(?:const|let|var)\\s+${targetName}\\b`,
      `\\b${targetName}\\s*[:=]\\s*(?:async\\s*)?(?:\\(|function\\b)`,
      `\\b${targetName}\\s*\\(`,
      `\`\`\`[\\s\\S]*?\\b${targetName}\\b[\\s\\S]*?\`\`\``,
    ].join("|"),
    "u",
  ).test(text);
};

export const guardGrowthResponse = (
  response: GrowthResponse,
  context: {
    readonly authorizedHintLevel: HintLevel;
    readonly revealAuthorized: boolean;
    readonly targetIdentifiers: readonly string[];
  },
): GuardedResponse => {
  const minimumLevel = MINIMUM_LEVEL_BY_KIND[response.kind];
  if (response.level > context.authorizedHintLevel) {
    return {
      accepted: false,
      reason: "HINT_LEVEL_EXCEEDED",
    };
  }
  if (
    response.level < minimumLevel ||
    minimumLevel > context.authorizedHintLevel
  ) {
    return {
      accepted: false,
      reason: "RESPONSE_CLASS_EXCEEDED",
    };
  }

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
