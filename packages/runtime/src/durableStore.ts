import type { DurableCommit } from "@adaptive-pair/protocol";

export interface DurableReceipt {
  readonly namespaceKey: string;
  readonly generationKey: string;
  readonly commitKey: string | null;
  readonly headSequence: number;
}

export type DurableWriteResult =
  | { readonly status: "committed"; readonly receipt: DurableReceipt }
  | { readonly status: "not-committed"; readonly code: DurableStoreFailure }
  | { readonly status: "indeterminate" };

export type DurableStoreFailure =
  | "INVALID_REQUEST" | "BINDING_MISMATCH" | "GENERATION_CONFLICT"
  | "HEAD_CONFLICT" | "IDENTITY_CONFLICT" | "LIMIT_EXCEEDED"
  | "ERASURE_PENDING";

export type DurableReadResult =
  | { readonly status: "empty" }
  | { readonly status: "present"; readonly text: string }
  | { readonly status: "erased"; readonly generationKey: string }
  | { readonly status: "blocked" };

export type DurableEraseResult =
  | { readonly status: "erased" }
  | { readonly status: "cleanup-pending" }
  | { readonly status: "indeterminate" }
  | { readonly status: "not-erased"; readonly code: DurableStoreFailure };

export interface DurableStore {
  load(): Promise<DurableReadResult>;
  create(text: string, expectedGenerationKey: string | null): Promise<DurableWriteResult>;
  append(generationKey: string, commit: DurableCommit): Promise<DurableWriteResult>;
  erase(generationKey: string): Promise<DurableEraseResult>;
}
