import type { PairEvent, PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { growthRuntime } from "@adaptive-pair/testkit";
import type {
  EffectPort,
  EffectRequest,
  EffectResult,
  PairStore,
} from "../src/index.js";

type DeferredResult = {
  readonly request: EffectRequest;
  readonly signal: AbortSignal;
  readonly resolve: (value: EffectResult) => void;
};

export class FakePairStore implements PairStore {
  public readonly loadedStreamIds: string[] = [];
  public readonly appendedStreamIds: string[] = [];
  public readonly savedStreamIds: string[] = [];
  private snapshotValue: PairRuntimeSnapshot;
  private readonly commandIds = new Set<string>();
  private readonly eventsValue: PairEvent[] = [];
  private failNextAppend = false;
  private failNextSave = false;

  public constructor(
    private readonly order: string[],
    initialSnapshot: PairRuntimeSnapshot = growthRuntime(),
  ) {
    this.snapshotValue = structuredClone(initialSnapshot);
  }

  public load(streamId: string): Promise<{
    readonly snapshot: PairRuntimeSnapshot;
    readonly seenCommandIds: ReadonlySet<string>;
  }> {
    this.loadedStreamIds.push(streamId);
    return Promise.resolve({
      snapshot: structuredClone(this.snapshotValue),
      seenCommandIds: new Set(this.commandIds),
    });
  }

  public append(streamId: string, events: readonly PairEvent[]): Promise<void> {
    this.appendedStreamIds.push(streamId);
    if (this.failNextAppend) {
      this.failNextAppend = false;
      return Promise.reject(new Error("STORE_APPEND_FAILED"));
    }

    for (const event of events) {
      this.order.push(`append:${event.type}`);
      this.commandIds.add(event.commandId);
      this.eventsValue.push(structuredClone(event));
    }

    return Promise.resolve();
  }

  public saveSnapshot(streamId: string, snapshot: PairRuntimeSnapshot): Promise<void> {
    this.savedStreamIds.push(streamId);
    if (this.failNextSave) {
      this.failNextSave = false;
      return Promise.reject(new Error("STORE_SAVE_FAILED"));
    }

    this.snapshotValue = structuredClone(snapshot);
    return Promise.resolve();
  }

  public snapshot(): PairRuntimeSnapshot {
    return structuredClone(this.snapshotValue);
  }

  public events(): readonly PairEvent[] {
    return Object.freeze(this.eventsValue.map(event => structuredClone(event)));
  }

  public failSavingOnce(): void {
    this.failNextSave = true;
  }

  public failAppendingOnce(): void {
    this.failNextAppend = true;
  }
}

export class FakeEffectPort implements EffectPort {
  public readonly calls: EffectRequest[] = [];
  private readonly pending: DeferredResult[] = [];

  public constructor(
    private readonly order: string[],
    private readonly options: {
      readonly outcome?: EffectResult["status"];
      readonly summary?: string;
      readonly block?: boolean;
      readonly ignoreAbort?: boolean;
    } = {},
  ) {}

  public async execute(request: EffectRequest, signal: AbortSignal): Promise<EffectResult> {
    this.calls.push(structuredClone(request));
    this.order.push(`effect:${request.kind}`);

    if (this.options.block === true) {
      return await new Promise<EffectResult>((resolve) => {
        const deferred: DeferredResult = {
          request,
          signal,
          resolve,
        };
        this.pending.push(deferred);

        signal.addEventListener(
          "abort",
          () => {
            if (this.options.ignoreAbort === true) {
              return;
            }
            resolve({
              operationId: request.operationId,
              status: "cancelled",
              summary: "Effect cancelled.",
              observation: {
                aborted: true,
              },
              sensitiveData: false,
              partial: false,
            });
          },
          { once: true },
        );
      });
    }

    return {
      operationId: request.operationId,
      status: this.options.outcome ?? "confirmed",
      summary: this.options.summary ?? "Fixture effect result.",
      observation: {
        toolName: request.toolName,
      },
      sensitiveData: false,
      partial: false,
    };
  }

  public async releaseNext(
    override: Partial<EffectResult> = {},
  ): Promise<void> {
    const deferred = this.pending.shift();

    if (deferred === undefined) {
      throw new Error("NO_PENDING_EFFECT");
    }

    deferred.resolve({
      operationId: deferred.request.operationId,
      status: override.status ?? this.options.outcome ?? "confirmed",
      summary: override.summary ?? this.options.summary ?? "Fixture effect result.",
      observation: override.observation ?? {
        released: true,
      },
      sensitiveData: override.sensitiveData ?? false,
      partial: override.partial ?? false,
    });

    await Promise.resolve();
  }

  public pendingCount(): number {
    return this.pending.length;
  }
}
