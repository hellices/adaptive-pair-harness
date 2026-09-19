import { durableJournalLimits, parseDurableJournal, type DurableJournal } from "@adaptive-pair/protocol";
import { replayDurableJournal } from "../src/durableReplay.js";
import type { DurableStoreFailure } from "../src/durableStore.js";

interface ControlBinding {
  readonly format: "adaptive-pair-durable";
  readonly version: 1;
  readonly namespaceKey: string;
  readonly generationKey: string;
  readonly retiredGenerationKeys: readonly string[];
}

export type ModelControl =
  | (ControlBinding & { readonly state: "present"; readonly headSequence: number; readonly payloadKey: number })
  | (ControlBinding & { readonly state: "erasing" | "erased" });

export interface ModelCopy {
  readonly copyKey: number;
  readonly namespaceKey: string;
  readonly generationKey: string;
  readonly kind: "payload" | "cache" | "staged";
  readonly text: string;
}

export interface ModelMedium {
  control: unknown;
  copies: ModelCopy[];
  nextCopyKey: number;
}

export type ModelView =
  | { readonly state: "empty" }
  | { readonly state: "erased"; readonly control: ModelControl }
  | { readonly state: "present"; readonly control: ModelControl; readonly journal: DurableJournal; readonly text: string };

export const modelMedium = (): ModelMedium => ({ control: null, copies: [], nextCopyKey: 1 });

const metadataCodeUnits = durableJournalLimits.commits * 35 + 1_536;
export const modelStorageLimits = Object.freeze({
  copies: 3,
  retainedCodeUnits: 3 * durableJournalLimits.textCodeUnits,
  retainedBytes: 3 * durableJournalLimits.encodedBytes,
  metadataCodeUnits,
  metadataBytes: metadataCodeUnits,
  serializedCodeUnits: 18 * durableJournalLimits.textCodeUnits + metadataCodeUnits,
  serializedBytes: 18 * durableJournalLimits.encodedBytes + metadataCodeUnits,
});

class ModelFailure extends Error {
  public constructor(readonly code: DurableStoreFailure) {
    super(code);
  }
}

export const failModel = (code: DurableStoreFailure): never => { throw new ModelFailure(code); };

export const modelFailureCode = (error: unknown): DurableStoreFailure => {
  if (error instanceof ModelFailure) return error.code;
  return error instanceof Error && /: (TEXT_LIMIT|BYTE_LIMIT|LIMIT_EXCEEDED)$/u.test(error.message)
    ? "LIMIT_EXCEEDED" : "INVALID_REQUEST";
};

export const modelKey = (value: unknown): value is string =>
  typeof value === "string" && value.length === 32 && /^[0-9a-f]{32}$/u.test(value);
const counter = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);

const fieldsMatch = (value: object, fields: readonly string[]): boolean => {
  const prototype: unknown = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) && Reflect.ownKeys(value).length === fields.length &&
    fields.every(field => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
    });
};

export const modelTextBytes = (text: string): number => {
  if (text.length > durableJournalLimits.textCodeUnits) return failModel("LIMIT_EXCEEDED");
  let bytes = 0;
  for (const character of text) {
    const code = character.charCodeAt(0);
    bytes += character.length === 2 ? 4 : code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
    if (bytes > durableJournalLimits.encodedBytes) return failModel("LIMIT_EXCEEDED");
  }
  return bytes;
};

const denseArray = (values: readonly unknown[]): boolean =>
  Reflect.ownKeys(values).length === values.length + 1 &&
  Array.from({ length: values.length }, (_, index) => Object.hasOwn(values, index)).every(Boolean);

export const readModelControl = (medium: ModelMedium, namespaceKey: string): ModelControl | null => {
  const raw = medium.control;
  if (raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return failModel("HEAD_CONFLICT");
  const record = raw as Record<string, unknown>;
  const fields = ["format", "version", "state", "namespaceKey", "generationKey", "retiredGenerationKeys"];
  if (record.state === "present") fields.push("headSequence", "payloadKey");
  const retired = record.retiredGenerationKeys;
  if (!fieldsMatch(record, fields) || record.format !== "adaptive-pair-durable" || record.version !== 1 ||
      !modelKey(record.namespaceKey) || !modelKey(record.generationKey) || !Array.isArray(retired)) return failModel("HEAD_CONFLICT");
  if (retired.length > durableJournalLimits.commits) return failModel("LIMIT_EXCEEDED");
  if (!denseArray(retired) || !retired.every(modelKey) || new Set<unknown>(retired).size !== retired.length ||
      retired.includes(record.generationKey) ||
      (record.state !== "present" && record.state !== "erasing" && record.state !== "erased") ||
      (record.state === "present" && (!counter(record.headSequence) || !counter(record.payloadKey) || record.payloadKey === 0))) {
    return failModel("HEAD_CONFLICT");
  }
  if (record.namespaceKey !== namespaceKey) return failModel("BINDING_MISMATCH");
  return record as unknown as ModelControl;
};

export const hasOwnedCopies = (medium: ModelMedium, namespaceKey: string): boolean =>
  medium.copies.some(copy => copy.namespaceKey === namespaceKey);

export const validateModelMetadata = (medium: ModelMedium): void => {
  if (!fieldsMatch(medium, ["control", "copies", "nextCopyKey"]) || !Array.isArray(medium.copies) ||
      !counter(medium.nextCopyKey) || medium.nextCopyKey === 0) {
    return failModel("HEAD_CONFLICT");
  }
};

const validateCopies = (medium: ModelMedium, namespaceKey: string): void => {
  validateModelMetadata(medium);
  if (medium.copies.length > modelStorageLimits.copies) return failModel("LIMIT_EXCEEDED");
  if (!denseArray(medium.copies)) return failModel("HEAD_CONFLICT");
  const seen = new Set<number>();
  const kinds = new Set<string>();
  let codeUnits = 0;
  let bytes = 0;
  for (const copy of medium.copies) {
    if (typeof copy !== "object" || copy === null ||
        !fieldsMatch(copy, ["copyKey", "namespaceKey", "generationKey", "kind", "text"])) return failModel("HEAD_CONFLICT");
    if (copy.namespaceKey !== namespaceKey) return failModel("BINDING_MISMATCH");
    if (!counter(copy.copyKey) || copy.copyKey === 0 || copy.copyKey >= medium.nextCopyKey || seen.has(copy.copyKey) ||
        !modelKey(copy.generationKey) || typeof copy.text !== "string" || kinds.has(copy.kind) ||
        (copy.kind !== "payload" && copy.kind !== "cache" && copy.kind !== "staged")) return failModel("HEAD_CONFLICT");
    codeUnits += copy.text.length;
    bytes += modelTextBytes(copy.text);
    if (codeUnits > modelStorageLimits.retainedCodeUnits || bytes > modelStorageLimits.retainedBytes) return failModel("LIMIT_EXCEEDED");
    seen.add(copy.copyKey);
    kinds.add(copy.kind);
  }
};

export const inspectModel = (medium: ModelMedium, namespaceKey: string): ModelView => {
  const control = readModelControl(medium, namespaceKey);
  if (control?.state === "erasing" || (control?.state === "erased" && hasOwnedCopies(medium, namespaceKey))) {
    return failModel("ERASURE_PENDING");
  }
  validateCopies(medium, namespaceKey);
  if (control === null) {
    if (medium.copies.length !== 0) return failModel("HEAD_CONFLICT");
    return { state: "empty" };
  }
  if (control.state === "erased") return { state: "erased", control };
  if (control.state !== "present") return failModel("ERASURE_PENDING");
  const payloads = medium.copies.filter(copy => copy.kind === "payload");
  const payload = payloads[0];
  if (payloads.length !== 1 || payload?.copyKey !== control.payloadKey ||
      payload.generationKey !== control.generationKey) return failModel("HEAD_CONFLICT");
  let journal: DurableJournal;
  try {
    journal = parseDurableJournal(payload.text);
    replayDurableJournal(journal);
  } catch {
    return failModel("HEAD_CONFLICT");
  }
  if (journal.namespaceKey !== namespaceKey) return failModel("BINDING_MISMATCH");
  if (journal.generationKey !== control.generationKey || journal.headSequence !== control.headSequence) {
    return failModel("HEAD_CONFLICT");
  }
  return { state: "present", control, journal, text: payload.text };
};
