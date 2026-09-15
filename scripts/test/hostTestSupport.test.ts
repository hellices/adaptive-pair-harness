import { describe, expect, it } from "vitest";
import {
  deriveHostManifest,
  selectStaleRunDirectories,
  HOST_TEST_MAIN,
} from "../host-test-support.mjs";

const productionManifest = {
  name: "adaptive-pair",
  publisher: "adaptive-pair",
  version: "0.2.0-preview.1",
  engines: { vscode: "^1.136.0" },
  main: "./dist/extension.cjs",
  contributes: { commands: [{ command: "adaptivePair.enablePresence" }] },
};

describe("deriveHostManifest", () => {
  it("keeps every production contribution and only redirects main", () => {
    const derived = deriveHostManifest(productionManifest);

    expect(derived).toEqual({ ...productionManifest, main: HOST_TEST_MAIN });
    expect(derived.contributes).toEqual(productionManifest.contributes);
    // The production manifest object is never mutated.
    expect(productionManifest.main).toBe("./dist/extension.cjs");
  });

  it("refuses a manifest without a production main entry", () => {
    expect(() => deriveHostManifest({ name: "adaptive-pair" })).toThrow(/main/u);
  });
});

describe("selectStaleRunDirectories", () => {
  const now = Date.UTC(2026, 0, 10, 12, 0, 0);
  const day = 24 * 60 * 60 * 1000;

  it("selects only run-prefixed directories older than the maximum age", () => {
    const selected = selectStaleRunDirectories(
      [
        { name: "run-old", isDirectory: true, mtimeMs: now - day - 1 },
        { name: "run-fresh", isDirectory: true, mtimeMs: now - 60_000 },
        { name: "run-exactly-a-day", isDirectory: true, mtimeMs: now - day },
        { name: "keep-me", isDirectory: true, mtimeMs: 0 },
        { name: "run-file", isDirectory: false, mtimeMs: 0 },
        { name: "..", isDirectory: true, mtimeMs: 0 },
        { name: "run-../escape", isDirectory: true, mtimeMs: 0 },
      ],
      { now, maxAgeMs: day },
    );

    expect(selected).toEqual(["run-old"]);
  });

  it("selects nothing from an empty or entirely fresh directory listing", () => {
    expect(selectStaleRunDirectories([], { now, maxAgeMs: day })).toEqual([]);
    expect(
      selectStaleRunDirectories(
        [{ name: "run-a", isDirectory: true, mtimeMs: now }],
        { now, maxAgeMs: day },
      ),
    ).toEqual([]);
  });
});
