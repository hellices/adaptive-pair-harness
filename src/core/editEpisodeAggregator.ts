import type { EditEpisode, EditSnapshot, Scheduler } from "./types";

interface PendingEpisode {
  readonly previousText: string;
  readonly snapshot: EditSnapshot;
  readonly timer: unknown;
}

export class EditEpisodeAggregator {
  private readonly pendingByUri = new Map<string, PendingEpisode>();
  private disposed = false;

  public constructor(
    private readonly debounceMs: number,
    private readonly scheduler: Scheduler,
    private readonly onEpisode: (episode: EditEpisode) => void,
  ) {}

  public record(snapshot: EditSnapshot): void {
    if (this.disposed) {
      return;
    }

    const existing = this.pendingByUri.get(snapshot.uri);
    if (existing !== undefined) {
      this.scheduler.cancel(existing.timer);
    }

    const previousText = existing?.previousText ?? snapshot.previousText;
    const pending: PendingEpisode = {
      previousText,
      snapshot,
      timer: this.scheduler.schedule(this.debounceMs, () => {
        const current = this.pendingByUri.get(snapshot.uri);
        if (current?.timer !== pending.timer) {
          return;
        }

        this.pendingByUri.delete(snapshot.uri);
        this.onEpisode({
          uri: snapshot.uri,
          languageId: pending.snapshot.languageId,
          previousText: pending.previousText,
          currentText: pending.snapshot.currentText,
          version: pending.snapshot.version,
          observedAt: pending.snapshot.observedAt,
        });
      }),
    };

    this.pendingByUri.set(snapshot.uri, pending);
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
