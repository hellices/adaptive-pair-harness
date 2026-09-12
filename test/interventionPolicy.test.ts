import { describe, expect, it } from "vitest";
import { InterventionPolicy } from "../src/core/interventionPolicy";
import { TokenBudget } from "../src/core/tokenBudget";
import type { Evidence, PairRange } from "../src/core/types";

const sharedRange: PairRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 1 },
};

const defaultGoal = "Ask a concise, evidence-backed question.";
const longGoal = "Ask a concise, evidence-backed question. ".repeat(8).trim();
const model = "qwen2.5-coder:7b";

const createEvidence = (overrides: Partial<Evidence> = {}): Evidence => ({
  id: overrides.id ?? "evidence-default",
  kind: overrides.kind ?? "new-dependency",
  severity: overrides.severity ?? "warning",
  title: overrides.title ?? "New dependency introduced",
  detail: overrides.detail ?? "Imported a new module dependency: ./repository.",
  source: overrides.source ?? "typescript-semantic-analyzer",
  confidence: overrides.confidence ?? 0.95,
  range: overrides.range ?? sharedRange,
  references: overrides.references ?? ["./repository"],
});

const createBudget = (): TokenBudget =>
  new TokenBudget({
    windowMs: 60_000,
    maxCalls: 10,
    maxInputTokens: 10_000,
  });

describe("InterventionPolicy", () => {
  it("asks about the highest-confidence new evidence", () => {
    const policy = new InterventionPolicy({
      model,
      budget: createBudget(),
      cooldownMs: 1_000,
    });
    const lowEvidence = createEvidence({
      id: "evidence-low",
      confidence: 0.74,
      title: "Complexity increased substantially",
      kind: "complexity-growth",
      severity: "info",
    });
    const highEvidence = createEvidence({
      id: "evidence-high",
      confidence: 0.96,
    });

    const decision = policy.decide({
      evidence: [lowEvidence, highEvidence],
      style: "balanced",
      now: 1_000,
      goal: defaultGoal,
    });

    expect(decision).toMatchObject({
      kind: "intervene",
      evidenceId: highEvidence.id,
      useModel: true,
    });
  });

  it("suppresses duplicate evidence during cooldown", () => {
    const policy = new InterventionPolicy({
      model,
      budget: createBudget(),
      cooldownMs: 1_000,
    });
    const highEvidence = createEvidence({ id: "evidence-high", confidence: 0.96 });

    policy.decide({
      evidence: [highEvidence],
      style: "balanced",
      now: 1_000,
      goal: defaultGoal,
    });

    expect(
      policy.decide({
        evidence: [highEvidence],
        style: "balanced",
        now: 1_500,
        goal: defaultGoal,
      }),
    ).toEqual({
      kind: "quiet",
      reason: "cooldown-active",
    });
  });

  it("reconsiders evidence after the cooldown expires", () => {
    const policy = new InterventionPolicy({
      model,
      budget: createBudget(),
      cooldownMs: 1_000,
    });
    const highEvidence = createEvidence({ id: "evidence-high", confidence: 0.96 });

    policy.decide({
      evidence: [highEvidence],
      style: "balanced",
      now: 1_000,
      goal: defaultGoal,
    });

    expect(
      policy.decide({
        evidence: [highEvidence],
        style: "balanced",
        now: 2_001,
        goal: defaultGoal,
      }),
    ).toMatchObject({
      kind: "intervene",
      evidenceId: highEvidence.id,
      useModel: true,
    });
  });

  it("uses the configured style thresholds", () => {
    const exactThresholdPolicy = new InterventionPolicy({
      model,
      budget: createBudget(),
      cooldownMs: 1_000,
    });

    expect(
      exactThresholdPolicy.decide({
        evidence: [createEvidence({ id: "eco-threshold", confidence: 0.9 })],
        style: "eco",
        now: 1,
        goal: defaultGoal,
      }),
    ).toMatchObject({
      kind: "intervene",
      evidenceId: "eco-threshold",
    });

    expect(
      exactThresholdPolicy.decide({
        evidence: [createEvidence({ id: "balanced-threshold", confidence: 0.72 })],
        style: "balanced",
        now: 2,
        goal: defaultGoal,
      }),
    ).toMatchObject({
      kind: "intervene",
      evidenceId: "balanced-threshold",
    });

    expect(
      exactThresholdPolicy.decide({
        evidence: [createEvidence({ id: "active-threshold", confidence: 0.55 })],
        style: "active",
        now: 3,
        goal: defaultGoal,
      }),
    ).toMatchObject({
      kind: "intervene",
      evidenceId: "active-threshold",
    });

    const belowThresholdPolicy = new InterventionPolicy({
      model,
      budget: createBudget(),
      cooldownMs: 1_000,
    });

    expect(
      belowThresholdPolicy.decide({
        evidence: [createEvidence({ id: "eco-below", confidence: 0.89 })],
        style: "eco",
        now: 1,
        goal: defaultGoal,
      }),
    ).toEqual({
      kind: "quiet",
      reason: "no-eligible-evidence",
    });

    expect(
      belowThresholdPolicy.decide({
        evidence: [createEvidence({ id: "balanced-below", confidence: 0.71 })],
        style: "balanced",
        now: 2,
        goal: defaultGoal,
      }),
    ).toEqual({
      kind: "quiet",
      reason: "no-eligible-evidence",
    });

    expect(
      belowThresholdPolicy.decide({
        evidence: [createEvidence({ id: "active-below", confidence: 0.54 })],
        style: "active",
        now: 3,
        goal: defaultGoal,
      }),
    ).toEqual({
      kind: "quiet",
      reason: "no-eligible-evidence",
    });
  });

  it("falls back to a local message when the budget denies a model call", () => {
    const budget = new TokenBudget({
      windowMs: 60_000,
      maxCalls: 0,
      maxInputTokens: 10_000,
    });
    const policy = new InterventionPolicy({
      model,
      budget,
      cooldownMs: 1_000,
    });
    const evidence = createEvidence({
      id: "evidence-high",
      confidence: 0.96,
      title: "Exported API signature changed",
    });

    expect(
      policy.decide({
        evidence: [evidence],
        style: "balanced",
        now: 1_000,
        goal: defaultGoal,
      }),
    ).toMatchObject({
      kind: "intervene",
      evidenceId: evidence.id,
      useModel: false,
      localMessage: expect.stringContaining(evidence.title),
    });
  });

  it("denies remote usage when the full prompt payload exceeds the token budget", () => {
    const budget = new TokenBudget({
      windowMs: 60_000,
      maxCalls: 10,
      maxInputTokens: 190,
    });
    const policy = new InterventionPolicy({
      model,
      budget,
      cooldownMs: 1_000,
    });
    const evidence = createEvidence({
      id: "evidence-overhead",
      confidence: 0.96,
      title: "Public API changed",
      detail: "A function signature was widened with a new dependency parameter.",
      kind: "public-api-change",
    });

    expect(
      policy.decide({
        evidence: [evidence],
        style: "balanced",
        now: 1_000,
        goal: longGoal,
      }),
    ).toMatchObject({
      kind: "intervene",
      evidenceId: evidence.id,
      useModel: false,
      localMessage: expect.stringContaining(evidence.title),
    });
  });
});
