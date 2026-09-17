import * as vscode from "vscode";
import {
  createModelProvider,
  createRequestHandler,
  createSessionItemController,
} from "./sessionTargetBindings";
import { SESSION_CAPABILITIES } from "./sessionTargetConfig";
import { SessionTargetProviderCore } from "./sessionTargetProviderCore";
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

export const activate = (
  context: vscode.ExtensionContext,
): SessionTargetPocApi => {
  const store = new SessionTargetStore(() => crypto.randomUUID());
  const core = new SessionTargetProviderCore(store, () => Date.now());
  let contentProviderCalls = 0;

  const modelProvider = createModelProvider(SESSION_TYPE);

  const requestHandler = createRequestHandler(core);

  const participant = vscode.chat.createChatParticipant(
    PARTICIPANT_ID,
    requestHandler,
  );

  const controller = createSessionItemController(core, store, SESSION_TYPE);

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
