import { describe, expect, it } from "vitest";
import { InterventionPolicy } from "../src/core/interventionPolicy";
import type { Evidence, PairRange } from "../src/core/types";

const sharedRange: PairRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 1 },
};

const defaultGoal = "Ask a concise, evidence-backed question.";

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

describe("InterventionPolicy", () => {
  it("asks about the highest-confidence new evidence", () => {
    const policy = new InterventionPolicy({
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
      cooldownMs: 1_000,
    });
    const highEvidence = createEvidence({ id: "evidence-high", confidence: 0.96 });

    const first = policy.decide({
      evidence: [highEvidence],
      style: "balanced",
      now: 1_000,
      goal: defaultGoal,
    });
    expect(first.kind).toBe("intervene");
    policy.markRendered(highEvidence.id, 1_000);

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
      cooldownMs: 1_000,
    });
    const highEvidence = createEvidence({ id: "evidence-high", confidence: 0.96 });

    policy.markRendered(highEvidence.id, 1_000);

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

  it("does not start cooldown until an intervention renders", () => {
    const policy = new InterventionPolicy({
      cooldownMs: 1_000,
    });
    const highEvidence = createEvidence({ id: "render-later" });

    expect(
      policy.decide({
        evidence: [highEvidence],
        style: "balanced",
        now: 1_000,
        goal: defaultGoal,
      }).kind,
    ).toBe("intervene");
    expect(
      policy.decide({
        evidence: [highEvidence],
        style: "balanced",
        now: 1_100,
        goal: defaultGoal,
      }).kind,
    ).toBe("intervene");

    policy.markRendered(highEvidence.id, 1_100);
    expect(
      policy.decide({
        evidence: [highEvidence],
        style: "balanced",
        now: 1_200,
        goal: defaultGoal,
      }),
    ).toMatchObject({ kind: "quiet", reason: "cooldown-active" });
  });

  it("clears cooldowns on session stop and removes expired entries", () => {
    const policy = new InterventionPolicy({
      cooldownMs: 1_000,
    });
    policy.markRendered("old", 0);
    policy.markRendered("current", 1_500);

    expect(policy.cooldownEntryCount(1_500)).toBe(1);
    policy.resetTransient();
    expect(policy.cooldownEntryCount(1_500)).toBe(0);
  });

  it("uses the configured style thresholds", () => {
    const exactThresholdPolicy = new InterventionPolicy({
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

});
