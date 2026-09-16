import { createPairToolResult, type EffectResult } from "@adaptive-pair/runtime";
import { serializeGrowthToolResult } from "./toolResultText.js";

const MAXIMUM_NUMERIC_ENVELOPE = Object.freeze({
  runtimeRevision: -Number.MAX_VALUE,
  authorityEpoch: -Number.MAX_VALUE,
});

const fitsResultEnvelopes = (result: EffectResult, maximumCharacters: number): boolean => {
  const completed = createPairToolResult(MAXIMUM_NUMERIC_ENVELOPE, result);
  return JSON.stringify(result).length <= maximumCharacters &&
    JSON.stringify(completed).length <= maximumCharacters &&
    serializeGrowthToolResult(completed).length <= maximumCharacters;
};

const codePointPrefix = (text: string, length: number): string => {
  const before = text.charCodeAt(length - 1);
  const after = text.charCodeAt(length);
  const splitsPair = before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
  return text.slice(0, splitsPair ? length - 1 : length);
};

export const boundEffectResultText = (
  text: string,
  maximumCharacters: number,
  createResult: (text: string) => EffectResult,
): EffectResult => {
  const complete = createResult(text);
  if (fitsResultEnvelopes(complete, maximumCharacters)) {
    return complete;
  }
  let bounded = createResult("");
  let minimum = 0;
  let maximum = Math.min(text.length, maximumCharacters);
  while (minimum <= maximum) {
    const midpoint = Math.floor((minimum + maximum) / 2);
    const candidate = createResult(codePointPrefix(text, midpoint));
    if (fitsResultEnvelopes(candidate, maximumCharacters)) {
      bounded = candidate;
      minimum = midpoint + 1;
    } else {
      maximum = midpoint - 1;
    }
  }
  return bounded;
};
