import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import LinkifyIt from "linkify-it";
import {
  createVsCodeChatResponse,
  neutralizeChatTextAutolinks,
} from "../src/vscode/vsCodeChatResponse";
import { PAIR_CHAT_RESPONSE_DISPLAY_LIMIT } from "../src/vscode/chatResponseDisplay";

const vscodeState = vi.hoisted(() => ({
  appendedText: [] as string[],
}));
const WORD_JOINER = "\u2060";
const HAIR_SPACE = "\u200a";

vi.mock("vscode", () => {
  class MarkdownString {
    public value = "";

    public appendText(value: string): this {
      vscodeState.appendedText.push(value);
      this.value = `escaped:${value}`;
      return this;
    }
  }

  return { MarkdownString };
});

describe("VS Code Chat response adapter", () => {
  it("passes trusted Markdown directly and lets appendText escape untrusted Markdown and HTML", () => {
    vscodeState.appendedText.length = 0;
    const markdown = vi.fn();
    const response = createVsCodeChatResponse({
      markdown,
    } as unknown as vscode.ChatResponseStream);
    const untrusted =
      "[run](command:adaptivePair.stop) 사용자@예시.한국 <img src=x>";
    const neutralized =
      `[run](command:adaptivePair.stop) 사용자${WORD_JOINER}` +
      `@${WORD_JOINER}예시.한국 <img src=x>`;

    response.markdown("**Trusted:**");
    response.text(untrusted);

    expect(markdown.mock.calls[0]?.[0]).toBe("**Trusted:**");
    expect(vscodeState.appendedText).toEqual([neutralized]);
    expect(markdown.mock.calls[1]?.[0]).toBeInstanceOf(vscode.MarkdownString);
    expect(markdown.mock.calls[1]?.[0]).toMatchObject({
      value: `escaped:${neutralized}`,
    });
  });

  it("neutralizes every nested and adjacent URI scheme separator", () => {
    const text =
      "http://outer.test/https://inner.test https://a.testhttp://b.test";

    expect(neutralizeChatTextAutolinks(text)).toBe(
      `http:${WORD_JOINER}//outer.test/https:${WORD_JOINER}//inner.test ` +
        `https:${WORD_JOINER}//a.testhttp:${WORD_JOINER}//b.test`,
    );
  });

  it("neutralizes arbitrary and uppercase URI schemes", () => {
    const text = "CUSTOM+SSH://host VSCODE-REMOTE://workspace file://local";

    expect(neutralizeChatTextAutolinks(text)).toBe(
      `CUSTOM+SSH:${WORD_JOINER}//host ` +
        `VSCODE-REMOTE:${WORD_JOINER}//workspace file:${WORD_JOINER}//local`,
    );
  });

  it("neutralizes bare www prefixes and ASCII, punycode, and Unicode email or mention separators", () => {
    const text =
      "www.example.com WWW.xn--fsq.com user@example.com " +
      "pair@xn--fsq.com 사용자@예시.한국 @pair";

    expect(neutralizeChatTextAutolinks(text)).toBe(
      `www${HAIR_SPACE}.example.com WWW${HAIR_SPACE}.xn--fsq.com ` +
        `user${WORD_JOINER}@${WORD_JOINER}example.com ` +
        `pair${WORD_JOINER}@${WORD_JOINER}xn--fsq.com ` +
        `사용자${WORD_JOINER}@${WORD_JOINER}예시.한국 ` +
        `${WORD_JOINER}@${WORD_JOINER}pair`,
    );
  });

  it("neutralizes URL text in escaped Markdown links and code strings without parsing Markdown", () => {
    const text = String.raw`\[docs\]\(https://example.com\) \`code www.example.com git://host user@example.com\``;

    expect(neutralizeChatTextAutolinks(text)).toBe(
      String.raw`\[docs\]\(https:` +
        WORD_JOINER +
        String.raw`//example.com\) \`code www` +
        HAIR_SPACE +
        `.example.com git:${WORD_JOINER}//host ` +
        `user${WORD_JOINER}@${WORD_JOINER}` +
        String.raw`example.com\``,
    );
  });

  it("is idempotent and preserves ordinary Unicode", () => {
    const text =
      "분석 😀 café — https://예시.한국 사용자@예시.한국 www.例子.测试";
    const once = neutralizeChatTextAutolinks(text);

    expect(neutralizeChatTextAutolinks(once)).toBe(once);
    expect(once).toContain("분석 😀 café —");
    expect(once.replaceAll(WORD_JOINER, "").replaceAll(HAIR_SPACE, "")).toBe(
      text,
    );
  });

  it("produces text that a Markdown linkifier does not recognize as an autolink", () => {
    const linkify = new LinkifyIt();
    const text =
      "https://example.com www.example.com user@example.com " +
      "pair@xn--fsq.com 사용자@예시.한국";

    expect(linkify.match(neutralizeChatTextAutolinks(text))).toBeNull();
  });

  it("caps the final normalized and neutralized text passed to appendText", () => {
    vscodeState.appendedText.length = 0;
    const response = createVsCodeChatResponse({
      markdown: vi.fn(),
    } as unknown as vscode.ChatResponseStream);
    const text = (
      "界😀\r\n\u0000https://outer.test/https://inner.test " +
      "user@example.com www.例子.测试 "
    ).repeat(PAIR_CHAT_RESPONSE_DISPLAY_LIMIT);

    response.text(text);

    const appended = vscodeState.appendedText[0] ?? "";
    expect([...appended]).toHaveLength(PAIR_CHAT_RESPONSE_DISPLAY_LIMIT);
    expect(appended.endsWith("…")).toBe(true);
    expect(appended).not.toContain("\r");
    expect(appended).not.toContain("\u0000");
    expect(new LinkifyIt().match(appended)).toBeNull();
  });

  it("passes exact-boundary non-link text to appendText unchanged", () => {
    vscodeState.appendedText.length = 0;
    const response = createVsCodeChatResponse({
      markdown: vi.fn(),
    } as unknown as vscode.ChatResponseStream);
    const text = "界".repeat(PAIR_CHAT_RESPONSE_DISPLAY_LIMIT);

    response.text(text);

    expect(vscodeState.appendedText).toEqual([text]);
  });
});
