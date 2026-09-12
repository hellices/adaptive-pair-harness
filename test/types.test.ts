import { describe, expect, it } from "vitest";
import type { Intervention, PairRange } from "../src/core/types";

describe("core types", () => {
  it("exports the Intervention contract", () => {
    const range: PairRange = {
      start: { line: 1, character: 2 },
      end: { line: 1, character: 5 },
    };

    const intervention: Intervention = {
      evidenceId: "evidence-1",
      message: "review the highlighted edit",
      range,
      source: "local",
      createdAt: 123,
    };

    expect(intervention).toEqual({
      evidenceId: "evidence-1",
      message: "review the highlighted edit",
      range,
      source: "local",
      createdAt: 123,
    });
  });
});
