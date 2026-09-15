export interface LineRange {
  readonly startLine: number;
  readonly endLine: number;
}

export interface EditEpisode {
  readonly uri: string;
  readonly languageId: string;
  readonly previousVersion: number;
  readonly currentVersion: number;
  readonly changedRanges: readonly LineRange[];
  readonly observedAt: number;
}

export interface EditObservation {
  readonly uri: string;
  readonly languageId: string;
  readonly previousVersion: number;
  readonly currentVersion: number;
  readonly changedRanges: readonly LineRange[];
  readonly observedAt: number;
}

export interface Scheduler {
  schedule(delayMs: number, callback: () => void): unknown;
  cancel(handle: unknown): void;
}

interface PendingEpisode {
  readonly previousVersion: number;
  currentVersion: number;
  readonly languageId: string;
  ranges: LineRange[];
  observedAt: number;
  timer: unknown;
}

const normalizeRange = (range: LineRange): LineRange => {
  if (
    !Number.isSafeInteger(range.startLine) ||
    !Number.isSafeInteger(range.endLine) ||
    range.startLine < 0 ||
    range.endLine < range.startLine
  ) {
    throw new Error("Edit ranges must be ordered non-negative safe integers.");
  }

  return { startLine: range.startLine, endLine: range.endLine };
};

const mergeRanges = (ranges: readonly LineRange[]): LineRange[] => {
  const sorted = [...ranges]
    .map(normalizeRange)
    .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);

  const merged: LineRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && range.startLine <= last.endLine + 1) {
      if (range.endLine > last.endLine) {
        merged[merged.length - 1] = {
          startLine: last.startLine,
          endLine: range.endLine,
        };
      }
      continue;
    }
    merged.push(range);
  }

  return merged;
};

export class EditEpisodeAggregator {
  private readonly pendingByUri = new Map<string, PendingEpisode>();
  private disposed = false;

  public constructor(
    private readonly debounceMs: number,
    private readonly scheduler: Scheduler,
    private readonly onEpisode: (episode: EditEpisode) => void,
  ) {
    if (!Number.isSafeInteger(debounceMs) || debounceMs < 0) {
      throw new Error("Debounce must be a non-negative safe integer.");
    }
  }

  public record(observation: EditObservation): void {
    if (this.disposed) {
      return;
    }

    const existing = this.pendingByUri.get(observation.uri);
    const previousVersion = existing?.previousVersion ?? observation.previousVersion;
    const ranges = mergeRanges([
      ...(existing?.ranges ?? []),
      ...observation.changedRanges,
    ]);
    if (existing !== undefined) {
      this.scheduler.cancel(existing.timer);
    }

    const pending: PendingEpisode = {
      previousVersion,
      currentVersion: observation.currentVersion,
      languageId: observation.languageId,
      ranges,
      observedAt: observation.observedAt,
      timer: undefined,
    };

    pending.timer = this.scheduler.schedule(this.debounceMs, () => {
      const current = this.pendingByUri.get(observation.uri);
      if (current?.timer !== pending.timer) {
        return;
      }

      this.pendingByUri.delete(observation.uri);
      this.onEpisode(
        Object.freeze({
          uri: observation.uri,
          languageId: pending.languageId,
          previousVersion: pending.previousVersion,
          currentVersion: pending.currentVersion,
          changedRanges: Object.freeze(pending.ranges.map(range => Object.freeze(range))),
          observedAt: pending.observedAt,
        }),
      );
    });

    this.pendingByUri.set(observation.uri, pending);
  }

  public cancel(uri: string): void {
    const pending = this.pendingByUri.get(uri);
    if (pending === undefined) {
      return;
    }

    this.pendingByUri.delete(uri);
    this.scheduler.cancel(pending.timer);
  }

  public clear(): void {
    for (const pending of this.pendingByUri.values()) {
      this.scheduler.cancel(pending.timer);
    }
    this.pendingByUri.clear();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.clear();
  }
}
