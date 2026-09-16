import type { PairEvent, PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { FakeClock, FakeIdSource, growthRuntime } from "@adaptive-pair/testkit";
import { PairCoordinator } from "../src/coordinator.js";
import { InMemoryJournal } from "../src/journal.js";
import type { EffectPort, EffectRequest, EffectResult, PairStore } from "../src/ports.js";

export const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(accept => {
    resolve = accept;
  });
  return { promise, resolve };
};

interface Gate<Value> {
  readonly reached: Promise<Value>;
  release(): void;
  hold(value: Value): Promise<Value>;
}

const createGate = <Value>(): Gate<Value> => {
  const reached = deferred<Value>();
  const released = deferred<void>();
  return {
    reached: reached.promise,
    release: () => released.resolve(),
    async hold(value) {
      reached.resolve(value);
      await released.promise;
      return value;
    },
  };
};

type LoadedState = Awaited<ReturnType<PairStore["load"]>>;

export class GatedJournal implements PairStore {
  public readonly journal = new InMemoryJournal("workspace-1", growthRuntime());
  private loadGate: { remaining: number; readonly gate: Gate<LoadedState> } | undefined;
  private commitGate: { readonly type: PairEvent["type"]; readonly gate: Gate<PairRuntimeSnapshot> } | undefined;

  public delayNextLoad(skip = 0): Gate<LoadedState> {
    const gate = createGate<LoadedState>();
    this.loadGate = { remaining: skip, gate };
    return gate;
  }

  public delayCommit(type: PairEvent["type"]): Gate<PairRuntimeSnapshot> {
    const gate = createGate<PairRuntimeSnapshot>();
    this.commitGate = { type, gate };
    return gate;
  }

  public load(streamId: string): Promise<LoadedState> {
    const loaded = this.journal.load(streamId);
    if (this.loadGate === undefined) {
      return loaded;
    }
    if (this.loadGate.remaining > 0) {
      this.loadGate.remaining -= 1;
      return loaded;
    }
    const { gate } = this.loadGate;
    this.loadGate = undefined;
    return loaded.then(state => gate.hold(state));
  }

  public async commit(
    streamId: string,
    expectedRevision: number,
    events: readonly PairEvent[],
  ): Promise<PairRuntimeSnapshot> {
    const snapshot = await this.journal.commit(streamId, expectedRevision, events);
    const delayed = this.commitGate;
    if (delayed !== undefined && events.some(event => event.type === delayed.type)) {
      this.commitGate = undefined;
      return delayed.gate.hold(snapshot);
    }
    return snapshot;
  }
}

export const confirmedEffect = (request: EffectRequest): EffectResult => ({
  operationId: request.operationId,
  status: "confirmed",
  summary: "Observed fixture effect.",
  sensitiveData: false,
  partial: false,
});

export const createInterleavingFixture = (effects: EffectPort) => {
  const store = new GatedJournal();
  const coordinator = new PairCoordinator({
    store,
    effects,
    clock: new FakeClock(),
    ids: new FakeIdSource(),
    streamId: "workspace-1",
  });
  return { coordinator, store };
};
