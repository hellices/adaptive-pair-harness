import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkArchitecture, readArchitectureProjects, type ArchitectureProject } from "../architecture.js";

const project = (
  name: string,
  content = "export {};",
  overrides: Partial<ArchitectureProject> = {},
): ArchitectureProject => {
  const root = name === "adaptive-pair" ? "apps/vscode-extension" : `packages/${name.split("/").at(-1)}`;
  return {
    name,
    root,
    dependencies: [],
    devDependencies: [],
    references: [],
    files: [{ path: `${root}/src/index.ts`, content }],
    ...overrides,
  };
};

describe("executable architecture boundaries", () => {
  it("accepts declared inward imports through public package entry points", () => {
    expect(checkArchitecture([
      project("@adaptive-pair/protocol"),
      project("@adaptive-pair/session-core", 'import type { PairCommand } from "@adaptive-pair/protocol";', {
        dependencies: ["@adaptive-pair/protocol"], references: ["packages/protocol"],
      }),
    ])).toEqual([]);
  });

  it.each([
    'import type { ExtensionContext } from "vscode";',
    'export { readFile } from "node:fs/promises";',
    'const host = import("@github/copilot-sdk");',
    'type Model = import("openai").Model;',
    'import sdk = require("@anthropic-ai/sdk");',
    'const vendor = require("@azure/openai");',
  ])("rejects host and vendor dependencies in pure source: %s", content => {
    expect(checkArchitecture([project("@adaptive-pair/session-core", content)])).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "external-dependency" })]),
    );
  });

  it("rejects forbidden inward-to-outward edges even when declared", () => {
    const findings = checkArchitecture([
      project("@adaptive-pair/protocol", 'export * from "@adaptive-pair/runtime";', {
        dependencies: ["@adaptive-pair/runtime"], references: ["packages/runtime"],
      }),
      project("@adaptive-pair/runtime"),
    ]);
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "forbidden-dependency" })]));
  });

  it.each([
    'import type { PairCommand } from "@adaptive-pair/protocol";',
    'export * from "@adaptive-pair/protocol";',
    'const protocol = import("@adaptive-pair/protocol");',
    'type Command = import("@adaptive-pair/protocol").PairCommand;',
  ])("requires both a direct dependency and project reference: %s", content => {
    const findings = checkArchitecture([project("@adaptive-pair/protocol"), project("adaptive-pair", content)]);
    expect(findings.map(finding => finding.rule)).toEqual(expect.arrayContaining(["undeclared-dependency", "missing-reference"]));
  });

  it.each([
    'import { decide } from "../../session-core/src/decide.js";',
    'export * from "@adaptive-pair/session-core/src/decide.js";',
  ])("rejects cross-package relative and deep imports: %s", content => {
    const findings = checkArchitecture([
      project("@adaptive-pair/runtime", content, {
        dependencies: ["@adaptive-pair/session-core"], references: ["packages/session-core"],
      }),
      project("@adaptive-pair/session-core"),
    ]);
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "nonpublic-import" })]));
  });

  it("detects dependency cycles independently of edge policy", () => {
    const findings = checkArchitecture([
      project("@adaptive-pair/protocol", 'import "@adaptive-pair/session-core";', {
        dependencies: ["@adaptive-pair/session-core"], references: ["packages/session-core"],
      }),
      project("@adaptive-pair/session-core", 'import "@adaptive-pair/protocol";', {
        dependencies: ["@adaptive-pair/protocol"], references: ["packages/protocol"],
      }),
    ]);
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "dependency-cycle" })]));
  });

  it("permits declared testkit imports only from tests", () => {
    const runtime = project("@adaptive-pair/runtime", "", {
      devDependencies: ["@adaptive-pair/testkit"], references: ["packages/testkit"],
      files: [{ path: "packages/runtime/test/runtime.test.ts", content: 'import { FakeClock } from "@adaptive-pair/testkit";' }],
    });
    expect(checkArchitecture([runtime, project("@adaptive-pair/testkit")])).toEqual([]);
    expect(checkArchitecture([
      { ...runtime, files: [{ ...runtime.files[0]!, path: "packages/runtime/src/runtime.ts" }] },
      project("@adaptive-pair/testkit"),
    ]).map(finding => finding.rule)).toEqual(expect.arrayContaining(["forbidden-dependency", "undeclared-dependency"]));
  });

  it("requires review of newly introduced product packages", () => {
    expect(checkArchitecture([project("@adaptive-pair/unreviewed")])).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "unreviewed-package" })]),
    );
  });

  it("rejects reference-only dependencies missing from the manifest", () => {
    const projects = readArchitectureProjects(resolve(import.meta.dirname, "../.."));
    const changed = projects.map(candidate => candidate.name === "@adaptive-pair/session-core"
      ? { ...candidate, references: [...candidate.references, "packages/evidence"] }
      : candidate);

    expect(checkArchitecture(changed)).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "undeclared-reference", file: "packages/session-core/tsconfig.json" }),
    ]));
  });

  it("rejects outward reference-only edges disguised as test dependencies", () => {
    expect(checkArchitecture([
      project("@adaptive-pair/session-core", "", {
        devDependencies: ["@adaptive-pair/evidence"], references: ["packages/evidence"],
      }),
      project("@adaptive-pair/evidence"),
    ])).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "forbidden-reference" }),
    ]));
  });

  it("rejects project references outside the reviewed workspace graph", () => {
    expect(checkArchitecture([
      project("@adaptive-pair/session-core", "", { references: ["packages/unknown"] }),
    ])).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "unknown-reference" }),
    ]));
  });

  it("accepts declared inward test-only references", () => {
    expect(checkArchitecture([
      project("@adaptive-pair/session-core", "", {
        devDependencies: ["@adaptive-pair/protocol"], references: ["packages/protocol"],
      }),
      project("@adaptive-pair/protocol"),
    ])).toEqual([]);
  });

  it("checks every active Stable workspace against its real manifest and references", () => {
    const projects = readArchitectureProjects(resolve(import.meta.dirname, "../.."));
    expect(projects).toHaveLength(12);
    expect(projects.every(candidate => !candidate.root.startsWith("poc/"))).toBe(true);
    expect(projects.find(candidate => candidate.name === "adaptive-pair")?.files.length).toBeGreaterThan(0);
    expect(checkArchitecture(projects)).toEqual([]);
  });
});
