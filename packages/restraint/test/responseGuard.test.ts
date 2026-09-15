import { describe, expect, it } from "vitest";
import { guardGrowthResponse } from "../src/index.js";

describe("guardGrowthResponse", () => {
  it("withholds a response above the deterministic hint ceiling", () => {
    const result = guardGrowthResponse(
      {
        level: 4,
        kind: "pseudocode",
        text: "Track attempts, stop at the bound, and return the successful count.",
      },
      {
        authorizedHintLevel: 1,
        revealAuthorized: false,
        targetIdentifiers: ["retry"],
      },
    );

    expect(result).toEqual({
      accepted: false,
      reason: "HINT_LEVEL_EXCEEDED",
    });
  });

  it("withholds a response class above the deterministic hint ceiling", () => {
    const result = guardGrowthResponse(
      {
        level: 1,
        kind: "solution-preview",
        text: "```ts\nexport function retry() { return 3; }\n```",
      },
      {
        authorizedHintLevel: 1,
        revealAuthorized: false,
        targetIdentifiers: [],
      },
    );

    expect(result).toEqual({
      accepted: false,
      reason: "RESPONSE_CLASS_EXCEEDED",
    });
  });

  it("withholds a target patch before reveal", () => {
    const result = guardGrowthResponse(
      { level: 3, kind: "hint", text: "```diff\n+export function retry() {}\n```" },
      {
        authorizedHintLevel: 3,
        revealAuthorized: false,
        targetIdentifiers: ["retry"],
      },
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
      {
        authorizedHintLevel: 4,
        revealAuthorized: false,
        targetIdentifiers: ["retry$1"],
      },
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
      {
        authorizedHintLevel: 5,
        revealAuthorized: false,
        targetIdentifiers: ["retry"],
      },
    );

    expect(result).toEqual({
      accepted: false,
      reason: "TARGET_SOLUTION_WITHHELD",
    });
  });

  it("rejects a solution preview that understates its semantic level", () => {
    const result = guardGrowthResponse(
      {
        level: 4,
        kind: "solution-preview",
        text: "The complete answer is 42.",
      },
      {
        authorizedHintLevel: 5,
        revealAuthorized: false,
        targetIdentifiers: [],
      },
    );

    expect(result).toEqual({
      accepted: false,
      reason: "RESPONSE_CLASS_EXCEEDED",
    });
  });

  it("passes through non-target guidance", () => {
    const result = guardGrowthResponse(
      {
        level: 2,
        kind: "question",
        text: "Which branch should update the retry counter first?",
      },
      {
        authorizedHintLevel: 2,
        revealAuthorized: false,
        targetIdentifiers: ["retry"],
      },
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
      {
        authorizedHintLevel: 4,
        revealAuthorized: false,
        targetIdentifiers: ["retry"],
      },
    );

    expect(result).toEqual({
      accepted: false,
      reason: "TARGET_SOLUTION_WITHHELD",
    });
  });

  it("withholds a target function whose name extends the file stem", () => {
    const result = guardGrowthResponse(
      {
        level: 4,
        kind: "pseudocode",
        text: "function retryUntil(action, max) { return action(max); }",
      },
      {
        authorizedHintLevel: 4,
        revealAuthorized: false,
        targetIdentifiers: ["retry"],
      },
    );

    expect(result).toEqual({
      accepted: false,
      reason: "TARGET_SOLUTION_WITHHELD",
    });
  });

  it.each([
    ["index", "Look at what indexOf() returns when the value is absent."],
    ["app", "Which array method would you apply (map or reduce)?"],
    ["tests", "Re-run the tests (in watch mode) and read the first failure."],
  ])("does not treat ordinary %s prose as a target implementation", (identifier, text) => {
    const result = guardGrowthResponse(
      {
        level: 2,
        kind: "hint",
        text,
      },
      {
        authorizedHintLevel: 2,
        revealAuthorized: false,
        targetIdentifiers: [identifier],
      },
    );

    expect(result).toMatchObject({ accepted: true });
  });

  it("withholds an unfenced target body without a declaration keyword", () => {
    const result = guardGrowthResponse(
      {
        level: 4,
        kind: "pseudocode",
        text: "retryUntil(action, max) { let attempts = 0; return attempts; }",
      },
      {
        authorizedHintLevel: 4,
        revealAuthorized: false,
        targetIdentifiers: ["retry"],
      },
    );

    expect(result).toEqual({
      accepted: false,
      reason: "TARGET_SOLUTION_WITHHELD",
    });
  });

  it("withholds any diff or patch fence even without known identifiers", () => {
    const result = guardGrowthResponse(
      {
        level: 3,
        kind: "hint",
        text: "```patch\n+ do the thing\n```",
      },
      {
        authorizedHintLevel: 3,
        revealAuthorized: false,
        targetIdentifiers: [],
      },
    );

    expect(result).toEqual({
      accepted: false,
      reason: "TARGET_SOLUTION_WITHHELD",
    });
  });

  it("emits a level-5 solution only after an explicit reveal authorization", () => {
    const response = {
      level: 5,
      kind: "solution-preview",
      text: "function retry() { return 3; }",
    } as const;

    expect(
      guardGrowthResponse(response, {
        authorizedHintLevel: 5,
        revealAuthorized: true,
        targetIdentifiers: ["retry"],
      }),
    ).toEqual({ accepted: true, response });
  });
});
