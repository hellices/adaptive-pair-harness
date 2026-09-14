import type { OperatingMode, PairRuntimeSnapshot } from "@adaptive-pair/protocol";

export const PAIR_TOOL_CATALOG_VERSION = 1 as const;
export const PAIR_INSTRUCTION_VERSION = 1 as const;

export type PairToolName =
  | "pair_get_state"
  | "pair_capture_entry"
  | "pair_read_scope"
  | "pair_search_scope"
  | "pair_record_attempt"
  | "pair_record_hypothesis"
  | "pair_request_hint"
  | "pair_reveal_solution"
  | "pair_propose_work_unit"
  | "pair_accept_handoff"
  | "pair_apply_edit"
  | "pair_run_verification"
  | "pair_run_command"
  | "pair_record_transfer"
  | "pair_close_session";

export type NativePairToolName = `adaptive_${PairToolName}`;

export interface PairToolDescriptor {
  readonly name: PairToolName;
  readonly effectClass:
    | "read"
    | "state"
    | "response"
    | "mutation"
    | "verification"
    | "external";
  readonly modes: readonly OperatingMode[];
  readonly requiredEditOwner: "human" | "ai" | "either";
  readonly requiresExplicitUserAction: boolean;
  readonly requiresConsent: boolean;
  readonly retry: "bounded-read" | "same-key" | "never";
  readonly maximumResultCharacters: number;
}

export interface PairToolView {
  readonly catalogVersion: typeof PAIR_TOOL_CATALOG_VERSION;
  readonly runtimeRevision: number;
  readonly authorityEpoch: number | undefined;
  readonly tools: readonly PairToolDescriptor[];
}

export interface InstructionLayer {
  readonly kind:
    | "product"
    | "mode"
    | "learning"
    | "work-unit"
    | "observation"
    | "user-request"
    | "untrusted-repository";
  readonly trusted: boolean;
  readonly content: string;
}

export interface CompiledInstructionEnvelope {
  readonly instructionVersion: typeof PAIR_INSTRUCTION_VERSION;
  readonly runtimeRevision: number;
  readonly authorityEpoch: number | undefined;
  readonly maximumResponseClass:
    | "question"
    | "hint"
    | "pseudocode"
    | "analogy"
    | "solution";
  readonly layers: readonly InstructionLayer[];
}

export interface PairUserActionGrant {
  readonly id: string;
  readonly nativeToolName: NativePairToolName;
  readonly runtimeRevision: number;
  readonly authorityEpoch: number | undefined;
  readonly consumed: boolean;
}

export interface VisibleToolInvocation {
  readonly catalogVersion: number;
  readonly name: PairToolName;
  readonly runtimeRevision: number;
  readonly authorityEpoch: number | undefined;
  readonly owner: "human" | "ai" | "none";
  readonly userAction?: PairUserActionGrant;
}

export type ToolPolicyDecision =
  | { readonly allowed: true; readonly descriptor: PairToolDescriptor }
  | {
      readonly allowed: false;
      readonly reason:
        | "TOOL_HIDDEN"
        | "STALE_TOOL_VIEW"
        | "WRONG_OWNER"
        | "USER_ACTION_REQUIRED"
        | "UNSUPPORTED_TOOL_CATALOG_VERSION";
    };

export interface CompileInstructionsInput {
  readonly snapshot: PairRuntimeSnapshot;
  readonly presenceSummary?: string;
  readonly userRequest?: string;
  readonly repositoryContext?: string;
  readonly toolResults?: readonly string[];
}
