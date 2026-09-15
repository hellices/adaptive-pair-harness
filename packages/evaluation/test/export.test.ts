import { describe, expect, it } from "vitest";
import {
  exportEvaluation,
  EvaluationExportError,
  type EvaluationRecord,
} from "../src/index.js";

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

  it("rejects prohibited extra properties without leaking their values", () => {
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

    let thrown: unknown;
    try {
      exportEvaluation([contaminated]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(EvaluationExportError);
    const message = (thrown as Error).message;
    // The failure names the rejection reason but never echoes the raw values.
    expect(message).not.toContain("secret-project");
    expect(message).not.toContain("acme-model-xl");
    expect(message).not.toContain("feature/private");
    expect(message).not.toContain("deep explanations");
    expect(message).not.toContain("proprietary");
    expect(message).not.toContain("secret.ts");
    expect(message).not.toContain("TS2345");
  });

  it("does not echo an unexpected sensitive property name in the error", () => {
    const sensitiveKey = "/Users/alice/private-prompt";
    const contaminated = {
      ...baseRecord(),
      [sensitiveKey]: true,
    } as unknown as EvaluationRecord;

    let thrown: unknown;
    try {
      exportEvaluation([contaminated]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(EvaluationExportError);
    expect((thrown as EvaluationExportError).field).not.toContain(sensitiveKey);
    expect((thrown as Error).message).not.toContain(sensitiveKey);
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

describe("Evaluation export — strict runtime validation", () => {
  it("rejects an invalid operation-outcome category without leaking its value", () => {
    const record = {
      ...baseRecord(),
      operationOutcomes: ["confirmed", "/Users/dev/secret/path"],
    } as unknown as EvaluationRecord;
    let thrown: unknown;
    try {
      exportEvaluation([record]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(EvaluationExportError);
    expect((thrown as EvaluationExportError).reason).toBe(
      "invalid-operation-outcome",
    );
    expect((thrown as Error).message).not.toContain("secret");
  });

  it("rejects sparse operation outcomes", () => {
    const operationOutcomes = new Array<EvaluationRecord["operationOutcomes"][number]>(1);
    const record = {
      ...baseRecord(),
      operationOutcomes,
    };

    expect(() => exportEvaluation([record])).toThrow(EvaluationExportError);
  });

  it("rejects sparse record arrays", () => {
    const records = new Array<EvaluationRecord>(1);

    expect(() => exportEvaluation(records)).toThrow(EvaluationExportError);
  });

  it("rejects an invalid mode category", () => {
    const record = { ...baseRecord(), mode: "smuggled-data" } as unknown as EvaluationRecord;
    expect(() => exportEvaluation([record])).toThrow(EvaluationExportError);
  });

  it("rejects an invalid growth demonstration value", () => {
    const record = {
      ...baseRecord(),
      growth: { ...baseRecord().growth, explanation: "leaked text" },
    } as unknown as EvaluationRecord;
    let thrown: unknown;
    try {
      exportEvaluation([record]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(EvaluationExportError);
    expect((thrown as Error).message).not.toContain("leaked text");
  });

  it("rejects an extra property nested in the growth object", () => {
    const record = {
      ...baseRecord(),
      growth: { ...baseRecord().growth, secretNote: "private" },
    } as unknown as EvaluationRecord;
    expect(() => exportEvaluation([record])).toThrow(EvaluationExportError);
  });

  it.each([
    ["a non-finite count", { pauseCount: Number.POSITIVE_INFINITY }],
    ["a NaN count", { conflictCount: Number.NaN }],
    ["a negative count", { unwantedInterventionCount: -1 }],
    ["a non-integer count", { pauseCount: 1.5 }],
    ["an unsafe-integer count", { conflictCount: Number.MAX_SAFE_INTEGER + 1 }],
  ])("rejects %s", (_label, override) => {
    const record = { ...baseRecord(), ...override };
    expect(() => exportEvaluation([record])).toThrow(EvaluationExportError);
  });

  it.each([
    ["a non-finite timestamp", { startedAt: Number.POSITIVE_INFINITY }],
    ["a NaN timestamp", { completedAt: Number.NaN }],
    ["a negative timestamp", { startedAt: -1 }],
    ["an unsafe-integer timestamp", { completedAt: Number.MAX_SAFE_INTEGER + 1 }],
  ])("rejects %s", (_label, override) => {
    const record = { ...baseRecord(), ...override };
    expect(() => exportEvaluation([record])).toThrow(EvaluationExportError);
  });

  it("rejects an out-of-range hint level", () => {
    const record = { ...baseRecord(), hintLevel: 9 } as unknown as EvaluationRecord;
    expect(() => exportEvaluation([record])).toThrow(EvaluationExportError);
  });

  it("rejects a wrong protocol version", () => {
    const record = { ...baseRecord(), protocolVersion: 2 } as unknown as EvaluationRecord;
    expect(() => exportEvaluation([record])).toThrow(EvaluationExportError);
  });

  it("rejects a non-boolean reveal flag", () => {
    const record = { ...baseRecord(), solutionRevealed: "yes" } as unknown as EvaluationRecord;
    expect(() => exportEvaluation([record])).toThrow(EvaluationExportError);
  });

  it("accepts a fully valid record", () => {
    expect(() => exportEvaluation([baseRecord()])).not.toThrow();
  });
});
