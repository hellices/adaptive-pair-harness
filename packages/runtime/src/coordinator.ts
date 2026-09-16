import {
  compileInstructions,
  nativeToolName,
  type PairToolName,
  toolsFor,
} from "@adaptive-pair/harness";
import type {
  OperationRecord,
  PairCommand,
  PairEvent,
  PairRuntimeSnapshot,
} from "@adaptive-pair/protocol";
import { decide, reduce } from "@adaptive-pair/session-core";
import type {
  Clock,
  EffectPort,
  IdSource,
  InvokeToolOptions,
  PairCoordinatorPort,
  PairPresencePort,
  PairStore,
  PairToolResult,
  PreparedTurn,
  PrepareTurnInput,
} from "./ports.js";
import { ToolExecutor } from "./toolExecutor.js";

const isTerminalOperationStatus = (status: OperationRecord["status"]): boolean =>
  status === "confirmed" ||
  status === "failed" ||
  status === "declined" ||
  status === "cancelled" ||
  status === "unknown";

export class PairCoordinator implements PairCoordinatorPort, PairPresencePort {
  private transitionQueue: Promise<void> = Promise.resolve();
  private readonly toolExecutor: ToolExecutor;

  public constructor(
    private readonly options: {
      readonly store: PairStore;
      readonly effects: EffectPort;
      readonly clock: Clock;
      readonly ids: IdSource;
      readonly streamId: string;
    },
  ) {
    this.toolExecutor = new ToolExecutor({
      ...options, state: this,
      observeResult: (operation, result) => this.observeResult(operation, result),
      admitReadRecovery: operationId => this.enqueueTransition(async () =>
        this.toolExecutor.admitReadRecovery(await this.snapshot(), operationId),
      ),
    });
  }

  public async snapshot(): Promise<PairRuntimeSnapshot> {
    return (await this.loadState()).snapshot;
  }

  public dispatch(command: PairCommand): Promise<PairRuntimeSnapshot> {
    return this.enqueueTransition(() => this.commitCommand(command));
  }

  public setPresence(
    status: "observing" | "quiet" | "paused" | "off",
    workspaceId?: string,
  ): Promise<PairRuntimeSnapshot> {
    return this.enqueueTransition(async () => {
      const snapshot = await this.snapshot();
      let staged = snapshot;
      const events: PairEvent[] = [];
      const stage = (command: PairCommand): void => {
        const decision = decide(staged, command);
        staged = reduce(staged, decision.events);
        events.push(...decision.events);
      };

      if (workspaceId !== undefined && status !== "off" && status !== "paused") {
        stage({
          protocolVersion: 1,
          commandId: this.options.ids.next("command"),
          expectedRevision: staged.revision,
          actor: "human",
          observedAt: this.options.clock.now(),
          type: "EnablePresence",
          workspaceId,
        });
      }
      stage({
        protocolVersion: 1,
        commandId: this.options.ids.next("command"),
        expectedRevision: staged.revision,
        actor: "human",
        observedAt: this.options.clock.now(),
        type: "SetPresence",
        status,
      });
      if (events.length === 0) {
        return snapshot;
      }
      const next = await this.options.store.commit(this.streamId(), snapshot.revision, events);
      this.toolExecutor.invalidate(next);
      return next;
    });
  }

  public observeWorkspace(): Promise<PairRuntimeSnapshot> {
    return this.enqueueTransition(async () => {
      const snapshot = await this.snapshot();
      return this.commitCommand({
        protocolVersion: 1,
        commandId: this.options.ids.next("command"),
        expectedRevision: snapshot.revision,
        actor: "host",
        observedAt: this.options.clock.now(),
        type: "ObserveWorkspace",
      });
    });
  }

  private enqueueTransition<Value>(transition: () => Promise<Value>): Promise<Value> {
    const result = this.transitionQueue.then(transition);
    this.transitionQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async commitCommand(command: PairCommand, signal?: AbortSignal): Promise<PairRuntimeSnapshot> {
    signal?.throwIfAborted();
    const { snapshot, seenCommandIds } = await this.loadState();
    signal?.throwIfAborted();
    const streamId = this.streamId();

    if (seenCommandIds.has(command.commandId)) {
      return snapshot;
    }

    const decision = decide(snapshot, command);

    if (decision.events.length === 0) {
      return snapshot;
    }

    const next = await this.options.store.commit(streamId, snapshot.revision, decision.events);
    this.toolExecutor.invalidate(next);
    return next;
  }

  public async grantUserAction(
    name: PairToolName,
    signal: AbortSignal,
    options?: {
      readonly runtimeRevision: number;
      readonly authorityEpoch: number | undefined;
    },
  ): Promise<string> {
    signal.throwIfAborted();
    const current = await this.snapshot();
    signal.throwIfAborted();
    if (
      options !== undefined &&
      (options.runtimeRevision !== current.revision ||
        options.authorityEpoch !== current.session?.authorityEpoch)
    ) {
      throw new Error("STALE_TOOL_VIEW");
    }
    const view = toolsFor(current);
    const descriptor = view.tools.find(tool => tool.name === name);

    if (descriptor === undefined) {
      throw new Error("TOOL_HIDDEN");
    }

    const owner = current.session?.workUnit?.owner ?? "none";
    if (
      descriptor.requiredEditOwner !== "either" &&
      descriptor.requiredEditOwner !== owner
    ) {
      throw new Error("WRONG_OWNER");
    }

    if (!descriptor.requiresExplicitUserAction) {
      throw new Error("USER_ACTION_NOT_REQUIRED");
    }

    const grantId = this.options.ids.next("grant");

    const command: PairCommand = {
      protocolVersion: 1,
      commandId: this.options.ids.next("command"),
      expectedRevision: current.revision,
      actor: "human",
      type: "GrantUserAction",
      grantId,
      nativeToolName: nativeToolName(name),
      observedAt: this.options.clock.now(),
    };

    await this.enqueueTransition(() => this.commitCommand(command, signal));

    return grantId;
  }

  public async prepareTurn(input: PrepareTurnInput): Promise<PreparedTurn> {
    const snapshot = await this.snapshot();
    return Object.freeze({
      instructions: compileInstructions({
        snapshot,
        ...(input.presenceSummary === undefined
          ? {}
          : { presenceSummary: input.presenceSummary }),
        ...(input.userRequest === undefined
          ? {}
          : { userRequest: input.userRequest }),
        ...(input.repositoryContext === undefined
          ? {}
          : { repositoryContext: input.repositoryContext }),
        ...(input.toolResults === undefined
          ? {}
          : { toolResults: input.toolResults }),
      }),
      tools: toolsFor(snapshot),
    });
  }

  private async loadState(): Promise<{
    readonly snapshot: PairRuntimeSnapshot;
    readonly seenCommandIds: ReadonlySet<string>;
  }> {
    return this.options.store.load(this.options.streamId);
  }

  private streamId(): string {
    return this.options.streamId;
  }

  private observeResult(
    operation: OperationRecord,
    result: {
      readonly operationId: string;
      readonly status: PairToolResult["status"];
      readonly summary: string;
      readonly observation?: Readonly<Record<string, unknown>>;
      readonly sensitiveData: boolean;
      readonly partial: boolean;
    },
  ): Promise<{ readonly snapshot: PairRuntimeSnapshot; readonly accepted: boolean }> {
    return this.enqueueTransition(async () => {
      const current = await this.snapshot();
      const liveOperation = current.session?.operations.find(
        candidate => candidate.id === operation.id,
      );

      if (
        liveOperation === undefined ||
        isTerminalOperationStatus(liveOperation.status) ||
        current.session?.authorityEpoch !== operation.authorityEpoch
      ) {
        return {
          snapshot: current,
          accepted: false,
        };
      }

      return {
        snapshot: await this.commitCommand({
          protocolVersion: 1,
          commandId: this.options.ids.next("command"),
          expectedRevision: current.revision,
          actor: "host",
          type: "ObserveOperationResult",
          operationId: operation.id,
          authorityEpoch: operation.authorityEpoch,
          status: result.status,
          summary: result.summary,
          ...(result.observation === undefined
            ? {}
            : { observation: result.observation }),
          observedAt: this.options.clock.now(),
        }),
        accepted: true,
      };
    });
  }

  public invokeTool(name: PairToolName, input: Readonly<Record<string, unknown>>, signal: AbortSignal, options?: InvokeToolOptions): Promise<PairToolResult> {
    return this.toolExecutor.invoke(name, input, signal, options);
  }

  public reconcile(): Promise<PairRuntimeSnapshot> {
    return this.toolExecutor.reconcile();
  }
}
