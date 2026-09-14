import { describe, expect, it } from "vitest";
import { mapLanguageModelAccessKind } from "../src/vscode/languageModelAccess";

enum LanguageModelAccessKind {
  Allowed,
  Disallowed,
  NeedsConsent,
}

describe("mapLanguageModelAccessKind", () => {
  it.each([
    [LanguageModelAccessKind.Allowed, true],
    [LanguageModelAccessKind.Disallowed, false],
    [LanguageModelAccessKind.NeedsConsent, undefined],
  ] as const)("maps VS Code access kind %s to %s", (access, expected) => {
    expect(
      mapLanguageModelAccessKind(access, LanguageModelAccessKind),
    ).toBe(expected);
  });
});
