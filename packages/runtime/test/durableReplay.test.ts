import { parseDurableJournal, type DurableFact, type DurableJournal } from "@adaptive-pair/protocol";
import { expect, it } from "vitest";
import { replayDurableJournal } from "../src/durableReplay.js";
import { classifyDurableCache, createDurableSnapshot } from "../src/durableSnapshot.js";
import * as runtime from "../src/index.js";
import {
  durableBaseFacts, durableCommit, durableHistory, durableKey, durableWire,
  generationKey, namespaceKey, operationKey, operationOpened, sessionKey,
  workUnitKey, workUnitOpened,
} from "./durableFixtures.js";

const replay = (wire: DurableJournal) => replayDurableJournal(parseDurableJournal(JSON.stringify(wire)));
const fail = (code: string): Error => new Error(`Invalid Pair durable journal: ${code}`);
const closed: DurableFact = { type: "SessionStatusRecorded", sessionKey, status: "closed" };
const nextSessionKey = durableKey(6);

it("replays only the minimized revision-zero state", () => {
  expect(replayDurableJournal(durableHistory())).toEqual({
    headSequence: 0, presence: "off", sessions: [],
  });
});

it("keeps replay and snapshot construction out of the public runtime API", () => {
  expect(Object.keys(runtime)).not.toContain("replayDurableJournal");
  expect(Object.keys(runtime)).not.toContain("createDurableSnapshot");
});

it("replays every retained field without synthesizing omitted live fields", () => {
  const state = replayDurableJournal(durableHistory(durableBaseFacts));
  expect(state).toEqual({
    headSequence: 10, presence: "engaged", sessions: [{
      sessionKey, openedSequence: 2, status: "ready", mode: "growth",
      learningBoundary: { humanOwnedCapabilities: ["implementation", "verification"], maximumHintLevel: 3 },
      workUnits: [{
        sessionKey, workUnitKey, mode: "growth", owner: "human", learningValue: "high",
        capability: "implementation", status: "agreed",
        assistance: { attempt: "none", hypothesis: "none", hintLevel: null, solutionRevealed: false },
      }],
      operations: [{ sessionKey, workUnitKey, operationKey, kind: "read", openedSequence: 10, status: "started" }],
    }],
  });
});

it("records absent optional retained state as null, not fabricated agreements", () => {
  const state = replayDurableJournal(durableHistory([{ type: "SessionOpened", sessionKey }, workUnitOpened()]));
  expect(state.sessions[0]).toEqual({
    sessionKey, openedSequence: 1, status: "briefing", mode: null, learningBoundary: null,
    workUnits: [{
      sessionKey, workUnitKey, mode: "growth", owner: "human", learningValue: "high",
      capability: "implementation", status: "proposed", assistance: null,
    }], operations: [],
  });
});

it("replays multiple commands in one atomic batch", () => {
  const commit = { ...durableCommit(durableBaseFacts), commandKeys: [durableKey(50), durableKey(51)] };
  expect(replay(durableWire([commit])).headSequence).toBe(durableBaseFacts.length);
});

it.each([1, 3, Number.MAX_SAFE_INTEGER])("rejects a first-commit sequence gap of %s", expectedSequence => {
  const commit = { ...durableCommit(durableBaseFacts), expectedSequence };
  expect(() => replay(durableWire([commit]))).toThrow(fail("NON_CONTIGUOUS_SEQUENCE"));
});

it("rejects reordered commits rather than returning a valid suffix", () => {
  const journal = durableHistory(durableBaseFacts, [closed]);
  expect(() => replay({ ...journal, commits: [...journal.commits].reverse() }))
    .toThrow(fail("NON_CONTIGUOUS_SEQUENCE"));
});

it.each([0, 9, 11, Number.MAX_SAFE_INTEGER])("requires the exact declared head %s", headSequence => {
  const journal = durableHistory(durableBaseFacts);
  expect(() => replay({ ...journal, headSequence })).toThrow(fail("HEAD_SEQUENCE_MISMATCH"));
});

it.each(["commitKey", "commandKeys"] as const)("rejects reused %s across commits", field => {
  const first = durableCommit(durableBaseFacts);
  const second = { ...durableCommit([closed], 10), [field]: first[field] };
  expect(() => replay(durableWire([first, second])))
    .toThrow(fail(field === "commitKey" ? "DUPLICATE_COMMIT_KEY" : "DUPLICATE_COMMAND_KEY"));
});

it.each<DurableFact>([
  { type: "SessionStatusRecorded", sessionKey, status: "ready" },
  { type: "ModeRecorded", sessionKey, mode: "growth" },
  { type: "LearningBoundaryRecorded", sessionKey, humanOwnedCapabilities: [], maximumHintLevel: 1 },
  workUnitOpened(),
  { type: "WorkUnitStatusRecorded", sessionKey, workUnitKey, status: "agreed" },
  {
    type: "AssistanceRecorded", sessionKey, workUnitKey,
    attempt: "recorded", hypothesis: "none", hintLevel: 2, solutionRevealed: false,
  },
  operationOpened(),
  { type: "OperationOutcomeRecorded", sessionKey, operationKey, status: "confirmed" },
])("rejects a dangling reference in $type", fact => {
  expect(() => replayDurableJournal(durableHistory([fact]))).toThrow(fail("INVALID_FACT_SEQUENCE"));
});

it.each<DurableFact>([
  { type: "SessionOpened", sessionKey }, workUnitOpened(), operationOpened(),
])("rejects reused lifetime keys for $type", fact => {
  expect(() => replayDurableJournal(durableHistory(durableBaseFacts, [closed], [fact])))
    .toThrow(fail("DUPLICATE_LIFETIME_KEY"));
});

it("does not open a second session before the previous one closes", () => {
  expect(() => replayDurableJournal(durableHistory(durableBaseFacts, [{ type: "SessionOpened", sessionKey: nextSessionKey }])))
    .toThrow(fail("INVALID_FACT_SEQUENCE"));
});

it.each(["briefing", "ready", "active", "paused", "reconciling", "closing"] as const)(
  "never reopens a closed session as %s", status => {
    expect(() => replayDurableJournal(durableHistory(durableBaseFacts, [closed], [
      { type: "SessionStatusRecorded", sessionKey, status },
    ]))).toThrow(fail("INVALID_FACT_SEQUENCE"));
  },
);

it.each<DurableFact>([
  { type: "WorkUnitStatusRecorded", sessionKey: nextSessionKey, workUnitKey, status: "executing" },
  {
    type: "AssistanceRecorded", sessionKey: nextSessionKey, workUnitKey,
    attempt: "none", hypothesis: "none", hintLevel: null, solutionRevealed: false,
  },
  operationOpened(durableKey(8), nextSessionKey),
  { type: "OperationOutcomeRecorded", sessionKey: nextSessionKey, operationKey, status: "unknown" },
])("rejects cross-session references in $type", fact => {
  expect(() => replayDurableJournal(durableHistory(durableBaseFacts, [closed], [
    { type: "SessionOpened", sessionKey: nextSessionKey }, fact,
  ]))).toThrow(fail("INVALID_FACT_SEQUENCE"));
});

it("requires a work unit to precede its operation in the same commit", () => {
  expect(() => replayDurableJournal(durableHistory([
    { type: "SessionOpened", sessionKey }, operationOpened(), workUnitOpened(),
  ]))).toThrow(fail("INVALID_FACT_SEQUENCE"));
});

it.each(["planned", "authorized", "started"] as const)("retains %s operations when closing", status => {
  const facts: readonly DurableFact[] = [
    { type: "SessionOpened", sessionKey }, workUnitOpened(),
    { type: "OperationOpened", sessionKey, workUnitKey, operationKey, kind: "read", status }, closed,
  ];
  expect(replayDurableJournal(durableHistory(facts)).sessions[0]?.operations[0]?.status).toBe(status);
});

it.each(["confirmed", "failed", "declined", "cancelled", "unknown"] as const)(
  "preserves the exact %s outcome and other unsettled operations", status => {
    const state = replayDurableJournal(durableHistory(durableBaseFacts, [
      operationOpened(durableKey(8)),
      { type: "OperationOutcomeRecorded", sessionKey, operationKey, status }, closed,
      { type: "SessionOpened", sessionKey: nextSessionKey },
    ]));
    expect(state.sessions).toHaveLength(2);
    expect(state.sessions[0]?.operations.map(operation => operation.status)).toEqual([status, "started"]);
    expect(state.sessions[1]?.operations).toEqual([]);
  },
);

const outcomes = ["confirmed", "failed", "declined", "cancelled", "unknown"] as const;
it.each(outcomes.flatMap(first => outcomes.map(second => ({ first, second }))))(
  "never overwrites $first with a second $second outcome", ({ first, second }) => {
    expect(() => replayDurableJournal(durableHistory(durableBaseFacts, [
      { type: "OperationOutcomeRecorded", sessionKey, operationKey, status: first },
      { type: "OperationOutcomeRecorded", sessionKey, operationKey, status: second },
    ]))).toThrow(fail("INVALID_FACT_SEQUENCE"));
  },
);

it("keeps prior work-unit lifetimes and replaces only explicitly recorded assistance", () => {
  const state = replayDurableJournal(durableHistory(durableBaseFacts, [
    { type: "WorkUnitStatusRecorded", sessionKey, workUnitKey, status: "completed" },
    {
      type: "AssistanceRecorded", sessionKey, workUnitKey,
      attempt: "recorded", hypothesis: "bypassed", hintLevel: 5, solutionRevealed: true,
    }, workUnitOpened(durableKey(8)),
  ]));
  expect(state.sessions[0]?.workUnits.map(unit => unit.status)).toEqual(["completed", "proposed"]);
  expect(state.sessions[0]?.workUnits[0]?.assistance).toEqual({
    attempt: "recorded", hypothesis: "bypassed", hintLevel: 5, solutionRevealed: true,
  });
  expect(state.sessions[0]?.workUnits[1]?.assistance).toBeNull();
});

it("returns detached deeply frozen state and keeps invocations isolated", () => {
  const journal = durableHistory(durableBaseFacts);
  const state = replayDurableJournal(journal);
  const session = state.sessions[0];
  expect(session).toBeDefined();
  for (const object of [
    state, state.sessions, session, session?.learningBoundary, session?.learningBoundary?.humanOwnedCapabilities,
    session?.workUnits, session?.workUnits[0], session?.workUnits[0]?.assistance, session?.operations, session?.operations[0],
  ]) expect(Object.isFrozen(object)).toBe(true);
  const boundary = journal.commits[0]?.facts.find(fact => fact.type === "LearningBoundaryRecorded");
  expect(session?.learningBoundary?.humanOwnedCapabilities).not.toBe(boundary?.humanOwnedCapabilities);
  expect(() => replayDurableJournal(durableHistory(durableBaseFacts, [operationOpened()])))
    .toThrow(fail("DUPLICATE_LIFETIME_KEY"));
  expect(replayDurableJournal(journal)).toEqual(state);
  expect(replayDurableJournal(journal)).not.toBe(state);
});

it("derives the canonical snapshot only from complete replay", () => {
  const journal = durableHistory(durableBaseFacts);
  const snapshot = createDurableSnapshot(journal);
  expect(snapshot).toEqual({
    format: "adaptive-pair-durable", version: 1, namespaceKey, generationKey,
    headSequence: 10, state: replayDurableJournal(journal),
  });
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.state)).toBe(true);
  expect(() => createDurableSnapshot(durableHistory(durableBaseFacts, [operationOpened()])))
    .toThrow(fail("DUPLICATE_LIFETIME_KEY"));
});

it("uses cache text only as an exact canonical comparison", () => {
  const snapshot = createDurableSnapshot(durableHistory(durableBaseFacts));
  const text = JSON.stringify(snapshot);
  expect(classifyDurableCache(undefined, snapshot)).toBe("absent");
  expect(classifyDurableCache(text, snapshot)).toBe("matched");
  for (const cache of [null, snapshot, Object(text) as unknown, "{", ` ${text}`, `${text}\n`,
    JSON.stringify({ ...snapshot, headSequence: 9 }), JSON.stringify({ ...snapshot, extra: "PRIVATE_CANARY" }),
    JSON.stringify(Object.fromEntries(Object.entries(snapshot).reverse())),
  ]) expect(classifyDurableCache(cache, snapshot)).toBe("discarded");
});
