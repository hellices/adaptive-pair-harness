import type {
  CompiledInstructionEnvelope,
  PairToolName,
  PairToolView,
} from "@adaptive-pair/harness";
import type { PairCommand, PairEvent, PairRuntimeSnapshot } from "@adaptive-pair/protocol";

export interface PairStore {
  load(streamId: string): Promise<{
    readonly snapshot: PairRuntimeSnapshot;
    readonly seenCommandIds: ReadonlySet<string>;
  }>;
  commit(
    streamId: string,
    expectedRevision: number,
    events: readonly PairEvent[],
  ): Promise<PairRuntimeSnapshot>;
}

export interface EffectRequest {
  readonly operationId: string;
  /** Host-trusted workspace identity captured by the coordinator. */
  readonly workspaceId: string;
  /** Host-trusted work-unit identity and scope; never caller-supplied. */
  readonly workUnitId: string;
  readonly allowedPaths: readonly string[];
  readonly toolName: PairToolName;
  readonly kind: "read" | "edit" | "check";
  readonly payload: Readonly<Record<string, unknown>>;
  readonly runtimeRevision: number;
  readonly authorityEpoch: number;
}

export interface EffectResult {
  readonly operationId: string;
  readonly status:
    | "confirmed"
    | "failed"
    | "declined"
    | "cancelled"
    | "unknown";
  readonly summary: string;
  readonly observation?: Readonly<Record<string, unknown>>;
  readonly sensitiveData: boolean;
  readonly partial: boolean;
}

export interface EffectPort {
  execute(request: EffectRequest, signal: AbortSignal): Promise<EffectResult>;
}

export interface Clock {
  now(): number;
}

export interface IdSource {
  next(prefix: string): string;
}

export interface PrepareTurnInput {
  readonly presenceSummary?: string;
  readonly userRequest?: string;
  readonly repositoryContext?: string;
  readonly toolResults?: readonly string[];
}

export interface PreparedTurn {
  readonly instructions: CompiledInstructionEnvelope;
  readonly tools: PairToolView;
}

export interface InvokeToolOptions {
  readonly userActionId?: string;
  readonly runtimeRevision?: number;
  readonly authorityEpoch?: number | undefined;
}

export interface GrantUserActionOptions {
  readonly runtimeRevision: number;
  readonly authorityEpoch: number | undefined;
}

export interface PairToolResult {
  readonly operationId: string;
  readonly runtimeRevision: number;
  readonly authorityEpoch: number | undefined;
  readonly status: EffectResult["status"];
  readonly summary: string;
  readonly observation: Readonly<Record<string, unknown>>;
  readonly sensitiveData: boolean;
  readonly partial: boolean;
}

export interface PairCoordinatorPort {
  dispatch(command: PairCommand): Promise<PairRuntimeSnapshot>;
  snapshot(): Promise<PairRuntimeSnapshot>;
  grantUserAction(
    name: PairToolName,
    signal: AbortSignal,
    options?: GrantUserActionOptions,
  ): Promise<string>;
  prepareTurn(input: PrepareTurnInput): Promise<PreparedTurn>;
  invokeTool(
    name: PairToolName,
    input: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
    options?: InvokeToolOptions,
  ): Promise<PairToolResult>;
  reconcile(): Promise<PairRuntimeSnapshot>;
}

export interface PairPresencePort {
  setPresence(
    status: "observing" | "quiet" | "paused" | "off",
    workspaceId?: string,
  ): Promise<PairRuntimeSnapshot>;
  observeWorkspace(): Promise<PairRuntimeSnapshot>;
}
