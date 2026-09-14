import * as vscode from "vscode";
import type { PairAgentMessage, PairAgentMessagePart, PairAgentModel, PairAgentModelPart } from "../core/pairAgent";

const nativePart = (part: PairAgentMessagePart): vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart => {
  if (part.kind === "text") {
    return new vscode.LanguageModelTextPart(part.text);
  }
  if (part.kind === "tool-result") {
    return new vscode.LanguageModelToolResultPart(part.callId, [new vscode.LanguageModelTextPart(part.text)]);
  }
  if (typeof part.input !== "object" || part.input === null) {
    throw new Error("The selected model supplied invalid tool arguments.");
  }
  return new vscode.LanguageModelToolCallPart(part.callId, part.name, part.input);
};

const nativeMessage = (message: PairAgentMessage): vscode.LanguageModelChatMessage => {
  const content = message.content.map(nativePart);
  if (message.role === "assistant") {
    if (content.some((part) => part instanceof vscode.LanguageModelToolResultPart)) {
      throw new Error("Tool results must belong to a user message.");
    }
    return vscode.LanguageModelChatMessage.Assistant(content.filter((part): part is vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart => !(part instanceof vscode.LanguageModelToolResultPart)));
  }
  if (content.some((part) => part instanceof vscode.LanguageModelToolCallPart)) {
    throw new Error("Tool calls must belong to an assistant message.");
  }
  return vscode.LanguageModelChatMessage.User(content.filter((part): part is vscode.LanguageModelTextPart | vscode.LanguageModelToolResultPart => !(part instanceof vscode.LanguageModelToolCallPart)));
};

const cancellationSource = (signal: AbortSignal): { readonly token: vscode.CancellationToken; dispose(): void } => {
  signal.throwIfAborted();
  const source = new vscode.CancellationTokenSource();
  const cancel = (): void => source.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) {
    cancel();
  }
  return {
    token: source.token,
    dispose: () => {
      signal.removeEventListener("abort", cancel);
      source.cancel();
      source.dispose();
    },
  };
};

export const createPairAgentModel = (selected: vscode.LanguageModelChat): PairAgentModel => {
  if (selected === undefined || typeof selected.sendRequest !== "function") {
    throw new Error("Select an available model in the Chat model picker, then retry. Pair does not substitute a template for a model answer.");
  }
  return {
    maxInputTokens: selected.maxInputTokens,
    countTokens: async (text, signal) => {
      const cancellation = cancellationSource(signal);
      try {
        const count = await selected.countTokens(text, cancellation.token);
        signal.throwIfAborted();
        return count;
      } finally {
        cancellation.dispose();
      }
    },
    stream: async (messages, tools, maxOutputTokens, signal, requireTool) => (async function* (): AsyncGenerator<PairAgentModelPart> {
      const cancellation = cancellationSource(signal);
      try {
        const response = await selected.sendRequest(
          messages.map(nativeMessage),
          {
            justification: "Pair on the developer's goal using approved project context and individually approved edits or verification checks.",
            modelOptions: { max_tokens: maxOutputTokens },
            ...(requireTool === true ? { toolMode: vscode.LanguageModelChatToolMode.Required } : {}),
            ...(tools.length === 0 ? {} : { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }),
          },
          cancellation.token,
        );
        signal.throwIfAborted();
        for await (const part of response.stream) {
          signal.throwIfAborted();
          if (part instanceof vscode.LanguageModelTextPart) {
            yield { kind: "text", text: part.value };
          } else if (part instanceof vscode.LanguageModelToolCallPart) {
            yield { kind: "tool-call", callId: part.callId, name: part.name, input: part.input };
          }
        }
      } finally {
        cancellation.dispose();
      }
    })(),
  };
};
