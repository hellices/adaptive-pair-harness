import { describe, expect, it } from "vitest";
import {
  EditEpisodeAggregator,
  createLocalEvidence,
  MAX_EVIDENCE_DETAIL,
  type EditEpisode,
  type EditObservation,
  type Scheduler,
} from "../src/index.js";

class FakeScheduler implements Scheduler {
  private nextHandleId = 1;
  private now = 0;
  private readonly tasks = new Map<
    number,
    { readonly runAt: number; readonly callback: () => void }
  >();

  public schedule(delayMs: number, callback: () => void): number {
    const handle = this.nextHandleId++;
    this.tasks.set(handle, { runAt: this.now + delayMs, callback });
    return handle;
  }

  public cancel(handle: unknown): void {
    if (typeof handle === "number") {
      this.tasks.delete(handle);
    }
  }

  public advanceBy(milliseconds: number): void {
    this.now += milliseconds;
    let due = [...this.tasks.entries()].find(([, task]) => task.runAt <= this.now);
    while (due !== undefined) {
      const [handle, task] = due;
      this.tasks.delete(handle);
      task.callback();
      due = [...this.tasks.entries()].find(([, task]) => task.runAt <= this.now);
    }
  }
}

const observation = (
  previousVersion: number,
  currentVersion: number,
  changedRanges: readonly { readonly startLine: number; readonly endLine: number }[],
  uri = "file:///pair.ts",
): EditObservation => ({
  uri,
  languageId: "typescript",
  previousVersion,
  currentVersion,
  changedRanges,
  observedAt: currentVersion,
});

describe("EditEpisodeAggregator", () => {
  it("coalesces rapid edits keeping the first previous version and last current version", () => {
    const scheduler = new FakeScheduler();
    const episodes: EditEpisode[] = [];
    const aggregator = new EditEpisodeAggregator(500, scheduler, episode => {
      episodes.push(episode);
    });

    aggregator.record(observation(1, 2, [{ startLine: 3, endLine: 3 }]));
    aggregator.record(observation(2, 3, [{ startLine: 10, endLine: 12 }]));

    scheduler.advanceBy(499);
    expect(episodes).toEqual([]);

    scheduler.advanceBy(1);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({
      previousVersion: 1,
      currentVersion: 3,
      changedRanges: [
        { startLine: 3, endLine: 3 },
        { startLine: 10, endLine: 12 },
      ],
    });
  });

  it("merges overlapping and adjacent changed ranges", () => {
    const scheduler = new FakeScheduler();
    const episodes: EditEpisode[] = [];
    const aggregator = new EditEpisodeAggregator(200, scheduler, episode => {
      episodes.push(episode);
    });

    aggregator.record(observation(1, 2, [{ startLine: 5, endLine: 8 }]));
    aggregator.record(observation(2, 3, [{ startLine: 7, endLine: 10 }]));
    aggregator.record(observation(3, 4, [{ startLine: 11, endLine: 11 }]));

    scheduler.advanceBy(200);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]?.changedRanges).toEqual([{ startLine: 5, endLine: 11 }]);
  });

  it("never retains previous or current buffer text on emitted episodes", () => {
    const scheduler = new FakeScheduler();
    const episodes: EditEpisode[] = [];
    const aggregator = new EditEpisodeAggregator(100, scheduler, episode => {
      episodes.push(episode);
    });

    aggregator.record(observation(1, 2, [{ startLine: 0, endLine: 0 }]));
    scheduler.advanceBy(100);

    const emitted = episodes[0];
    expect(emitted).toBeDefined();
    expect(Object.keys(emitted as EditEpisode)).not.toContain("previousText");
    expect(Object.keys(emitted as EditEpisode)).not.toContain("currentText");
    expect(Object.isFrozen(emitted)).toBe(true);
  });

  it("keeps per-document timers independent and stops emitting after dispose", () => {
    const scheduler = new FakeScheduler();
    const episodes: EditEpisode[] = [];
    const aggregator = new EditEpisodeAggregator(200, scheduler, episode => {
      episodes.push(episode);
    });

    aggregator.record(observation(1, 2, [{ startLine: 0, endLine: 0 }], "file:///a.ts"));
    aggregator.record(observation(1, 2, [{ startLine: 1, endLine: 1 }], "file:///b.ts"));
    scheduler.advanceBy(200);
    expect(episodes.map(episode => episode.uri)).toEqual([
      "file:///a.ts",
      "file:///b.ts",
    ]);

    aggregator.record(observation(2, 3, [{ startLine: 2, endLine: 2 }], "file:///a.ts"));
    aggregator.dispose();
    scheduler.advanceBy(200);
    expect(episodes).toHaveLength(2);
  });

  it("clears pending episodes without preventing a later episode", () => {
    const scheduler = new FakeScheduler();
    const episodes: EditEpisode[] = [];
    const aggregator = new EditEpisodeAggregator(200, scheduler, episode => {
      episodes.push(episode);
    });

    aggregator.record(observation(1, 2, [{ startLine: 0, endLine: 0 }]));
    aggregator.clear();
    scheduler.advanceBy(200);
    expect(episodes).toEqual([]);

    aggregator.record(observation(2, 3, [{ startLine: 4, endLine: 4 }]));
    scheduler.advanceBy(200);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]?.previousVersion).toBe(2);
  });

  it("keeps a pending valid episode when a later range is invalid", () => {
    const scheduler = new FakeScheduler();
    const episodes: EditEpisode[] = [];
    const aggregator = new EditEpisodeAggregator(200, scheduler, episode => {
      episodes.push(episode);
    });

    aggregator.record(observation(1, 2, [{ startLine: 4, endLine: 6 }]));
    expect(() =>
      aggregator.record(observation(2, 3, [{ startLine: 7, endLine: 5 }])),
    ).toThrow(/ordered non-negative/u);

    scheduler.advanceBy(200);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({
      previousVersion: 1,
      currentVersion: 2,
      changedRanges: [{ startLine: 4, endLine: 6 }],
    });
  });
});

describe("createLocalEvidence", () => {
  it("records provenance, freshness, and privacy class", () => {
    const evidence = createLocalEvidence({
      id: "ev-1",
      provenance: "local-edit",
      privacyClass: "summary",
      detail: "src/pair.ts changed near lines 10-12",
      observedAt: 1_000,
      now: 1_200,
      freshnessWindowMs: 5_000,
    });

    expect(evidence).toMatchObject({
      id: "ev-1",
      provenance: "local-edit",
      privacyClass: "summary",
      freshness: "fresh",
    });
    expect(Object.isFrozen(evidence)).toBe(true);
  });

  it("marks evidence stale once it falls outside the freshness window", () => {
    const evidence = createLocalEvidence({
      id: "ev-2",
      provenance: "diagnostic",
      privacyClass: "summary",
      detail: "src/pair.ts:12 unused variable",
      observedAt: 1_000,
      now: 100_000,
      freshnessWindowMs: 5_000,
    });

    expect(evidence.freshness).toBe("stale");
  });

  it("bounds detail to the privacy limit", () => {
    const evidence = createLocalEvidence({
      id: "ev-3",
      provenance: "workspace-validation",
      privacyClass: "summary",
      detail: "x".repeat(MAX_EVIDENCE_DETAIL + 120),
      observedAt: 1_000,
      now: 1_000,
    });

    expect(evidence.detail.length).toBeLessThanOrEqual(MAX_EVIDENCE_DETAIL);
  });

  it("rejects absolute paths so they never enter local evidence", () => {
    expect(() =>
      createLocalEvidence({
        id: "ev-4",
        provenance: "diagnostic",
        privacyClass: "summary",
        detail: "leaked /Users/alice/project/src/secret.ts value",
        observedAt: 1_000,
        now: 1_000,
      }),
    ).toThrowError(/absolute path/i);
  });

  it.each([
    "/secret.txt",
    "Read failed: /secret.txt",
  ])("rejects root-level POSIX path detail %s", detail => {
    expect(() =>
      createLocalEvidence({
        id: "ev-root-path",
        provenance: "diagnostic",
        privacyClass: "summary",
        detail,
        observedAt: 1_000,
        now: 1_000,
      }),
    ).toThrowError(/absolute path/i);
  });

  it("rejects multi-line raw content so transcripts never enter local evidence", () => {
    expect(() =>
      createLocalEvidence({
        id: "ev-5",
        provenance: "diagnostic",
        privacyClass: "summary",
        detail: "line one\nline two",
        observedAt: 1_000,
        now: 1_000,
      }),
    ).toThrowError(/single line/i);
  });
});
