import { describe, expect, it } from "vitest";
import type { PairEvent } from "@adaptive-pair/protocol";
import { InMemoryJournal } from "../src/index.js";

const started = (commandId = "cmd-start", revision = 1): PairEvent => ({
  protocolVersion: 1,
  eventId: `${commandId}:0`,
  commandId,
  actor: "human",
  revision,
  recordedAt: 10,
  type: "SessionStarted",
  sessionId: "session-1",
});

describe("InMemoryJournal", () => {
  it("atomically commits frozen events, snapshots, and command IDs", async () => {
    const journal = new InMemoryJournal("workspace-1");

    await journal.commit("workspace-1", 0, [
      {
        protocolVersion: 1,
        eventId: "cmd-start:0",
        commandId: "cmd-start",
        actor: "human",
        revision: 1,
        recordedAt: 10,
        type: "SessionStarted",
        sessionId: "session-1",
      },
    ]);

    const stored = journal.events("workspace-1");
    expect(stored).toHaveLength(1);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored[0])).toBe(true);

    const loaded = await journal.load("workspace-1");
    expect(loaded.snapshot.session?.sessionId).toBe("session-1");
    expect(loaded.snapshot.revision).toBe(1);
    expect(loaded.seenCommandIds.has("cmd-start")).toBe(true);
  });

  it("rejects non-contiguous revisions and duplicate command IDs", async () => {
    const journal = new InMemoryJournal("workspace-1");

    await journal.commit("workspace-1", 0, [
      {
        protocolVersion: 1,
        eventId: "cmd-start:0",
        commandId: "cmd-start",
        actor: "human",
        revision: 1,
        recordedAt: 10,
        type: "SessionStarted",
        sessionId: "session-1",
      },
    ]);

    await expect(
      journal.commit("workspace-1", 1, [
        {
          protocolVersion: 1,
          eventId: "cmd-gap:0",
          commandId: "cmd-gap",
          actor: "human",
          revision: 3,
          recordedAt: 11,
          type: "SessionPaused",
          reason: "gap",
          authorityEpoch: 1,
        },
      ]),
    ).rejects.toThrow("NON_CONTIGUOUS_REVISION");

    await expect(
      journal.commit("workspace-1", 1, [
        {
          protocolVersion: 1,
          eventId: "cmd-start:1",
          commandId: "cmd-start",
          actor: "human",
          revision: 2,
          recordedAt: 11,
          type: "SessionPaused",
          reason: "duplicate",
          authorityEpoch: 1,
        },
      ]),
    ).rejects.toThrow("DUPLICATE_COMMAND_ID");
  });

  it("rejects a competing commit at the same expected revision", async () => {
    const journal = new InMemoryJournal("workspace-1");

    const results = await Promise.allSettled([
      journal.commit("workspace-1", 0, [started("first")]),
      journal.commit("workspace-1", 0, [started("second")]),
    ]);

    expect(results[0]?.status).toBe("fulfilled");
    expect(results[1]).toMatchObject({
      status: "rejected",
      reason: new Error("STALE_REVISION"),
    });
    expect(journal.events().map(event => event.commandId)).toEqual(["first"]);
    expect((await journal.load("workspace-1")).seenCommandIds).toEqual(new Set(["first"]));
  });

  it("leaves the entire store unchanged when a later event cannot reduce", async () => {
    const journal = new InMemoryJournal("workspace-1");
    const before = await journal.load("workspace-1");

    await expect(journal.commit("workspace-1", 0, [
      started(),
      {
        protocolVersion: 1,
        eventId: "cmd-pause:0",
        commandId: "cmd-pause",
        actor: "human",
        revision: 2,
        recordedAt: 11,
        type: "SessionPaused",
        reason: "Not yet pausable",
        authorityEpoch: 1,
      },
    ])).rejects.toThrow("SESSION_NOT_PAUSABLE");

    expect(await journal.load("workspace-1")).toEqual(before);
    expect(journal.events()).toEqual([]);
    await expect(journal.commit("workspace-1", 0, [started()])).resolves.toMatchObject({ revision: 1 });
  });

  it("allows one command to emit multiple events and isolates nested values", async () => {
    const journal = new InMemoryJournal("workspace-1");
    const openPaths = ["src/main.ts"];
    const snapshot = await journal.commit("workspace-1", 0, [
      started(),
      {
        protocolVersion: 1,
        eventId: "cmd-start:1",
        commandId: "cmd-start",
        actor: "human",
        revision: 2,
        recordedAt: 11,
        type: "EntryCaptured",
        entry: {
          workspaceId: "workspace-1",
          openPaths,
          dirtyPaths: [],
          diagnostics: [],
          protectedPaths: [],
          capturedAt: 11,
        },
      },
    ]);
    openPaths.push("src/other.ts");

    expect(snapshot.session?.entrySnapshot?.openPaths).toEqual(["src/main.ts"]);
    expect(Object.isFrozen(snapshot.session?.entrySnapshot?.openPaths)).toBe(true);
    expect(Object.isFrozen(snapshot.session?.entrySnapshot)).toBe(true);
    const stored = journal.events()[1];
    if (stored?.type !== "EntryCaptured") {
      throw new Error("Missing entry event");
    }
    expect(Object.isFrozen(stored.entry.openPaths)).toBe(true);
    expect(journal.snapshotNow()).toEqual(snapshot);

    const loaded = await journal.load("workspace-1");
    (loaded.seenCommandIds as Set<string>).clear();
    expect((await journal.load("workspace-1")).seenCommandIds).toEqual(new Set(["cmd-start"]));
  });

  it("keeps different stream identities isolated", async () => {
    const journal = new InMemoryJournal("default-stream");
    await journal.commit("another-stream", 0, [started()]);

    expect((await journal.load("another-stream")).snapshot.presence.workspaceId).toBe("another-stream");
    expect(journal.snapshotNow().revision).toBe(0);
    expect(journal.events()).toEqual([]);
    expect((await journal.load("default-stream")).seenCommandIds.size).toBe(0);
  });
});
