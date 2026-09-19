import { parseDurableJournal } from "@adaptive-pair/protocol";
import { classifyDurableCache, createDurableSnapshot } from "./durableSnapshot.js";
import type {
  DurableRecoveryAssessment, DurableRecoveryBlock, DurableRecoveryExpectation, UnsettledDurableOperation,
} from "./durableRecoveryTypes.js";

const readExpectation = (value: unknown): DurableRecoveryExpectation | "INVALID_EXPECTATION" | "INVALID_TIME" => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return "INVALID_EXPECTATION";
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return "INVALID_EXPECTATION";
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== 3 ||
        !["namespaceKey", "generationKey", "now"].every(field =>
          Object.hasOwn(descriptors, field) && Object.hasOwn(descriptors[field]!, "value"))) return "INVALID_EXPECTATION";
    const namespaceKey: unknown = descriptors.namespaceKey?.value;
    const generationKey: unknown = descriptors.generationKey?.value;
    const now: unknown = descriptors.now?.value;
    if (typeof namespaceKey !== "string" || !/^[0-9a-f]{32}$/u.test(namespaceKey) ||
        typeof generationKey !== "string" || !/^[0-9a-f]{32}$/u.test(generationKey)) return "INVALID_EXPECTATION";
    if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0 || Object.is(now, -0)) return "INVALID_TIME";
    return Object.freeze({ namespaceKey, generationKey, now });
  } catch {
    return "INVALID_EXPECTATION";
  }
};

const blocked = (reason: DurableRecoveryBlock): DurableRecoveryAssessment => Object.freeze({
  status: "blocked", reason, authorityRestored: false, automaticReplayAllowed: false,
});

export const inspectDurableJournal = (
  text: unknown, expectation: unknown, cacheText?: unknown,
): DurableRecoveryAssessment => {
  const expected = readExpectation(expectation);
  if (typeof expected === "string") return blocked(expected);
  try {
    const journal = parseDurableJournal(text);
    if (journal.namespaceKey !== expected.namespaceKey) return blocked("NAMESPACE_MISMATCH");
    if (journal.generationKey !== expected.generationKey) return blocked("GENERATION_MISMATCH");
    if (expected.now < journal.createdAt) return blocked("INVALID_TIME");
    const snapshot = createDurableSnapshot(journal);
    if (expected.now >= journal.expiresAt) return Object.freeze({
      status: "expired", erasureRequired: true, effectStatusUnavailable: true,
      authorityRestored: false, automaticReplayAllowed: false,
    });
    const unsettledOperations = snapshot.state.sessions.flatMap(session => session.operations)
      .filter((operation): operation is UnsettledDurableOperation =>
        operation.status === "planned" || operation.status === "authorized" ||
        operation.status === "started" || operation.status === "unknown");
    return Object.freeze({
      status: "review-required", snapshot, cacheText: JSON.stringify(snapshot),
      cacheDisposition: classifyDurableCache(cacheText, snapshot),
      unsettledOperations: Object.freeze(unsettledOperations),
      authorityRestored: false, automaticReplayAllowed: false,
    });
  } catch (error) {
    return blocked(error instanceof Error && error.message === "Invalid Pair durable journal: UNSUPPORTED_VERSION"
      ? "UNSUPPORTED_VERSION" : "INVALID_JOURNAL");
  }
};
