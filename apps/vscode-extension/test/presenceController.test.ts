import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildController, DelayedReadMemoryFs, FakeScheduler, flush, harness,
  MemoryFs, NodeJournalFileSystem, run,
} from "./presenceTestHarness.js";

describe("PresenceController — command test harness", () => {
  it("rejects an unregistered command instead of silently succeeding", async () => {
    await expect(run("adaptivePair.missing")).rejects.toThrow(
      "Unknown command: adaptivePair.missing",
    );
  });
});

describe("PresenceController — pending edit timers", () => {
  it("observes an undo that returns a document to its saved state", async () => {
    const scheduler = new FakeScheduler();
    const fs = new MemoryFs();
    const { controller } = buildController(scheduler, fs);

    await run("adaptivePair.enablePresence");
    harness.emitChange("/workspace/src/pair.ts", { isDirty: false });
    scheduler.advanceBy(1_000);
    await flush();

    expect(controller.getState().observationCount).toBe(1);
    expect(fs.writes).toBeGreaterThan(0);
  });

  it("ignores document-change events without text changes", async () => {
    const scheduler = new FakeScheduler();
    const fs = new MemoryFs();
    const { controller } = buildController(scheduler, fs);

    await run("adaptivePair.enablePresence");
    harness.emitChange("/workspace/src/pair.ts", { contentChanges: false });
    scheduler.advanceBy(1_000);
    await flush();

    expect(controller.getState().observationCount).toBe(0);
    expect(fs.writes).toBe(0);
  });

  it("cancels a pending edit episode when presence pauses", async () => {
    const scheduler = new FakeScheduler();
    const fs = new MemoryFs();
    const { controller } = buildController(scheduler, fs);

    await run("adaptivePair.enablePresence");
    harness.emitChange("/workspace/src/pair.ts");
    expect(scheduler.pendingCount()).toBe(1);

    await run("adaptivePair.pausePresence");
    expect(scheduler.pendingCount()).toBe(0);

    scheduler.advanceBy(1_000);
    await flush();

    expect(fs.writes).toBe(0);
    expect(controller.getState().presenceStatus).toBe("paused");
  });

  it("cancels a pending edit episode when presence is disabled", async () => {
    const scheduler = new FakeScheduler();
    const fs = new MemoryFs();
    const { controller } = buildController(scheduler, fs);

    await run("adaptivePair.enablePresence");
    harness.emitChange("/workspace/src/pair.ts");
    expect(scheduler.pendingCount()).toBe(1);

    harness.state.warningResponses.push("Disable and clear");
    await run("adaptivePair.disablePresence");
    expect(scheduler.pendingCount()).toBe(0);

    scheduler.advanceBy(1_000);
    await flush();

    expect(fs.writes).toBe(0);
    expect(controller.getState().presenceStatus).toBe("off");
  });
});

describe("PresenceController — out-of-workspace changes", () => {
  it("ignores document changes outside the active workspace", async () => {
    const scheduler = new FakeScheduler();
    const fs = new MemoryFs();
    const { controller } = buildController(scheduler, fs);

    await run("adaptivePair.enablePresence");
    harness.emitChange("/elsewhere/secret.ts");

    expect(scheduler.pendingCount()).toBe(0);
    expect(controller.getState().observationCount).toBe(0);

    scheduler.advanceBy(1_000);
    await flush();

    expect(fs.writes).toBe(0);
    expect(controller.getState().presenceStatus).toBe("observing");
    expect(harness.state.warnings).toEqual([]);
  });
});

describe("PresenceController — journal reconciliation across restart", () => {
  it("reconciles persisted edit episodes into the observation window on a fresh activation", async () => {
    const scheduler = new FakeScheduler();
    const fs = new MemoryFs();

    // First activation: enable Presence, observe one local edit, and let the
    // aggregator flush it to the persisted journal.
    const first = buildController(scheduler, fs);
    await run("adaptivePair.enablePresence");
    harness.emitChange("/workspace/src/pair.ts");
    scheduler.advanceBy(1_000);
    await flush();
    expect(fs.writes).toBeGreaterThan(0);
    expect(first.controller.getState().observationCount).toBe(1);
    first.controller.dispose();

    // Restart: a brand-new activation pointed at the SAME persisted journal must
    // reconcile the durable episode back into its observation window.
    harness.reset();
    const second = buildController(new FakeScheduler(), fs);
    await flush();

    expect(second.controller.getState().observationCount).toBe(1);
  });
});

describe("PresenceController — continuity clearing on disable", () => {
  it("removes the persisted journal so disable clears Pair continuity", async () => {
    const scheduler = new FakeScheduler();
    const fs = new MemoryFs();
    const { controller } = buildController(scheduler, fs);

    await run("adaptivePair.enablePresence");
    harness.emitChange("/workspace/src/pair.ts");
    scheduler.advanceBy(1_000);
    await flush();
    expect(fs.files.has("/journal-storage/journal.jsonl")).toBe(true);

    harness.state.warningResponses.push("Disable and clear");
    await run("adaptivePair.disablePresence");
    await flush();

    expect(fs.removes).toBeGreaterThan(0);
    expect(fs.files.has("/journal-storage/journal.jsonl")).toBe(false);
    expect(controller.getState().presenceStatus).toBe("off");

    // A subsequent restart finds no continuity to reconcile.
    harness.reset();
    const restarted = buildController(new FakeScheduler(), fs);
    await flush();
    expect(restarted.controller.getState().observationCount).toBe(0);
  });

  it("does not restore delayed journal replay after disable clears continuity", async () => {
    const scheduler = new FakeScheduler();
    const fs = new DelayedReadMemoryFs();
    const first = buildController(scheduler, fs);

    await run("adaptivePair.enablePresence");
    harness.emitChange("/workspace/src/pair.ts");
    scheduler.advanceBy(1_000);
    await flush();
    first.controller.dispose();

    harness.reset();
    const delayedRead = fs.delayNextRead();
    const second = buildController(new FakeScheduler(), fs);
    await delayedRead.started;

    const disable = second.controller.performDisable();
    delayedRead.release();
    await disable;

    expect(second.controller.getState().observationCount).toBe(0);
  });
});

describe("PresenceController — untrusted workspace gate", () => {
  it("refuses to enable, observe, or join until the workspace is trusted", async () => {
    const scheduler = new FakeScheduler();
    const fs = new MemoryFs();
    const { controller } = buildController(scheduler, fs);
    harness.state.workspaceTrusted = false;

    await run("adaptivePair.enablePresence");
    await flush();

    expect(controller.getState().presenceStatus).toBe("off");
    expect(controller.getState().documentListenerActive).toBe(false);
    expect(controller.getState().contextKeys["adaptivePair.presenceEnabled"]).toBe(false);
    expect(harness.state.warnings.join("\n")).toContain("trusted workspace");

    // An edit in an untrusted workspace is never observed.
    harness.emitChange("/workspace/src/pair.ts");
    scheduler.advanceBy(1_000);
    await flush();
    expect(controller.getState().observationCount).toBe(0);
    expect(fs.writes).toBe(0);

    await run("adaptivePair.joinInProgress");
    await flush();
    expect(controller.getState().sessionStatus).toBe("inactive");

    // Once the developer trusts the workspace, the same command succeeds.
    harness.state.workspaceTrusted = true;
    await run("adaptivePair.enablePresence");
    await flush();
    expect(controller.getState().presenceStatus).toBe("observing");
  });
});

describe("PresenceController — journal I/O failures", () => {
  it("fails closed with a sanitized warning when a journal write throws", async () => {
    const scheduler = new FakeScheduler();
    const fs = new MemoryFs();
    fs.writeError = Object.assign(new Error("EIO /Users/alice/secret disk failure"), {
      code: "EIO",
    });
    const { controller } = buildController(scheduler, fs);

    await run("adaptivePair.enablePresence");
    harness.emitChange("/workspace/src/pair.ts");
    scheduler.advanceBy(1_000);
    await flush();

    expect(controller.getState().presenceStatus).toBe("paused");
    expect(harness.state.warnings).toHaveLength(1);
    expect(harness.state.warnings[0]).not.toContain("/Users/alice/secret");
    expect(harness.state.warnings[0]).not.toContain("disk failure");
  });
});

describe("NodeJournalFileSystem.readFile", () => {
  let directory: string;

  afterEach(async () => {
    if (directory !== undefined) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns undefined for a missing file but rethrows other errors", async () => {
    directory = await mkdtemp(join(process.cwd(), "journal-io-test-"));
    const fs = new NodeJournalFileSystem();

    await expect(fs.readFile(join(directory, "missing.jsonl"))).resolves.toBeUndefined();

    const nested = join(directory, "as-directory");
    await mkdir(nested);
    await expect(fs.readFile(nested)).rejects.toThrow();
  });
});
