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

  it.each([
    ["http://example.com", String.raw`http\://example.com`],
    [
      "https://example.com/path?q=pair#result",
      String.raw`https\://example.com/path?q=pair#result`,
    ],
    ["www.example.com", String.raw`www\.example.com`],
    ["pair@example.com", String.raw`pair\@example.com`],
  ])("neutralizes the exact bare autolink %s", (markdown, expected) => {
    expect(sanitizeModelMarkdown(markdown)).toBe(expected);
  });

  it("neutralizes URLs left as text inside escaped links and images", () => {
    const markdown =
      "[docs](https://example.com/guide) ![diagram](http://images.example.com/pair.png)";

    expect(sanitizeModelMarkdown(markdown)).toBe(
      String.raw`\[docs\](https\://example.com/guide) !\[diagram\](http\://images.example.com/pair.png)`,
    );
  });

  it("preserves punctuation surrounding bare autolinks", () => {
    const markdown =
      "See (https://example.com/a?x=1#part), www.example.com; or pair+chat@example.co.uk.";

    expect(sanitizeModelMarkdown(markdown)).toBe(
      String.raw`See (https\://example.com/a?x=1#part), www\.example.com; or pair+chat\@example.co.uk.`,
    );
  });

  it("preserves Unicode while neutralizing adjacent bare autolinks", () => {
    const markdown =
      "분석 😀 https://예시.한국/경로 — pair@example.com에서 확인";

    expect(sanitizeModelMarkdown(markdown)).toBe(
      String.raw`분석 😀 https\://예시.한국/경로 — pair\@example.com에서 확인`,
    );
  });

  it("keeps action, data, file, HTML, link, and image forms inert", () => {
    const markdown = [
      "[run](command:adaptivePair.close)",
      "![open](vscode://file/workspace/secret.ts)",
      "[payload](data:text/html,<svg/onload=alert(1)>)",
      "[local](file:///workspace/secret.ts)",
      "<a href=https://example.com>visit</a>",
    ].join("\n");

    expect(sanitizeModelMarkdown(markdown)).toBe(
      [
        String.raw`\[run\](command：adaptivePair.close)`,
        String.raw`!\[open\](vscode：//file/workspace/secret.ts)`,
        String.raw`\[payload\](data:text/html,\<svg/onload=alert(1)\>)`,
        String.raw`\[local\](file:///workspace/secret.ts)`,
        String.raw`\<a href=https\://example.com\>visit\</a\>`,
      ].join("\n"),
    );
  });

  it("does not insert a second autolink escape when sanitized repeatedly", () => {
    const markdown =
      "[docs](https://www.example.com/user@example.com) www.example.com pair@example.com 분석 😀";
    const once = sanitizeModelMarkdown(markdown);

    expect(once).toBe(
      String.raw`\[docs\](https\://www.example.com/user@example.com) www\.example.com pair\@example.com 분석 😀`,
    );
    expect(sanitizeModelMarkdown(once)).toBe(once);
  });
});
