import type { PairEvent, PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { growthRuntime } from "@adaptive-pair/testkit";
import { InMemoryJournal } from "../src/journal.js";
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
  public readonly committedStreamIds: string[] = [];
  private readonly journal: InMemoryJournal;
  private failNextCommit = false;

  public constructor(
    private readonly order: string[],
    initialSnapshot: PairRuntimeSnapshot = growthRuntime(),
    streamId = "workspace-1",
  ) {
    this.journal = new InMemoryJournal(streamId, initialSnapshot);
  }

  public load(streamId: string): Promise<{
    readonly snapshot: PairRuntimeSnapshot;
    readonly seenCommandIds: ReadonlySet<string>;
  }> {
    this.loadedStreamIds.push(streamId);
    return this.journal.load(streamId);
  }

  public async commit(
    streamId: string,
    expectedRevision: number,
    events: readonly PairEvent[],
  ): Promise<PairRuntimeSnapshot> {
    this.committedStreamIds.push(streamId);
    if (this.failNextCommit) {
      this.failNextCommit = false;
      throw new Error("STORE_COMMIT_FAILED");
    }

    const snapshot = await this.journal.commit(streamId, expectedRevision, events);
    for (const event of events) {
      this.order.push(`commit:${event.type}`);
    }
    return snapshot;
  }

  public snapshot(): PairRuntimeSnapshot {
    return this.journal.snapshotNow();
  }

  public events(): readonly PairEvent[] {
    return this.journal.events();
  }

  public failCommittingOnce(): void {
    this.failNextCommit = true;
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
