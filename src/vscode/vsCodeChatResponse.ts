import * as vscode from "vscode";
import { neutralizePlainTextAutolinks } from "./plainTextAutolinks";

export interface PairChatResponse {
  markdown(value: string): void;
  text(value: string): void;
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
      new vscode.MarkdownString().appendText(
        neutralizePlainTextAutolinks(value),
      ),
    );
  },
});
