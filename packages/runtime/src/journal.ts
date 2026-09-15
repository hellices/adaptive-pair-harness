import type { PairEvent, PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { createRuntime, reduce } from "@adaptive-pair/session-core";
import type { PairStore } from "./ports.js";

type StreamState = {
  readonly events: PairEvent[];
  readonly commandIds: Set<string>;
  snapshot: PairRuntimeSnapshot | undefined;
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

  public constructor(private readonly defaultStreamId: string) {}

  public load(streamId: string): Promise<{
    readonly snapshot: PairRuntimeSnapshot;
    readonly seenCommandIds: ReadonlySet<string>;
  }> {
    const stream = this.ensureStream(streamId);

    return Promise.resolve({
      snapshot: cloneFrozen(this.replay(streamId, stream.events)),
      seenCommandIds: new Set(stream.commandIds),
    });
  }

  public append(streamId: string, events: readonly PairEvent[]): Promise<void> {
    const stream = this.ensureStream(streamId);
    let nextRevision = stream.events.at(-1)?.revision ?? 0;
    const existingCommandIds = stream.commandIds;

    for (const event of events) {
      nextRevision += 1;

      if (event.revision !== nextRevision) {
        return Promise.reject(new Error("NON_CONTIGUOUS_REVISION"));
      }

      if (existingCommandIds.has(event.commandId)) {
        return Promise.reject(new Error("DUPLICATE_COMMAND_ID"));
      }
    }

    for (const event of events) {
      stream.events.push(cloneFrozen(event));
      stream.commandIds.add(event.commandId);
    }

    stream.snapshot = undefined;
    return Promise.resolve();
  }

  public saveSnapshot(
    streamId: string,
    snapshot: PairRuntimeSnapshot,
  ): Promise<void> {
    const stream = this.ensureStream(streamId);
    stream.snapshot = cloneFrozen(snapshot);
    return Promise.resolve();
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
      snapshot: undefined,
    };

    this.streams.set(streamId, created);
    return created;
  }

  private replay(
    streamId: string,
    events: readonly PairEvent[],
  ): PairRuntimeSnapshot {
    let snapshot = createRuntime(streamId);

    for (const event of events) {
      snapshot = reduce(snapshot, [event]);
    }

    return snapshot;
  }
}
