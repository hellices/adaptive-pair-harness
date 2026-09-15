import { describe, expect, it } from "vitest";
import { nextHintLevel } from "../src/index.js";

const createState = () => ({
  attempted: false,
  bypassedAttempt: false,
  hypothesisRecorded: false,
  currentLevel: 0 as const,
  maximumLevel: 4 as const,
  revealAuthorized: false,
});

describe("nextHintLevel", () => {
  it("requires an attempt before direct rescue", () => {
    expect(nextHintLevel(createState(), 3)).toEqual({
      level: 1,
      requiresAttempt: true,
      requiresReveal: false,
    });
  });

  it("respects an explicit attempt bypass", () => {
    expect(
      nextHintLevel(
        {
          ...createState(),
          bypassedAttempt: true,
        },
        4,
      ),
    ).toEqual({
      level: 4,
      requiresAttempt: false,
      requiresReveal: false,
    });
  });

  it("caps hints at the learning agreement maximum", () => {
    expect(
      nextHintLevel(
        {
          ...createState(),
          attempted: true,
          maximumLevel: 2,
        },
        4,
      ),
    ).toEqual({
      level: 2,
      requiresAttempt: false,
      requiresReveal: false,
    });
  });

  it("requires explicit reveal before level 5", () => {
    expect(
      nextHintLevel(
        {
          ...createState(),
          attempted: true,
          maximumLevel: 5,
        },
        5,
      ),
    ).toEqual({
      level: 4,
      requiresAttempt: false,
      requiresReveal: true,
    });
  });
});
