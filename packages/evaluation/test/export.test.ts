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
  it("emits only allowlisted fields with timestamps rounded to a whole minute", () => {
    const parsed = JSON.parse(exportEvaluation([baseRecord()])) as {
      readonly records: readonly Record<string, unknown>[];
    };

    expect(parsed.records).toEqual([
      {
        ...baseRecord(),
        startedAt: 1_700_000_040_000,
        completedAt: 1_700_000_100_000,
      },
    ]);
  });

  it("rejects an unexpected property without echoing its name or value", () => {
    const sensitiveKey = "/Users/alice/private-prompt";
    const contaminated = {
      ...baseRecord(),
      [sensitiveKey]: "here is my proprietary source code",
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
    expect((thrown as Error).message).not.toContain("proprietary");
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
    ["a NaN count", { conflictCount: Number.NaN }],
    ["a negative count", { unwantedInterventionCount: -1 }],
    ["a non-integer count", { pauseCount: 1.5 }],
  ])("rejects %s", (_label, override) => {
    const record = { ...baseRecord(), ...override };
    expect(() => exportEvaluation([record])).toThrow(EvaluationExportError);
  });

  it.each([
    ["a NaN timestamp", { completedAt: Number.NaN }],
    ["a negative timestamp", { startedAt: -1 }],
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
});
