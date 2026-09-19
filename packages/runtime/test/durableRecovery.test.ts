import fc from "fast-check";
import type { DurableFact } from "@adaptive-pair/protocol";
import { expect, expectTypeOf, it, vi } from "vitest";
import { inspectDurableJournal, type DurableRecoveryAssessment } from "../src/index.js";
import * as runtime from "../src/index.js";
import type {
  DurableEraseResult as PublicDurableEraseResult, DurableReadResult as PublicDurableReadResult,
  DurableReceipt as PublicDurableReceipt, DurableStore as PublicDurableStore,
  DurableStoreFailure as PublicDurableStoreFailure, DurableWriteResult as PublicDurableWriteResult,
} from "../src/index.js";
import type {
  DurableEraseResult, DurableReadResult, DurableReceipt, DurableStore, DurableStoreFailure, DurableWriteResult,
} from "../src/durableStore.js";
import {
  durableBaseFacts, durableExpectation, durableHistory, durableKey, durableWire, emptyDurableText,
  operationKey, operationOpened, sessionKey, workUnitKey, workUnitOpened,
} from "./durableFixtures.js";

const validText = () => JSON.stringify(durableHistory(durableBaseFacts));
const reviewRequired = (report: DurableRecoveryAssessment) => {
  expect(report.status).toBe("review-required");
  if (report.status !== "review-required") throw new Error("expected historical review");
  return report;
};

const denied = (status: string) => ({ status, authorityRestored: false, automaticReplayAllowed: false });

it("never turns successful empty replay into admission", () => {
  const report = inspectDurableJournal(emptyDurableText(), durableExpectation);
  expect(report.authorityRestored).toBe(false);
  expect(report.automaticReplayAllowed).toBe(false);
  expect(report.status).toBe("review-required");
});

it("preserves literal false types and unchanged P2a entry points", () => {
  const report = inspectDurableJournal(emptyDurableText(), durableExpectation);
  const authority: false = report.authorityRestored;
  const replay: false = report.automaticReplayAllowed;
  expect([authority, replay]).toEqual([false, false]);
  expect(runtime.inspectPairJournal).toBeTypeOf("function");
  expect(runtime.InMemoryJournal).toBeTypeOf("function");
  expect(runtime.PairCoordinator).toBeTypeOf("function");
  expect(Object.keys(runtime)).not.toContain("replayDurableJournal");
  expect(Object.keys(runtime)).not.toContain("createDurableSnapshot");
});

it("exports the storage contract as types without a production store", () => {
  expectTypeOf<PublicDurableStore>().toEqualTypeOf<DurableStore>();
  expectTypeOf<PublicDurableReceipt>().toEqualTypeOf<DurableReceipt>();
  expectTypeOf<PublicDurableWriteResult>().toEqualTypeOf<DurableWriteResult>();
  expectTypeOf<PublicDurableStoreFailure>().toEqualTypeOf<DurableStoreFailure>();
  expectTypeOf<PublicDurableReadResult>().toEqualTypeOf<DurableReadResult>();
  expectTypeOf<PublicDurableEraseResult>().toEqualTypeOf<DurableEraseResult>();
  expect(Object.keys(runtime)).not.toContain("DurableStore");
  expect(Object.keys(runtime)).not.toContain("DurableStoreModel");
});

it.each([
  undefined, null, [], "private", {}, { ...durableExpectation, namespaceKey: "PRIVATE_CANARY" },
  { ...durableExpectation, generationKey: "A".repeat(32) }, { ...durableExpectation, extra: true },
  { namespaceKey: durableExpectation.namespaceKey, generationKey: durableExpectation.generationKey },
  { ...durableExpectation, [Symbol("private")]: true },
])("rejects invalid trusted expectations without exposing their fields %#", expectation => {
  expect(inspectDurableJournal(validText(), expectation)).toEqual({
    ...denied("blocked"), reason: "INVALID_EXPECTATION",
  });
});

it("does not invoke expectation getters or expose proxy failures", () => {
  const getter = vi.fn(() => { throw new Error("PRIVATE_CANARY"); });
  const expectation = { ...durableExpectation };
  Object.defineProperty(expectation, "namespaceKey", { get: getter });
  expect(inspectDurableJournal(validText(), expectation)).toEqual({ ...denied("blocked"), reason: "INVALID_EXPECTATION" });
  expect(getter).not.toHaveBeenCalled();
  const proxy = new Proxy({}, { ownKeys: () => { throw new Error("PRIVATE_CANARY"); } });
  expect(inspectDurableJournal(validText(), proxy)).toEqual({ ...denied("blocked"), reason: "INVALID_EXPECTATION" });
});

it("validates the binding before parsing any supplied text", () => {
  const parse = vi.spyOn(JSON, "parse");
  try {
    const report = inspectDurableJournal("PRIVATE_CANARY", null);
    expect(report).toEqual({ ...denied("blocked"), reason: "INVALID_EXPECTATION" });
    expect(parse).not.toHaveBeenCalled();
  } finally { parse.mockRestore(); }
});

it.each([NaN, Infinity, -Infinity, -1, -0, 0.5, Number.MAX_SAFE_INTEGER + 1, "150", null])(
  "rejects an unsafe current time %#", now => {
    expect(inspectDurableJournal(validText(), { ...durableExpectation, now }))
      .toEqual({ ...denied("blocked"), reason: "INVALID_TIME" });
  },
);

it.each(["namespaceKey", "generationKey"] as const)("requires the trusted %s, not only file self-description", field => {
  expect(inspectDurableJournal(validText(), { ...durableExpectation, [field]: durableKey(999) }))
    .toEqual({ ...denied("blocked"), reason: field === "namespaceKey" ? "NAMESPACE_MISMATCH" : "GENERATION_MISMATCH" });
});

it.each([0, 99])("blocks backward clock values before creation (%s)", now => {
  expect(inspectDurableJournal(validText(), { ...durableExpectation, now }))
    .toEqual({ ...denied("blocked"), reason: "INVALID_TIME" });
});

it.each([100, 150, 199])("accepts nonexpired history at %s without admitting it", now => {
  expect(reviewRequired(inspectDurableJournal(validText(), { ...durableExpectation, now })).snapshot.headSequence).toBe(10);
});

it.each([200, 201, Number.MAX_SAFE_INTEGER])("erases logically expired history at %s without settling effects", now => {
  const report = inspectDurableJournal(validText(), { ...durableExpectation, now });
  expect(report).toEqual({ ...denied("expired"), erasureRequired: true, effectStatusUnavailable: true });
  expect(Object.isFrozen(report)).toBe(true);
  expect(Object.keys(report)).not.toContain("snapshot");
  expect(Object.keys(report)).not.toContain("cacheText");
  expect(Object.keys(report)).not.toContain("unsettledOperations");
});

it("honors shortened lifetimes and the exact seven-day ceiling", () => {
  for (const lifetime of [1, 604_800_000]) {
    const journal = { ...durableHistory(durableBaseFacts), expiresAt: 100 + lifetime };
    const text = JSON.stringify(journal);
    expect(inspectDurableJournal(text, { ...durableExpectation, now: journal.expiresAt - 1 }).status).toBe("review-required");
    expect(inspectDurableJournal(text, { ...durableExpectation, now: journal.expiresAt }).status).toBe("expired");
  }
});

it("rejects unsupported versions without guessing an upgrade", () => {
  const text = JSON.stringify({ ...durableWire(), version: 2 });
  expect(inspectDurableJournal(text, durableExpectation)).toEqual({ ...denied("blocked"), reason: "UNSUPPORTED_VERSION" });
});

it.each([undefined, null, "{", "PRIVATE_CANARY", "{}", "[]", '"private"', { toString: () => "PRIVATE_CANARY" }])(
  "rejects missing and malformed journals with no raw errors %#", text => {
    expect(inspectDurableJournal(text, durableExpectation)).toEqual({ ...denied("blocked"), reason: "INVALID_JOURNAL" });
  },
);

it("does not accept P2a histories as durable exports", () => {
  const text = JSON.stringify({ formatVersion: 1, streamId: "private", initialWorkspaceId: "private", headRevision: 0, commits: [] });
  expect(inspectDurableJournal(text, durableExpectation)).toEqual({ ...denied("blocked"), reason: "INVALID_JOURNAL" });
});

it("requires full valid replay even if the framing is expired or a good cache exists", () => {
  const previous = reviewRequired(inspectDurableJournal(validText(), durableExpectation));
  const invalid = JSON.stringify(durableHistory(durableBaseFacts, [operationOpened()]));
  for (const now of [150, 200]) {
    expect(inspectDurableJournal(invalid, { ...durableExpectation, now }, previous.cacheText))
      .toEqual({ ...denied("blocked"), reason: "INVALID_JOURNAL" });
  }
  expect(inspectDurableJournal(undefined, durableExpectation, previous.cacheText))
    .toEqual({ ...denied("blocked"), reason: "INVALID_JOURNAL" });
});

it("reports all pending phases and unknown across closed session lifetimes", () => {
  const facts: DurableFact[] = [{ type: "SessionOpened", sessionKey }, workUnitOpened()];
  const statuses = ["planned", "authorized", "started", "unknown", "confirmed", "failed", "declined", "cancelled"] as const;
  for (const [index, status] of statuses.entries()) {
    const key = durableKey(20 + index);
    const pending = status === "planned" || status === "authorized" || status === "started";
    facts.push({ type: "OperationOpened", sessionKey, workUnitKey, operationKey: key, kind: "check", status: pending ? status : "authorized" });
    if (!pending) facts.push({ type: "OperationOutcomeRecorded", sessionKey, operationKey: key, status });
  }
  facts.push(
    { type: "SessionStatusRecorded", sessionKey, status: "closed" },
    { type: "SessionOpened", sessionKey: durableKey(9) },
    workUnitOpened(durableKey(10), durableKey(9)), operationOpened(operationKey, durableKey(9), durableKey(10)),
  );
  const report = reviewRequired(inspectDurableJournal(JSON.stringify(durableHistory(facts)), durableExpectation));
  expect(report.unsettledOperations.map(operation => operation.status)).toEqual(["planned", "authorized", "started", "unknown", "started"]);
  expect(report.unsettledOperations.slice(0, 4).every(operation => operation.sessionKey === sessionKey)).toBe(true);
  expect(report.unsettledOperations[4]?.sessionKey).toBe(durableKey(9));
  expect(report.snapshot.state.sessions[0]?.status).toBe("closed");
});

it("only matches canonical cache text and rebuilds discarded caches from the valid full log", () => {
  const first = reviewRequired(inspectDurableJournal(validText(), durableExpectation));
  expect(first.cacheDisposition).toBe("absent");
  expect(first.cacheText).toBe(JSON.stringify(first.snapshot));
  const matched = reviewRequired(inspectDurableJournal(validText(), durableExpectation, first.cacheText));
  expect(matched.cacheDisposition).toBe("matched");
  const canary = vi.fn(() => { throw new Error("PRIVATE_CANARY"); });
  for (const cache of [null, { toString: canary }, "PRIVATE_CANARY", ` ${first.cacheText}`,
    JSON.stringify({ ...first.snapshot, extra: "PRIVATE_CANARY" }),
    JSON.stringify({ ...first.snapshot, headSequence: 0 }),
  ]) {
    const rebuilt = reviewRequired(inspectDurableJournal(validText(), durableExpectation, cache));
    expect(rebuilt.cacheDisposition).toBe("discarded");
    expect(rebuilt.cacheText).toBe(first.cacheText);
  }
  expect(canary).not.toHaveBeenCalled();
});

it("returns deeply frozen detached reports with no live authority fields", () => {
  const report = reviewRequired(inspectDurableJournal(validText(), durableExpectation));
  expect(report.unsettledOperations).toHaveLength(1);
  for (const value of [report, report.snapshot, report.snapshot.state, report.snapshot.state.sessions,
    report.snapshot.state.sessions[0], report.unsettledOperations, report.unsettledOperations[0]]) {
    expect(Object.isFrozen(value)).toBe(true);
  }
  for (const field of ["workspaceId", "protocolVersion", "authorityEpoch", "userActionGrants", "entrySnapshot", "input", "summary"]) {
    expect(JSON.stringify(report)).not.toContain(`"${field}"`);
  }
  const again = reviewRequired(inspectDurableJournal(validText(), durableExpectation));
  expect(again).toEqual(report);
  expect(again.snapshot.state).not.toBe(report.snapshot.state);
});

it("isolates failures and sensitive canaries across arbitrary interleaved calls", () => {
  const expected = inspectDurableJournal(validText(), durableExpectation);
  fc.assert(fc.property(fc.jsonValue(), value => {
    const invalid = JSON.stringify({ ...durableWire(), private: ["PRIVATE_CANARY", value] });
    expect(inspectDurableJournal(invalid, durableExpectation)).toEqual({ ...denied("blocked"), reason: "INVALID_JOURNAL" });
    expect(inspectDurableJournal(validText(), durableExpectation)).toEqual(expected);
  }), { numRuns: 100 });
});
