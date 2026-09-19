import { durableJournalLimits, type DurableFact, type DurableJournal } from "@adaptive-pair/protocol";
import type { DurableStoreFailure } from "../src/durableStore.js";
import { failModel, modelKey } from "./durableStoreState.js";

const factFields: Readonly<Record<DurableFact["type"], readonly string[]>> = {
  PresenceRecorded: ["status"],
  SessionOpened: ["sessionKey"],
  SessionStatusRecorded: ["sessionKey", "status"],
  LearningBoundaryRecorded: ["sessionKey", "humanOwnedCapabilities", "maximumHintLevel"],
  ModeRecorded: ["sessionKey", "mode"],
  WorkUnitOpened: ["sessionKey", "workUnitKey", "mode", "owner", "learningValue", "capability"],
  WorkUnitStatusRecorded: ["sessionKey", "workUnitKey", "status"],
  AssistanceRecorded: ["sessionKey", "workUnitKey", "attempt", "hypothesis", "hintLevel", "solutionRevealed"],
  OperationOpened: ["sessionKey", "workUnitKey", "operationKey", "kind", "status"],
  OperationOutcomeRecorded: ["sessionKey", "operationKey", "status"],
};

const record = (value: unknown): object => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return failModel("INVALID_REQUEST");
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return failModel("INVALID_REQUEST");
  return value;
};

const fieldsMatch = (value: object, fields: readonly string[]): void => {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(key => typeof key !== "string" || !fields.includes(key))) {
    failModel("INVALID_REQUEST");
  }
};

const data = (value: object, field: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, "value")) return failModel("INVALID_REQUEST");
  return descriptor.value as unknown;
};

const primitive = (field: string, value: unknown): string | number | boolean | null => {
  if (field === "hintLevel" && value === null) return null;
  if (field === "solutionRevealed") return typeof value === "boolean" ? value : failModel("INVALID_REQUEST");
  if (field === "expectedSequence" || field === "maximumHintLevel" || field === "hintLevel") {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)
      ? value : failModel("INVALID_REQUEST");
  }
  if (typeof value !== "string" || value.length > 32 || (field.endsWith("Key") && !modelKey(value))) {
    return failModel("INVALID_REQUEST");
  }
  return value;
};

const array = (
  value: unknown, limit: number, copy: (element: unknown) => unknown, limitFailure: DurableStoreFailure = "LIMIT_EXCEEDED",
): readonly unknown[] => {
  if (!Array.isArray(value)) return failModel("INVALID_REQUEST");
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Array.prototype && prototype !== null) return failModel("INVALID_REQUEST");
  const length: unknown = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) return failModel("INVALID_REQUEST");
  if (length > limit) return failModel(limitFailure);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || keys.some(key => key !== "length" &&
      (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length))) return failModel("INVALID_REQUEST");
  return Object.freeze(Array.from({ length }, (_, index) => copy(data(value, String(index)))));
};

const copyFact = (value: unknown): object => {
  const source = record(value);
  const type = primitive("type", data(source, "type"));
  if (typeof type !== "string" || !Object.hasOwn(factFields, type)) return failModel("INVALID_REQUEST");
  const fields = ["type", ...factFields[type as DurableFact["type"]]];
  fieldsMatch(source, fields);
  return Object.freeze(Object.fromEntries(fields.map(field => {
    const payload = field === "type" ? type : data(source, field);
    return [field, field === "humanOwnedCapabilities"
      ? array(payload, 7, capability => primitive("capability", capability), "INVALID_REQUEST") : primitive(field, payload)];
  })));
};

const copyCommit = (value: unknown): object => {
  const source = record(value);
  fieldsMatch(source, ["commitKey", "expectedSequence", "commandKeys", "facts"]);
  return Object.freeze({
    commitKey: primitive("commitKey", data(source, "commitKey")),
    expectedSequence: primitive("expectedSequence", data(source, "expectedSequence")),
    commandKeys: array(data(source, "commandKeys"), durableJournalLimits.commandKeys, key => primitive("commandKey", key)),
    facts: array(data(source, "facts"), durableJournalLimits.facts, copyFact),
  });
};

interface EncodingBudget {
  nodes: number;
  codeUnits: number;
  bytes: number;
}

const charge = (budget: EncodingBudget, codeUnits: number, bytes = codeUnits): void => {
  budget.codeUnits += codeUnits;
  budget.bytes += bytes;
  if (budget.codeUnits > durableJournalLimits.textCodeUnits || budget.bytes > durableJournalLimits.encodedBytes) {
    failModel("LIMIT_EXCEEDED");
  }
};

const chargeString = (budget: EncodingBudget, value: string): void => {
  charge(budget, 2);
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character === '"' || character === "\\" || "\b\t\n\f\r".includes(character)) charge(budget, 2);
    else if (code < 0x20 || (character.length === 1 && code >= 0xd800 && code <= 0xdfff)) charge(budget, 6);
    else charge(budget, character.length, character.length === 2 ? 4 : code < 0x80 ? 1 : code < 0x800 ? 2 : 3);
  }
};

const chargeValue = (value: unknown, budget: EncodingBudget, depth: number): void => {
  budget.nodes += 1;
  if (depth > 7 || budget.nodes > 16 * durableJournalLimits.facts + durableJournalLimits.commandKeys + 32) {
    return failModel("LIMIT_EXCEEDED");
  }
  if (typeof value === "string") return chargeString(budget, value);
  if (value === null) return charge(budget, 4);
  if (typeof value === "number" || typeof value === "boolean") return charge(budget, String(value).length);
  if (Array.isArray(value)) {
    charge(budget, 2 + Math.max(0, value.length - 1));
    for (const element of value) chargeValue(element, budget, depth + 1);
    return;
  }
  if (typeof value !== "object") return failModel("INVALID_REQUEST");
  const entries = Object.entries(value);
  charge(budget, 2 + entries.length + Math.max(0, entries.length - 1));
  for (const [field, payload] of entries) {
    chargeString(budget, field);
    chargeValue(payload, budget, depth + 1);
  }
};

export const modelRequestText = (journal: DurableJournal, commit: unknown): string => {
  const copied = copyCommit(commit);
  const envelope = { ...journal, commits: [copied] };
  chargeValue(envelope, { nodes: 0, codeUnits: 0, bytes: 0 }, 1);
  return JSON.stringify(envelope);
};
