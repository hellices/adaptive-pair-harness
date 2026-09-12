import { describe, expect, it } from "vitest";
import { EditEpisodeAggregator } from "../src/core/editEpisodeAggregator";
import type { EditEpisode, EditSnapshot, Scheduler } from "../src/core/types";

class FakeScheduler implements Scheduler {
  private nextHandleId = 1;
  private now = 0;
  private readonly tasks = new Map<number, { readonly runAt: number; readonly callback: () => void }>();

  schedule(delayMs: number, callback: () => void): number {
    const handle = this.nextHandleId++;
    this.tasks.set(handle, { runAt: this.now + delayMs, callback });
    return handle;
  }

  cancel(handle: unknown): void {
    if (typeof handle === "number") {
      this.tasks.delete(handle);
    }
  }

  advanceBy(milliseconds: number): void {
    this.now += milliseconds;

    let dueTask = [...this.tasks.entries()].find(([, task]) => task.runAt <= this.now);
    while (dueTask !== undefined) {
      const [handle, task] = dueTask;
      this.tasks.delete(handle);
      task.callback();

      dueTask = [...this.tasks.entries()].find(([, task]) => task.runAt <= this.now);
    }
  }
}

const snapshot = (
  previousText: string,
  currentText: string,
  version: number,
  uri = "file:///pair.ts",
): EditSnapshot => ({
  uri,
  languageId: "typescript",
  previousText,
  currentText,
  version,
  observedAt: version,
});

describe("EditEpisodeAggregator", () => {
  it("coalesces rapid edits into one episode with the first before-text", () => {
    const scheduler = new FakeScheduler();
    const episodes: EditEpisode[] = [];
    const aggregator = new EditEpisodeAggregator(500, scheduler, (episode) => {
      episodes.push(episode);
    });

    aggregator.record(snapshot("before", "first", 2));
    aggregator.record(snapshot("first", "final", 3));

    scheduler.advanceBy(499);
    expect(episodes).toEqual([]);

    scheduler.advanceBy(1);
    expect(episodes).toEqual([
      expect.objectContaining({
        previousText: "before",
        currentText: "final",
        version: 3,
      }),
    ]);
  });

  it("keeps document timers independent and stops emitting after dispose", () => {
    const scheduler = new FakeScheduler();
    const episodes: EditEpisode[] = [];
    const aggregator = new EditEpisodeAggregator(200, scheduler, (episode) => {
      episodes.push(episode);
    });

    aggregator.record(snapshot("a-before", "a-after", 1, "file:///a.ts"));
    aggregator.record(snapshot("b-before", "b-after", 1, "file:///b.ts"));

    scheduler.advanceBy(200);
    expect(episodes).toEqual([
      expect.objectContaining({
        uri: "file:///a.ts",
        previousText: "a-before",
      }),
      expect.objectContaining({
        uri: "file:///b.ts",
        previousText: "b-before",
      }),
    ]);

    aggregator.record(snapshot("a-again-before", "a-again-after", 2, "file:///a.ts"));
    aggregator.dispose();
    scheduler.advanceBy(200);

    expect(episodes).toHaveLength(2);
  });

  it("cancels one document without emitting even if its stale callback runs", () => {
    const callbacks = new Map<number, () => void>();
    let nextHandle = 1;
    const scheduler: Scheduler = {
      schedule: (_delayMs, callback) => {
        const handle = nextHandle++;
        callbacks.set(handle, callback);
        return handle;
      },
      cancel: () => {
        // Deliberately retain callbacks to simulate an already-queued timer.
      },
    };
    const episodes: EditEpisode[] = [];
    const aggregator = new EditEpisodeAggregator(500, scheduler, (episode) => {
      episodes.push(episode);
    });

    aggregator.record(snapshot("before", "after", 2, "file:///closed.ts"));
    const cancel = (
      aggregator as EditEpisodeAggregator & { cancel(uri: string): void }
    ).cancel;
    expect(cancel).toBeTypeOf("function");
    cancel.call(aggregator, "file:///closed.ts");
    callbacks.get(1)?.();

    expect(episodes).toEqual([]);
  });
});
