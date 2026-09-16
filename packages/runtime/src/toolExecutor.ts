import {
  authorizeVisibleTool,
  issuePairUserActionGrant,
  PAIR_TOOL_CATALOG,
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

type PendingOperation = {
  readonly authorityEpoch: number;
  readonly controller: AbortController;
};

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
  readonly state: Pick<PairCoordinatorPort, "snapshot" | "dispatch">;
  readonly effects: EffectPort;
  readonly ids: IdSource;
  readonly clock: Clock;
  readonly observeResult: (operation: OperationRecord, result: EffectResult) => Promise<{ readonly snapshot: PairRuntimeSnapshot; readonly accepted: boolean }>;
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
      return this.createResult(snapshot, {
        operationId: this.options.ids.next("state"),
        status: "confirmed",
        summary: "Returned the current Pair snapshot.",
        observation: {
          snapshot,
        },
        sensitiveData: false,
        partial: false,
      });
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
      const next = await this.options.state.dispatch(localCommand);
      return this.createResult(next, {
        operationId: this.options.ids.next("state"),
        status: "confirmed",
        summary: `Applied ${name} through the session core.`,
        observation: {
          runtimeRevision: next.revision,
        },
        sensitiveData: false,
        partial: false,
      });
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

    const authorizedSnapshot = await this.options.state.dispatch({
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
    });

    const operation = this.requireOperation(
      authorizedSnapshot,
      authorizedSnapshot.session?.operations.at(-1)?.id,
    );
    const controller = new AbortController();
    this.linkAbort(signal, controller);
    this.pendingOperations.set(operation.id, {
      authorityEpoch: operation.authorityEpoch,
      controller,
    });

    try {
      const result = await this.options.effects.execute(
        {
          operationId: operation.id,
          workspaceId: snapshot.presence.workspaceId,
          workUnitId: workUnit.id,
          allowedPaths: [...workUnit.allowedPaths],
          toolName: name,
          kind: operation.kind,
          payload: structuredClone(input),
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
        });
      }

      return this.createResult(observed.snapshot, result);
    } finally {
      this.pendingOperations.delete(operation.id);
      controller.abort();
    }
  }

  public async reconcile(): Promise<PairRuntimeSnapshot> {
    let snapshot = await this.options.state.snapshot();
    const operations = snapshot.session?.operations ?? [];

    for (const operation of operations) {
      if (operation.status !== "authorized" || operation.kind !== "read") {
        continue;
      }

      const descriptor = PAIR_TOOL_CATALOG.find(
        candidate => candidate.name === operation.toolName,
      );

      if (
        descriptor === undefined ||
        descriptor.retry !== "bounded-read" ||
        !isEffectfulDescriptor(descriptor)
      ) {
        continue;
      }
      const workUnit = snapshot.session?.workUnit;
      if (
        workUnit === undefined ||
        workUnit.id !== operation.workUnitId ||
        workUnit.status !== "agreed"
      ) {
        continue;
      }

      const result = await this.options.effects.execute(
        {
          operationId: operation.id,
          workspaceId: snapshot.presence.workspaceId,
          workUnitId: operation.workUnitId,
          allowedPaths: [...workUnit.allowedPaths],
          toolName: descriptor.name,
          kind: operation.kind,
          payload: structuredClone(operation.input),
          runtimeRevision: operation.runtimeRevision,
          authorityEpoch: operation.authorityEpoch,
        },
        new AbortController().signal,
      );
      snapshot = (await this.options.observeResult(operation, result)).snapshot;
    }

    return snapshot;
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
  ): PairToolResult {
    return Object.freeze({
      operationId: result.operationId,
      runtimeRevision: snapshot.revision,
      authorityEpoch: snapshot.session?.authorityEpoch,
      status: result.status,
      summary: result.summary,
      observation: result.observation ?? EMPTY_OBSERVATION,
      sensitiveData: result.sensitiveData,
      partial: result.partial,
    });
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

  private linkAbort(parent: AbortSignal, controller: AbortController): void {
    if (parent.aborted) {
      controller.abort();
      return;
    }

    parent.addEventListener("abort", () => controller.abort(), { once: true });
  }
}
