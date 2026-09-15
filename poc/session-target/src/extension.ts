import * as vscode from "vscode";
import { SessionTargetProviderCore } from "./sessionTargetProviderCore";
import { SESSION_CAPABILITIES } from "./sessionTargetConfig";
import { SessionTargetStore } from "./sessionTargetStore";

const SESSION_TYPE = "adaptive-pair";
const PARTICIPANT_ID = SESSION_TYPE;

interface SessionTargetPocApi {
  readonly registered: true;
  getState(): {
    readonly sessionCount: number;
    readonly contentProviderCalls: number;
    readonly completedSessions: number;
  };
}

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

export const activate = (
  context: vscode.ExtensionContext,
): SessionTargetPocApi => {
  const store = new SessionTargetStore(() => crypto.randomUUID());
  const core = new SessionTargetProviderCore(store, () => Date.now());
  let contentProviderCalls = 0;

  const modelProvider: vscode.LanguageModelChatProvider = {
    provideLanguageModelChatInformation: () => [{
      id: "echo",
      name: "POC Echo",
      family: "adaptive-pair-poc",
      version: "1",
      maxInputTokens: 4_096,
      maxOutputTokens: 1_024,
      capabilities: {
        toolCalling: false,
      },
      targetChatSessionType: SESSION_TYPE,
      isDefault: true,
      isUserSelectable: true,
    }],
    provideLanguageModelChatResponse: async (
      _model,
      _messages,
      _options,
      progress,
      token,
    ) => {
      if (token.isCancellationRequested) {
        throw new Error("Adaptive Pair POC model request was cancelled.");
      }
      progress.report(new vscode.LanguageModelTextPart(
        "Adaptive Pair POC model is available.",
      ));
    },
    provideTokenCount: async (_model, value) =>
      Math.max(1, Math.ceil(
        (typeof value === "string" ? value : JSON.stringify(value)).length / 4,
      )),
  };

  const requestHandler: vscode.ChatRequestHandler = async (
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

  const participant = vscode.chat.createChatParticipant(
    PARTICIPANT_ID,
    requestHandler,
  );

  let controller: vscode.ChatSessionItemController;
  controller = vscode.chat.createChatSessionItemController(
    SESSION_TYPE,
    async token => {
      if (token.isCancellationRequested) {
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
    },
  );

  controller.newChatSessionItemHandler = async ({ request }, token) => {
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
    return item;
  };

  const provider: vscode.ChatSessionContentProvider = {
    provideChatSessionContent: resource => {
      contentProviderCalls += 1;
      const record = store.get(resource.toString());
      return {
        ...(record === undefined ? {} : { title: record.title }),
        history: [],
        requestHandler: undefined,
      };
    },
  };

  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider(
      "adaptive-pair-poc",
      modelProvider,
    ),
    participant,
    controller,
    vscode.chat.registerChatSessionContentProvider(
      SESSION_TYPE,
      provider,
      participant,
      SESSION_CAPABILITIES,
    ),
  );

  return Object.freeze({
    registered: true,
    getState: () => Object.freeze({
      sessionCount: store.list().length,
      contentProviderCalls,
      completedSessions: store.list().filter(
        session => session.status === "completed",
      ).length,
    }),
  });
};

export const deactivate = (): void => {};
