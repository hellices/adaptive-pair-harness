import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { TypeScriptSemanticAnalyzer } from "../src/core/semanticAnalyzer";
import type { EditEpisode, Evidence, PairRange } from "../src/core/types";

const analyzer = new TypeScriptSemanticAnalyzer();

afterEach(() => {
  vi.restoreAllMocks();
});

const episode = (
  previousText: string,
  currentText: string,
  languageId = "typescript",
  uri = "file:///pair.ts",
): EditEpisode => ({
  uri,
  languageId,
  previousText,
  currentText,
  version: 1,
  observedAt: 1,
});

const analyzeEvidence = (edit: EditEpisode): readonly Evidence[] => {
  const result = analyzer.analyze(edit);
  return result.stability === "stable" ? result.evidence : [];
};

const comparePositions = (left: PairRange["start"], right: PairRange["start"]): number => {
  if (left.line === right.line) {
    return left.character - right.character;
  }

  return left.line - right.line;
};

describe("TypeScriptSemanticAnalyzer", () => {
  it("keeps every filesystem probe inside the installed TypeScript lib directory", () => {
    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.Latest,
    };
    const installedLibraryDirectory = resolve(
      dirname(ts.getDefaultLibFilePath(compilerOptions)),
    );
    const libraryDirectory =
      ts.sys.realpath?.(installedLibraryDirectory) ??
      installedLibraryDirectory;
    const probes: Array<{ readonly operation: string; readonly path: string }> =
      [];
    const recordProbe = (operation: string, path: string): void => {
      probes.push({ operation, path: resolve(path) });
    };
    const originalFileExists = ts.sys.fileExists;
    const originalReadFile = ts.sys.readFile;
    const originalReadDirectory = ts.sys.readDirectory;
    vi.spyOn(ts.sys, "fileExists").mockImplementation((path) => {
      recordProbe("fileExists", path);
      return originalFileExists(path);
    });
    vi.spyOn(ts.sys, "readFile").mockImplementation((path, encoding) => {
      recordProbe("readFile", path);
      return originalReadFile(path, encoding);
    });
    vi.spyOn(ts.sys, "readDirectory").mockImplementation(
      (path, extensions, exclude, include, depth) => {
        recordProbe("readDirectory", path);
        return originalReadDirectory(
          path,
          extensions,
          exclude,
          include,
          depth,
        );
      },
    );
    const originalDirectoryExists = ts.sys.directoryExists;
    if (originalDirectoryExists !== undefined) {
      vi.spyOn(ts.sys, "directoryExists").mockImplementation((path) => {
        recordProbe("directoryExists", path);
        return originalDirectoryExists(path);
      });
    }
    const originalGetDirectories = ts.sys.getDirectories;
    if (originalGetDirectories !== undefined) {
      vi.spyOn(ts.sys, "getDirectories").mockImplementation((path) => {
        recordProbe("getDirectories", path);
        return originalGetDirectories(path);
      });
    }
    const originalRealpath = ts.sys.realpath;
    if (originalRealpath !== undefined) {
      const systemWithRealpath = ts.sys as ts.System & {
        realpath: (path: string) => string;
      };
      vi.spyOn(systemWithRealpath, "realpath").mockImplementation((path) => {
        const realPath = originalRealpath(path);
        recordProbe("realpath", realPath);
        return realPath;
      });
    }

    const result = analyzer.analyze(
      episode(
        [
          '/// <reference path="/private/project/secret.d.ts" />',
          '/// <reference types="outside-package" />',
          'import type { Secret } from "/private/project/secret";',
          "export const values = async () => [1];",
        ].join("\n"),
        [
          '/// <reference path="/private/project/secret.d.ts" />',
          '/// <reference types="outside-package" />',
          'import type { Secret } from "/private/project/secret";',
          'export const values = async () => ["one"];',
        ].join("\n"),
        "typescript",
        "file:///private/project/pair.ts",
      ),
    );

    expect(result.stability).toBe("stable");
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["values"],
        }),
      ]),
    );
    expect(probes.length).toBeGreaterThan(0);
    for (const probe of probes) {
      const pathWithinLibrary = relative(libraryDirectory, probe.path);
      expect(
        pathWithinLibrary === "" ||
          (!pathWithinLibrary.startsWith("..") &&
            !isAbsolute(pathWithinLibrary)),
        `${probe.operation} escaped the TypeScript lib directory: ${probe.path}`,
      ).toBe(true);
      if (probe.operation === "fileExists" || probe.operation === "readFile") {
        expect(basename(probe.path)).toMatch(/^lib(?:\..+)?\.d\.ts$/u);
      }
    }
  });

  it("rejects an allowed-looking standard library symlink that resolves outside the canonical root", () => {
    const installedLibraryDirectory = resolve("virtual-typescript-link", "lib");
    const canonicalLibraryDirectory = resolve("virtual-typescript", "lib");
    const installedLibraryFile = resolve(
      installedLibraryDirectory,
      "lib.esnext.full.d.ts",
    );
    const canonicalLibraryFile = resolve(
      canonicalLibraryDirectory,
      "lib.esnext.full.d.ts",
    );
    const symlinkFile = resolve(canonicalLibraryDirectory, "lib.es5.d.ts");
    const escapedTarget = resolve("private-project", "secret.d.ts");
    const operations: Array<{
      readonly operation: "fileExists" | "readFile" | "realpath";
      readonly path: string;
    }> = [];
    const fakeFileSystem = {
      fileExists: (path: string): boolean => {
        operations.push({ operation: "fileExists", path });
        return path === canonicalLibraryFile || path === escapedTarget;
      },
      getDefaultLibFilePath: (): string => installedLibraryFile,
      readFile: (path: string): string | undefined => {
        operations.push({ operation: "readFile", path });
        if (path === canonicalLibraryFile) {
          return '/// <reference lib="es5" />\ninterface Array<T> {}';
        }
        if (path === escapedTarget) {
          return "declare const leakedSecret: unique symbol;";
        }
        return undefined;
      },
      realpath: (path: string): string | undefined => {
        operations.push({ operation: "realpath", path });
        if (path === installedLibraryDirectory) {
          return canonicalLibraryDirectory;
        }
        if (path === symlinkFile) {
          return escapedTarget;
        }
        return path;
      },
    };
    const analyzerWithFileSystem = new TypeScriptSemanticAnalyzer(
      fakeFileSystem,
    );

    const result = analyzerWithFileSystem.analyze(
      episode("export const value = 1;", "export const value = 2;"),
    );

    expect(result.stability).toBe("stable");
    expect(operations).toContainEqual({
      operation: "realpath",
      path: symlinkFile,
    });
    expect(operations).not.toContainEqual({
      operation: "fileExists",
      path: escapedTarget,
    });
    expect(operations).not.toContainEqual({
      operation: "fileExists",
      path: symlinkFile,
    });
    expect(operations).not.toContainEqual({
      operation: "readFile",
      path: escapedTarget,
    });
    expect(operations).not.toContainEqual({
      operation: "readFile",
      path: symlinkFile,
    });
  });

  it("reports a newly introduced import", () => {
    const evidence = analyzeEvidence(
      episode(
        "export const value = 1;",
        'import { save } from "./repository";\nexport const value = 1;',
      ),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "new-dependency",
          title: "New dependency introduced",
          references: ["./repository"],
        }),
      ]),
    );
  });

  it("reports a changed exported function signature", () => {
    const evidence = analyzeEvidence(
      episode(
        "export function load(id: string): string { return id; }",
        "export function load(id: number): string { return String(id); }",
      ),
    );

    expect(evidence.some((item) => item.kind === "public-api-change")).toBe(true);
  });

  it("reports a changed anonymous default-exported function signature", () => {
    const evidence = analyzeEvidence(
      episode(
        "export default function (value: string): string { return value; }",
        "export default function (value: number): string { return String(value); }",
      ),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["default export"],
        }),
      ]),
    );
  });

  it("keys named default exports by their external default identity", () => {
    const renamed = analyzeEvidence(
      episode(
        "export default function before(value: string): string { return value; }",
        "export default function after(value: string): string { return value; }",
      ),
    );
    const changed = analyzeEvidence(
      episode(
        "export default function before(value: string): string { return value; }",
        "export default function after(value: number): string { return String(value); }",
      ),
    );

    expect(
      renamed.filter((item) => item.kind === "public-api-change"),
    ).toEqual([]);
    expect(changed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["default export"],
        }),
      ]),
    );
  });

  it("reports inferred signature changes for exported function-valued variables", () => {
    const evidence = analyzeEvidence(
      episode(
        "export const load = (id = 1) => id + 1;",
        'export const load = (id = 1) => String(id);',
      ),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["load"],
        }),
      ]),
    );
  });

  it("prioritizes explicit callable variable annotations over initializer syntax", () => {
    const evidence = analyzeEvidence(
      episode(
        [
          "export const load: (id: string) => string =",
          "  (id: any) => String(id);",
        ].join("\n"),
        [
          "export const load: (id: number) => string =",
          "  (id: any) => String(id);",
        ].join("\n"),
      ),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["load"],
        }),
      ]),
    );
  });

  it("infers changed array element types from the standard library", () => {
    const evidence = analyzeEvidence(
      episode(
        "export const values = () => [1];",
        'export const values = () => ["one"];',
      ),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["values"],
        }),
      ]),
    );
  });

  it("infers changed async return types from the standard library", () => {
    const evidence = analyzeEvidence(
      episode(
        "export const load = async () => 1;",
        'export const load = async () => "one";',
      ),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["load"],
        }),
      ]),
    );
  });

  it("tracks local export lists by their external aliases", () => {
    const evidence = analyzeEvidence(
      episode(
        [
          "const load = (id: string): string => id;",
          "export { load as fetchItem };",
        ].join("\n"),
        [
          "const load = (id: number): string => String(id);",
          "export { load as fetchItem };",
        ].join("\n"),
      ),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["fetchItem"],
        }),
      ]),
    );
  });

  it("resolves callable identifiers assigned to exported variables", () => {
    const evidence = analyzeEvidence(
      episode(
        [
          "function impl(id: string): string { return id; }",
          "export const load = impl;",
        ].join("\n"),
        [
          "function impl(id: number): string { return String(id); }",
          "export const load = impl;",
        ].join("\n"),
      ),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["load"],
        }),
      ]),
    );
    expect(JSON.stringify(evidence)).not.toContain("impl");
  });

  it("uses checker call signatures for typed callable aliases", () => {
    const evidence = analyzeEvidence(
      episode(
        [
          "declare const impl: (id: string) => string;",
          "export const load = impl;",
        ].join("\n"),
        [
          "declare const impl: (id: number) => string;",
          "export const load = impl;",
        ].join("\n"),
      ),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["load"],
        }),
      ]),
    );
  });

  it("resolves CommonJS exports through JavaScript alias variables", () => {
    const evidence = analyzeEvidence(
      episode(
        [
          "function impl(id) { return 1; }",
          "const alias = impl;",
          "module.exports.load = alias;",
        ].join("\n"),
        [
          'function impl(id) { return "one"; }',
          "const alias = impl;",
          "module.exports.load = alias;",
        ].join("\n"),
        "javascript",
        "file:///pair.js",
      ),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["load"],
        }),
      ]),
    );
  });

  it("reports CommonJS JavaScript export signature changes", () => {
    const named = analyzeEvidence(
      episode(
        "exports.load = function (id) { return 1; };",
        'exports.load = function (id) { return "one"; };',
        "javascript",
        "file:///pair.js",
      ),
    );
    const defaultExport = analyzeEvidence(
      episode(
        "module.exports = (id) => 1;",
        'module.exports = (id) => "one";',
        "javascript",
        "file:///pair.js",
      ),
    );

    expect(named).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["load"],
        }),
      ]),
    );
    expect(defaultExport).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["default export"],
        }),
      ]),
    );
  });

  it("includes optional, async, and generator changes in exported signatures", () => {
    const evidence = analyzeEvidence(
      episode(
        "export function stream(value: string): Iterable<string> { return [value]; }",
        "export async function* stream(value?: string) { yield value ?? ''; }",
      ),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["stream"],
        }),
      ]),
    );
  });

  it("reports a changed method signature on an anonymous default-exported class", () => {
    const evidence = analyzeEvidence(
      episode(
        "export default class { render(value: string): string { return value; } }",
        "export default class { render(value: number): string { return String(value); } }",
      ),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["default export#render"],
        }),
      ]),
    );
  });

  it("reports overload-only changes for exported functions", () => {
    const evidence = analyzeEvidence(
      episode(
        [
          "export function load(value: string): string;",
          "export function load(value: string | number): string { return String(value); }",
        ].join("\n"),
        [
          "export function load(value: string): string;",
          "export function load(value: number): string;",
          "export function load(value: string | number): string { return String(value); }",
        ].join("\n"),
      ),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["load"],
        }),
      ]),
    );
  });

  it("reports overload-only changes for exported class methods", () => {
    const evidence = analyzeEvidence(
      episode(
        [
          "export class Example {",
          "  run(value: string): string;",
          "  run(value: string | number): string {",
          "    return String(value);",
          "  }",
          "}",
        ].join("\n"),
        [
          "export class Example {",
          "  run(value: string): string;",
          "  run(value: number): string;",
          "  run(value: string | number): string {",
          "    return String(value);",
          "  }",
          "}",
        ].join("\n"),
      ),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["Example#run"],
        }),
      ]),
    );
  });

  it("reports when an exported function is removed", () => {
    const evidence = analyzeEvidence(
      episode("export function load(id: string): string { return id; }", "const value = 1;"),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["load"],
          detail: expect.stringContaining("load"),
        }),
      ]),
    );

    const removalEvidence = evidence.find(
      (item) => item.kind === "public-api-change" && item.references.includes("load"),
    );

    expect(removalEvidence).toBeDefined();
    expect(removalEvidence?.range.start).toEqual(removalEvidence?.range.end);
  });

  it("reports when a public method is removed from an exported class", () => {
    const evidence = analyzeEvidence(
      episode(
        [
          "export class Example {",
          "  run(value: string): string {",
          "    return value;",
          "  }",
          "}",
        ].join("\n"),
        "export class Example {}",
      ),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["Example#run"],
          detail: expect.stringContaining("Example#run"),
        }),
      ]),
    );

    const removalEvidence = evidence.find(
      (item) => item.kind === "public-api-change" && item.references.includes("Example#run"),
    );

    expect(removalEvidence).toBeDefined();
    expect(removalEvidence?.range.start).toEqual(removalEvidence?.range.end);
  });

  it("does not report removal of non-exported functions or private methods", () => {
    const removedFunctionEvidence = analyzeEvidence(
      episode("function load(id: string): string { return id; }", "const value = 1;"),
    );
    const removedPrivateMethodEvidence = analyzeEvidence(
      episode(
        [
          "export class Example {",
          "  private run(value: string): string {",
          "    return value;",
          "  }",
          "}",
        ].join("\n"),
        "export class Example {}",
      ),
    );

    expect(removedFunctionEvidence).toEqual([]);
    expect(removedPrivateMethodEvidence).toEqual([]);
  });

  it("does not report formatting-only or comment-only exported signature changes", () => {
    const evidence = analyzeEvidence(
      episode(
        "export function load(value: string | number): string | number { return value; }",
        [
          "export function load(",
          "  value:string",
          "    /* formatting only */",
          "    |number,",
          "):string|number {",
          "  return value;",
          "}",
        ].join("\n"),
      ),
    );

    expect(evidence.filter((item) => item.kind === "public-api-change")).toEqual([]);
  });

  it("still reports real exported signature literal changes", () => {
    const evidence = analyzeEvidence(
      episode(
        'export function load(value: { status: "ok"; note: "a b" }): "done now" { return "done now"; }',
        'export function load(value: { status: "ok"; note: "ab" }): "done now" { return "done now"; }',
      ),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["load"],
        }),
      ]),
    );
  });

  it("returns an explicit unstable result while the current source has parse errors", () => {
    const result = analyzer.analyze(
      episode("export function load() {}", "export function load("),
    );

    expect(result).toEqual({
      stability: "unstable",
      evidence: [],
    });
  });

  it("reports complexity growth when a function crosses the intervention threshold", () => {
    const evidence = analyzeEvidence(
      episode(
        "export function decide(value: number): number { if (value > 0) { return value; } if (value < 0) { return -value; } return 0; }",
        [
          "export function decide(value: number): number {",
          "  if (value > 10) {",
          "    return 10;",
          "  }",
          "  if (value > 0 && value < 10) {",
          "    return value;",
          "  }",
          "  for (const item of [value]) {",
          "    if (item === 0) {",
          "      return 0;",
          "    }",
          "  }",
          "  return value < 0 ? -value : value;",
          "}",
        ].join("\n"),
      ),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "complexity-growth",
          title: "Complexity increased substantially",
        }),
      ]),
    );
  });

  it("assigns deterministic ids for repeated analysis of the same edit", () => {
    const edit = episode(
      "export function load(id: string): string { return id; }",
      'import { save } from "./repository";\nexport function load(id: number): string { return String(id); }',
    );

    const firstEvidence = analyzeEvidence(edit);
    const secondEvidence = analyzeEvidence(edit);

    expect(firstEvidence.map((item) => item.id)).toEqual(secondEvidence.map((item) => item.id));
  });

  it("uses privacy-safe module hashes to distinguish identical evidence across files", () => {
    const previous = "export const value = 1;";
    const current =
      'import { save } from "./repository";\nexport const value = 1;';
    const first = analyzeEvidence(
      episode(previous, current, "typescript", "file:///private/alpha.ts"),
    );
    const second = analyzeEvidence(
      episode(previous, current, "typescript", "file:///private/beta.ts"),
    );

    expect(first[0]?.id).not.toBe(second[0]?.id);
    expect(first[0]?.id).not.toContain("private");
    expect(first[0]?.id).not.toContain("repository");
    expect(second[0]?.id).not.toContain("beta");
  });

  it("anchors evidence to valid ranges in the current source", () => {
    const currentText = 'import { save } from "./repository";\nexport const value = 1;';
    const evidence = analyzeEvidence(episode("export const value = 1;", currentText));

    expect(evidence).not.toEqual([]);

    for (const item of evidence) {
      expect(item.range.start.line).toBeGreaterThanOrEqual(0);
      expect(item.range.start.character).toBeGreaterThanOrEqual(0);
      expect(item.range.end.line).toBeGreaterThanOrEqual(item.range.start.line);
      expect(comparePositions(item.range.start, item.range.end)).toBeLessThan(0);
    }
  });

  it("assigns distinct complexity evidence ids to same-named nested functions in different scopes", () => {
    const evidence = analyzeEvidence(
      episode(
        [
          "function outerOne(value: number): number {",
          "  function helper(input: number): number {",
          "    if (input > 0) {",
          "      return input;",
          "    }",
          "    if (input < 0) {",
          "      return -input;",
          "    }",
          "    return 0;",
          "  }",
          "  return helper(value);",
          "}",
          "function outerTwo(value: number): number {",
          "  function helper(input: number): number {",
          "    if (input > 0) {",
          "      return input;",
          "    }",
          "    if (input < 0) {",
          "      return -input;",
          "    }",
          "    return 0;",
          "  }",
          "  return helper(value);",
          "}",
        ].join("\n"),
        [
          "function outerOne(value: number): number {",
          "  function helper(input: number): number {",
          "    if (input > 10) {",
          "      return 10;",
          "    }",
          "    if (input > 0 && input < 10) {",
          "      return input;",
          "    }",
          "    for (const item of [input]) {",
          "      if (item === 0) {",
          "        return 0;",
          "      }",
          "    }",
          "    return input < 0 ? -input : input;",
          "  }",
          "  return helper(value);",
          "}",
          "function outerTwo(value: number): number {",
          "  function helper(input: number): number {",
          "    if (input > 10) {",
          "      return 10;",
          "    }",
          "    if (input > 0 && input < 10) {",
          "      return input;",
          "    }",
          "    for (const item of [input]) {",
          "      if (item === 0) {",
          "        return 0;",
          "      }",
          "    }",
          "    return input < 0 ? -input : input;",
          "  }",
          "  return helper(value);",
          "}",
        ].join("\n"),
      ),
    );

    const complexityEvidence = evidence.filter((item) => item.kind === "complexity-growth");

    expect(complexityEvidence).toHaveLength(2);
    expect(new Set(complexityEvidence.map((item) => item.id)).size).toBe(2);
  });

  it("assigns distinct complexity identities to same-named arrows nested in outer arrows", () => {
    const previousOuter = (outerName: string) => [
      `const ${outerName} = (() => {`,
      "  const helper = (input: number): number => {",
      "    if (input > 0) return input;",
      "    if (input < 0) return -input;",
      "    return 0;",
      "  };",
      "  return helper(1);",
      "}) as () => number;",
    ].join("\n");
    const currentOuter = (outerName: string) => [
      `const ${outerName} = (() => {`,
      "  const helper = (input: number): number => {",
      "    if (input > 10) return 10;",
      "    if (input > 0 && input < 10) return input;",
      "    for (const item of [input]) {",
      "      if (item === 0) return 0;",
      "    }",
      "    return input < 0 ? -input : input;",
      "  };",
      "  return helper(1);",
      "}) as () => number;",
    ].join("\n");
    const evidence = analyzeEvidence(
      episode(
        [previousOuter("outerOne"), previousOuter("outerTwo")].join("\n"),
        [currentOuter("outerOne"), currentOuter("outerTwo")].join("\n"),
      ),
    );
    const nestedHelpers = evidence.filter(
      (item) =>
        item.kind === "complexity-growth" &&
        item.references[0]?.endsWith(".helper") === true,
    );

    expect(nestedHelpers).toHaveLength(2);
    expect(new Set(nestedHelpers.map((item) => item.id)).size).toBe(2);
    expect(nestedHelpers.map((item) => item.references[0]).sort()).toEqual([
      "outerOne.helper",
      "outerTwo.helper",
    ]);
  });

  it("compares the next stable edit with the last stable source", () => {
    const lastStable =
      "export function load(id: string): string { return id; }";
    const unstable = analyzer.analyze(
      episode(lastStable, "export function load(id:"),
    );
    const stableAgain = analyzer.analyze(
      episode(
        lastStable,
        "export function load(id: number): string { return String(id); }",
      ),
    );

    expect(unstable.stability).toBe("unstable");
    expect(stableAgain).toMatchObject({
      stability: "stable",
      evidence: [
        expect.objectContaining({
          kind: "public-api-change",
          references: ["load"],
        }),
      ],
    });
  });
});
