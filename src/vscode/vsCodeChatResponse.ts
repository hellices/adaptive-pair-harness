import * as vscode from "vscode";
import { formatChatResponseForDisplay, PAIR_CHAT_RESPONSE_DISPLAY_LIMIT } from "./chatResponseDisplay";

export interface PairChatResponse {
  markdown(value: string): void;
  text(value: string): void;
  progress?(value: string): void;
  code?(value: string, language: string): void;
}

export {
  neutralizePlainTextAutolinks,
  neutralizePlainTextAutolinks as neutralizeChatTextAutolinks,
} from "./plainTextAutolinks";

export const createVsCodeChatResponse = (
  response: vscode.ChatResponseStream,
): PairChatResponse => ({
  markdown: (value) => {
    response.markdown(value);
  },
  text: (value) => {
    response.markdown(
      new vscode.MarkdownString().appendText(formatChatResponseForDisplay(value)),
    );
  },
  progress: (value) => {
    response.progress(new vscode.MarkdownString().appendText(formatChatResponseForDisplay(value)).value);
  },
  code: (value, language) => {
    const codePoints = [...value];
    const bounded = codePoints.length > PAIR_CHAT_RESPONSE_DISPLAY_LIMIT
      ? `${codePoints.slice(0, PAIR_CHAT_RESPONSE_DISPLAY_LIMIT - 1).join("")}…` : value;
    const longestFence = Math.max(2, ...[...bounded.matchAll(/`+/gu)].map((match) => match[0].length));
    const fence = "`".repeat(longestFence + 1);
    const safeLanguage = /^[\w+-]{0,30}$/u.test(language) ? language : "";
    const markdown = new vscode.MarkdownString(`${fence}${safeLanguage}\n${bounded}\n${fence}\n`);
    markdown.isTrusted = false;
    markdown.supportHtml = false;
    response.markdown(markdown);
  },
});
