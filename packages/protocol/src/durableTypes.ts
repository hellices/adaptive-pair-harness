import type {
  CapabilityCategory, HintLevel, OperatingMode, PresenceStatus, SessionStatus, WorkUnitStatus,
} from "./types.js";

export const durableJournalLimits = Object.freeze({
  textCodeUnits: 1_048_576,
  encodedBytes: 1_048_576,
  commits: 1_024,
  facts: 1_024,
  commandKeys: 1_024,
  lifetimeMs: 7 * 24 * 60 * 60 * 1_000,
});

export type DurablePendingStatus = "planned" | "authorized" | "started";
export type DurableOutcomeStatus = "confirmed" | "failed" | "declined" | "cancelled" | "unknown";
export type DurableAttemptStatus = "none" | "recorded" | "bypassed";

export interface DurableAssistance {
  readonly attempt: DurableAttemptStatus;
  readonly hypothesis: DurableAttemptStatus;
  readonly hintLevel: HintLevel | null;
  readonly solutionRevealed: boolean;
}

export type DurableFact =
  | { readonly type: "PresenceRecorded"; readonly status: Exclude<PresenceStatus, "off"> }
  | { readonly type: "SessionOpened"; readonly sessionKey: string }
  | {
      readonly type: "SessionStatusRecorded";
      readonly sessionKey: string;
      readonly status: Exclude<SessionStatus, "inactive">;
    }
  | {
      readonly type: "LearningBoundaryRecorded";
      readonly sessionKey: string;
      readonly humanOwnedCapabilities: readonly CapabilityCategory[];
      readonly maximumHintLevel: HintLevel;
    }
  | { readonly type: "ModeRecorded"; readonly sessionKey: string; readonly mode: OperatingMode }
  | {
      readonly type: "WorkUnitOpened";
      readonly sessionKey: string;
      readonly workUnitKey: string;
      readonly mode: OperatingMode;
      readonly owner: "human" | "ai";
      readonly learningValue: "high" | "mixed" | "low";
      readonly capability: CapabilityCategory;
    }
  | {
      readonly type: "WorkUnitStatusRecorded";
      readonly sessionKey: string;
      readonly workUnitKey: string;
      readonly status: WorkUnitStatus;
    }
  | (DurableAssistance & {
      readonly type: "AssistanceRecorded";
      readonly sessionKey: string;
      readonly workUnitKey: string;
    })
  | {
      readonly type: "OperationOpened";
      readonly sessionKey: string;
      readonly workUnitKey: string;
      readonly operationKey: string;
      readonly kind: "read" | "edit" | "check";
      readonly status: DurablePendingStatus;
    }
  | {
      readonly type: "OperationOutcomeRecorded";
      readonly sessionKey: string;
      readonly operationKey: string;
      readonly status: DurableOutcomeStatus;
    };

export interface DurableCommit {
  readonly commitKey: string;
  readonly expectedSequence: number;
  readonly commandKeys: readonly string[];
  readonly facts: readonly DurableFact[];
}

export interface DurableJournal {
  readonly format: "adaptive-pair-durable";
  readonly version: 1;
  readonly namespaceKey: string;
  readonly generationKey: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly headSequence: number;
  readonly commits: readonly DurableCommit[];
}
