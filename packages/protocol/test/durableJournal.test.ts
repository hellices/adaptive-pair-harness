import fc from "fast-check";
import { expect, it, vi } from "vitest";
import { durableJournalLimits, parseDurableJournal } from "../src/index.js";
import { durableCommit, durableFacts, durableKey, durableText, durableWire } from "./durableFixtures.js";

const fail = (code: string): Error => new Error(`Invalid Pair durable journal: ${code}`);
const emptyText = durableText();

it("parses a detached frozen empty generation", () => {
  const journal = parseDurableJournal(emptyText);
  expect(journal).toEqual(durableWire());
  expect(Object.isFrozen(journal)).toBe(true);
  expect(Object.isFrozen(journal.commits)).toBe(true);
});

it("parses without host-specific encoding globals", () => {
  vi.stubGlobal("TextEncoder", undefined);
  try {
    expect(parseDurableJournal(emptyText)).toEqual(durableWire());
  } finally {
    vi.unstubAllGlobals();
  }
});

it("publishes the exact immutable independent budgets", () => {
  expect(durableJournalLimits).toEqual({
    textCodeUnits: 1_048_576, encodedBytes: 1_048_576,
    commits: 1_024, facts: 1_024, commandKeys: 1_024,
    lifetimeMs: 604_800_000,
  });
  expect(Object.isFrozen(durableJournalLimits)).toBe(true);
});

it.each([null, undefined, false, 1, 1n, Symbol("text"), [], {}, Object(emptyText) as unknown])(
  "rejects nonprimitive text %#", value => {
    expect(() => parseDurableJournal(value)).toThrow(fail("INVALID_TEXT"));
  },
);

it("does not inspect hostile objects or conversion hooks", () => {
  const get = vi.fn(() => { throw new Error("private conversion"); });
  expect(() => parseDurableJournal(new Proxy({}, { get }))).toThrow(fail("INVALID_TEXT"));
  expect(get).not.toHaveBeenCalled();
});

it.each(["", "{", '{"private":}', '{"nested":'.repeat(5_000)])(
  "sanitizes malformed JSON %#", text => {
    expect(() => parseDurableJournal(text)).toThrow(fail("INVALID_JSON"));
  },
);

it("accepts exactly both text and byte budgets", () => {
  const text = " ".repeat(1_048_576 - emptyText.length) + emptyText;
  expect(parseDurableJournal(text)).toEqual(durableWire());
});

it("rejects text limit plus one before JSON parsing", () => {
  const parse = vi.spyOn(JSON, "parse");
  try {
    expect(() => parseDurableJournal(" ".repeat(1_048_577))).toThrow(fail("TEXT_LIMIT"));
    expect(parse).not.toHaveBeenCalled();
  } finally {
    parse.mockRestore();
  }
});

it.each(["é".repeat(524_288), "🚀".repeat(262_144)])(
  "enforces UTF-8 bytes independently of UTF-16 units %#", value => {
    const text = JSON.stringify(value);
    expect(text.length).toBeLessThan(1_048_576);
    expect(() => parseDurableJournal(text)).toThrow(fail("BYTE_LIMIT"));
  },
);

it.each([
  { character: "é", bytes: 2 }, { character: "한", bytes: 3 }, { character: "🚀", bytes: 4 },
  { character: "\ud800", bytes: 3 }, { character: "\udc00", bytes: 3 },
])("counts exact UTF-8 limits for code points and lone surrogates %#", ({ character, bytes }) => {
  const count = Math.floor((1_048_576 - 2) / bytes);
  const text = `"${character.repeat(count)}"` + " ".repeat(1_048_576 - 2 - count * bytes);
  expect(() => parseDurableJournal(text)).toThrow(fail("INVALID_ENVELOPE"));
  expect(() => parseDurableJournal(`${text} `)).toThrow(fail("BYTE_LIMIT"));
});

it.each([null, [], "text", 1, true])("rejects a nonobject envelope %#", value => {
  expect(() => parseDurableJournal(JSON.stringify(value))).toThrow(fail("INVALID_ENVELOPE"));
});

it.each(Object.keys(durableWire()))("requires the own envelope field %s", field => {
  const wire: Record<string, unknown> = durableWire();
  delete wire[field];
  expect(() => parseDurableJournal(JSON.stringify(wire))).toThrow(fail("INVALID_ENVELOPE"));
});

it.each(["privateInput", "__proto__", "constructor", "prototype"])(
  "rejects extra envelope field %s", field => {
    expect(() => parseDurableJournal(JSON.stringify({ ...durableWire(), [field]: "PRIVATE_CANARY" })))
      .toThrow(fail("INVALID_ENVELOPE"));
  },
);

it.each([0, 2, "1", null])("rejects unsupported durable versions %#", version => {
  expect(() => parseDurableJournal(JSON.stringify({ ...durableWire(), version })))
    .toThrow(fail("UNSUPPORTED_VERSION"));
});

it("does not reinterpret P2a framing as a durable export", () => {
  expect(() => parseDurableJournal(JSON.stringify({
    formatVersion: 1, streamId: "private-workspace", initialWorkspaceId: "private-workspace",
    headRevision: 0, commits: [],
  }))).toThrow(fail("INVALID_ENVELOPE"));
});

it.each(["", "f".repeat(31), "f".repeat(33), "F".repeat(32), "z".repeat(32), "file:///private", 0])(
  "rejects malformed namespace tokens %#", namespaceKey => {
    expect(() => parseDurableJournal(JSON.stringify({ ...durableWire(), namespaceKey })))
      .toThrow(fail("INVALID_ENVELOPE"));
  },
);

it.each(["generationKey", "namespaceKey"])("never permits arbitrary identifiers in %s", field => {
  const wire = { ...durableWire(), [field]: "PRIVATE_CANARY" };
  expect(() => parseDurableJournal(JSON.stringify(wire))).toThrow(fail("INVALID_ENVELOPE"));
});

it.each(["createdAt", "expiresAt", "headSequence"])("rejects negative zero in %s", field => {
  const text = JSON.stringify(durableWire()).replace(new RegExp(`"${field}":\\d+`), `"${field}":-0`);
  expect(() => parseDurableJournal(text)).toThrow(fail("INVALID_ENVELOPE"));
});

it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, null, "0"])(
  "rejects invalid counters %#", headSequence => {
    expect(() => parseDurableJournal(JSON.stringify({ ...durableWire(), headSequence })))
      .toThrow(fail("INVALID_ENVELOPE"));
  },
);

const counterText = (field: string, literal: string): string =>
  durableText([durableFacts[0]]).replace(new RegExp(`"${field}":\\d+`), `"${field}":${literal}`);

it.each(["headSequence", "expectedSequence"])("accepts safe framing endpoints for %s", field => {
  for (const value of [0, Number.MAX_SAFE_INTEGER]) {
    expect(() => parseDurableJournal(counterText(field, String(value)))).not.toThrow();
  }
});

it.each(["headSequence", "expectedSequence"].flatMap(field =>
  ["-0", "-1", "0.5", "9007199254740992", "1e400", "-1e400", "null", '"0"']
    .map(literal => ({ field, literal })),
))("validates $field=$literal independently of empty-origin framing", ({ field, literal }) => {
  expect(() => parseDurableJournal(counterText(field, literal)))
    .toThrow(fail(field === "headSequence" ? "INVALID_ENVELOPE" : "INVALID_COMMIT"));
});

it.each([99, 100, 604_800_101])("rejects invalid expiry %s", expiresAt => {
  expect(() => parseDurableJournal(JSON.stringify({ ...durableWire(), expiresAt })))
    .toThrow(fail("INVALID_ENVELOPE"));
});

it("accepts the exact lifetime ceiling and shorter local lifetimes", () => {
  for (const expiresAt of [101, 604_800_100]) {
    expect(parseDurableJournal(JSON.stringify({ ...durableWire(), expiresAt })).expiresAt).toBe(expiresAt);
  }
});

it("rejects a nonzero empty origin", () => {
  expect(() => parseDurableJournal(JSON.stringify({ ...durableWire(), headSequence: 1 })))
    .toThrow(fail("INVALID_ENVELOPE"));
});

it.each(Object.keys(durableCommit()))("requires commit field %s", field => {
  const commit: Record<string, unknown> = durableCommit();
  delete commit[field];
  expect(() => parseDurableJournal(JSON.stringify({ ...durableWire(), commits: [commit] })))
    .toThrow(fail("INVALID_COMMIT"));
});

it.each([
  null, {}, { ...durableCommit(), facts: [] }, { ...durableCommit(), facts: null },
  { ...durableCommit(), commandKeys: [] }, { ...durableCommit(), commandKeys: ["private"] },
  { ...durableCommit(), commandKeys: [durableKey(8), durableKey(8)] },
  { ...durableCommit(), commitKey: "private" }, { ...durableCommit(), expectedSequence: -1 },
  { ...durableCommit(), extra: "PRIVATE_CANARY" },
])("rejects invalid closed commit %#", commit => {
  expect(() => parseDurableJournal(JSON.stringify({ ...durableWire(), commits: [commit] })))
    .toThrow(fail("INVALID_COMMIT"));
});

it.each(durableFacts)("accepts the closed $type shape", fact => {
  expect(parseDurableJournal(durableText([fact])).commits[0]?.facts[0]).toEqual(fact);
});

it.each(durableFacts.flatMap(fact => Object.keys(fact).map(field => ({ type: fact.type, fact, field }))))(
  "requires $type.$field", ({ fact, field }) => {
    const candidate: Record<string, unknown> = { ...fact };
    delete candidate[field];
    expect(() => parseDurableJournal(durableText([candidate]))).toThrow(fail("INVALID_FACT"));
  },
);

it.each(durableFacts)("rejects extra data on $type", fact => {
  expect(() => parseDurableJournal(durableText([{ ...fact, input: "PRIVATE_CANARY" }])))
    .toThrow(fail("INVALID_FACT"));
});

it.each(durableFacts.flatMap(fact => Object.keys(fact)
  .filter(field => field.endsWith("Key"))
  .map(field => ({ type: fact.type, fact, field }))))(
  "rejects source identifiers in $type.$field", ({ fact, field }) => {
    expect(() => parseDurableJournal(durableText([{ ...fact, [field]: "PRIVATE_CANARY" }])))
      .toThrow(fail("INVALID_FACT"));
  },
);

it.each([
  { type: "PresenceRecorded", status: "off" },
  { ...durableFacts[2], status: "inactive" },
  { ...durableFacts[3], maximumHintLevel: 6 },
  { ...durableFacts[3], maximumHintLevel: 0.5 },
  { ...durableFacts[3], humanOwnedCapabilities: ["implementation", "implementation"] },
  { ...durableFacts[3], humanOwnedCapabilities: ["PRIVATE_CANARY"] },
  { ...durableFacts[4], mode: "automatic" },
  { ...durableFacts[5], owner: "host" },
  { ...durableFacts[5], learningValue: "private" },
  { ...durableFacts[5], capability: "private" },
  { ...durableFacts[6], status: "private" },
  { ...durableFacts[7], attempt: "private" },
  { ...durableFacts[7], hypothesis: "private" },
  { ...durableFacts[7], hintLevel: 6 },
  { ...durableFacts[7], solutionRevealed: 1 },
  { ...durableFacts[8], kind: "terminal" },
  { ...durableFacts[8], status: "confirmed" },
  { ...durableFacts[9], status: "started" },
  { type: "UserActionGranted", grantId: "PRIVATE_CANARY" },
  null, [], "private",
])("rejects invalid fact fields %#", fact => {
  expect(() => parseDurableJournal(durableText([fact]))).toThrow(fail("INVALID_FACT"));
});

it("freezes every nested parsed collection and fact", () => {
  const journal = parseDurableJournal(durableText(durableFacts));
  const commit = journal.commits[0];
  expect(Object.isFrozen(commit)).toBe(true);
  expect(Object.isFrozen(commit?.commandKeys)).toBe(true);
  expect(Object.isFrozen(commit?.facts)).toBe(true);
  for (const fact of commit?.facts ?? []) {
    expect(Object.isFrozen(fact)).toBe(true);
    if (fact.type === "LearningBoundaryRecorded") expect(Object.isFrozen(fact.humanOwnedCapabilities)).toBe(true);
  }
});

it("accepts exact aggregate commit, fact, and command budgets", () => {
  const commits = Array.from({ length: 1_024 }, (_value, index) => durableCommit([durableFacts[0]], index));
  expect(parseDurableJournal(JSON.stringify(durableWire(commits))).commits).toHaveLength(1_024);
  const commandKeys = Array.from({ length: 1_024 }, (_value, index) => durableKey(2_000 + index));
  const grouped = { ...durableCommit(), commandKeys };
  expect(parseDurableJournal(JSON.stringify(durableWire([grouped]))).commits[0]?.commandKeys).toHaveLength(1_024);
});

it.each(["commits", "facts", "commandKeys"])("rejects aggregate %s limit plus one", dimension => {
  const commits = dimension === "commits"
    ? Array.from({ length: 1_025 }, (_value, index) => durableCommit([durableFacts[0]], index))
    : [{
      ...durableCommit(),
      facts: dimension === "facts" ? Array.from({ length: 1_025 }, () => durableFacts[0]) : [durableFacts[0]],
      commandKeys: dimension === "commandKeys"
        ? Array.from({ length: 1_025 }, (_value, index) => durableKey(2_000 + index)) : [durableKey(8)],
    }];
  expect(() => parseDurableJournal(JSON.stringify(durableWire(commits)))).toThrow(fail("LIMIT_EXCEEDED"));
});

const distributedBudget = (dimension: string, total: number, invalidFact = false): string => {
  const commits = [512, total - 512].map((count, index) => ({
    ...durableCommit([durableFacts[0]], index),
    facts: dimension === "facts" ? Array.from({ length: count }, () => durableFacts[0]) : [durableFacts[0]],
    commandKeys: dimension === "commandKeys"
      ? Array.from({ length: count }, (_value, offset) => durableKey(3_000 + index * 512 + offset))
      : [durableKey(3_000 + index)],
  }));
  const wire: unknown = invalidFact ? {
    ...durableWire(commits),
    commits: commits.map((commit, index) => index === 0 ? {
      ...commit, facts: [{ type: "PRIVATE_CANARY" }, ...commit.facts.slice(1)],
    } : commit),
  } : durableWire(commits);
  return JSON.stringify(wire);
};

it.each(["facts", "commandKeys"])("enforces aggregate %s across individually valid commits", dimension => {
  expect(parseDurableJournal(distributedBudget(dimension, 1_024)).commits).toHaveLength(2);
  expect(() => parseDurableJournal(distributedBudget(dimension, 1_025))).toThrow(fail("LIMIT_EXCEEDED"));
  expect(() => parseDurableJournal(distributedBudget(dimension, 1_025, true))).toThrow(fail("LIMIT_EXCEEDED"));
});

it("never exposes payloads or raw causes through errors", () => {
  for (const text of ['{"PRIVATE_CANARY":}', durableText([{ ...durableFacts[0], private: "PRIVATE_CANARY" }])]) {
    try {
      parseDurableJournal(text);
      expect.fail("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/^Invalid Pair durable journal: [A-Z_]+$/u);
      expect((error as Error).message).not.toContain("PRIVATE_CANARY");
      expect((error as Error).cause).toBeUndefined();
    }
  }
});

it("rejects arbitrary extra data without changing valid surrounding parses", () => {
  fc.assert(fc.property(fc.jsonValue(), value => {
    const text = durableText([{ ...durableFacts[0], unexpected: value }]);
    expect(() => parseDurableJournal(text)).toThrow(fail("INVALID_FACT"));
    expect(parseDurableJournal(emptyText).headSequence).toBe(0);
  }), { numRuns: 100 });
});
