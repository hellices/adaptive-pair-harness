import { Ajv } from "ajv";
import type { PairEvent } from "./events.js";
import { pairEventSchema } from "./eventSchemas.js";
import { immutableJsonSnapshot } from "./jsonSnapshot.js";
import { jsonValidationSnapshot } from "./jsonValidation.js";
import type { OperationRecord } from "./types.js";

type WireOperation = Omit<OperationRecord, "summary" | "userActionGrantId"> & {
  readonly summary?: string;
  readonly userActionGrantId?: string;
};

type WirePairEvent =
  | Exclude<PairEvent, { type: "UserActionGranted" | "OperationAuthorized" }>
  | (Omit<Extract<PairEvent, { type: "UserActionGranted" }>, "authorityEpoch"> & {
      readonly authorityEpoch?: number;
    })
  | (Omit<Extract<PairEvent, { type: "OperationAuthorized" }>, "operation"> & {
      readonly operation: WireOperation;
    });

const ajv = new Ajv({ allErrors: true, strict: true, ownProperties: true });
const validatePairEvent = ajv.compile<WirePairEvent>(pairEventSchema);

const toMemoryEvent = (event: WirePairEvent): PairEvent => {
  if (event.type === "UserActionGranted") {
    return { ...event, authorityEpoch: event.authorityEpoch };
  }
  if (event.type === "OperationAuthorized") {
    return {
      ...event,
      operation: {
        ...event.operation,
        summary: event.operation.summary,
        userActionGrantId: event.operation.userActionGrantId,
      },
    };
  }
  return event;
};

export const parsePairEvent = (value: unknown): PairEvent => {
  const snapshot = jsonValidationSnapshot(value, "event", { maximumDepth: 64, maximumNodes: 10_000 });
  if (!validatePairEvent(snapshot)) {
    const detail = ajv.errorsText(validatePairEvent.errors, { separator: "; " });
    throw new Error(`Invalid Pair event: ${detail}`);
  }
  return immutableJsonSnapshot(toMemoryEvent(snapshot));
};
