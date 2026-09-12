import { describe, expect, it } from "vitest";
import { discoverHarnessSignals } from "../src/core/coexistence";

describe("discoverHarnessSignals", () => {
  it("detects known coexistence signals without claiming active ownership", () => {
    const signals = discoverHarnessSignals({
      extensionIds: [
        "github.copilot",
        "saoudrizwan.claude-dev",
        "github.copilot",
        "SAOUDRIZWAN.CLAUDE-DEV",
      ],
      workspacePaths: [
        "AGENTS.md",
        "docs/superpowers/plans/2026-09-12-plan.md",
        "docs\\superpowers\\plans\\2026-09-12-plan.md",
      ],
    });

    expect(signals.map((signal) => signal.kind)).toEqual(
      expect.arrayContaining([
        "copilot",
        "cline",
        "superpowers-plan",
        "agents-instructions",
      ]),
    );
    expect(signals).toHaveLength(4);
    expect(Object.isFrozen(signals)).toBe(true);
    expect(signals.every((signal) => Object.isFrozen(signal))).toBe(true);
    expect(
      signals.every(
        (signal) => JSON.stringify(Object.keys(signal).sort()) === "[\"kind\",\"label\",\"source\"]",
      ),
    ).toBe(true);
  });

  it("ignores absolute and escaping workspace paths when detecting superpowers plans", () => {
    const signals = discoverHarnessSignals({
      extensionIds: [],
      workspacePaths: [
        "../docs/superpowers/plans/2026-09-13-plan.md",
        "/workspace/docs/superpowers/plans/2026-09-14-plan.md",
        "C:\\workspace\\docs\\superpowers\\plans\\2026-09-15-plan.md",
      ],
    });

    expect(signals).toEqual([]);
  });
});
