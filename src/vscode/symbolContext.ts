import * as vscode from "vscode";
import type { ModelSymbolContext } from "../core/modelRouter";

export const findCurrentSymbol = (
  symbols: readonly (vscode.DocumentSymbol | vscode.SymbolInformation)[],
  documentUri: vscode.Uri,
  evidenceStart: vscode.Position,
  evidenceEnd: vscode.Position,
): ModelSymbolContext | undefined => {
  const candidates: Array<{
    readonly name: string;
    readonly kind: vscode.SymbolKind;
    readonly range: vscode.Range;
  }> = [];

  const collectDocumentSymbol = (symbol: vscode.DocumentSymbol): void => {
    if (!containsEvidence(symbol.range, evidenceStart, evidenceEnd)) {
      return;
    }
    candidates.push(symbol);
    for (const child of symbol.children) {
      collectDocumentSymbol(child);
    }
  };

  for (const symbol of symbols) {
    if (isDocumentSymbol(symbol)) {
      collectDocumentSymbol(symbol);
    } else if (
      symbol.location.uri.toString() === documentUri.toString() &&
      containsEvidence(symbol.location.range, evidenceStart, evidenceEnd)
    ) {
      candidates.push({
        name: symbol.name,
        kind: symbol.kind,
        range: symbol.location.range,
      });
    }
  }

  const current = candidates.reduce<
    (typeof candidates)[number] | undefined
  >((smallest, candidate) => {
    if (smallest === undefined) {
      return candidate;
    }
    return compareSymbolSpecificity(candidate, smallest) < 0
      ? candidate
      : smallest;
  }, undefined);
  if (current === undefined) {
    return undefined;
  }
  return {
    name: current.name,
    kind: vscode.SymbolKind[current.kind] ?? String(current.kind),
    range: {
      start: {
        line: current.range.start.line,
        character: current.range.start.character,
      },
      end: {
        line: current.range.end.line,
        character: current.range.end.character,
      },
    },
  };
};

const containsEvidence = (
  range: vscode.Range,
  start: vscode.Position,
  end: vscode.Position,
): boolean => range.contains(start) && range.contains(end);

const compareSymbolSpecificity = (
  left: { readonly name: string; readonly range: vscode.Range },
  right: { readonly name: string; readonly range: vscode.Range },
): number => {
  const leftContainsRight = left.range.contains(right.range);
  const rightContainsLeft = right.range.contains(left.range);
  if (leftContainsRight !== rightContainsLeft) {
    return leftContainsRight ? 1 : -1;
  }

  const lineSpan =
    left.range.end.line -
    left.range.start.line -
    (right.range.end.line - right.range.start.line);
  if (lineSpan !== 0) {
    return lineSpan;
  }
  const characterSpan =
    left.range.end.character -
    left.range.start.character -
    (right.range.end.character - right.range.start.character);
  if (characterSpan !== 0) {
    return characterSpan;
  }
  const startOrder =
    right.range.start.line - left.range.start.line ||
    right.range.start.character - left.range.start.character;
  return startOrder !== 0 ? startOrder : left.name.localeCompare(right.name);
};

const isDocumentSymbol = (
  symbol: vscode.DocumentSymbol | vscode.SymbolInformation,
): symbol is vscode.DocumentSymbol => "selectionRange" in symbol;
