import {
  createLocalInterventionQuestion,
  estimateOpenAICompatibleInputTokens,
} from "./modelRouter";
import type { ModelRequest } from "./modelRouter";
import type { TokenBudget } from "./tokenBudget";
import type { Evidence } from "./types";

export type InterventionStyle = "eco" | "balanced" | "active";

export interface PolicyInput {
  readonly evidence: readonly Evidence[];
  readonly style: InterventionStyle;
  readonly now: number;
  readonly goal: string;
}

export type PolicyDecision =
  | { readonly kind: "quiet"; readonly reason: string }
  | {
      readonly kind: "intervene";
      readonly evidenceId: string;
      readonly useModel: boolean;
      readonly localMessage: string;
    };

export interface InterventionPolicyConfig {
  readonly budget?: TokenBudget;
  readonly cooldownMs?: number;
}

const STYLE_THRESHOLDS: Readonly<Record<InterventionStyle, number>> = {
  eco: 0.9,
  balanced: 0.72,
  active: 0.55,
};

const DEFAULT_COOLDOWN_MS = 30_000;

export class InterventionPolicy {
  private readonly lastInterventionByEvidenceId = new Map<string, number>();
  private readonly budget: TokenBudget | undefined;
  private readonly cooldownMs: number;

  public constructor(config: InterventionPolicyConfig = {}) {
    this.budget = config.budget;
    this.cooldownMs = config.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  }

  public decide(input: PolicyInput): PolicyDecision {
    const threshold = STYLE_THRESHOLDS[input.style];
    const thresholdEligibleEvidence = input.evidence
      .filter((candidate) => candidate.confidence >= threshold)
      .sort(compareEvidencePriority);

    if (thresholdEligibleEvidence.length === 0) {
      return {
        kind: "quiet",
        reason: "no-eligible-evidence",
      };
    }

    const readyEvidence = thresholdEligibleEvidence.filter(
      (candidate) => !this.isCoolingDown(candidate.id, input.now),
    );

    if (readyEvidence.length === 0) {
      return {
        kind: "quiet",
        reason: "cooldown-active",
      };
    }

    const selectedEvidence = readyEvidence[0];
    if (selectedEvidence === undefined) {
      return {
        kind: "quiet",
        reason: "cooldown-active",
      };
    }

    const localMessage = createLocalInterventionQuestion(selectedEvidence);
    const remoteRequest: ModelRequest = {
      goal: input.goal,
      evidence: selectedEvidence,
      interactionStyle: "ask-first",
    };
    const reservation = this.budget?.tryReserve(
      estimateOpenAICompatibleInputTokens(remoteRequest),
      input.now,
    );

    this.lastInterventionByEvidenceId.set(selectedEvidence.id, input.now);

    if (reservation?.allowed === false) {
      return {
        kind: "intervene",
        evidenceId: selectedEvidence.id,
        useModel: false,
        localMessage,
      };
    }

    return {
      kind: "intervene",
      evidenceId: selectedEvidence.id,
      useModel: true,
      localMessage,
    };
  }

  private isCoolingDown(evidenceId: string, now: number): boolean {
    const previousInterventionAt = this.lastInterventionByEvidenceId.get(evidenceId);
    if (previousInterventionAt === undefined) {
      return false;
    }

    return now - previousInterventionAt < this.cooldownMs;
  }
}

const compareEvidencePriority = (left: Evidence, right: Evidence): number => {
  if (left.confidence === right.confidence) {
    return left.id.localeCompare(right.id);
  }

  return right.confidence - left.confidence;
};
