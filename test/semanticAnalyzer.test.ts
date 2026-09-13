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

    expect(analyzeEvidence(episode("export const value = 1;", current))).toEqual(
      [],
    );
  });

  it("deduplicates repeated dependency forms by full specifier in source order", () => {
    const current = [
      'const required = require("./shared");',
      'const imported = import("./shared");',
      'export * from "./shared";',
    ].join("\n");
    const evidence = analyzeEvidence(episode("", current));

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
    )[0];
    const second = analyzeEvidence(
      episode("", `import ${JSON.stringify(secondSpecifier)};`),
    )[0];

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

  it("resolves a parenthesized identifier used as the default export", () => {
    const evidence = analyzeEvidence(
      episode(
        [
          "function f(value: string): string { return value; }",
          "export default (f);",
        ].join("\n"),
        [
          "function f(value: number): string { return String(value); }",
          "export default (f);",
        ].join("\n"),
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

  it.each([
    [
      "identifier",
      [
        "function handler(value: string): string { return value; }",
        "export = handler;",
      ].join("\n"),
      [
        "function handler(value: number): string { return String(value); }",
        "export = handler;",
      ].join("\n"),
      "export =",
    ],
    [
      "function expression",
      "export = function (value: string): string { return value; };",
      "export = function (value: number): string { return String(value); };",
      "export =",
    ],
    [
      "class expression",
      "export = class { handle(value: string): string { return value; } };",
      "export = class { handle(value: number): string { return String(value); } };",
      "export =#handle",
    ],
    [
      "checker-resolved callable expression",
      [
        "declare function createHandler(): (value: string) => string;",
        "export = createHandler();",
      ].join("\n"),
      [
        "declare function createHandler(): (value: number) => string;",
        "export = createHandler();",
      ].join("\n"),
      "export =",
    ],
  ])(
    "reports a changed export-equals %s signature",
    (_label, previous, current, reference) => {
      const evidence = analyzeEvidence(episode(previous, current));

      expect(evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "public-api-change",
            title: "Exported API signature changed",
            references: [reference],
          }),
        ]),
      );
    },
  );

  it("reports removal of a callable export-equals assignment", () => {
    const declaration =
      "function handler(value: string): string { return value; }";
    const evidence = analyzeEvidence(
      episode([declaration, "export = handler;"].join("\n"), declaration),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          title: "Exported API removed",
          references: ["export ="],
        }),
      ]),
    );
  });

  it("keeps a callable export-equals identity stable across local renames", () => {
    const evidence = analyzeEvidence(
      episode(
        [
          "function before(value: string): string { return value; }",
          "export = before;",
        ].join("\n"),
        [
          "function after(value: string): string { return value; }",
          "export = after;",
        ].join("\n"),
      ),
    );

    expect(
      evidence.filter((item) => item.kind === "public-api-change"),
    ).toEqual([]);
  });

  it.each([
    [
      "default export",
      [
        "function handler(value: string): string { return value; }",
        "export default handler;",
      ].join("\n"),
      "default export",
    ],
    [
      "CommonJS root",
      [
        "function handler(value: string): string { return value; }",
        "module.exports = handler;",
      ].join("\n"),
      "default export",
    ],
  ])(
    "keeps export-equals distinct from the %s identity",
    (_label, previous, otherReference) => {
      const current = [
        "function handler(value: string): string { return value; }",
        "export = handler;",
      ].join("\n");
      const evidence = analyzeEvidence(episode(previous, current)).filter(
        (item) => item.kind === "public-api-change",
      );

      expect(evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            title: "Exported API added",
            references: ["export ="],
          }),
          expect.objectContaining({
            title: "Exported API removed",
            references: [otherReference],
          }),
        ]),
      );
    },
  );

  it.each([
    ["named alias to export-equals", "named" as const, "special" as const],
    ["export-equals to named alias", "special" as const, "named" as const],
  ])(
    "keeps a user \"export-equals\" alias distinct during the %s transition",
    (_label, previousKind, currentKind) => {
      const declaration =
        "function handler(value: string): string { return value; }";
      const source = (kind: "named" | "special"): string =>
        [
          declaration,
          kind === "named"
            ? 'export { handler as "export-equals" };'
            : "export = handler;",
        ].join("\n");
      const evidence = analyzeEvidence(
        episode(source(previousKind), source(currentKind)),
      ).filter((item) => item.kind === "public-api-change");

      expect(evidence).toHaveLength(2);
      expect(evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            title: "Exported API added",
            references: [
              currentKind === "special" ? "export =" : "export-equals",
            ],
          }),
          expect.objectContaining({
            title: "Exported API removed",
            references: [
              previousKind === "special" ? "export =" : "export-equals",
            ],
          }),
        ]),
      );
    },
  );

  it.each([
    [
      "export-equals",
      "export = C;",
      "export =#run",
    ],
    [
      "default",
      "export default C;",
      "default export#run",
    ],
    [
      "local alias",
      "export { C as PublicC };",
      "PublicC#run",
    ],
  ])(
    "reports method signature changes for a %s class-valued identifier",
    (_label, exportStatement, reference) => {
      const source = (parameterType: string): string =>
        [
          "const C = class {",
          `  run(value: ${parameterType}): string { return String(value); }`,
          "};",
          exportStatement,
        ].join("\n");
      const evidence = analyzeEvidence(
        episode(source("string"), source("number")),
      );

      expect(evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "public-api-change",
            title: "Exported API signature changed",
            references: [reference],
          }),
        ]),
      );
    },
  );

  it("reports constructor changes through a checker-resolved class-valued alias", () => {
    const source = (parameterType: string): string =>
      [
        "const Implementation = class {",
        `  constructor(value: ${parameterType}) { void value; }`,
        "};",
        "const C = Implementation;",
        "export default C;",
      ].join("\n");
    const evidence = analyzeEvidence(
      episode(source("string"), source("number")),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          title: "Exported API signature changed",
          references: ["default export#constructor"],
        }),
      ]),
    );
  });

  it("records checker-only constructor and class member signatures", () => {
    const source = (parameterType: string): string =>
      [
        "declare const C: {",
        `  new (value: ${parameterType}): {`,
        `    run(input: ${parameterType}): string;`,
        "  };",
        "};",
        "export = C;",
      ].join("\n");
    const evidence = analyzeEvidence(
      episode(source("string"), source("number")),
    ).filter((item) => item.kind === "public-api-change");

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Exported API signature changed",
          references: ["export =#constructor"],
        }),
        expect.objectContaining({
          title: "Exported API signature changed",
          references: ["export =#run"],
        }),
      ]),
    );
  });

  it.each([
    [
      "direct declaration",
      "export class C {}",
      "class C {}",
      "C#constructor",
    ],
    [
      "anonymous default declaration",
      "export default class {}",
      "class C {}",
      "default export#constructor",
    ],
    [
      "export-equals class expression",
      "export = class {};",
      "const C = class {};",
      "export =#constructor",
    ],
    [
      "local class-expression alias",
      ["const C = class {};", "export { C as PublicC };"].join("\n"),
      "const C = class {};",
      "PublicC#constructor",
    ],
  ])(
    "reports removal of an implicit constructor from a %s",
    (_label, previous, current, reference) => {
      const evidence = analyzeEvidence(episode(previous, current));

      expect(evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "public-api-change",
            title: "Exported API removed",
            references: [reference],
          }),
        ]),
      );
    },
  );

  it("reports adding and changing an implicit constructor surface", () => {
    const added = analyzeEvidence(
      episode("class C {}", ["class C {}", "export { C };"].join("\n")),
    );
    const changed = analyzeEvidence(
      episode(
        "export class C {}",
        "export class C { constructor(value: string) { void value; } }",
      ),
    );

    expect(added).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Exported API added",
          references: ["C#constructor"],
        }),
      ]),
    );
    expect(changed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Exported API signature changed",
          references: ["C#constructor"],
        }),
      ]),
    );
  });

  it("serializes an exported structural constructor type alias independently", () => {
    const source = (parameterType: string): string =>
      [
        "class Named { run(): void {} }",
        `export type Factory = new (value: ${parameterType}) => Named;`,
      ].join("\n");
    const evidence = analyzeEvidence(
      episode(source("string"), source("number")),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          title: "Exported API signature changed",
          references: ["Factory#constructor"],
        }),
      ]),
    );
  });

  it("detects a structural constructor variable return-type change", () => {
    const source = (returnType: string): string =>
      [
        "class First { run(): void {} }",
        "class Second { run(): void {} }",
        `declare const Factory: new (value: string) => ${returnType};`,
        "export { Factory };",
      ].join("\n");
    const evidence = analyzeEvidence(
      episode(source("First"), source("Second")),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          title: "Exported API signature changed",
          references: ["Factory#constructor"],
        }),
      ]),
    );
  });

  it("composes call and construct signatures when only construction changes", () => {
    const source = (parameterType: string): string =>
      [
        "class Named {}",
        "interface Hybrid {",
        "  (value: string): string;",
        `  new (value: ${parameterType}): Named;`,
        "}",
        "declare const hybrid: Hybrid;",
        "export default hybrid;",
      ].join("\n");
    const evidence = analyzeEvidence(
      episode(source("string"), source("number")),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          title: "Exported API signature changed",
          references: ["default export#constructor"],
        }),
      ]),
    );
  });

  it("composes callable class aliases with their public members", () => {
    const source = (parameterType: string): string =>
      [
        "class Named {",
        `  run(value: ${parameterType}): void { void value; }`,
        "}",
        "declare const Hybrid: typeof Named & ((value: boolean) => boolean);",
        "export = Hybrid;",
      ].join("\n");
    const evidence = analyzeEvidence(
      episode(source("string"), source("number")),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          title: "Exported API signature changed",
          references: ["export =#run"],
        }),
      ]),
    );
  });

  it("retains structural return types in callable class intersections", () => {
    const source = (returnType: string): string =>
      [
        "class Base {}",
        "class First {}",
        "class Second {}",
        "declare const Hybrid:",
        "  typeof Base &",
        "  ((value: boolean) => boolean) &",
        `  (new (value: string) => ${returnType});`,
        "export { Hybrid };",
      ].join("\n");
    const evidence = analyzeEvidence(
      episode(source("First"), source("Second")),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          title: "Exported API signature changed",
          references: ["Hybrid#constructor"],
        }),
      ]),
    );
  });

  it("deduplicates identical callable and constructable overloads", () => {
    const source = (duplicate: boolean): string =>
      [
        "class Named {}",
        "interface Hybrid {",
        "  (value: string): string;",
        ...(duplicate ? ["  (value: string): string;"] : []),
        "  new (value: string): Named;",
        ...(duplicate ? ["  new (value: string): Named;"] : []),
        "}",
        "declare const hybrid: Hybrid;",
        "export { hybrid };",
      ].join("\n");
    const evidence = analyzeEvidence(episode(source(false), source(true)));

    expect(
      evidence.filter((item) => item.kind === "public-api-change"),
    ).toEqual([]);
  });

  it("preserves construct overload order semantics", () => {
    const source = (reverse: boolean): string =>
      [
        "class First {}",
        "class Second {}",
        "interface Hybrid {",
        "  (value: boolean): boolean;",
        ...(reverse
          ? [
              "  new (value: number): Second;",
              "  new (value: string): First;",
            ]
          : [
              "  new (value: string): First;",
              "  new (value: number): Second;",
            ]),
        "}",
        "declare const hybrid: Hybrid;",
        "export { hybrid };",
      ].join("\n");
    const evidence = analyzeEvidence(episode(source(false), source(true)));

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["hybrid#constructor"],
        }),
      ]),
    );
  });

  it("reports a removed method from a locally exported class-valued identifier", () => {
    const evidence = analyzeEvidence(
      episode(
        [
          "const C = class {",
          "  run(value: string): string { return value; }",
          "};",
          "export { C as PublicC };",
        ].join("\n"),
        [
          "const C = class {};",
          "export { C as PublicC };",
        ].join("\n"),
      ),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          title: "Exported API removed",
          references: ["PublicC#run"],
        }),
      ]),
    );
  });

  it.each(["protected", "private"] as const)(
    "does not fabricate a public constructor inherited from a %s base constructor",
    (access) => {
      const source = (exported: boolean): string =>
        [
          `class Base { ${access} constructor(value: string) { void value; } }`,
          `${exported ? "export " : ""}class Derived extends Base {}`,
        ].join("\n");
      const evidence = analyzeEvidence(episode(source(false), source(true)));

      expect(
        evidence.filter(
          (item) =>
            item.kind === "public-api-change" &&
            item.references[0] === "Derived#constructor",
        ),
      ).toEqual([]);
    },
  );

  it("canonicalizes an inherited public constructor across equivalent export forms and local renames", () => {
    const previous = [
      "class Base { constructor(value: string) { void value; } }",
      "export class PublicClass extends Base {}",
    ].join("\n");
    const current = [
      "class Base { constructor(value: string) { void value; } }",
      "class RenamedImplementation extends Base {}",
      "const CheckerResolvedAlias = RenamedImplementation;",
      "export { CheckerResolvedAlias as PublicClass };",
    ].join("\n");

    expect(
      analyzeEvidence(episode(previous, current)).filter(
        (item) => item.kind === "public-api-change",
      ),
    ).toEqual([]);
  });

  it("preserves non-primary class return types in constructable intersections", () => {
    const source = (additionalClass: string): string =>
      [
        "class Primary { constructor(value: string) { void value; } }",
        "class Secondary { constructor(value: number) { void value; } }",
        "class Replacement { constructor(value: number) { void value; } }",
        `declare const Hybrid: typeof Primary & typeof ${additionalClass};`,
        "export { Hybrid };",
      ].join("\n");
    const evidence = analyzeEvidence(
      episode(source("Secondary"), source("Replacement")),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          title: "Exported API signature changed",
          references: ["Hybrid#constructor"],
        }),
      ]),
    );
  });

  it("reports removal when an inherited public constructor becomes protected", () => {
    const source = (access: "" | "protected "): string =>
      [
        `class Base { ${access}constructor(value: string) { void value; } }`,
        "export class Derived extends Base {}",
      ].join("\n");
    const evidence = analyzeEvidence(
      episode(source(""), source("protected ")),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          title: "Exported API removed",
          references: ["Derived#constructor"],
        }),
      ]),
    );
  });

  it.each([
    [
      "additional static property",
      "{ version: string }",
      "{ version: number }",
      "Hybrid.version",
    ],
    [
      "constructed instance property",
      "new () => { value: string }",
      "new () => { value: number }",
      "Hybrid#value",
    ],
    [
      "constructed instance method",
      "new () => { run(value: string): void }",
      "new () => { run(value: number): void }",
      "Hybrid#run",
    ],
  ])(
    "reports a class intersection %s-only change",
    (_label, previousMember, currentMember, reference) => {
      const source = (member: string): string =>
        [
          "class Base {}",
          `declare const Hybrid: typeof Base & (${member});`,
          "export { Hybrid };",
        ].join("\n");
      const evidence = analyzeEvidence(
        episode(source(previousMember), source(currentMember)),
      );

      expect(evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "public-api-change",
            title: "Exported API signature changed",
            references: [reference],
          }),
        ]),
      );
    },
  );

  it("deduplicates repeated structural class-intersection properties deterministically", () => {
    const source = (propertyType: string, duplicate: boolean): string =>
      [
        "class Base {}",
        "declare const Hybrid:",
        "  typeof Base &",
        `  { version: ${propertyType} }${
          duplicate ? ` & { version: ${propertyType} }` : ""
        };`,
        "export { Hybrid };",
      ].join("\n");
    const evidence = analyzeEvidence(
      episode(source("string", false), source("number", true)),
    ).filter(
      (item) =>
        item.kind === "public-api-change" &&
        item.references[0] === "Hybrid.version",
    );

    expect(evidence).toHaveLength(1);
  });

  it("models direct type alias and interface member changes", () => {
    const previous = [
      "export type Payload = { value: string };",
      "export interface Service { run(value: string): void; }",
    ].join("\n");
    const current = [
      "export type Payload = { value: number };",
      "export interface Service { run(value: number): void; }",
    ].join("\n");
    const references = analyzeEvidence(episode(previous, current))
      .filter((item) => item.kind === "public-api-change")
      .map((item) => item.references[0]);

    expect(references).toEqual(
      expect.arrayContaining(["Payload#value", "Service#run"]),
    );
  });

  it("normalizes equivalent direct and local-list type exports", () => {
    const direct = "export type Payload = { value: string };";
    const localList = [
      "type InternalPayload = { value: string };",
      "export type { InternalPayload as Payload };",
    ].join("\n");

    for (const [previous, current] of [
      [direct, localList],
      [localList, direct],
    ] as const) {
      expect(
        analyzeEvidence(episode(previous, current)).filter(
          (item) => item.kind === "public-api-change",
        ),
      ).toEqual([]);
    }
  });

  it.each([
    [
      "type alias",
      "export type PublicNode = { next?: PublicNode };",
      [
        "type InternalNode = { next?: InternalNode };",
        "export type { InternalNode as PublicNode };",
      ].join("\n"),
    ],
    [
      "interface",
      "export interface PublicNode { next?: PublicNode }",
      [
        "interface InternalNode { next?: InternalNode }",
        "export type { InternalNode as PublicNode };",
      ].join("\n"),
    ],
    [
      "class",
      [
        "export class PublicNode {",
        "  next(): PublicNode { return this; }",
        "}",
      ].join("\n"),
      [
        "class InternalNode {",
        "  next(): InternalNode { return this; }",
        "}",
        "export { InternalNode as PublicNode };",
      ].join("\n"),
    ],
  ])(
    "normalizes a recursive exported %s across equivalent local renames",
    (_label, direct, renamed) => {
      expect(
        analyzeEvidence(episode(direct, renamed)).filter(
          (item) => item.kind === "public-api-change",
        ),
      ).toEqual([]);
    },
  );

  it("normalizes recursive self references across equivalent default export renames", () => {
    const direct = "export default interface PublicNode { next?: PublicNode }";
    const renamed = [
      "interface InternalNode { next?: InternalNode }",
      "export type { InternalNode as default };",
    ].join("\n");

    expect(
      analyzeEvidence(episode(direct, renamed)).filter(
        (item) => item.kind === "public-api-change",
      ),
    ).toEqual([]);
  });

  it("reports a real recursive member change after normalizing its local name", () => {
    const previous = [
      "type PreviousNode = { next?: PreviousNode };",
      "export type { PreviousNode as PublicNode };",
    ].join("\n");
    const current = [
      "type CurrentNode = { next?: readonly CurrentNode[] };",
      "export type { CurrentNode as PublicNode };",
    ].join("\n");

    expect(analyzeEvidence(episode(previous, current))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          title: "Exported API signature changed",
          references: ["PublicNode#next"],
        }),
      ]),
    );
  });

  it("uses default external identity for legal default interface exports", () => {
    const direct = "export default interface Direct { value: string }";
    const localList = [
      "interface Renamed { value: string }",
      "export type { Renamed as default };",
    ].join("\n");
    const equivalent = analyzeEvidence(episode(direct, localList)).filter(
      (item) => item.kind === "public-api-change",
    );
    const changed = analyzeEvidence(
      episode(
        direct,
        [
          "interface Renamed { value: number }",
          "export { type Renamed as default };",
        ].join("\n"),
      ),
    );

    expect(equivalent).toEqual([]);
    expect(changed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["default export#value"],
        }),
      ]),
    );
  });

  it("distinguishes a type-only callable API from an equivalent runtime value export", () => {
    const previous =
      "export type Handler = (value: string) => string;";
    const current =
      "export const Handler = (value: string): string => value;";
    const evidence = analyzeEvidence(episode(previous, current)).filter(
      (item) => item.kind === "public-api-change",
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Exported API added",
          references: ["Handler"],
        }),
        expect.objectContaining({
          title: "Exported API removed",
          references: ["Handler"],
        }),
      ]),
    );
  });

  it("records both namespaces of a merged local export with distinct identities", () => {
    const current = [
      "function Merged(value: string): string { return value; }",
      "interface Merged { readonly tag: string }",
      "export { Merged as PublicApi };",
    ].join("\n");
    const changes = analyzeEvidence(episode("", current)).filter(
      (item) => item.kind === "public-api-change",
    );
    const rootChanges = changes.filter(
      (item) => item.references[0] === "PublicApi",
    );

    expect(rootChanges).toHaveLength(2);
    expect(new Set(rootChanges.map((item) => item.id)).size).toBe(2);
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ references: ["PublicApi#tag"] }),
      ]),
    );
  });

  it("records both namespaces when a local variable merges with an interface", () => {
    const current = [
      "const Merged: number = 1;",
      "interface Merged { readonly tag: string }",
      "export { Merged as PublicApi };",
    ].join("\n");
    const changes = analyzeEvidence(episode("", current)).filter(
      (item) => item.kind === "public-api-change",
    );

    expect(
      changes.filter((item) => item.references[0] === "PublicApi"),
    ).toHaveLength(2);
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ references: ["PublicApi#tag"] }),
      ]),
    );
  });

  it("reports only the type namespace removed from a merged local export", () => {
    const previous = [
      "function Merged(value: string): string { return value; }",
      "interface Merged { readonly tag: string }",
      "export { Merged as PublicApi };",
    ].join("\n");
    const current = [
      "function ValueOnly(value: string): string { return value; }",
      "export { ValueOnly as PublicApi };",
    ].join("\n");
    const changes = analyzeEvidence(episode(previous, current)).filter(
      (item) => item.kind === "public-api-change",
    );

    expect(changes).toHaveLength(2);
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Exported API removed",
          references: ["PublicApi"],
        }),
        expect.objectContaining({
          title: "Exported API removed",
          references: ["PublicApi#tag"],
        }),
      ]),
    );
  });

  it("reports only the value namespace removed from a merged local export", () => {
    const previous = [
      "function Merged(value: string): string { return value; }",
      "interface Merged { readonly tag: string }",
      "export { Merged as PublicApi };",
    ].join("\n");
    const current = [
      "interface TypeOnly { readonly tag: string }",
      "export type { TypeOnly as PublicApi };",
    ].join("\n");
    const changes = analyzeEvidence(episode(previous, current)).filter(
      (item) => item.kind === "public-api-change",
    );

    expect(changes).toEqual([
      expect.objectContaining({
        title: "Exported API removed",
        references: ["PublicApi"],
      }),
    ]);
  });

  it.each([
    [
      "signature change",
      [
        "class Merged {",
        "  run(value: string): void { void value; }",
        "}",
        "interface Merged { readonly tag: string }",
        "export { Merged as PublicApi };",
      ].join("\n"),
      [
        "class Merged {",
        "  run(value: number): void { void value; }",
        "}",
        "interface Merged { readonly tag: string }",
        "export { Merged as PublicApi };",
      ].join("\n"),
      "Exported API signature changed",
    ],
    [
      "removal",
      [
        "class Merged {",
        "  run(value: string): void { void value; }",
        "}",
        "interface Merged { readonly tag: string }",
        "export { Merged as PublicApi };",
      ].join("\n"),
      [
        "class Merged {}",
        "interface Merged { readonly tag: string }",
        "export { Merged as PublicApi };",
      ].join("\n"),
      "Exported API removed",
    ],
  ])(
    "deduplicates an identical merged type/value member %s",
    (_label, previous, current, expectedTitle) => {
      const changes = analyzeEvidence(episode(previous, current)).filter(
        (item) =>
          item.kind === "public-api-change" &&
          item.references[0] === "PublicApi#run",
      );

      expect(changes).toEqual([
        expect.objectContaining({
          title: expectedTitle,
          references: ["PublicApi#run"],
        }),
      ]);
    },
  );

  it("keeps a deduplicated merged-member ID stable across declaration order", () => {
    const source = (interfaceFirst: boolean, parameterType: string): string => {
      const classDeclaration = [
        "export class Merged {",
        `  run(value: ${parameterType}): void { void value; }`,
        "}",
      ].join("\n");
      const interfaceDeclaration =
        "export interface Merged { readonly tag: string }";
      return [
        ...(interfaceFirst
          ? [interfaceDeclaration, classDeclaration]
          : [classDeclaration, interfaceDeclaration]),
      ].join("\n");
    };
    const valueFirst = analyzeEvidence(
      episode(source(false, "string"), source(false, "number")),
    ).find((item) => item.references[0] === "Merged#run");
    const typeFirst = analyzeEvidence(
      episode(source(true, "string"), source(true, "number")),
    ).find((item) => item.references[0] === "Merged#run");

    expect(valueFirst).toBeDefined();
    expect(typeFirst).toBeDefined();
    expect(valueFirst?.id).toBe(typeFirst?.id);
  });

  it("reports abstract-to-concrete exported class transitions", () => {
    const source = (abstract: boolean): string =>
      `export ${abstract ? "abstract " : ""}class Service { ` +
      "constructor(value: string) { void value; } }";
    const evidence = analyzeEvidence(
      episode(source(true), source(false)),
    ).filter((item) => item.kind === "public-api-change");

    expect(evidence).toEqual([
      expect.objectContaining({
        title: "Exported API signature changed",
        references: ["Service"],
      }),
    ]);
  });

  it("reports an abstract class transition even when its constructor is protected", () => {
    const source = (abstract: boolean): string =>
      [
        `export ${abstract ? "abstract " : ""}class Service {`,
        "  protected constructor(value: string) { void value; }",
        "}",
      ].join("\n");
    const evidence = analyzeEvidence(
      episode(source(true), source(false)),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          title: "Exported API signature changed",
          references: ["Service"],
        }),
      ]),
    );
  });

  it("reports abstract-to-concrete structural construct transitions", () => {
    const source = (abstract: boolean): string =>
      [
        "interface Instance { run(): void }",
        `export type Factory = ${
          abstract ? "abstract " : ""
        }new (value: string) => Instance;`,
      ].join("\n");
    const evidence = analyzeEvidence(
      episode(source(true), source(false)),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          title: "Exported API signature changed",
          references: ["Factory#constructor"],
        }),
      ]),
    );
  });

  it("preserves an abstract structural construct that returns the intersected class", () => {
    const source = (abstract: boolean): string =>
      [
        "class Base {}",
        "declare const Hybrid:",
        `  typeof Base & (${abstract ? "abstract " : ""}new ` +
          "(value: string) => Base);",
        "export { Hybrid };",
      ].join("\n");
    const evidence = analyzeEvidence(
      episode(source(true), source(false)),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          title: "Exported API signature changed",
          references: ["Hybrid#constructor"],
        }),
      ]),
    );
  });

  it("reports abstractness changes in every class intersection constituent", () => {
    const source = (secondaryAbstract: boolean): string =>
      [
        "class Primary { protected constructor() {} }",
        `${secondaryAbstract ? "abstract " : ""}class Secondary {`,
        "  protected constructor() {}",
        "}",
        "declare const Hybrid: typeof Primary & typeof Secondary;",
        "export { Hybrid };",
      ].join("\n");
    const evidence = analyzeEvidence(
      episode(source(true), source(false)),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          title: "Exported API signature changed",
          references: ["Hybrid"],
        }),
      ]),
    );
  });

  it("normalizes equivalent class intersection constituent reordering", () => {
    const declarations = [
      "abstract class AbstractBase { protected constructor() {} }",
      "class ConcreteBase { protected constructor() {} }",
    ];
    const source = (reverse: boolean): string =>
      [
        ...declarations,
        `declare const Hybrid: ${
          reverse
            ? "typeof ConcreteBase & typeof AbstractBase"
            : "typeof AbstractBase & typeof ConcreteBase"
        };`,
        "export { Hybrid };",
      ].join("\n");

    expect(
      analyzeEvidence(episode(source(false), source(true))).filter(
        (item) => item.kind === "public-api-change",
      ),
    ).toEqual([]);
  });

  it("reports abstractness changes in every structural construct constituent", () => {
    const source = (secondaryAbstract: boolean): string =>
      [
        "interface Primary {}",
        "interface Secondary {}",
        "declare const Hybrid:",
        "  (new (value: string) => Primary) &",
        `  (${secondaryAbstract ? "abstract " : ""}new ` +
          "(value: number) => Secondary);",
        "export { Hybrid };",
      ].join("\n");
    const evidence = analyzeEvidence(
      episode(source(true), source(false)),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          title: "Exported API signature changed",
          references: ["Hybrid#constructor"],
        }),
      ]),
    );
  });

  it("normalizes equivalent structural construct constituent reordering", () => {
    const declarations = [
      "interface Primary {}",
      "interface Secondary {}",
    ];
    const source = (reverse: boolean): string =>
      [
        ...declarations,
        `declare const Hybrid: ${
          reverse
            ? "(abstract new (value: number) => Secondary) & (new (value: string) => Primary)"
            : "(new (value: string) => Primary) & (abstract new (value: number) => Secondary)"
        };`,
        "export { Hybrid };",
      ].join("\n");

    expect(
      analyzeEvidence(episode(source(false), source(true))).filter(
        (item) => item.kind === "public-api-change",
      ),
    ).toEqual([]);
  });

  it("preserves construct overload order within an intersection constituent", () => {
    const source = (reverseOverloads: boolean): string =>
      [
        "interface First {}",
        "interface Second {}",
        "interface Extra {}",
        "interface Ordered {",
        ...(reverseOverloads
          ? [
              "  new (value: number): Second;",
              "  new (value: string): First;",
            ]
          : [
              "  new (value: string): First;",
              "  new (value: number): Second;",
            ]),
        "}",
        "type Additional = new (value: boolean) => Extra;",
        "declare const Hybrid: Ordered & Additional;",
        "export { Hybrid };",
      ].join("\n");
    const evidence = analyzeEvidence(
      episode(source(false), source(true)),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["Hybrid#constructor"],
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

  it("normalizes equivalent direct and local-list value exports", () => {
    const direct = "export const load = (id: string): string => id;";
    const localList = [
      "const load = (id: string): string => id;",
      "export { load };",
    ].join("\n");

    for (const [previous, current] of [
      [direct, localList],
      [localList, direct],
    ] as const) {
      const evidence = analyzeEvidence(episode(previous, current));

      expect(
        evidence.filter((item) => item.kind === "public-api-change"),
      ).toEqual([]);
    }
  });

  it.each([
    [
      "statement value-to-type-only",
      "export { load as fetchItem };",
      "export type { load as fetchItem };",
    ],
    [
      "statement type-only-to-value",
      "export type { load as fetchItem };",
      "export { load as fetchItem };",
    ],
    [
      "element value-to-type-only",
      "export { load as fetchItem };",
      "export { type load as fetchItem };",
    ],
    [
      "element type-only-to-value",
      "export { type load as fetchItem };",
      "export { load as fetchItem };",
    ],
  ])(
    "reports a local %s export transition",
    (_label, previousExport, currentExport) => {
      const declaration = "const load = (id: string): string => id;";
      const evidence = analyzeEvidence(
        episode(
          [declaration, previousExport].join("\n"),
          [declaration, currentExport].join("\n"),
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
    },
  );

  it.each([
    [
      "statement value to type-only",
      'export { Foo } from "./foo";',
      'export type { Foo } from "./foo";',
    ],
    [
      "statement type-only to value",
      'export type { Foo } from "./foo";',
      'export { Foo } from "./foo";',
    ],
    [
      "element value to type-only",
      'export { Foo } from "./foo";',
      'export { type Foo } from "./foo";',
    ],
    [
      "element type-only to value",
      'export { type Foo } from "./foo";',
      'export { Foo } from "./foo";',
    ],
  ])("reports a re-export %s transition", (_label, previous, current) => {
    const evidence = analyzeEvidence(episode(previous, current));

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["Foo"],
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

  it("reports signature changes for directly exported object-destructured callables", () => {
    const evidence = analyzeEvidence(
      episode(
        [
          "declare const source: { api: { load?: (id: string) => string } };",
          "const fallback = (id: string): string => id;",
          "export const { api: { load: fetchItem = fallback } } = source;",
        ].join("\n"),
        [
          "declare const source: { api: { load?: (id: number) => string } };",
          "const fallback = (id: number): string => String(id);",
          "export const { api: { load: fetchItem = fallback } } = source;",
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

  it("reports return changes for array-destructured callables in local export lists", () => {
    const evidence = analyzeEvidence(
      episode(
        [
          "declare const source: [[((id: string) => string)?]];",
          "const fallback = (id: string): string => id;",
          "const [[load = fallback]] = source;",
          "export { load as fetchItem };",
        ].join("\n"),
        [
          "declare const source: [[((id: string) => number)?]];",
          "const fallback = (id: string): number => id.length;",
          "const [[load = fallback]] = source;",
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

  it("tracks the CommonJS root callable separately from its default property", () => {
    const evidence = analyzeEvidence(
      episode(
        "",
        [
          "module.exports = (root) => root;",
          "module.exports.default = (value) => value;",
        ].join("\n"),
        "javascript",
        "file:///pair.js",
      ),
    );
    const changes = evidence.filter(
      (item) => item.kind === "public-api-change",
    );

    expect(changes).toHaveLength(2);
    expect(changes.map((item) => item.references[0])).toEqual([
      "default export",
      "default export",
    ]);
    expect(new Set(changes.map((item) => item.id)).size).toBe(2);
  });

  it("reports a changed CommonJS root when its default property stays unchanged", () => {
    const evidence = analyzeEvidence(
      episode(
        [
          "module.exports = (root) => root;",
          "module.exports.default = (value) => value;",
        ].join("\n"),
        [
          "module.exports = (root, options) => root;",
          "module.exports.default = (value) => value;",
        ].join("\n"),
        "javascript",
        "file:///pair.js",
      ),
    );
    const changes = evidence.filter(
      (item) => item.kind === "public-api-change",
    );

    expect(changes).toEqual([
      expect.objectContaining({
        title: "Exported API signature changed",
        references: ["default export"],
        range: expect.objectContaining({
          start: expect.objectContaining({ line: 0 }),
        }),
      }),
    ]);
  });

  it("distinguishes a literal dotted CommonJS property from a nested path", () => {
    const evidence = analyzeEvidence(
      episode(
        [
          'module.exports["foo.bar"] = class { static run(value) { return value; } };',
          "module.exports.foo = {};",
          "module.exports.foo.bar = (nested) => nested;",
        ].join("\n"),
        [
          'module.exports["foo.bar"] = class { static run(value, options) { return value; } };',
          "module.exports.foo = {};",
          "module.exports.foo.bar = (nested, options) => nested;",
        ].join("\n"),
        "javascript",
        "file:///pair.js",
      ),
    );
    const changes = evidence.filter(
      (item) => item.kind === "public-api-change",
    );

    expect(changes).toHaveLength(2);
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ references: ["foo.bar.run"] }),
        expect.objectContaining({ references: ["foo.bar"] }),
      ]),
    );
    expect(new Set(changes.map((item) => item.id)).size).toBe(2);
  });

  it("clears the complete CommonJS state on whole-object replacement", () => {
    const previousText = [
      "module.exports = (root) => root;",
      "module.exports.default = (value) => value;",
      'module.exports["foo.bar"] = (literal) => literal;',
      "module.exports.foo = {};",
      "module.exports.foo.bar = (nested) => nested;",
    ].join("\n");
    const evidence = analyzeEvidence(
      episode(
        previousText,
        [
          previousText,
          "module.exports = { keep: (value) => value };",
        ].join("\n"),
        "javascript",
        "file:///pair.js",
      ),
    );
    const changes = evidence.filter(
      (item) => item.kind === "public-api-change",
    );
    const removals = changes.filter(
      (item) => item.title === "Exported API removed",
    );

    expect(changes).toHaveLength(5);
    expect(removals).toHaveLength(4);
    expect(removals.map((item) => item.references[0]).sort()).toEqual([
      "default export",
      "default export",
      "foo.bar",
      "foo.bar",
    ]);
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Exported API added",
          references: ["keep"],
        }),
      ]),
    );
    expect(new Set(changes.map((item) => item.id)).size).toBe(5);
  });

  it("ignores a changed CommonJS assignment overwritten by the same final replacement", () => {
    const evidence = analyzeEvidence(
      episode(
        [
          "module.exports = (id) => 1;",
          'module.exports = (id) => "final";',
        ].join("\n"),
        [
          "module.exports = (id) => true;",
          'module.exports = (id) => "final";',
        ].join("\n"),
        "javascript",
        "file:///pair.js",
      ),
    );

    expect(
      evidence.filter((item) => item.kind === "public-api-change"),
    ).toEqual([]);
  });

  it("reports a CommonJS property removed by a later whole replacement", () => {
    const evidence = analyzeEvidence(
      episode(
        [
          "module.exports = {};",
          "module.exports.removed = (id) => id;",
          "module.exports.keep = (id) => id;",
        ].join("\n"),
        [
          "module.exports.removed = (id) => id;",
          "module.exports = {};",
          "module.exports.keep = (id) => id;",
        ].join("\n"),
        "javascript",
        "file:///pair.js",
      ),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          title: "Exported API removed",
          references: ["removed"],
        }),
      ]),
    );
  });

  it("keeps CommonJS property assignments made after a whole replacement", () => {
    const evidence = analyzeEvidence(
      episode(
        "module.exports = (id) => id;",
        [
          "module.exports = (id) => id;",
          "module.exports.extra = (name) => name;",
        ].join("\n"),
        "javascript",
        "file:///pair.js",
      ),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          references: ["extra"],
        }),
      ]),
    );
    expect(
      evidence.some(
        (item) =>
          item.kind === "public-api-change" &&
          item.references[0] === "default export",
      ),
    ).toBe(false);
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

  it("reports getter-only to getter-and-setter public surface changes", () => {
    const getter = [
      "export class Settings {",
      '  get value(): string { return ""; }',
      "}",
    ];
    const setter = [
      "  set value(next: string) {",
      "    void next;",
      "  }",
    ];
    const evidence = analyzeEvidence(
      episode(
        getter.join("\n"),
        [...getter.slice(0, -1), ...setter, "}"].join("\n"),
      ),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          title: "Exported API signature changed",
          references: ["Settings#value"],
        }),
      ]),
    );
  });

  it("reports a setter parameter change when its getter stays unchanged", () => {
    const source = (setterType: string): string =>
      [
        "export class Settings {",
        '  get value(): string { return ""; }',
        `  set value(next: ${setterType}) {`,
        "    void next;",
        "  }",
        "}",
      ].join("\n");
    const evidence = analyzeEvidence(
      episode(source("string"), source("number")),
    );

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public-api-change",
          title: "Exported API signature changed",
          references: ["Settings#value"],
        }),
      ]),
    );
  });

  it("treats a non-public setter as absent from the public accessor shape", () => {
    const previous = [
      "export class Settings {",
      '  get value(): string { return ""; }',
      "  private set value(next: string) {",
      "    void next;",
      "  }",
      "}",
    ].join("\n");
    const current = [
      "export class Settings {",
      '  get value(): string { return ""; }',
      "}",
    ].join("\n");

    expect(
      analyzeEvidence(episode(previous, current)).filter(
        (item) => item.kind === "public-api-change",
      ),
    ).toEqual([]);
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
          references: ["load"],
        }),
      ],
    });
  });
});
