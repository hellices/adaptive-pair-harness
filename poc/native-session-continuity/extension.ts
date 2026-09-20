import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { errorMessage, isFixtureMetadata, type FixtureMetadata, type Invocation, type ProbeApi } from "./contracts.js";
import { run } from "./host.js";

const inspectResource = (request: vscode.ChatRequest): Invocation["diagnosticSessionResource"] => {
  try {
    const diagnostic = request as unknown as { readonly sessionResource?: vscode.Uri };
    const value = diagnostic.sessionResource?.toString();
    return value === undefined ? {} : { value };
  } catch (error) {
    return { error: errorMessage(error) };
  }
};

export const activate = (extensionContext: vscode.ExtensionContext): ProbeApi => {
  const invocations: Invocation[] = [];
  const bootKey = randomUUID();
  let modelCalls = 0;
  let tokenCountCalls = 0;
  const disposalEvents: string[] = [];
  let disposalApi: string;
  try {
    const diagnostic = vscode.chat as unknown as {
      onDidDisposeChatSession(listener: (event: unknown) => void): vscode.Disposable;
    };
    extensionContext.subscriptions.push(diagnostic.onDidDisposeChatSession(event => disposalEvents.push(String(event))));
    disposalApi = "available";
  } catch (error) {
    disposalApi = errorMessage(error);
  }
  const register = (participant: string): vscode.ChatParticipant => vscode.chat.createChatParticipant(
    participant,
    (request, context, response) => {
      const history = context.history.map(turn => {
        if (turn instanceof vscode.ChatRequestTurn) return { participant: turn.participant, prompt: turn.prompt };
        const metadata: unknown = turn.result.metadata;
        return { participant: turn.participant, ...(isFixtureMetadata(metadata) ? { metadata } : {}) };
      });
      const metadata: FixtureMetadata = {
        fixture: "adaptive-pair-native-continuity/v1", marker: request.prompt.trim(), bootKey,
        authorityRestored: false, automaticReplayAllowed: false,
      };
      invocations.push({
        participant, prompt: request.prompt, bootKey, history,
        contextKeys: Object.keys(context), requestKeys: Object.keys(request),
        diagnosticSessionResource: inspectResource(request),
      });
      response.markdown("Synthetic continuity probe completed without a model call.");
      return { metadata };
    },
  );
  extensionContext.subscriptions.push(
    register("adaptive-pair.native-continuity-probe"), register("adaptive-pair.native-continuity-peer"),
    vscode.lm.registerLanguageModelChatProvider("adaptive-pair-native-probe", {
      provideLanguageModelChatInformation: () => [{
        id: "offline", name: "Native Probe Offline Fixture", family: "native-probe", version: "1",
        maxInputTokens: 4096, maxOutputTokens: 1024, capabilities: { toolCalling: false },
      }],
      provideLanguageModelChatResponse: () => {
        modelCalls += 1;
        return Promise.reject(new Error("The continuity probe must not invoke a language model."));
      },
      provideTokenCount: () => {
        tokenCountCalls += 1;
        return Promise.resolve(1);
      },
    }),
  );
  const api: ProbeApi = { getState: () => ({
    invocations: [...invocations], bootKey, modelCalls, tokenCountCalls, disposalApi, disposalEvents,
  }) };
  if (process.env.AP_NATIVE_DRIVER === "1") {
    setImmediate(() => {
      void run().catch((error: unknown) => console.error(error))
        .finally(() => vscode.commands.executeCommand("workbench.action.quit"));
    });
  }
  return api;
};
