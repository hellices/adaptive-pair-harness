import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(".github/workflows/ci.yml"), "utf8");

const job = (start: string, end?: string): string => {
  const startIndex = workflow.indexOf(start);
  expect(startIndex, `missing workflow job ${start}`).toBeGreaterThanOrEqual(0);
  const endIndex = end === undefined ? workflow.length : workflow.indexOf(end, startIndex);
  expect(endIndex, `missing workflow boundary ${end}`).toBeGreaterThan(startIndex);
  return workflow.slice(startIndex, endIndex);
};

const expectOrdered = (text: string, steps: readonly string[]): void => {
  let previous = -1;
  for (const step of steps) {
    const index = text.indexOf(step);
    expect(index, `missing workflow step: ${step}`).toBeGreaterThan(previous);
    previous = index;
  }
};

describe("CI clean-checkout ordering", () => {
  it("validates feature branches through pull requests and main after merge", () => {
    const triggers = workflow.slice(0, workflow.indexOf("jobs:"));

    expect(triggers).toContain('push:\n    branches: ["main"]');
    expect(triggers).toContain("pull_request:");
    expect(triggers).not.toContain('branches: ["**"]');
  });

  it("builds workspace exports before targeted parity imports", () => {
    expectOrdered(job("  build-and-package:", "  host-smoke:"), [
      "run: npm ci",
      "name: Build workspace package exports",
      "run: npm run typecheck",
      "name: Manifest-to-catalog parity tests",
    ]);
  });

  it("builds workspace exports before both stable host smoke jobs", () => {
    expectOrdered(job("  host-smoke:", "  host-insiders:"), [
      "run: npm ci",
      "name: Build workspace package exports",
      "run: npm run typecheck",
      "name: Run isolated Extension Host smoke",
    ]);
  });

  it("builds workspace exports before the Insiders host smoke job", () => {
    expectOrdered(job("  host-insiders:"), [
      "run: npm ci",
      "name: Build workspace package exports",
      "run: npm run typecheck",
      "name: Run isolated Extension Host smoke on Insiders",
    ]);
  });
});
