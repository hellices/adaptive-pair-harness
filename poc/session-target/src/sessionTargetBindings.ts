import * as vscode from "vscode";
import type { SessionTargetProviderCore } from "./sessionTargetProviderCore";
import type { SessionTargetStore } from "./sessionTargetStore";

const toAbortSignal = (
  token: vscode.CancellationToken,
): { readonly signal: AbortSignal; dispose(): void } => {
  const controller = new AbortController();
  const cancellation = token.onCancellationRequested(() => {
    controller.abort(new Error("Adaptive Pair request was cancelled."));
  });
  if (token.isCancellationRequested) {
    controller.abort(new Error("Adaptive Pair request was cancelled."));
  }
  return {
    signal: controller.signal,
    dispose: () => {
      cancellation.dispose();
      controller.abort();
    },
  };
};

export const createModelProvider = (sessionType: string): vscode.LanguageModelChatProvider => ({
  provideLanguageModelChatInformation: () => [{
    id: "echo",
    name: "POC Echo",
    family: "adaptive-pair-poc",
    version: "1",
    maxInputTokens: 4_096,
    maxOutputTokens: 1_024,
    capabilities: { toolCalling: false },
    targetChatSessionType: sessionType,
    isDefault: true,
    isUserSelectable: true,
  }],
  provideLanguageModelChatResponse: (_model, _messages, _options, progress, token) =>
    new Promise<void>(resolve => {
      if (token.isCancellationRequested) {
        throw new Error("Adaptive Pair POC model request was cancelled.");
      }
      progress.report(new vscode.LanguageModelTextPart("Adaptive Pair POC model is available."));
      resolve();
    }),
  provideTokenCount: (_model, value) => new Promise<number>(resolve => {
    resolve(Math.max(1, Math.ceil((typeof value === "string" ? value : JSON.stringify(value)).length / 4)));
  }),
});

export const createRequestHandler = (core: SessionTargetProviderCore): vscode.ChatRequestHandler => async (
    request,
    chatContext,
    response,
    token,
  ) => {
    const existingResource =
      chatContext.chatSessionContext?.chatSessionItem.resource.toString();
    const session = core.resolveForRequest(existingResource, request.prompt);
    const cancellation = toAbortSignal(token);
    try {
      await core.respond(
        session.resource,
        request.prompt,
        cancellation.signal,
        chunk => {
          response.markdown(new vscode.MarkdownString().appendText(chunk));
        },
      );
      return {
        metadata: {
          adaptivePairSessionId: session.id,
        },
      };
    } finally {
      cancellation.dispose();
    }
  };

export const createSessionItemController = (
  core: SessionTargetProviderCore,
  store: SessionTargetStore,
  sessionType: string,
): vscode.ChatSessionItemController => {
  const controller = vscode.chat.createChatSessionItemController(
    sessionType,
    token => new Promise<void>(resolve => {
      if (token.isCancellationRequested) {
        resolve();
        return;
      }
      controller.items.replace(
        store.list().map(record => {
          const item = controller.createChatSessionItem(
            vscode.Uri.parse(record.resource),
            record.title,
          );
          item.status = record.status === "completed"
            ? vscode.ChatSessionStatus.Completed
            : record.status === "failed"
              ? vscode.ChatSessionStatus.Failed
              : record.status === "needs-input"
                ? vscode.ChatSessionStatus.NeedsInput
                : vscode.ChatSessionStatus.InProgress;
          item.timing = {
            created: record.createdAt,
          };
          return item;
        }),
      );
      resolve();
    }),
  );

  controller.newChatSessionItemHandler = ({ request }, token) => new Promise<vscode.ChatSessionItem>(resolve => {
    if (token.isCancellationRequested) {
      throw new Error("Adaptive Pair session creation was cancelled.");
    }
    const record = core.create(request.prompt);
    const item = controller.createChatSessionItem(
      vscode.Uri.parse(record.resource),
      record.title,
    );
    item.status = vscode.ChatSessionStatus.InProgress;
    item.timing = {
      created: record.createdAt,
    };
    controller.items.add(item);
    resolve(item);
  });

  return controller;
};
