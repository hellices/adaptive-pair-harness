import {
  authorizeVisibleTool,
  issuePairUserActionGrant,
  PAIR_TOOL_CATALOG_VERSION,
  type PairToolDescriptor,
  type PairToolName,
  pairToolNameFromNative,
  toolsFor,
} from "@adaptive-pair/harness";
import type { OperationRecord, PairCommand, PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import type {
  Clock,
  EffectPort,
  EffectRequest,
  EffectResult,
  IdSource,
  InvokeToolOptions,
  PairCoordinatorPort,
  PairToolResult,
} from "./ports.js";
import { commandForTool } from "./toolCommands.js";
import { projectModelState } from "./modelStateProjection.js";

type PendingOperation = {
  readonly authorityEpoch: number;
  readonly controller: AbortController;
};

interface ReadRecovery {
  readonly operation: OperationRecord;
  readonly request: EffectRequest;
  readonly controller: AbortController;
}

const EMPTY_OBSERVATION = Object.freeze({}) as Readonly<Record<string, unknown>>;

const isEffectfulDescriptor = (descriptor: PairToolDescriptor): boolean =>
  descriptor.effectClass === "read" ||
  descriptor.effectClass === "verification" ||
  descriptor.effectClass === "mutation" ||
  descriptor.effectClass === "external";

const effectKindFor = (descriptor: PairToolDescriptor): EffectRequest["kind"] => {
  if (descriptor.name === "pair_apply_edit") {
    return "edit";
  }

  return descriptor.effectClass === "read" ? "read" : "check";
};

interface ToolExecutionOptions {
  readonly state: Pick<PairCoordinatorPort, "snapshot">;
  readonly dispatchCommand: (command: PairCommand, signal: AbortSignal) => Promise<PairRuntimeSnapshot>;
  readonly effects: EffectPort;
  readonly ids: IdSource;
  readonly clock: Clock;
  readonly observeResult: (operation: OperationRecord, result: EffectResult) => Promise<{ readonly snapshot: PairRuntimeSnapshot; readonly accepted: boolean }>;
  readonly admitReadRecovery: (operationId: string) => Promise<ReadRecovery | undefined>;
}

export class ToolExecutor {
  private readonly pendingOperations = new Map<string, PendingOperation>();

  public constructor(private readonly options: ToolExecutionOptions) {}

  public async invoke(
    name: PairToolName,
    input: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
    options: InvokeToolOptions = {},
  ): Promise<PairToolResult> {
    signal.throwIfAborted();

    const snapshot = await this.options.state.snapshot();
    signal.throwIfAborted();
    const view = toolsFor(snapshot);
    const userActionGrant = this.materializeGrant(snapshot, name, options.userActionId);
    const decision = authorizeVisibleTool(view, {
      catalogVersion: PAIR_TOOL_CATALOG_VERSION,
      name,
      runtimeRevision: options.runtimeRevision ?? view.runtimeRevision,
      authorityEpoch: options.authorityEpoch ?? view.authorityEpoch,
      owner: snapshot.session?.workUnit?.owner ?? "none",
      ...(userActionGrant === undefined ? {} : { userAction: userActionGrant }),
    });

    if (!decision.allowed) {
      throw new Error(decision.reason);
    }

    if (name === "pair_get_state") {
      const projection = projectModelState(snapshot);
      return this.createResult(snapshot, {
        operationId: this.options.ids.next("state"),
        status: "confirmed",
        summary: "Returned bounded Pair state metadata.",
        observation: Object.freeze({ snapshot: projection.snapshot }),
        sensitiveData: false,
        partial: projection.partial,
      }, decision.descriptor.maximumResultCharacters);
    }

    const userActionGrantId = decision.descriptor.requiresExplicitUserAction
      ? options.userActionId
      : undefined;

    const localCommand = this.commandForTool(
      name,
      input,
      snapshot,
      userActionGrantId,
    );
    if (localCommand !== undefined) {
      const next = await this.options.dispatchCommand(localCommand, signal);
      return this.createResult(next, {
        operationId: this.options.ids.next("state"),
        status: "confirmed",
        summary: `Applied ${name} through the session core.`,
        observation: {
          runtimeRevision: next.revision,
        },
        sensitiveData: false,
        partial: false,
      }, decision.descriptor.maximumResultCharacters);
    }

    return this.executeOperation(snapshot, decision.descriptor, input, signal, userActionGrantId);
  }

  private async executeOperation(
    snapshot: PairRuntimeSnapshot,
    descriptor: PairToolDescriptor,
    input: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
    userActionGrantId: string | undefined,
  ): Promise<PairToolResult> {
    const name = descriptor.name;
    if (!isEffectfulDescriptor(descriptor)) {
      throw new Error("UNSUPPORTED_TOOL_OPERATION");
    }
    const workUnit = snapshot.session?.workUnit;
    if (workUnit === undefined || workUnit.status !== "agreed") {
      throw new Error("WORK_UNIT_NOT_AGREED");
    }

    const authorizedSnapshot = await this.options.dispatchCommand({
      protocolVersion: 1,
      commandId: this.options.ids.next("command"),
      expectedRevision: snapshot.revision,
      actor: "ai",
      type: "AuthorizeOperation",
      operationId: this.options.ids.next("operation"),
      toolName: name,
      kind: effectKindFor(descriptor),
      input: structuredClone(input),
      ...(userActionGrantId === undefined ? {} : { userActionGrantId }),
      observedAt: this.options.clock.now(),
    }, signal);

    const operation = this.requireOperation(
      authorizedSnapshot,
      authorizedSnapshot.session?.operations.at(-1)?.id,
    );
    const controller = new AbortController();
    const unlinkAbort = this.linkAbort(signal, controller);
    this.pendingOperations.set(operation.id, {
      authorityEpoch: operation.authorityEpoch,
      controller,
    });

    try {
      const result: EffectResult = controller.signal.aborted ? {
        operationId: operation.id,
        status: "cancelled",
        summary: "Operation was cancelled before effect dispatch.",
        observation: { reason: "cancelled-before-dispatch" },
        sensitiveData: false,
        partial: false,
      } : await this.options.effects.execute(
        {
          operationId: operation.id,
          workspaceId: snapshot.presence.workspaceId,
          workUnitId: workUnit.id,
          allowedPaths: [...workUnit.allowedPaths],
          toolName: name,
          kind: operation.kind,
          payload: structuredClone(operation.input),
          runtimeRevision: operation.runtimeRevision,
          authorityEpoch: operation.authorityEpoch,
        },
        controller.signal,
      );

      const observed = await this.options.observeResult(operation, result);
      if (!observed.accepted) {
        return this.createResult(observed.snapshot, {
          operationId: operation.id,
          status: "cancelled",
          summary: "Ignored a stale operation result after authority changed.",
          observation: {
            stale: true,
          },
          sensitiveData: result.sensitiveData,
          partial: result.partial,
        }, descriptor.maximumResultCharacters);
      }

      return this.createResult(observed.snapshot, result, descriptor.maximumResultCharacters);
    } finally {
      this.pendingOperations.delete(operation.id);
      unlinkAbort();
      controller.abort();
    }
  }

  public async reconcile(): Promise<PairRuntimeSnapshot> {
    const snapshot = await this.options.state.snapshot();

    for (const candidate of snapshot.session?.operations ?? []) {
      if (candidate.status !== "authorized" || candidate.kind !== "read") {
        continue;
      }
      const recovery = await this.options.admitReadRecovery(candidate.id);
      if (recovery === undefined) {
        continue;
      }
      try {
        if (recovery.controller.signal.aborted) {
          continue;
        }
        const result = await this.options.effects.execute(recovery.request, recovery.controller.signal);
        await this.options.observeResult(recovery.operation, result);
      } finally {
        this.pendingOperations.delete(recovery.operation.id);
        recovery.controller.abort();
      }
    }

    return this.options.state.snapshot();
  }

  public admitReadRecovery(snapshot: PairRuntimeSnapshot, operationId: string): ReadRecovery | undefined {
    const operation = snapshot.session?.operations.find(candidate => candidate.id === operationId);
    if (
      operation === undefined ||
      operation.status !== "authorized" ||
      operation.kind !== "read" ||
      operation.authorityEpoch !== snapshot.session?.authorityEpoch ||
      this.pendingOperations.has(operationId)
    ) {
      return undefined;
    }
    const descriptor = toolsFor(snapshot).tools.find(candidate => candidate.name === operation.toolName);
    const workUnit = snapshot.session?.workUnit;
    if (
      descriptor === undefined ||
      descriptor.retry !== "bounded-read" ||
      descriptor.effectClass !== "read" ||
      workUnit === undefined ||
      workUnit.id !== operation.workUnitId ||
      workUnit.status !== "agreed"
    ) {
      return undefined;
    }

    const request: EffectRequest = {
      operationId: operation.id,
      workspaceId: snapshot.presence.workspaceId,
      workUnitId: operation.workUnitId,
      allowedPaths: [...workUnit.allowedPaths],
      toolName: descriptor.name,
      kind: operation.kind,
      payload: structuredClone(operation.input),
      runtimeRevision: operation.runtimeRevision,
      authorityEpoch: operation.authorityEpoch,
    };
    const controller = new AbortController();
    this.pendingOperations.set(operation.id, {
      authorityEpoch: operation.authorityEpoch,
      controller,
    });
    return { operation, request, controller };
  }

  private materializeGrant(
    snapshot: PairRuntimeSnapshot,
    name: PairToolName,
    userActionId: string | undefined,
  ) {
    if (userActionId === undefined) {
      return undefined;
    }

    const grant = snapshot.session?.userActionGrants.find(
      candidate => candidate.id === userActionId && candidate.status === "available",
    );

    if (grant === undefined) {
      return undefined;
    }

    const grantedName = pairToolNameFromNative(grant.nativeToolName);

    if (grantedName !== name) {
      return undefined;
    }

    return issuePairUserActionGrant({
      name: grantedName,
      runtimeRevision: grant.runtimeRevision,
      authorityEpoch: grant.authorityEpoch,
    });
  }

  private commandForTool(
    name: PairToolName,
    input: Readonly<Record<string, unknown>>,
    snapshot: PairRuntimeSnapshot,
    grantId: string | undefined,
  ): PairCommand | undefined {
    return commandForTool(name, input, snapshot, grantId, this.options.ids, this.options.clock);
  }

  private requireOperation(
    snapshot: PairRuntimeSnapshot,
    operationId: string | undefined,
  ): OperationRecord {
    const operation = snapshot.session?.operations.find(
      candidate => candidate.id === operationId,
    );

    if (operation === undefined) {
      throw new Error("OPERATION_NOT_FOUND");
    }

    return operation;
  }

  private createResult(
    snapshot: PairRuntimeSnapshot,
    result: {
      readonly operationId: string;
      readonly status: PairToolResult["status"];
      readonly summary: string;
      readonly observation?: Readonly<Record<string, unknown>>;
      readonly sensitiveData: boolean;
      readonly partial: boolean;
    },
    maximumResultCharacters: number,
  ): PairToolResult {
    const completed = Object.freeze({
      operationId: result.operationId,
      runtimeRevision: snapshot.revision,
      authorityEpoch: snapshot.session?.authorityEpoch,
      status: result.status,
      summary: result.summary,
      observation: result.observation ?? EMPTY_OBSERVATION,
      sensitiveData: result.sensitiveData,
      partial: result.partial,
    });
    if (JSON.stringify(completed).length > maximumResultCharacters) {
      throw new Error("TOOL_RESULT_TOO_LARGE");
    }
    return completed;
  }

  public invalidate(snapshot: PairRuntimeSnapshot): void {
    const authorityEpoch = snapshot.session?.authorityEpoch;

    for (const [operationId, pending] of this.pendingOperations) {
      if (
        authorityEpoch === undefined ||
        snapshot.session?.status === "paused" ||
        snapshot.session?.status === "reconciling" ||
        snapshot.session?.status === "closed" ||
        pending.authorityEpoch !== authorityEpoch
      ) {
        pending.controller.abort();
        this.pendingOperations.delete(operationId);
      }
    }
  }

  private linkAbort(parent: AbortSignal, controller: AbortController): () => void {
    if (parent.aborted) {
      controller.abort();
      return () => undefined;
    }

    const onAbort = (): void => controller.abort();
    parent.addEventListener("abort", onAbort, { once: true });
    return () => parent.removeEventListener("abort", onAbort);
  }
}
