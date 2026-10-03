import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ESLint, type Linter } from "eslint";
import { describe, expect, it } from "vitest";

const fixtureRoot = resolve(import.meta.dirname, "../../examples/growth-trial");
const fixtureFiles = ["package.json", "src/retry.mjs", "test/retry.test.mjs", "tsconfig.json"];
const passingTests = [
  "succeeds on the first attempt without retrying",
  "succeeds on the last allowed attempt",
];
const failingTests = [
  "returns false after exhausting a limit of 0",
  "returns false after exhausting a limit of 1",
  "returns false after exhausting a limit of 3",
  "does not accept success after the attempt limit",
];

function readFixture(directory: string) {
  return {
    entries: readdirSync(directory, { recursive: true }).sort(),
    contents: fixtureFiles.map(relativePath => readFileSync(join(directory, relativePath))),
  };
}

function runExercise(directory: string) {
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap"], {
    cwd: directory,
    encoding: "utf8",
    timeout: 10_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.stderr).toBe("");
  return result;
}

function testNames(output: string, status: "ok" | "not ok") {
  return Array.from(
    output.matchAll(new RegExp(`^${status} \\d+ - (.+)$`, "gmu")),
    match => match[1],
  );
}

function expectSummary(output: string, passed: number, failed: number) {
  expect(output.split(/\r?\n/u)).toEqual(expect.arrayContaining([
    `# tests ${passed + failed}`,
    `# pass ${passed}`,
    `# fail ${failed}`,
    "# cancelled 0",
    "# skipped 0",
    "# todo 0",
  ]));
}

describe("Growth trial exercise", () => {
  it.each(["src/retry.mjs", "test/retry.test.mjs"])("type-aware lints %s without suppressions", async relativePath => {
    const eslint = new ESLint();
    const filePath = join(fixtureRoot, relativePath);
    const config = await eslint.calculateConfigForFile(filePath) as Linter.Config;
    expect(config.linterOptions?.noInlineConfig).toBe(true);
    expect(config.rules?.["@typescript-eslint/no-unsafe-call"]).toEqual([2]);
    expect(config.rules?.["@typescript-eslint/no-floating-promises"]).toEqual([2]);

    const results = await eslint.lintFiles([filePath]);
    expect(results.flatMap(result => result.messages)).toEqual([]);
  });

  it("ships a private, dependency-free Node 24 package", () => {
    const manifestPath = join(fixtureRoot, "package.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;

    expect(manifest).toMatchObject({
      private: true,
      type: "module",
      engines: { node: ">=24" },
    });
    expect(manifest["scripts"]).toEqual({ test: "node --test" });
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
      "bundledDependencies",
      "bundleDependencies",
    ]) {
      expect(manifest).not.toHaveProperty(field);
    }
    for (const entry of ["node_modules", "package-lock.json", "npm-shrinkwrap.json"]) {
      expect(existsSync(join(fixtureRoot, entry)), entry).toBe(false);
    }
  });

  it("fails at the intended boundaries and passes after a disposable one-line repair", () => {
    for (const relativePath of fixtureFiles) {
      expect(existsSync(join(fixtureRoot, relativePath)), relativePath).toBe(true);
    }
    const original = readFixture(fixtureRoot);
    const temporaryRoot = mkdtempSync(join(tmpdir(), "adaptive-pair-growth-trial-"));
    const disposableRoot = join(temporaryRoot, "exercise");

    try {
      cpSync(fixtureRoot, disposableRoot, { recursive: true });
      expect(readFixture(disposableRoot)).toEqual(original);
      rmSync(join(disposableRoot, "tsconfig.json"));

      const initial = runExercise(disposableRoot);
      expect(initial.status, initial.stdout).toBe(1);
      expect(testNames(initial.stdout, "ok")).toEqual(passingTests);
      expect(testNames(initial.stdout, "not ok")).toEqual(failingTests);
      expectSummary(initial.stdout, passingTests.length, failingTests.length);

      const sourcePath = join(disposableRoot, "src/retry.mjs");
      const source = readFileSync(sourcePath, "utf8");
      const boundary = "attempt <= maxAttempts";
      expect(source.split(boundary)).toHaveLength(2);
      writeFileSync(sourcePath, source.replace(boundary, "attempt < maxAttempts"));

      const repaired = runExercise(disposableRoot);
      expect(repaired.status, repaired.stdout).toBe(0);
      expect(testNames(repaired.stdout, "ok")).toEqual([...passingTests, ...failingTests]);
      expect(testNames(repaired.stdout, "not ok")).toEqual([]);
      expectSummary(repaired.stdout, passingTests.length + failingTests.length, 0);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
      expect(readFixture(fixtureRoot)).toEqual(original);
    }
  }, 30_000);
});
