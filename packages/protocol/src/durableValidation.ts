import type { DurableFact } from "./durableTypes.js";

type Rule = (value: unknown) => boolean;

export const failDurableJournal = (code: string): never => {
  throw new Error(`Invalid Pair durable journal: ${code}`);
};

export const hasDurableFields = (
  value: unknown,
  fields: readonly string[],
): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));

export const isDurableCounter = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);

export const isDurableKey = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{32}$/u.test(value);

const oneOf = (choices: readonly string[]): Rule =>
  value => typeof value === "string" && choices.includes(value);

const mode = oneOf(["growth", "pair", "delivery"]);
const capability = oneOf([
  "problem-framing", "design", "test", "implementation", "diagnosis", "repair", "verification",
]);
const hint = (value: unknown): boolean => isDurableCounter(value) && value <= 5;
const attempt = oneOf(["none", "recorded", "bypassed"]);

const rules: Readonly<Record<DurableFact["type"], Readonly<Record<string, Rule>>>> = {
  PresenceRecorded: { status: oneOf(["observing", "engaged", "quiet", "paused"]) },
  SessionOpened: { sessionKey: isDurableKey },
  SessionStatusRecorded: {
    sessionKey: isDurableKey,
    status: oneOf(["briefing", "ready", "active", "paused", "reconciling", "closing", "closed"]),
  },
  LearningBoundaryRecorded: {
    sessionKey: isDurableKey,
    humanOwnedCapabilities: value => Array.isArray(value) && value.length <= 7 &&
      value.every(capability) && new Set<unknown>(value).size === value.length,
    maximumHintLevel: hint,
  },
  ModeRecorded: { sessionKey: isDurableKey, mode },
  WorkUnitOpened: {
    sessionKey: isDurableKey, workUnitKey: isDurableKey, mode,
    owner: oneOf(["human", "ai"]), learningValue: oneOf(["high", "mixed", "low"]), capability,
  },
  WorkUnitStatusRecorded: {
    sessionKey: isDurableKey, workUnitKey: isDurableKey,
    status: oneOf([
      "proposed", "agreed", "executing", "verifying", "completed", "paused", "needs-reconcile", "cancelled", "failed",
    ]),
  },
  AssistanceRecorded: {
    sessionKey: isDurableKey, workUnitKey: isDurableKey, attempt, hypothesis: attempt,
    hintLevel: value => value === null || hint(value),
    solutionRevealed: value => typeof value === "boolean",
  },
  OperationOpened: {
    sessionKey: isDurableKey, workUnitKey: isDurableKey, operationKey: isDurableKey,
    kind: oneOf(["read", "edit", "check"]), status: oneOf(["planned", "authorized", "started"]),
  },
  OperationOutcomeRecorded: {
    sessionKey: isDurableKey, operationKey: isDurableKey,
    status: oneOf(["confirmed", "failed", "declined", "cancelled", "unknown"]),
  },
};

export const readDurableFact = (value: unknown): DurableFact => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return failDurableJournal("INVALID_FACT");
  const record = value as Record<string, unknown>;
  if (typeof record.type !== "string" || !Object.hasOwn(rules, record.type)) return failDurableJournal("INVALID_FACT");
  const fieldRules = rules[record.type as DurableFact["type"]];
  const fields = Object.keys(fieldRules);
  if (!hasDurableFields(record, ["type", ...fields]) ||
      !fields.every(field => fieldRules[field]?.(record[field]))) {
    return failDurableJournal("INVALID_FACT");
  }
  return Object.freeze(Object.fromEntries([
    ["type", record.type],
    ...fields.map(field => {
      const payload: unknown = record[field];
      if (!Array.isArray(payload)) return [field, payload];
      const values: readonly unknown[] = payload;
      return [field, Object.freeze([...values])];
    }),
  ])) as DurableFact;
};
