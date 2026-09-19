import type {
  CapabilityCategory, DurableAssistance, DurableCommit, DurableOutcomeStatus, DurablePendingStatus,
  HintLevel, OperatingMode, PairEvent, PairRuntimeSnapshot, PresenceStatus, SessionStatus, WorkUnitStatus,
} from "@adaptive-pair/protocol";

export interface DurableLearningBoundary {
  readonly humanOwnedCapabilities: readonly CapabilityCategory[];
  readonly maximumHintLevel: HintLevel;
}

export interface DurableWorkUnitState {
  readonly sessionKey: string;
  readonly workUnitKey: string;
  readonly mode: OperatingMode;
  readonly owner: "human" | "ai";
  readonly learningValue: "high" | "mixed" | "low";
  readonly capability: CapabilityCategory;
  readonly status: WorkUnitStatus;
  readonly assistance: DurableAssistance | null;
}

export interface DurableOperationState {
  readonly sessionKey: string;
  readonly workUnitKey: string;
  readonly operationKey: string;
  readonly kind: "read" | "edit" | "check";
  readonly openedSequence: number;
  readonly status: DurablePendingStatus | DurableOutcomeStatus;
}

export interface DurableSessionState {
  readonly sessionKey: string;
  readonly openedSequence: number;
  readonly status: Exclude<SessionStatus, "inactive">;
  readonly mode: OperatingMode | null;
  readonly learningBoundary: DurableLearningBoundary | null;
  readonly workUnits: readonly DurableWorkUnitState[];
  readonly operations: readonly DurableOperationState[];
}

export interface DurableState {
  readonly headSequence: number;
  readonly presence: PresenceStatus;
  readonly sessions: readonly DurableSessionState[];
}

export interface DurableSnapshot {
  readonly format: "adaptive-pair-durable";
  readonly version: 1;
  readonly namespaceKey: string;
  readonly generationKey: string;
  readonly headSequence: number;
  readonly state: DurableState;
}

export type DurableCacheDisposition = "absent" | "matched" | "discarded";

export interface DurableKeyIssuer {
  next(): string;
}

export type DurableProjection =
  | { readonly kind: "append"; readonly commit: DurableCommit }
  | { readonly kind: "erase" }
  | { readonly kind: "omitted" };

export type DurableProjectionResolution = "committed" | "not-committed" | "indeterminate";

export interface DurableProjector {
  project(previous: PairRuntimeSnapshot, events: readonly PairEvent[], expectedSequence: number): DurableProjection;
  resolve(commitKey: string, outcome: DurableProjectionResolution): void;
}
