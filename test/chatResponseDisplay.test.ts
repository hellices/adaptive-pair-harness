import { describe, expect, it } from "vitest";
import LinkifyIt from "linkify-it";
import {
  PAIR_CHAT_RESPONSE_DISPLAY_LIMIT,
  formatChatResponseForDisplay,
  formatChatResponsePartsForDisplay,
} from "../src/vscode/chatResponseDisplay";
import { neutralizePlainTextAutolinks } from "../src/vscode/plainTextAutolinks";

describe("Chat response display boundary", () => {
  it("bounds an oversized 64 KiB OpenAI-compatible response", () => {
    const response = "o".repeat(64 * 1_024);

    const displayed = formatChatResponseForDisplay(response);

    expect([...displayed]).toHaveLength(PAIR_CHAT_RESPONSE_DISPLAY_LIMIT);
    expect(displayed).toBe(
      `${"o".repeat(PAIR_CHAT_RESPONSE_DISPLAY_LIMIT - 1)}…`,
    );
  });

  it("preserves plain Unicode text and newlines while normalizing line endings and controls", () => {
    const response =
      `## 분석\r\n\u0000\r${"界😀".repeat(
        PAIR_CHAT_RESPONSE_DISPLAY_LIMIT,
      )}`;

    const displayed = formatChatResponseForDisplay(response);

    expect(displayed.startsWith("## 분석\n \n界😀")).toBe(true);
    expect(displayed).not.toContain("\r");
    expect(displayed).not.toContain("\u0000");
    expect(displayed.endsWith("…")).toBe(true);
    expect([...displayed]).toHaveLength(PAIR_CHAT_RESPONSE_DISPLAY_LIMIT);
  });

  it("does not truncate a response at the exact display boundary", () => {
    const response = "界".repeat(PAIR_CHAT_RESPONSE_DISPLAY_LIMIT);

    expect(formatChatResponseForDisplay(response)).toBe(response);
  });

  it("neutralizes every URL and email before applying the final display cap", () => {
    const response = (
      "https://outer.test/https://inner.test user@example.com " +
      "www.example.com\r\n\u0000"
    ).repeat(PAIR_CHAT_RESPONSE_DISPLAY_LIMIT);
    const normalized = response.replaceAll("\r\n", "\n").replaceAll("\u0000", " ");
    const neutralized = neutralizePlainTextAutolinks(normalized);
    const expected =
      [...neutralized]
        .slice(0, PAIR_CHAT_RESPONSE_DISPLAY_LIMIT - 1)
        .join("") + "…";

    const displayed = formatChatResponseForDisplay(response);

    expect(displayed).toBe(expected);
    expect([...displayed]).toHaveLength(PAIR_CHAT_RESPONSE_DISPLAY_LIMIT);
    expect(displayed.endsWith("…")).toBe(true);
    expect(new LinkifyIt().match(displayed)).toBeNull();
  });

  it("keeps capped CJK and emoji output idempotent without reintroducing links", () => {
    const response = (
      "分析😀 https://예시.한국 사용자@예시.한국 www.例子.测试 "
    ).repeat(PAIR_CHAT_RESPONSE_DISPLAY_LIMIT);

    const displayed = formatChatResponseForDisplay(response);

    expect(formatChatResponseForDisplay(displayed)).toBe(displayed);
    expect([...displayed]).toHaveLength(PAIR_CHAT_RESPONSE_DISPLAY_LIMIT);
    expect(displayed.endsWith("…")).toBe(true);
    expect(displayed).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u,
    );
    expect(new LinkifyIt().match(displayed)).toBeNull();
  });

  it("caps multipart Chat output after neutralizing every text part", () => {
    const displayed = formatChatResponsePartsForDisplay([
      { kind: "markdown", value: "**Sources:** " },
      {
        kind: "text",
        value: "https://outer.test/https://inner.test ".repeat(
          PAIR_CHAT_RESPONSE_DISPLAY_LIMIT,
        ),
      },
    ]);
    const combined = displayed.map(({ value }) => value).join("");
    const plainText = displayed
      .filter(({ kind }) => kind === "text")
      .map(({ value }) => value)
      .join("");

    expect([...combined]).toHaveLength(PAIR_CHAT_RESPONSE_DISPLAY_LIMIT);
    expect(combined.endsWith("…")).toBe(true);
    expect(new LinkifyIt().match(plainText)).toBeNull();
  });

  it("never leaves a dangling surrogate when truncating emoji", () => {
    const response =
      "x".repeat(PAIR_CHAT_RESPONSE_DISPLAY_LIMIT - 2) + "😀more";

    const displayed = formatChatResponseForDisplay(response);

    expect(displayed).toBe(
      `${"x".repeat(PAIR_CHAT_RESPONSE_DISPLAY_LIMIT - 2)}😀…`,
    );
    expect(displayed).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u,
    );
    expect([...displayed]).toHaveLength(PAIR_CHAT_RESPONSE_DISPLAY_LIMIT);
  });
});
