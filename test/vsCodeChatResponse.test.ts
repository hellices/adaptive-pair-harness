import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { createVsCodeChatResponse } from "../src/vscode/vsCodeChatResponse";

const vscodeState = vi.hoisted(() => ({
  appendedText: [] as string[],
}));

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
  it("passes trusted Markdown directly and wraps text with MarkdownString.appendText", () => {
    vscodeState.appendedText.length = 0;
    const markdown = vi.fn();
    const response = createVsCodeChatResponse({
      markdown,
    } as unknown as vscode.ChatResponseStream);
    const untrusted =
      "[run](command:adaptivePair.stop) 사용자@예시.한국 <img src=x>";

    response.markdown("**Trusted:**");
    response.text(untrusted);

    expect(markdown.mock.calls[0]?.[0]).toBe("**Trusted:**");
    expect(vscodeState.appendedText).toEqual([untrusted]);
    expect(markdown.mock.calls[1]?.[0]).toBeInstanceOf(vscode.MarkdownString);
    expect(markdown.mock.calls[1]?.[0]).toMatchObject({
      value: `escaped:${untrusted}`,
    });
  });
});
