import { describe, expect, it } from "vitest";
import { guardGrowthResponse } from "../src/index.js";

describe("guardGrowthResponse", () => {
  it("withholds a target patch before reveal", () => {
    const result = guardGrowthResponse(
      { level: 3, kind: "hint", text: "```diff\n+export function retry() {}\n```" },
      { revealAuthorized: false, targetIdentifiers: ["retry"] },
    );

    expect(result).toEqual({
      accepted: false,
      reason: "TARGET_SOLUTION_WITHHELD",
    });
  });

  it("escapes target identifiers before building matchers", () => {
    const result = guardGrowthResponse(
      {
        level: 4,
        kind: "pseudocode",
        text: "class retry$1 {}\nKeep the rest of the logic unchanged.",
      },
      { revealAuthorized: false, targetIdentifiers: ["retry$1"] },
    );

    expect(result).toEqual({
      accepted: false,
      reason: "TARGET_SOLUTION_WITHHELD",
    });
  });

  it("blocks level 5 previews until explicit reveal", () => {
    const result = guardGrowthResponse(
      {
        level: 5,
        kind: "solution-preview",
        text: "function retry() { return 3; }",
      },
      { revealAuthorized: false, targetIdentifiers: ["retry"] },
    );

    expect(result).toEqual({
      accepted: false,
      reason: "TARGET_SOLUTION_WITHHELD",
    });
  });

  it("passes through non-target guidance", () => {
    const result = guardGrowthResponse(
      {
        level: 2,
        kind: "question",
        text: "Which branch should update the retry counter first?",
      },
      { revealAuthorized: false, targetIdentifiers: ["retry"] },
    );

    expect(result).toEqual({
      accepted: true,
      response: {
        level: 2,
        kind: "question",
        text: "Which branch should update the retry counter first?",
      },
    });
  });

  it("withholds code-like target declarations beyond function/class syntax", () => {
    const result = guardGrowthResponse(
      {
        level: 4,
        kind: "pseudocode",
        text: "const retry = () => nextCount + 1;",
      },
      { revealAuthorized: false, targetIdentifiers: ["retry"] },
    );

    expect(result).toEqual({
      accepted: false,
      reason: "TARGET_SOLUTION_WITHHELD",
    });
  });
});
