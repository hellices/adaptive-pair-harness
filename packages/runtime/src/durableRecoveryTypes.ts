import type { DurablePendingStatus } from "@adaptive-pair/protocol";
import type { DurableCacheDisposition, DurableOperationState, DurableSnapshot } from "./durableTypes.js";

export interface DurableRecoveryExpectation {
  readonly namespaceKey: string;
  readonly generationKey: string;
  readonly now: number;
}

export type DurableRecoveryBlock =
  | "INVALID_EXPECTATION" | "INVALID_TIME" | "NAMESPACE_MISMATCH"
  | "GENERATION_MISMATCH" | "UNSUPPORTED_VERSION" | "INVALID_JOURNAL";

export interface UnsettledDurableOperation extends DurableOperationState {
  readonly status: DurablePendingStatus | "unknown";
}

interface DeniedRestartAuthority {
  readonly authorityRestored: false;
  readonly automaticReplayAllowed: false;
}

export type DurableRecoveryAssessment = DeniedRestartAuthority & (
  | { readonly status: "blocked"; readonly reason: DurableRecoveryBlock }
  | { readonly status: "expired"; readonly erasureRequired: true; readonly effectStatusUnavailable: true }
  | {
      readonly status: "review-required";
      readonly snapshot: DurableSnapshot;
      readonly cacheText: string;
      readonly cacheDisposition: DurableCacheDisposition;
      readonly unsettledOperations: readonly UnsettledDurableOperation[];
    }
);
