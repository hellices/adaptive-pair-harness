import { describe, expect, it, vi } from "vitest";
import { parsePairJournal } from "../src/index.js";
import * as eventParser from "../src/parseEvent.js";
import { createEventFixtures } from "./eventFixtures.js";

const journalWire = (commits: readonly unknown[] = [], headRevision = 0) => ({
  formatVersion: 1,
  streamId: "stream-1",
  initialWorkspaceId: "workspace-1",
  headRevision,
  commits,
});

const emptyText = JSON.stringify(journalWire());
const fixtures = createEventFixtures();
const eventsText = (...events: readonly unknown[]) =>
  JSON.stringify(journalWire([{ expectedRevision: 0, events }], events.length));

describe("parsePairJournal", () => {
  it("accepts an immutable empty revision-zero journal", () => {
    const journal = parsePairJournal(emptyText);
    expect(journal.headRevision).toBe(0);
    expect(Object.isFrozen(journal)).toBe(true);
    expect(Object.isFrozen(journal.commits)).toBe(true);
  });
});

it.each([undefined, Object(emptyText) as unknown])(
  "rejects non-primitive text %s", value => {
    expect(() => parsePairJournal(value)).toThrow(new Error("Invalid Pair journal: INVALID_TEXT"));
  },
);

it("does not read proxy properties or invoke serialization hooks", () => {
  let accesses = 0;
  const input = new Proxy({}, {
    get() { accesses += 1; throw new Error("secret conversion hook"); },
  });
  expect(() => parsePairJournal(input)).toThrow(new Error("Invalid Pair journal: INVALID_TEXT"));
  expect(accesses).toBe(0);
});

it.each(['{"secret":}', '{"nested":'.repeat(4_000) + '"secret"'])(
  "sanitizes malformed JSON %#", text => {
    expect(() => parsePairJournal(text)).toThrow(new Error("Invalid Pair journal: INVALID_JSON"));
  },
);

it("accepts exactly the UTF-16 code-unit limit, including non-ASCII text", () => {
  const text = JSON.stringify({ ...journalWire(), streamId: "stream-🚀" });
  const padded = " ".repeat(1_048_576 - text.length) + text;
  expect(padded.length).toBe(1_048_576);
  expect(parsePairJournal(padded).streamId).toBe("stream-🚀");
});

it("rejects limit plus one before JSON decoding", () => {
  const text = " ".repeat(1_048_577 - emptyText.length) + emptyText;
  const parse = vi.spyOn(JSON, "parse");
  try {
    expect(() => parsePairJournal(text)).toThrow(new Error("Invalid Pair journal: TEXT_LIMIT"));
    expect(parse).not.toHaveBeenCalled();
  } finally {
    parse.mockRestore();
  }
});

it.each([null, [], 1])("rejects a non-object JSON envelope %j", value => {
  expect(() => parsePairJournal(JSON.stringify(value)))
    .toThrow(new Error("Invalid Pair journal: INVALID_ENVELOPE"));
});

it("requires every own root field", () => {
  const wire: Record<string, unknown> = journalWire();
  delete wire.formatVersion;
  expect(() => parsePairJournal(JSON.stringify(wire)))
    .toThrow(new Error("Invalid Pair journal: INVALID_ENVELOPE"));
});

it.each(["extra", "__proto__"])("rejects extra root key %s", field => {
  const wire = { ...journalWire(), [field]: { streamId: "injected" } };
  expect(() => parsePairJournal(JSON.stringify(wire)))
    .toThrow(new Error("Invalid Pair journal: INVALID_ENVELOPE"));
});

it("does not use or read an inherited required root field", () => {
  const wire: Record<string, unknown> = { ...journalWire(), replacement: "same key count" };
  delete wire.streamId;
  const text = JSON.stringify(wire);
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "streamId");
  let inheritedReads = 0;
  let error: unknown;
  Object.defineProperty(Object.prototype, "streamId", {
    configurable: true,
    get() { inheritedReads += 1; return "inherited"; },
  });
  try {
    parsePairJournal(text);
  } catch (caught) {
    error = caught;
  } finally {
    if (original === undefined) Reflect.deleteProperty(Object.prototype, "streamId");
    else Object.defineProperty(Object.prototype, "streamId", original);
  }
  expect(error).toEqual(new Error("Invalid Pair journal: INVALID_ENVELOPE"));
  expect(inheritedReads).toBe(0);
});

it.each([2, "1"])("rejects journal format %j", formatVersion => {
  expect(() => parsePairJournal(JSON.stringify({ ...journalWire(), formatVersion })))
    .toThrow(new Error("Invalid Pair journal: UNSUPPORTED_JOURNAL_VERSION"));
});

it.each(["streamId", "initialWorkspaceId"].flatMap(field =>
  ["", null].map(value => ({ field, value })),
))("rejects invalid $field: $value", ({ field, value }) => {
  expect(() => parsePairJournal(JSON.stringify({ ...journalWire(), [field]: value })))
    .toThrow(new Error("Invalid Pair journal: INVALID_ENVELOPE"));
});

it.each([-1, Number.MAX_SAFE_INTEGER + 1, "0"])("rejects invalid counters %j", value => {
  expect(() => parsePairJournal(JSON.stringify({ ...journalWire(), headRevision: value })))
    .toThrow(new Error("Invalid Pair journal: INVALID_ENVELOPE"));
  const commits = [{ expectedRevision: value, events: [fixtures.WorkspaceObserved] }];
  expect(() => parsePairJournal(JSON.stringify(journalWire(commits, 1))))
    .toThrow(new Error("Invalid Pair journal: INVALID_ENVELOPE"));
});

it("requires a revision-zero head when there are no commits", () => {
  expect(() => parsePairJournal(JSON.stringify(journalWire([], 1))))
    .toThrow(new Error("Invalid Pair journal: INVALID_ENVELOPE"));
});

it("requires a commit array", () => {
  const commits = {};
  expect(() => parsePairJournal(JSON.stringify({ ...journalWire(), commits })))
    .toThrow(new Error("Invalid Pair journal: INVALID_ENVELOPE"));
});

it.each([
  null, { events: [fixtures.WorkspaceObserved] },
  { expectedRevision: 0, events: [] }, { expectedRevision: 0, events: {} },
])("rejects invalid commit envelope %#", commit => {
  expect(() => parsePairJournal(JSON.stringify(journalWire([commit], 1))))
    .toThrow(new Error("Invalid Pair journal: INVALID_ENVELOPE"));
});

it.each(["extra", "__proto__"])("rejects extra commit key %s", field => {
  const commit = { expectedRevision: 0, events: [fixtures.WorkspaceObserved], [field]: "injected" };
  expect(() => parsePairJournal(JSON.stringify(journalWire([commit], 1))))
    .toThrow(new Error("Invalid Pair journal: INVALID_ENVELOPE"));
});

it("validates every commit envelope before parsing any event", () => {
  const commits = [{ expectedRevision: 0, events: [null] }, { expectedRevision: 1, events: [] }];
  const parseEvent = vi.spyOn(eventParser, "parsePairEvent");
  try {
    expect(() => parsePairJournal(JSON.stringify(journalWire(commits, 2))))
      .toThrow(new Error("Invalid Pair journal: INVALID_ENVELOPE"));
    expect(parseEvent).not.toHaveBeenCalled();
  } finally {
    parseEvent.mockRestore();
  }
});

it("accepts exactly 1,024 commits and total events below the text cap", () => {
  const commits = Array.from({ length: 1_024 }, (_value, index) => ({
    expectedRevision: index,
    events: [{ ...fixtures.WorkspaceObserved, revision: index + 1, eventId: `event-${index}` }],
  }));
  const text = JSON.stringify(journalWire(commits, 1_024));
  expect(text.length).toBeLessThan(1_048_576);
  expect(parsePairJournal(text).commits).toHaveLength(1_024);
});

it("rejects 1,025 commits independently of event parsing", () => {
  const commits = Array.from({ length: 1_025 }, () => ({ expectedRevision: 0, events: [null] }));
  const text = JSON.stringify(journalWire(commits, 1_025));
  expect(text.length).toBeLessThan(1_048_576);
  expect(() => parsePairJournal(text)).toThrow(new Error("Invalid Pair journal: INVALID_ENVELOPE"));
});

it("bounds total events across commits before parsing any event", () => {
  const events = Array.from({ length: 1_025 }, () => null);
  const commits = [
    { expectedRevision: 0, events: events.slice(0, 512) },
    { expectedRevision: 512, events: events.slice(512) },
  ];
  const text = JSON.stringify(journalWire(commits, 1_025));
  expect(text.length).toBeLessThan(1_048_576);
  const parseEvent = vi.spyOn(eventParser, "parsePairEvent");
  try {
    expect(() => parsePairJournal(text)).toThrow(new Error("Invalid Pair journal: EVENT_LIMIT"));
    expect(parseEvent).not.toHaveBeenCalled();
  } finally {
    parseEvent.mockRestore();
  }
});

it("retains the event wire and memory contract", () => {
  const parsed = parsePairJournal(eventsText(fixtures.OperationAuthorized));
  expect(parsed.commits[0]?.events[0]).toStrictEqual(fixtures.OperationAuthorized);
  expect(Object.isFrozen(parsed.commits[0])).toBe(true);
  expect(Object.isFrozen(parsed.commits[0]?.events)).toBe(true);
  expect(Object.isFrozen(parsed.commits[0]?.events[0])).toBe(true);
});

it.each([
  { ...fixtures.WorkspaceObserved, protocolVersion: 2 },
  null,
])("wraps invalid event %# without schema diagnostics", event => {
  expect(() => parsePairJournal(eventsText(event))).toThrow(new Error("Invalid Pair journal: INVALID_EVENT"));
});

it.each(["eventId", "commandId"] as const)("rejects empty %s only at the journal boundary", field => {
  const event = { ...fixtures.WorkspaceObserved, [field]: "" };
  expect(eventParser.parsePairEvent(event)[field]).toBe("");
  expect(() => parsePairJournal(eventsText(event))).toThrow(new Error("Invalid Pair journal: INVALID_EVENT"));
});

it("does not expose a cause, payload or valid prefix after failure", () => {
  const secret = "private-journal-payload-sentinel";
  let error: unknown;
  try {
    parsePairJournal(eventsText(fixtures.WorkspaceObserved, { secret }));
  } catch (caught) {
    error = caught;
  }
  expect(error).toEqual(new Error("Invalid Pair journal: INVALID_EVENT"));
  expect(error).not.toHaveProperty("cause");
  expect(error).not.toHaveProperty("events");
  expect(String(error)).not.toContain(secret);
  expect(parsePairJournal(emptyText).commits).toEqual([]);
});
