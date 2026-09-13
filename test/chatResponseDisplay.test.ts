import { describe, expect, it } from "vitest";
import {
  PAIR_CHAT_RESPONSE_DISPLAY_LIMIT,
  formatChatResponseForDisplay,
} from "../src/vscode/chatResponseDisplay";

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
