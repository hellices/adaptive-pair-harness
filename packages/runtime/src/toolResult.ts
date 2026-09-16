import type { EffectResult, PairToolResult } from "./ports.js";

const EMPTY_OBSERVATION = Object.freeze({}) as Readonly<Record<string, unknown>>;

export const createPairToolResult = (
  boundary: Pick<PairToolResult, "runtimeRevision" | "authorityEpoch">,
  result: EffectResult,
): PairToolResult => Object.freeze({
  operationId: result.operationId,
  runtimeRevision: boundary.runtimeRevision,
  authorityEpoch: boundary.authorityEpoch,
  status: result.status,
  summary: result.summary,
  observation: result.observation ?? EMPTY_OBSERVATION,
  sensitiveData: result.sensitiveData,
  partial: result.partial,
});
