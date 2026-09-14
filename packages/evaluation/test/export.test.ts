import { describe, expect, it } from "vitest";
import { exportEvaluation, type EvaluationRecord } from "../src/index.js";

const baseRecord = (): EvaluationRecord => ({
  protocolVersion: 1,
  mode: "growth",
  startedAt: 1_700_000_037_400,
  completedAt: 1_700_000_092_800,
  operationOutcomes: ["confirmed", "failed", "confirmed"],
  hintLevel: 2,
  solutionRevealed: false,
  growth: {
    productVerified: true,
    similarGeneration: "demonstrated",
    variedDebugging: "not-assessed",
    explanation: "demonstrated",
    meaningfulAuthorship: "demonstrated",
    nextAssistance: "less",
    product: "verified",
    growth: "unverified",
  },
  pauseCount: 1,
  conflictCount: 0,
  unwantedInterventionCount: 2,
});

describe("Evaluation export", () => {
  it("rounds timestamps to a whole minute", () => {
    const parsed = JSON.parse(exportEvaluation([baseRecord()])) as {
      readonly records: readonly {
        readonly startedAt: number;
        readonly completedAt: number;
      }[];
    };
    const record = parsed.records[0];
    expect(record).toBeDefined();
    // 1_700_000_037_400 rounds to 1_700_000_040_000; 1_700_000_092_800 -> 1_700_000_100_000.
    expect(record?.startedAt).toBe(1_700_000_040_000);
    expect(record?.completedAt).toBe(1_700_000_100_000);
    expect((record?.startedAt ?? 1) % 60_000).toBe(0);
    expect((record?.completedAt ?? 1) % 60_000).toBe(0);
  });

  it("emits only the allowlisted categorical and count fields", () => {
    const parsed = JSON.parse(exportEvaluation([baseRecord()])) as {
      readonly records: readonly Record<string, unknown>[];
    };
    const record = parsed.records[0];
    expect(record).toBeDefined();
    expect(Object.keys(record ?? {}).sort()).toEqual(
      [
        "completedAt",
        "conflictCount",
        "growth",
        "hintLevel",
        "mode",
        "operationOutcomes",
        "pauseCount",
        "protocolVersion",
        "solutionRevealed",
        "startedAt",
        "unwantedInterventionCount",
      ].sort(),
    );
  });

  it("excludes prohibited workspace, model, path, and profile text even when present on the input", () => {
    const contaminated = {
      ...baseRecord(),
      workspaceId: "file:///Users/dev/secret-project",
      modelId: "acme-model-xl",
      branch: "feature/private",
      profileText: "developer prefers deep explanations",
      prompt: "here is my proprietary source code",
      diagnostics: ["src/secret.ts:12:5 error TS2345"],
      sourcePath: "/Users/dev/secret-project/src/secret.ts",
    } as unknown as EvaluationRecord;

    const serialized = exportEvaluation([contaminated]);
    expect(serialized).not.toContain("secret-project");
    expect(serialized).not.toContain("acme-model-xl");
    expect(serialized).not.toContain("feature/private");
    expect(serialized).not.toContain("deep explanations");
    expect(serialized).not.toContain("proprietary");
    expect(serialized).not.toContain("secret.ts");
    expect(serialized).not.toContain("TS2345");
  });

  it("emits only the categorical growth outcome fields", () => {
    const parsed = JSON.parse(exportEvaluation([baseRecord()])) as {
      readonly records: readonly {
        readonly growth: Record<string, unknown>;
      }[];
    };
    const growth = parsed.records[0]?.growth;
    expect(growth).toBeDefined();
    expect(Object.keys(growth ?? {}).sort()).toEqual(
      [
        "explanation",
        "growth",
        "meaningfulAuthorship",
        "nextAssistance",
        "product",
        "productVerified",
        "similarGeneration",
        "variedDebugging",
      ].sort(),
    );
  });
});
