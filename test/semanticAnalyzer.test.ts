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
});
