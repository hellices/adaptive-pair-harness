import { describe, expect, it } from "vitest";
import { TypeScriptSemanticAnalyzer } from "../src/core/semanticAnalyzer";
import type { EditEpisode, PairRange } from "../src/core/types";

const analyzer = new TypeScriptSemanticAnalyzer();

const episode = (previousText: string, currentText: string): EditEpisode => ({
  uri: "file:///pair.ts",
  languageId: "typescript",
  previousText,
  currentText,
  version: 1,
  observedAt: 1,
});

const comparePositions = (left: PairRange["start"], right: PairRange["start"]): number => {
  if (left.line === right.line) {
    return left.character - right.character;
  }

  return left.line - right.line;
};

describe("TypeScriptSemanticAnalyzer", () => {
  it("reports a newly introduced import", () => {
    const evidence = analyzer.analyze(
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
    const evidence = analyzer.analyze(
      episode(
        "export function load(id: string): string { return id; }",
        "export function load(id: number): string { return String(id); }",
      ),
    );

    expect(evidence.some((item) => item.kind === "public-api-change")).toBe(true);
  });

  it("reports a changed anonymous default-exported function signature", () => {
    const evidence = analyzer.analyze(
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

  it("reports a changed method signature on an anonymous default-exported class", () => {
    const evidence = analyzer.analyze(
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
    const evidence = analyzer.analyze(
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
    const evidence = analyzer.analyze(
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
    const evidence = analyzer.analyze(
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
    const evidence = analyzer.analyze(
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
    const removedFunctionEvidence = analyzer.analyze(
      episode("function load(id: string): string { return id; }", "const value = 1;"),
    );
    const removedPrivateMethodEvidence = analyzer.analyze(
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
    const evidence = analyzer.analyze(
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
    const evidence = analyzer.analyze(
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

  it("does not intervene while the current source has parse errors", () => {
    const evidence = analyzer.analyze(
      episode("export function load() {}", "export function load("),
    );

    expect(evidence).toEqual([]);
  });

  it("reports complexity growth when a function crosses the intervention threshold", () => {
    const evidence = analyzer.analyze(
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

    const firstEvidence = analyzer.analyze(edit);
    const secondEvidence = analyzer.analyze(edit);

    expect(firstEvidence.map((item) => item.id)).toEqual(secondEvidence.map((item) => item.id));
  });

  it("anchors evidence to valid ranges in the current source", () => {
    const currentText = 'import { save } from "./repository";\nexport const value = 1;';
    const evidence = analyzer.analyze(episode("export const value = 1;", currentText));

    expect(evidence).not.toEqual([]);

    for (const item of evidence) {
      expect(item.range.start.line).toBeGreaterThanOrEqual(0);
      expect(item.range.start.character).toBeGreaterThanOrEqual(0);
      expect(item.range.end.line).toBeGreaterThanOrEqual(item.range.start.line);
      expect(comparePositions(item.range.start, item.range.end)).toBeLessThan(0);
    }
  });

  it("assigns distinct complexity evidence ids to same-named nested functions in different scopes", () => {
    const evidence = analyzer.analyze(
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
});
