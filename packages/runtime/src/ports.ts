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
  append(streamId: string, events: readonly PairEvent[]): Promise<void>;
  saveSnapshot(streamId: string, snapshot: PairRuntimeSnapshot): Promise<void>;
}

export interface EffectRequest {
  readonly operationId: string;
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
