import * as vscode from "vscode";

export interface PairChatResponse {
  markdown(value: string): void;
  text(value: string): void;
}

export const createVsCodeChatResponse = (
  response: vscode.ChatResponseStream,
): PairChatResponse => ({
  markdown: (value) => {
    response.markdown(value);
  },
  text: (value) => {
    response.markdown(new vscode.MarkdownString().appendText(value));
  },
});
