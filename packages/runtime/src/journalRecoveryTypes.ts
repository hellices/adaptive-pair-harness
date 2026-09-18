import type { OperationRecord, SessionStatus } from "@adaptive-pair/protocol";

export interface JournalExpectation {
  readonly streamId: string;
  readonly workspaceId: string;
}

export interface UnsettledJournalOperation {
  readonly sessionStartedAtRevision: number;
  readonly workspaceId: string;
  readonly operationId: string;
  readonly kind: OperationRecord["kind"];
  readonly recordedStatus: "planned" | "authorized" | "started" | "unknown";
}

export interface JournalRecoveryReport {
  readonly formatVersion: 1;
  readonly streamId: string;
  readonly workspaceId: string;
  readonly headRevision: number;
  readonly commitCount: number;
  readonly eventCount: number;
  readonly historicalSession: {
    readonly sessionId: string;
    readonly startedAtRevision: number;
    readonly status: SessionStatus;
  } | undefined;
  readonly unsettledOperations: readonly UnsettledJournalOperation[];
  readonly authorityRestored: false;
  readonly automaticReplayAllowed: false;
}
