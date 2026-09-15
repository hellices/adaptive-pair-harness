import {
  authorizeVisibleTool,
  compileInstructions,
  issuePairUserActionGrant,
  nativeToolName,
  pairToolNameFromNative,
  PAIR_TOOL_CATALOG,
  PAIR_TOOL_CATALOG_VERSION,
  type PairToolDescriptor,
  type PairToolName,
  toolsFor,
} from "@adaptive-pair/harness";
import type {
  EntrySnapshot,
  HintLevel,
  LearningAgreement,
  OperatingMode,
  OperationRecord,
  PairCommand,
  PairRuntimeSnapshot,
  WorkUnit,
} from "@adaptive-pair/protocol";
import { decide, reduce } from "@adaptive-pair/session-core";
import type {
  EffectRequest,
  InvokeToolOptions,
  PairCoordinatorPort,
  PairStore,
  PairToolResult,
  PreparedTurn,
  PrepareTurnInput,
  Clock,
  EffectPort,
  IdSource,
} from "./ports.js";

type PendingOperation = {
  readonly authorityEpoch: number;
  readonly controller: AbortController;
};

const EMPTY_OBSERVATION = Object.freeze({}) as Readonly<Record<string, unknown>>;

const isTerminalOperationStatus = (status: OperationRecord["status"]): boolean =>
  status === "confirmed" ||
  status === "failed" ||
  status === "declined" ||
  status === "cancelled" ||
  status === "unknown";

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

const throwIfAborted = (signal: AbortSignal): void => {
  signal.throwIfAborted();
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(item => typeof item === "string");

const isHintLevel = (value: unknown): value is HintLevel =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 5;

const isCapability = (value: unknown): value is LearningAgreement["humanOwnedCapabilities"][number] =>
  value === "problem-framing" ||
  value === "design" ||
  value === "test" ||
  value === "implementation" ||
  value === "diagnosis" ||
  value === "repair" ||
  value === "verification";

const isOperatingMode = (value: unknown): value is OperatingMode =>
  value === "growth" || value === "pair" || value === "delivery";

const isEntrySnapshot = (value: unknown): value is EntrySnapshot => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.workspaceId === "string" &&
    (value.branch === undefined || typeof value.branch === "string") &&
    isStringArray(value.dirtyPaths) &&
    isStringArray(value.openPaths) &&
    isStringArray(value.diagnostics) &&
    isStringArray(value.protectedPaths) &&
    typeof value.capturedAt === "number"
  );
};

const isLearningAgreement = (value: unknown): value is LearningAgreement => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isStringArray(value.learningGoals) &&
    isStringArray(value.familiarAreas) &&
    Array.isArray(value.humanOwnedCapabilities) &&
    value.humanOwnedCapabilities.every(isCapability) &&
    isStringArray(value.delegatableWork) &&
    isHintLevel(value.maximumHintLevel) &&
    typeof value.independentCheck === "string"
  );
};

const isWorkUnit = (value: unknown): value is WorkUnit => {
  if (!isRecord(value) || !isRecord(value.baseline)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.objective === "string" &&
    isOperatingMode(value.mode) &&
    (value.learningValue === "high" || value.learningValue === "mixed" || value.learningValue === "low") &&
    isCapability(value.capability) &&
    (value.owner === "human" || value.owner === "ai") &&
    isStringArray(value.allowedPaths) &&
    isStringArray(value.acceptanceChecks) &&
    typeof value.verificationPlan === "string" &&
    typeof value.stoppingCondition === "string" &&
    Object.values(value.baseline).every(entry => typeof entry === "string") &&
    (
      value.status === "proposed" ||
      value.status === "agreed" ||
      value.status === "executing" ||
      value.status === "verifying" ||
      value.status === "completed" ||
      value.status === "paused" ||
      value.status === "needs-reconcile" ||
      value.status === "cancelled" ||
      value.status === "failed"
    )
  );
};

export class PairCoordinator implements PairCoordinatorPort {
  private readonly pendingOperations = new Map<string, PendingOperation>();

  public constructor(
    private readonly options: {
      readonly store: PairStore;
      readonly effects: EffectPort;
      readonly clock: Clock;
      readonly ids: IdSource;
      readonly streamId: string;
    },
  ) {}

  public async snapshot(): Promise<PairRuntimeSnapshot> {
    return (await this.loadState()).snapshot;
  }

  public async dispatch(command: PairCommand): Promise<PairRuntimeSnapshot> {
    const { snapshot, seenCommandIds } = await this.loadState();
    const streamId = this.streamId();

    if (seenCommandIds.has(command.commandId)) {
      return snapshot;
    }

    const decision = decide(snapshot, command);

    if (decision.events.length === 0) {
      return snapshot;
    }

    await this.options.store.append(streamId, decision.events);
    const next = reduce(snapshot, decision.events);
    await this.options.store.saveSnapshot(streamId, next);
    this.abortInvalidatedOperations(next);
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
    throwIfAborted(signal);
    const current = await this.snapshot();
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

    await this.dispatch({
      protocolVersion: 1,
      commandId: this.options.ids.next("command"),
      expectedRevision: current.revision,
      actor: "human",
      type: "GrantUserAction",
      grantId,
      nativeToolName: nativeToolName(name),
      observedAt: this.options.clock.now(),
    });

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

  public async invokeTool(
    name: PairToolName,
    input: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
    options: InvokeToolOptions = {},
  ): Promise<PairToolResult> {
    throwIfAborted(signal);

    const snapshot = await this.snapshot();
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
      const next = await this.dispatch(localCommand);
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

    if (!isEffectfulDescriptor(decision.descriptor)) {
      throw new Error("UNSUPPORTED_TOOL_OPERATION");
    }

    const authorizedSnapshot = await this.dispatch({
      protocolVersion: 1,
      commandId: this.options.ids.next("command"),
      expectedRevision: snapshot.revision,
      actor: "ai",
      type: "AuthorizeOperation",
      operationId: this.options.ids.next("operation"),
      toolName: name,
      kind: effectKindFor(decision.descriptor),
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
          toolName: name,
          kind: operation.kind,
          payload: structuredClone(input),
          runtimeRevision: operation.runtimeRevision,
          authorityEpoch: operation.authorityEpoch,
        },
        controller.signal,
      );

      const observed = await this.observeResult(operation, result);
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
    let snapshot = await this.snapshot();
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

      const result = await this.options.effects.execute(
        {
          operationId: operation.id,
          toolName: descriptor.name,
          kind: operation.kind,
          payload: structuredClone(operation.input),
          runtimeRevision: operation.runtimeRevision,
          authorityEpoch: operation.authorityEpoch,
        },
        new AbortController().signal,
      );
      snapshot = (await this.observeResult(operation, result)).snapshot;
    }

    return snapshot;
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
    userActionGrantId: string | undefined,
  ): PairCommand | undefined {
    const commandBase = {
      protocolVersion: 1 as const,
      commandId: this.options.ids.next("command"),
      expectedRevision: snapshot.revision,
      actor: "ai" as const,
      observedAt: this.options.clock.now(),
      ...(userActionGrantId === undefined ? {} : { userActionGrantId }),
    };

    switch (name) {
      case "pair_capture_entry":
        if (!isEntrySnapshot(input.entry)) {
          throw new Error("INVALID_CAPTURE_ENTRY_INPUT");
        }
        return {
          ...commandBase,
          type: "CaptureEntry",
          entry: input.entry,
        };

      case "pair_confirm_learning":
        if (!isLearningAgreement(input.agreement)) {
          throw new Error("INVALID_CONFIRM_LEARNING_INPUT");
        }
        return {
          ...commandBase,
          type: "ConfirmLearning",
          agreement: input.agreement,
        };

      case "pair_select_mode":
        if (!isOperatingMode(input.mode)) {
          throw new Error("INVALID_SELECT_MODE_INPUT");
        }
        return {
          ...commandBase,
          type: "SelectMode",
          mode: input.mode,
        };

      case "pair_record_attempt":
        if (
          typeof input.workUnitId !== "string" ||
          typeof input.summary !== "string" ||
          typeof input.bypassed !== "boolean"
        ) {
          throw new Error("INVALID_RECORD_ATTEMPT_INPUT");
        }
        return {
          ...commandBase,
          type: "RecordAttempt",
          workUnitId: input.workUnitId,
          summary: input.summary,
          bypassed: input.bypassed,
        };

      case "pair_record_hypothesis":
        if (
          typeof input.workUnitId !== "string" ||
          typeof input.summary !== "string" ||
          typeof input.bypassed !== "boolean"
        ) {
          throw new Error("INVALID_RECORD_HYPOTHESIS_INPUT");
        }
        return {
          ...commandBase,
          type: "RecordHypothesis",
          workUnitId: input.workUnitId,
          summary: input.summary,
          bypassed: input.bypassed,
        };

      case "pair_request_hint":
        if (typeof input.workUnitId !== "string" || !isHintLevel(input.level)) {
          throw new Error("INVALID_REQUEST_HINT_INPUT");
        }
        return {
          ...commandBase,
          type: "RequestHint",
          workUnitId: input.workUnitId,
          level: input.level,
        };

      case "pair_reveal_solution":
        if (typeof input.workUnitId !== "string") {
          throw new Error("INVALID_REVEAL_SOLUTION_INPUT");
        }
        return {
          ...commandBase,
          type: "AuthorizeSolutionReveal",
          workUnitId: input.workUnitId,
          previewOnly: true,
        };

      case "pair_propose_work_unit":
        if (!isWorkUnit(input.workUnit)) {
          throw new Error("INVALID_PROPOSE_WORK_UNIT_INPUT");
        }
        return {
          ...commandBase,
          type: "ProposeWorkUnit",
          workUnit: input.workUnit,
        };

      case "pair_agree_work_unit":
        if (typeof input.workUnitId !== "string") {
          throw new Error("INVALID_AGREE_WORK_UNIT_INPUT");
        }
        return {
          ...commandBase,
          type: "AgreeWorkUnit",
          workUnitId: input.workUnitId,
        };

      case "pair_close_session":
        return {
          ...commandBase,
          type: "CloseSession",
        };

      default:
        return undefined;
    }
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

  private async observeResult(
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
      snapshot: await this.dispatch({
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

  private abortInvalidatedOperations(snapshot: PairRuntimeSnapshot): void {
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
