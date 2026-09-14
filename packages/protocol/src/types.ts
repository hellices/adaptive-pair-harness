export type OperatingMode = "growth" | "pair" | "delivery";

export type PresenceStatus =
  | "off"
  | "observing"
  | "engaged"
  | "quiet"
  | "paused";

export type SessionStatus =
  | "inactive"
  | "briefing"
  | "ready"
  | "active"
  | "paused"
  | "reconciling"
  | "closing"
  | "closed";

export type WorkUnitStatus =
  | "proposed"
  | "agreed"
  | "executing"
  | "verifying"
  | "completed"
  | "paused"
  | "needs-reconcile"
  | "cancelled"
  | "failed";

export type Actor = "human" | "ai" | "host" | "policy";

export type CapabilityCategory =
  | "problem-framing"
  | "design"
  | "test"
  | "implementation"
  | "diagnosis"
  | "repair"
  | "verification";

export interface LearningAgreement {
  readonly learningGoals: readonly string[];
  readonly familiarAreas: readonly string[];
  readonly humanOwnedCapabilities: readonly CapabilityCategory[];
  readonly delegatableWork: readonly string[];
  readonly maximumHintLevel: 0 | 1 | 2 | 3 | 4 | 5;
  readonly independentCheck: string;
}

export interface EntrySnapshot {
  readonly workspaceId: string;
  readonly branch?: string;
  readonly dirtyPaths: readonly string[];
  readonly openPaths: readonly string[];
  readonly diagnostics: readonly string[];
  readonly protectedPaths: readonly string[];
  readonly capturedAt: number;
}

export interface WorkUnit {
  readonly id: string;
  readonly objective: string;
  readonly mode: OperatingMode;
  readonly learningValue: "high" | "mixed" | "low";
  readonly capability: CapabilityCategory;
  readonly owner: "human" | "ai";
  readonly allowedPaths: readonly string[];
  readonly acceptanceChecks: readonly string[];
  readonly verificationPlan: string;
  readonly stoppingCondition: string;
  readonly baseline: Readonly<Record<string, string>>;
  readonly status: WorkUnitStatus;
}

export interface OperationRecord {
  readonly id: string;
  readonly workUnitId: string;
  readonly kind: "read" | "edit" | "check";
  readonly authorityEpoch: number;
  readonly status:
    | "planned"
    | "authorized"
    | "started"
    | "confirmed"
    | "failed"
    | "declined"
    | "cancelled"
    | "unknown";
}

export interface PairPresence {
  readonly workspaceId: string;
  readonly observationRevision: number;
  readonly status: PresenceStatus;
  readonly activeSessionId: string | undefined;
}

export interface PairSessionSnapshot {
  readonly sessionId: string;
  readonly authorityEpoch: number;
  readonly status: SessionStatus;
  readonly mode: OperatingMode | undefined;
  readonly goal: string | undefined;
  readonly criteria: readonly string[];
  readonly learningAgreement: LearningAgreement | undefined;
  readonly entrySnapshot: EntrySnapshot | undefined;
  readonly workUnit: WorkUnit | undefined;
  readonly operations: readonly OperationRecord[];
}

export interface PairRuntimeSnapshot {
  readonly protocolVersion: 1;
  readonly revision: number;
  readonly presence: PairPresence;
  readonly session: PairSessionSnapshot | undefined;
}
