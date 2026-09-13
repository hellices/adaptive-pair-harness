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

const publicApiEvidence = (edit: EditEpisode): readonly Evidence[] =>
  analyzeEvidence(edit).filter((item) => item.kind === "public-api-change");

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
          references: ["public declarations"],
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

  it.each([
    ["CommonJS require", 'const dependency = require("./required");', "./required"],
    [
      "dynamic import",
      'const dependency = import("./dynamic");',
      "./dynamic",
    ],
    [
      "named re-export",
      'export { dependency } from "./named-export";',
      "./named-export",
    ],
    ["star re-export", 'export * from "./star-export";', "./star-export"],
  ])(
    "reports a newly introduced literal %s dependency",
    (_label, declaration, specifier) => {
      const evidence = analyzeEvidence(
        episode("export const value = 1;", `${declaration}\nexport const value = 1;`),
      );
      const dependencies = evidence.filter(
        (item) => item.kind === "new-dependency",
      );

      expect(dependencies).toEqual([
        expect.objectContaining({
          kind: "new-dependency",
          references: [specifier],
        }),
      ]);
    },
  );

  it("ignores computed require and dynamic import expressions", () => {
    const current = [
      'const moduleName = "./computed";',
      "const required = require(moduleName);",
      "const imported = import(`./${moduleName}`);",
      "export const value = [required, imported];",
    ].join("\n");

    expect(
      analyzeEvidence(episode("export const value = 1;", current)).filter(
        (item) => item.kind === "new-dependency",
      ),
    ).toEqual([]);
  });

  it("deduplicates repeated dependency forms by full specifier in source order", () => {
    const current = [
      'const required = require("./shared");',
      'const imported = import("./shared");',
      'export * from "./shared";',
    ].join("\n");
    const evidence = analyzeEvidence(episode("", current)).filter(
      (item) => item.kind === "new-dependency",
    );

    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      kind: "new-dependency",
      references: ["./shared"],
      range: {
        start: { line: 0 },
        end: { line: 0 },
      },
    });
  });

  it("bounds huge multiline dependency evidence while hashing the full specifier", () => {
    const sharedPrefix = `@scope/${"segment".repeat(100)}`;
    const firstSpecifier = `${sharedPrefix}\nfirst-private-suffix`;
    const secondSpecifier = `${sharedPrefix}\nsecond-private-suffix`;
    const first = analyzeEvidence(
      episode("", `import ${JSON.stringify(firstSpecifier)};`),
    ).find((item) => item.kind === "new-dependency");
    const second = analyzeEvidence(
      episode("", `import ${JSON.stringify(secondSpecifier)};`),
    ).find((item) => item.kind === "new-dependency");

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first?.id).not.toBe(second?.id);
    expect(first?.detail.length).toBeLessThanOrEqual(500);
    expect(first?.references[0]?.length).toBeLessThanOrEqual(240);
    expect(first?.detail).not.toMatch(/[\r\n]/u);
    expect(first?.references[0]).not.toMatch(/[\r\n]/u);
    expect(first?.detail.endsWith("…")).toBe(true);
    expect(first?.references[0]?.endsWith("…")).toBe(true);
    expect(JSON.stringify(first)).not.toContain("first-private-suffix");
  });

  describe("declaration-emitter public API evidence", () => {
    it.each([
      [
        "d.ts",
        "export interface Model { value: string; }",
        "export interface Model { value: number; }",
        "Changed public declaration surface in this document.",
      ],
      [
        "d.mts",
        "",
        "export type Identifier = string;",
        "Added public declaration surface in this document.",
      ],
      [
        "d.cts",
        "export declare const version: string;",
        "",
        "Removed public declaration surface from this document.",
      ],
    ])(
      "compares an existing %s declaration surface directly",
      (extension, previous, current, detail) => {
        const evidence = publicApiEvidence(
          episode(
            previous,
            current,
            "typescript",
            `file:///types.${extension}`,
          ),
        );

        expect(evidence).toHaveLength(1);
        expect(evidence[0]).toMatchObject({
          kind: "public-api-change",
          detail,
        });
        expect(JSON.stringify(evidence[0])).not.toMatch(
          /Model|Identifier|version/u,
        );
      },
    );

    it("does not report an unchanged declaration file", () => {
      const declaration = "export declare const version: string;";

      expect(
        publicApiEvidence(
          episode(
            declaration,
            declaration,
            "typescript",
            "file:///types.d.ts",
          ),
        ),
      ).toEqual([]);
    });

    it("ignores declaration-file formatting and comment-only changes", () => {
      const evidence = publicApiEvidence(
        episode(
          "export interface Model { value: string; }",
          [
            "// public declaration documentation",
            "export interface Model {",
            "  value: string;",
            "}",
          ].join("\n"),
          "typescript",
          "vscode-remote://ssh-remote+host/workspace/types.d.mts",
        ),
      );

      expect(evidence).toEqual([]);
    });

    it("keeps invalid declaration files unstable or skips their surface", () => {
      const unstable = analyzer.analyze(
        episode(
          "export interface Model { value: string; }",
          "export interface Model { value:",
          "typescript",
          "file:///types.d.cts",
        ),
      );
      const skipped = publicApiEvidence(
        episode(
          "export interface Model { value:",
          "export interface Model { value: string; }",
          "typescript",
          "file:///types.d.cts",
        ),
      );

      expect(unstable).toMatchObject({ stability: "unstable", evidence: [] });
      expect(skipped).toEqual([]);
    });

    it.each([
      [
        "functions",
        "export function load(value: string): string { return value; }",
        "export function load(value: number): string { return String(value); }",
        "typescript",
      ],
      [
        "classes and accessors",
        'export class Box { get value(): string { return ""; } set value(next: string) {} }',
        "export class Box { get value(): number { return 1; } set value(next: number) {} }",
        "typescript",
      ],
      [
        "types, interfaces, and merges",
        [
          "export type Identifier = string;",
          "export interface Model { id: Identifier; }",
          "export interface Model { enabled: boolean; }",
        ].join("\n"),
        [
          "export type Identifier = number;",
          "export interface Model { id: Identifier; }",
          "export interface Model { enabled: boolean; }",
        ].join("\n"),
        "typescript",
      ],
      [
        "function-valued exports",
        "export const handle = (value: string): string => value;",
        "export const handle = (value: number): string => String(value);",
        "typescript",
      ],
      [
        "destructured exports",
        "export const { value } = { value: 1 };",
        'export const { value } = { value: "one" };',
        "typescript",
      ],
      [
        "export lists",
        [
          "const handle = (value: string): string => value;",
          "export { handle as load };",
        ].join("\n"),
        [
          "const handle = (value: number): string => String(value);",
          "export { handle as load };",
        ].join("\n"),
        "typescript",
      ],
      [
        "unresolved re-exports and type-only exports",
        [
          'export { Widget as Item } from "./external";',
          'export type { Shape } from "./types";',
        ].join("\n"),
        [
          'export { Gadget as Item } from "./external";',
          'export type { Shape } from "./types";',
        ].join("\n"),
        "typescript",
      ],
      [
        "export equals",
        [
          "function handle(value: string): string { return value; }",
          "export = handle;",
        ].join("\n"),
        [
          "function handle(value: number): string { return String(value); }",
          "export = handle;",
        ].join("\n"),
        "typescript",
      ],
      [
        "CommonJS module exports",
        "module.exports = function () { return 1; };",
        'module.exports = function () { return "one"; };',
        "javascript",
      ],
      [
        "CommonJS named exports",
        "exports.load = function () { return 1; };",
        'exports.load = function () { return "one"; };',
        "javascript",
      ],
    ])(
      "reports one generic declaration-surface change for %s",
      (_label, previous, current, languageId) => {
        const evidence = publicApiEvidence(
          episode(
            previous,
            current,
            languageId,
            languageId === "javascript"
              ? "file:///pair.js"
              : "file:///pair.ts",
          ),
        );

        expect(evidence).toHaveLength(1);
        expect(evidence[0]).toMatchObject({
          kind: "public-api-change",
          title: "Public API surface changed",
          detail: "Changed public declaration surface in this document.",
          references: ["public declarations"],
        });
      },
    );

    it.each([
      [
        "added",
        "",
        "export const version = 1;",
        "Added public declaration surface in this document.",
      ],
      [
        "removed",
        "export const version = 1;",
        "",
        "Removed public declaration surface from this document.",
      ],
    ])(
      "describes a declaration surface that was %s without embedding declarations",
      (_label, previous, current, detail) => {
        const evidence = publicApiEvidence(episode(previous, current));

        expect(evidence).toHaveLength(1);
        expect(evidence[0]).toMatchObject({
          title: "Public API surface changed",
          detail,
          references: ["public declarations"],
        });
        expect(JSON.stringify(evidence[0])).not.toContain("version");
      },
    );

    it("collapses multiple changed declarations into one document-level evidence item", () => {
      const evidence = publicApiEvidence(
        episode(
          [
            "export function first(value: string): string { return value; }",
            "export interface Model { value: string; }",
          ].join("\n"),
          [
            "export function first(value: number): string { return String(value); }",
            "export interface Model { value: number; }",
          ].join("\n"),
        ),
      );

      expect(evidence).toHaveLength(1);
      expect(evidence[0]?.references).toEqual(["public declarations"]);
    });

    it("ignores declaration formatting and trivia changes", () => {
      const evidence = publicApiEvidence(
        episode(
          "export interface Model { value: string; count: number; }",
          [
            "export interface Model {",
            "  // public shape is unchanged",
            "  value: string;",
            "",
            "  count: number;",
            "}",
          ].join("\n"),
        ),
      );

      expect(evidence).toEqual([]);
    });

    it("skips public API evidence when either declaration surface is unreliable", () => {
      const result = analyzer.analyze(
        episode(
          "export function incomplete(",
          "export function ready(): void {}",
        ),
      );

      expect(result.stability).toBe("stable");
      expect(
        result.evidence.filter((item) => item.kind === "public-api-change"),
      ).toEqual([]);
    });

    it("uses deterministic privacy-safe transition ids and a current export range", () => {
      const edit = episode(
        "export function privateCustomerName(value: string): string { return value; }",
        [
          "// current declaration",
          "export function privateCustomerName(value: number): string {",
          "  return String(value);",
          "}",
        ].join("\n"),
        "typescript",
        "file:///private/acme/customer-secret.ts",
      );
      const first = publicApiEvidence(edit);
      const second = publicApiEvidence(edit);

      expect(first).toHaveLength(1);
      expect(first[0]?.id).toBe(second[0]?.id);
      expect(first[0]?.id).toMatch(
        /^ts-semantic:public-api-change:[a-f0-9]{16}:[a-f0-9]{16}$/u,
      );
      expect(JSON.stringify(first[0])).not.toContain("privateCustomerName");
      expect(JSON.stringify(first[0])).not.toContain("customer-secret");
      expect(first[0]?.range.start.line).toBe(1);
      expect(
        comparePositions(first[0]!.range.start, first[0]!.range.end),
      ).toBeLessThan(0);
    });

    it("uses a valid zero-width range when the declaration surface is removed", () => {
      const evidence = publicApiEvidence(
        episode("export const removed = 1;", ""),
      );

      expect(evidence).toHaveLength(1);
      expect(evidence[0]?.range).toEqual({
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      });
    });
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

  it("assigns distinct complexity identities to same-named functions in nested namespaces", () => {
    const namespaceSource = (namespaceName: string, complex: boolean) => [
      `namespace ${namespaceName}.Handlers {`,
      "  export function decide(input: number): number {",
      ...(complex
        ? [
            "    if (input > 10) return 10;",
            "    if (input > 0 && input < 10) return input;",
            "    for (const item of [input]) {",
            "      if (item === 0) return 0;",
            "    }",
            "    return input < 0 ? -input : input;",
          ]
        : [
            "    if (input > 0) return input;",
            "    if (input < 0) return -input;",
            "    return 0;",
          ]),
      "  }",
      "}",
    ].join("\n");
    const evidence = analyzeEvidence(
      episode(
        [
          namespaceSource("Alpha", false),
          namespaceSource("Beta", false),
        ].join("\n"),
        [
          namespaceSource("Alpha", true),
          namespaceSource("Beta", true),
        ].join("\n"),
      ),
    );
    const complexityEvidence = evidence.filter(
      (item) => item.kind === "complexity-growth",
    );

    expect(complexityEvidence).toHaveLength(2);
    expect(new Set(complexityEvidence.map((item) => item.id)).size).toBe(2);
    expect(
      complexityEvidence.map((item) => item.references[0]).sort(),
    ).toEqual(["Alpha.Handlers.decide", "Beta.Handlers.decide"]);
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

  it.each([
    [
      "object-literal getters",
      (outerName: string, helper: readonly string[]) =>
        [
          `function ${outerName}(): number {`,
          "  const target = {",
          "    get value(): number {",
          ...helper,
          "      return helper(1);",
          "    },",
          "  };",
          "  return target.value;",
          "}",
        ].join("\n"),
      "outerOne.helper",
    ],
    [
      "class-expression setters",
      (outerName: string, helper: readonly string[]) =>
        [
          `function ${outerName}(input: number): void {`,
          "  const Target = class {",
          "    set value(next: number) {",
          ...helper,
          "      helper(next);",
          "    }",
          "  };",
          "  new Target().value = input;",
          "}",
        ].join("\n"),
      "outerOne.helper",
    ],
    [
      "computed static getters",
      (outerName: string, helper: readonly string[]) =>
        [
          `function ${outerName}(): number {`,
          "  class Target {",
          '    static get ["value"](): number {',
          ...helper,
          "      return helper(1);",
          "    }",
          "  }",
          '  return Target["value"];',
          "}",
        ].join("\n"),
      "outerOne.Target.helper",
    ],
  ] as const)(
    "attributes first-only complexity growth inside %s to its outer scope",
    (_caseName, accessorSource, expectedReference) => {
      const simpleHelper = [
        "      const helper = (input: number): number => {",
        "        if (input > 0) return input;",
        "        if (input < 0) return -input;",
        "        return 0;",
        "      };",
      ];
      const complexHelper = [
        "      const helper = (input: number): number => {",
        "        if (input > 10) return 10;",
        "        if (input > 0 && input < 10) return input;",
        "        for (const item of [input]) {",
        "          if (item === 0) return 0;",
        "        }",
        "        return input < 0 ? -input : input;",
        "      };",
      ];
      const source = (firstHelper: readonly string[]): string =>
        [
          accessorSource("outerOne", firstHelper),
          accessorSource("outerTwo", simpleHelper),
        ].join("\n");

      const evidence = analyzeEvidence(
        episode(source(simpleHelper), source(complexHelper)),
      ).filter(
        (item) =>
          item.kind === "complexity-growth" &&
          item.references[0]?.endsWith(".helper") === true,
      );

      expect(evidence).toHaveLength(1);
      expect(evidence[0]?.references[0]).toBe(expectedReference);
      expect(evidence[0]?.detail).toContain("now has 6 branches, up from 2.");
    },
  );

  it("attributes complexity growth to only the first same-named arrow across distinct accessors", () => {
    const simpleHelper = [
      "    const helper = (input: number): number => {",
      "      if (input > 0) return input;",
      "      if (input < 0) return -input;",
      "      return 0;",
      "    };",
    ];
    const complexHelper = [
      "    const helper = (input: number): number => {",
      "      if (input > 10) return 10;",
      "      if (input > 0 && input < 10) return input;",
      "      for (const item of [input]) {",
      "        if (item === 0) return 0;",
      "      }",
      "      return input < 0 ? -input : input;",
      "    };",
    ];
    const source = (firstHelper: readonly string[]): string =>
      [
        "class Worker {",
        "  static get primary(): number {",
        ...firstHelper,
        "    return helper(1);",
        "  }",
        "  static set primary(input: number) {",
        ...simpleHelper,
        "    helper(input);",
        "  }",
        "  get primary(): number {",
        ...simpleHelper,
        "    return helper(1);",
        "  }",
        "  static get secondary(): number {",
        ...simpleHelper,
        "    return helper(1);",
        "  }",
        "}",
        "class OtherWorker {",
        "  static get primary(): number {",
        ...simpleHelper,
        "    return helper(1);",
        "  }",
        "}",
      ].join("\n");

    const evidence = analyzeEvidence(
      episode(source(simpleHelper), source(complexHelper)),
    ).filter((item) => item.kind === "complexity-growth");

    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      detail: expect.stringContaining("now has 6 branches, up from 2."),
      range: {
        start: { line: 2, character: 10 },
      },
    });
  });

  it("attributes complexity growth to the first same-named arrow in sibling top-level blocks", () => {
    const simpleBlock = [
      "{",
      "  const helper = (input: number): number => {",
      "    if (input > 0) return input;",
      "    if (input < 0) return -input;",
      "    return 0;",
      "  };",
      "  helper(1);",
      "}",
    ];
    const complexBlock = [
      "{",
      "  const helper = (input: number): number => {",
      "    if (input > 10) return 10;",
      "    if (input > 0 && input < 10) return input;",
      "    for (const item of [input]) {",
      "      if (item === 0) return 0;",
      "    }",
      "    return input < 0 ? -input : input;",
      "  };",
      "  helper(1);",
      "}",
    ];
    const source = (
      firstBlock: readonly string[],
      secondBlock: readonly string[],
    ): string => [...firstBlock, ...secondBlock].join("\n");

    const evidence = analyzeEvidence(
      episode(
        source(simpleBlock, simpleBlock),
        source(complexBlock, simpleBlock),
      ),
    ).filter((item) => item.kind === "complexity-growth");

    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      detail: "helper now has 6 branches, up from 2.",
      references: ["helper"],
      range: {
        start: { line: 1, character: 8 },
      },
    });
  });

  it("keeps same-named arrows distinct and stable across sibling lexical blocks", () => {
    const simpleBlock = [
      "  {",
      "    const helper = (input: number): number => {",
      "      if (input > 0) return input;",
      "      if (input < 0) return -input;",
      "      return 0;",
      "    };",
      "    helper(value);",
      "  }",
    ];
    const complexBlock = [
      "  {",
      "    const helper = (input: number): number => {",
      "      if (input > 10) return 10;",
      "      if (input > 0 && input < 10) return input;",
      "      for (const item of [input]) {",
      "        if (item === 0) return 0;",
      "      }",
      "      return input < 0 ? -input : input;",
      "    };",
      "    helper(value);",
      "  }",
    ];
    const source = (
      firstBlock: readonly string[],
      secondBlock: readonly string[],
    ): string =>
      [
        "function outer(value: number): void {",
        ...firstBlock,
        ...secondBlock,
        "}",
      ].join("\n");

    const evidence = analyzeEvidence(
      episode(
        source(simpleBlock, complexBlock),
        source(complexBlock, complexBlock),
      ),
    ).filter((item) => item.kind === "complexity-growth");

    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      detail: "outer.helper now has 6 branches, up from 2.",
      references: ["outer.helper"],
      range: {
        start: { line: 2, character: 10 },
      },
    });
  });

  it("attributes complexity growth to the first same-named arrow in sibling class static blocks", () => {
    const simpleStaticBlock = [
      "  static {",
      "    const helper = (input: number): number => {",
      "      if (input > 0) return input;",
      "      if (input < 0) return -input;",
      "      return 0;",
      "    };",
      "  }",
    ];
    const complexStaticBlock = [
      "  static {",
      "    const helper = (input: number): number => {",
      "      if (input > 10) return 10;",
      "      if (input > 0 && input < 10) return input;",
      "      for (const item of [input]) {",
      "        if (item === 0) return 0;",
      "      }",
      "      return input < 0 ? -input : input;",
      "    };",
      "  }",
    ];
    const source = (
      firstBlock: readonly string[],
      secondBlock: readonly string[],
    ): string =>
      [
        "class Worker {",
        ...firstBlock,
        ...secondBlock,
        "}",
      ].join("\n");

    const evidence = analyzeEvidence(
      episode(
        source(simpleStaticBlock, simpleStaticBlock),
        source(complexStaticBlock, simpleStaticBlock),
      ),
    ).filter((item) => item.kind === "complexity-growth");

    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      detail: "Worker.helper now has 6 branches, up from 2.",
      references: ["Worker.helper"],
      range: {
        start: { line: 2, character: 10 },
      },
    });
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
          references: ["public declarations"],
        }),
      ],
    });
  });
});
