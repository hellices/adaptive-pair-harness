import type { PairEvent, PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { createRuntime, reduce } from "@adaptive-pair/session-core";
import type { PairStore } from "./ports.js";

type StreamState = {
  readonly events: readonly PairEvent[];
  readonly commandIds: ReadonlySet<string>;
  readonly snapshot: PairRuntimeSnapshot;
};

const cloneFrozen = <Value>(value: Value): Value => {
  const deepFreeze = (current: unknown): void => {
    if (typeof current !== "object" || current === null) {
      return;
    }

    for (const key of Object.keys(current)) {
      deepFreeze((current as Record<string, unknown>)[key]);
    }

    Object.freeze(current);
  };

  const clone = structuredClone(value);
  deepFreeze(clone);
  return clone;
};

export class InMemoryJournal implements PairStore {
  private readonly streams = new Map<string, StreamState>();

  public constructor(
    private readonly defaultStreamId: string,
    initialSnapshot = createRuntime(defaultStreamId),
  ) {
    this.streams.set(defaultStreamId, {
      events: [],
      commandIds: new Set<string>(),
      snapshot: cloneFrozen(initialSnapshot),
    });
  }

  public snapshotNow(streamId = this.defaultStreamId): PairRuntimeSnapshot {
    return this.ensureStream(streamId).snapshot;
  }

  public load(streamId: string): Promise<{
    readonly snapshot: PairRuntimeSnapshot;
    readonly seenCommandIds: ReadonlySet<string>;
  }> {
    const stream = this.ensureStream(streamId);

    return Promise.resolve({
      snapshot: stream.snapshot,
      seenCommandIds: new Set(stream.commandIds),
    });
  }

  public commit(
    streamId: string,
    expectedRevision: number,
    events: readonly PairEvent[],
  ): Promise<PairRuntimeSnapshot> {
    try {
      const stream = this.ensureStream(streamId);
      if (expectedRevision !== stream.snapshot.revision) {
        throw new Error("STALE_REVISION");
      }

      let nextRevision = expectedRevision;
      const committedEvents = cloneFrozen(events);
      for (const event of committedEvents) {
        nextRevision += 1;
        if (event.revision !== nextRevision) {
          throw new Error("NON_CONTIGUOUS_REVISION");
        }
        if (stream.commandIds.has(event.commandId)) {
          throw new Error("DUPLICATE_COMMAND_ID");
        }
      }

      const snapshot = reduce(stream.snapshot, committedEvents);
      const commandIds = new Set(stream.commandIds);
      for (const event of committedEvents) {
        commandIds.add(event.commandId);
      }
      const disabledAt = committedEvents.findLastIndex(
        event => event.type === "PresenceChanged" && event.status === "off",
      );
      this.streams.set(streamId, {
        events: disabledAt < 0
          ? [...stream.events, ...committedEvents]
          : committedEvents.slice(disabledAt),
        commandIds,
        snapshot,
      });
      return Promise.resolve(snapshot);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error("STORE_COMMIT_FAILED", { cause: error }));
    }
  }

  public events(streamId = this.defaultStreamId): readonly PairEvent[] {
    return Object.freeze(
      this.ensureStream(streamId).events.map(event => cloneFrozen(event)),
    );
  }

  private ensureStream(streamId: string): StreamState {
    const existing = this.streams.get(streamId);

    if (existing !== undefined) {
      return existing;
    }

    const created: StreamState = {
      events: [],
      commandIds: new Set<string>(),
      snapshot: createRuntime(streamId),
    };

    this.streams.set(streamId, created);
    return created;
  }
}
