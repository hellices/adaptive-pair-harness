import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

vi.mock("vscode", () => ({
  SymbolKind: {
    5: "Method",
    11: "Function",
    Function: 11,
    Method: 5,
  },
}));

import { findCurrentSymbol } from "../src/vscode/symbolContext";

const comparePosition = (
  left: { readonly line: number; readonly character: number },
  right: { readonly line: number; readonly character: number },
): number =>
  left.line === right.line
    ? left.character - right.character
    : left.line - right.line;

const range = (
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
): vscode.Range =>
  ({
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
    contains: (
      value:
        | { readonly line: number; readonly character: number }
        | {
            readonly start: {
              readonly line: number;
              readonly character: number;
            };
            readonly end: {
              readonly line: number;
              readonly character: number;
            };
          },
    ) =>
      "start" in value
        ? comparePosition(
            { line: startLine, character: startCharacter },
            value.start,
          ) <= 0 &&
          comparePosition(value.end, {
            line: endLine,
            character: endCharacter,
          }) <= 0
        : comparePosition(
            { line: startLine, character: startCharacter },
            value,
          ) <= 0 &&
          comparePosition(value, {
            line: endLine,
            character: endCharacter,
          }) <= 0,
  }) as unknown as vscode.Range;

const documentUri = {
  toString: () => "file:///workspace/source.ts",
} as vscode.Uri;
const position = { line: 5, character: 6 } as vscode.Position;

describe("document symbol context", () => {
  it("chooses the smallest containing nested DocumentSymbol regardless of provider order", () => {
    const innermost = {
      name: "innermost",
      kind: 11,
      range: range(5, 4, 5, 9),
      selectionRange: range(5, 4, 5, 9),
      children: [],
    } as unknown as vscode.DocumentSymbol;
    const middle = {
      name: "middle",
      kind: 5,
      range: range(3, 0, 8, 0),
      selectionRange: range(3, 0, 3, 6),
      children: [],
    } as unknown as vscode.DocumentSymbol;
    const outer = {
      name: "outer",
      kind: 11,
      range: range(0, 0, 20, 0),
      selectionRange: range(0, 0, 0, 5),
      children: [innermost, middle],
    } as unknown as vscode.DocumentSymbol;

    expect(
      findCurrentSymbol([outer], documentUri, position, position),
    ).toMatchObject({
      name: "innermost",
      kind: "Function",
      range: {
        start: { line: 5, character: 4 },
        end: { line: 5, character: 9 },
      },
    });
  });

  it("chooses the smallest containing flat SymbolInformation regardless of provider order", () => {
    const symbol = (
      name: string,
      symbolRange: vscode.Range,
    ): vscode.SymbolInformation =>
      ({
        name,
        kind: 11,
        location: { uri: documentUri, range: symbolRange },
      }) as vscode.SymbolInformation;

    expect(
      findCurrentSymbol(
        [
          symbol("innermost", range(5, 4, 5, 9)),
          symbol("outer", range(0, 0, 20, 0)),
        ],
        documentUri,
        position,
        position,
      ),
    ).toMatchObject({
      name: "innermost",
      range: {
        start: { line: 5, character: 4 },
        end: { line: 5, character: 9 },
      },
    });
  });

  it.each([
    ["DocumentSymbol first", false],
    ["SymbolInformation first", true],
  ])(
    "requires both evidence endpoints and remains deterministic with %s",
    (_label, flatFirst) => {
      const inner = {
        name: "start-only-inner",
        kind: 11,
        range: range(5, 4, 5, 9),
        selectionRange: range(5, 4, 5, 9),
        children: [],
      } as unknown as vscode.DocumentSymbol;
      const outer = {
        name: "outer",
        kind: 11,
        range: range(0, 0, 20, 0),
        selectionRange: range(0, 0, 0, 5),
        children: [inner],
      } as unknown as vscode.DocumentSymbol;
      const smallestContaining = {
        name: "complete-evidence",
        kind: 5,
        location: {
          uri: documentUri,
          range: range(4, 0, 7, 0),
        },
      } as vscode.SymbolInformation;
      const symbols = flatFirst
        ? [smallestContaining, outer]
        : [outer, smallestContaining];

      expect(
        findCurrentSymbol(
          symbols,
          documentUri,
          position,
          { line: 6, character: 2 } as vscode.Position,
        ),
      ).toMatchObject({
        name: "complete-evidence",
        range: {
          start: { line: 4, character: 0 },
          end: { line: 7, character: 0 },
        },
      });
    },
  );
});
