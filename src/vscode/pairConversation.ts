import type * as vscode from "vscode";
import type { ModelConversationTurn } from "../core/modelRouter";

export const collectPairConversation = (
  history: vscode.ChatContext["history"],
  conversationId: string,
  includeAssistant: boolean,
): readonly ModelConversationTurn[] => {
  const exchanges: ModelConversationTurn[][] = [];
  let request: vscode.ChatRequestTurn | undefined;
  for (const turn of history.slice(-24)) {
    if (turn.participant !== "adaptivePair.chat") {
      request = undefined;
      continue;
    }
    if ("prompt" in turn) {
      request = turn;
      continue;
    }
    if (request === undefined || turn.result.metadata?.pairConversationId !== conversationId) {
      request = undefined;
      continue;
    }
    if (["start", "stop", "session", "context", "brief"].includes(request.command ?? "")) {
      request = undefined;
      continue;
    }
    const exchange: ModelConversationTurn[] = [{ role: "user", content: request.prompt }];
    if (includeAssistant) {
      const content = turn.response.flatMap((part) => {
        if ("value" in part && typeof part.value === "object" && part.value !== null && "value" in part.value && typeof part.value.value === "string") {
          return [part.value.value];
        }
        return [];
      }).join("\n");
      if (content.length > 0) {
        exchange.push({ role: "assistant", content });
      }
    }
    exchanges.push(exchange);
    request = undefined;
  }
  return exchanges.slice(-3).flat();
};
