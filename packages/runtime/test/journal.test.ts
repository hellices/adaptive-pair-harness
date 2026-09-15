import { describe, expect, it } from "vitest";
import { InMemoryJournal } from "../src/index.js";

describe("InMemoryJournal", () => {
  it("deep-freezes appended events and replays them into snapshots", async () => {
    const journal = new InMemoryJournal("workspace-1");

    await journal.append("workspace-1", [
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

    await journal.append("workspace-1", [
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
      journal.append("workspace-1", [
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
      journal.append("workspace-1", [
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
});
