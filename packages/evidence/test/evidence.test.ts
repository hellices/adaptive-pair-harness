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

const createAggregator = (debounceMs: number) => {
  const scheduler = new FakeScheduler();
  const episodes: EditEpisode[] = [];
  const aggregator = new EditEpisodeAggregator(debounceMs, scheduler, episode => {
    episodes.push(episode);
  });

  return { scheduler, episodes, aggregator };
};

describe("EditEpisodeAggregator", () => {
  it("coalesces rapid edits keeping the first previous version and last current version", () => {
    const { scheduler, episodes, aggregator } = createAggregator(500);

    aggregator.record(observation(1, 2, [{ startLine: 3, endLine: 3 }]));
    aggregator.record(observation(2, 3, [{ startLine: 10, endLine: 12 }]));

    scheduler.advanceBy(499);
    expect(episodes).toEqual([]);

    scheduler.advanceBy(1);
    expect(episodes).toEqual([
      {
        uri: "file:///pair.ts",
        languageId: "typescript",
        previousVersion: 1,
        currentVersion: 3,
        changedRanges: [
          { startLine: 3, endLine: 3 },
          { startLine: 10, endLine: 12 },
        ],
        observedAt: 3,
      },
    ]);
    expect(Object.isFrozen(episodes[0])).toBe(true);
  });

  it("merges overlapping and adjacent changed ranges", () => {
    const { scheduler, episodes, aggregator } = createAggregator(200);

    aggregator.record(observation(1, 2, [{ startLine: 5, endLine: 8 }]));
    aggregator.record(observation(2, 3, [{ startLine: 7, endLine: 10 }]));
    aggregator.record(observation(3, 4, [{ startLine: 11, endLine: 11 }]));

    scheduler.advanceBy(200);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]?.changedRanges).toEqual([{ startLine: 5, endLine: 11 }]);
  });

  it("keeps per-document timers independent and stops emitting after dispose", () => {
    const { scheduler, episodes, aggregator } = createAggregator(200);

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
    const { scheduler, episodes, aggregator } = createAggregator(200);

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
    const { scheduler, episodes, aggregator } = createAggregator(200);

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

  it.each([
    "/secret.txt",
    "Read failed: /secret.txt",
    "//server/share/secret.ts",
    "///home/alice/private.ts",
    "file:///Users/alice/private.ts",
    "file:%2F%2F%2FUsers%2Falice%2Fprivate.ts",
    "\\\\server\\share\\secret.ts",
  ])("rejects absolute path detail %s", detail => {
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

  it.each([
    "See http://example.com/docs/path for context",
    "myfile:value",
    "File: changed",
  ])("preserves non-file URI text %s", detail => {
    const evidence = createLocalEvidence({
      id: "ev-url",
      provenance: "diagnostic",
      privacyClass: "summary",
      detail,
      observedAt: 1_000,
      now: 1_000,
    });

    expect(evidence.detail).toBe(detail);
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
