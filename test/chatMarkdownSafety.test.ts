import { describe, expect, it } from "vitest";
import {
  escapeMarkdownText,
  sanitizeModelMarkdown,
} from "../src/core/chatMarkdownSafety";

describe("Chat Markdown safety", () => {
  it("escapes untrusted text without changing Unicode or line structure", () => {
    const malicious = [
      String.raw`[close](command:workbench.action.close)`,
      String.raw`![open](vscode://file/workspace/secret.ts)`,
      "# heading **emphasis** _more_",
      "```ts",
      String.raw`const path = "C:\workspace";`,
      "```",
      "<img src=x onerror=alert(1)>",
      "분석 😀",
    ].join("\n");

    const escaped = escapeMarkdownText(malicious);

    expect(escaped).toContain(
      String.raw`\[close\]\(command：workbench\.action\.close\)`,
    );
    expect(escaped).toContain(
      String.raw`\!\[open\]\(vscode：\/\/file\/workspace\/secret\.ts\)`,
    );
    expect(escaped).toContain(String.raw`\# heading \*\*emphasis\*\* \_more\_`);
    expect(escaped).toContain(String.raw`\`\`\`ts`);
    expect(escaped).toContain(
      String.raw`const path \= \"C\:\\workspace\"\;`,
    );
    expect(escaped).toContain(
      String.raw`\<img src\=x onerror\=alert\(1\)\>`,
    );
    expect(escaped).toContain("분석 😀");
    expect(escaped.split("\n")).toHaveLength(8);
    expect(escaped).not.toMatch(/(?:command|vscode):/iu);
  });

  it("preserves remote prose formatting while neutralizing links, images, action URIs, and HTML", () => {
    const markdown = [
      "## 분석 **강조**",
      "```ts",
      "const value = 1;",
      "```",
      "[close](command:workbench.action.close)",
      "![open](vscode://file/workspace/secret.ts)",
      "<details><summary>hidden</summary></details>",
      "Bare command:adaptivePair.close and vscode://file/workspace",
    ].join("\n");

    const sanitized = sanitizeModelMarkdown(markdown);

    expect(sanitized).toContain("## 분석 **강조**");
    expect(sanitized).toContain("```ts\nconst value = 1;\n```");
    expect(sanitized).toContain(
      String.raw`\[close\](command：workbench.action.close)`,
    );
    expect(sanitized).toContain(
      String.raw`!\[open\](vscode：//file/workspace/secret.ts)`,
    );
    expect(sanitized).toContain(
      String.raw`\<details\>\<summary\>hidden\</summary\>\</details\>`,
    );
    expect(sanitized).toContain(
      "Bare command：adaptivePair.close and vscode：//file/workspace",
    );
    expect(sanitized).not.toMatch(/(?:command|vscode):/iu);
    expect(sanitizeModelMarkdown(sanitized)).toBe(sanitized);
  });
});
