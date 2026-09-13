import * as vscode from "vscode";

const WORD_JOINER = "\u2060";
const HAIR_SPACE = "\u200a";
const URI_SCHEME_SEPARATOR = /:(?:\u2060)?\/\//gu;
const BARE_WWW_PREFIX = /(?<![\p{L}\p{N}_])www(?:\u200a)?\./giu;
const AT_SEPARATOR = /(?:\u2060)?@(?:\u2060)?/gu;

export interface PairChatResponse {
  markdown(value: string): void;
  text(value: string): void;
}

export const neutralizeChatTextAutolinks = (value: string): string =>
  value
    .replace(URI_SCHEME_SEPARATOR, `:${WORD_JOINER}//`)
    .replace(BARE_WWW_PREFIX, (prefix) => {
      const www = prefix.slice(0, 3);
      return `${www}${HAIR_SPACE}.`;
    })
    .replace(AT_SEPARATOR, `${WORD_JOINER}@${WORD_JOINER}`);

export const createVsCodeChatResponse = (
  response: vscode.ChatResponseStream,
): PairChatResponse => ({
  markdown: (value) => {
    response.markdown(value);
  },
  text: (value) => {
    response.markdown(
      new vscode.MarkdownString().appendText(
        neutralizeChatTextAutolinks(value),
      ),
    );
  },
});
