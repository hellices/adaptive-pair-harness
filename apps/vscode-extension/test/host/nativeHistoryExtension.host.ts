import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { createExtensionRuntime } from "../../src/extensionCore.js";
import { inspectNativeHistory } from "../../src/nativeCheckpoint.js";
import type { GrowthSetupStage } from "../../src/growthSetup.js";
import { runNativeHistoryDriver } from "./nativeHistoryDriver.js";
import type { NativeHistoryApi, NativeHistoryInvocation } from "./nativeHistoryContracts.js";

const diagnosticResource = (request: vscode.ChatRequest): string => {
  const diagnostic = request as vscode.ChatRequest & { readonly sessionResource?: vscode.Uri };
  const resource = diagnostic.sessionResource?.toString();
  if (!resource) { throw new Error("The test-only native sessionResource diagnostic is unavailable."); }
  return resource;
};

const observeHandler = (
  runtime: ReturnType<typeof createExtensionRuntime>, invocations: NativeHistoryInvocation[],
): void => {
  const original = runtime.growthParticipant.handle.bind(runtime.growthParticipant);
  runtime.growthParticipant.handle = async (request, context, response, token) => {
    const before = runtime.sessionController.snapshotNow();
    const history = inspectNativeHistory(context.history);
    const resource = diagnosticResource(request);
    const emitted: string[] = [];
    const observed: vscode.ChatResponseStream = {
      ...response,
      markdown: value => {
        emitted.push(typeof value === "string" ? value : value.value);
        response.markdown(value);
        return observed;
      },
    };
    const result = await original(request, context, observed, token);
    invocations.push({ command: request.command, resource, history, result, emitted, before,
      after: runtime.sessionController.snapshotNow() });
    return result;
  };
};

export const activate = (context: vscode.ExtensionContext): NativeHistoryApi => {
  if (context.extensionMode === vscode.ExtensionMode.Production || process.env.ADAPTIVE_PAIR_NATIVE_HISTORY_TEST !== "1") {
    throw new Error("The native history fixture requires a flagged development extension host.");
  }
  const invocations: NativeHistoryInvocation[] = [];
  const setupConfirmations: { stage: GrowthSetupStage; accepted: boolean }[] = [];
  let declinedMode = false;
  let checkpointConfirmations = 0;
  let verificationConfirmations = 0;
  let modelCalls = 0;
  let tokenCountCalls = 0;
  const runtime = createExtensionRuntime(context, {
    confirmation: { confirm: (request, signal) => {
      void request;
      verificationConfirmations += 1;
      return Promise.resolve(!signal.aborted);
    } },
    growthSetupUi: {
      collect: () => Promise.resolve({ objective: "Fix the retry boundary", allowedPath: "src/retry.mjs",
        independentCheck: "Try a changed retry limit independently", verificationPlan: "npm test" }),
      confirm: (stage, description, signal) => {
        void description;
        const accepted = !signal.aborted && (stage !== "mode" || declinedMode);
        if (stage === "mode") { declinedMode = true; }
        setupConfirmations.push({ stage, accepted });
        return Promise.resolve(accepted);
      },
    },
    confirmCheckpoint: signal => {
      checkpointConfirmations += 1;
      return Promise.resolve(!signal.aborted && checkpointConfirmations === 2);
    },
  });
  observeHandler(runtime, invocations);
  context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider("adaptive-pair-native-history-fixture", {
    provideLanguageModelChatInformation: () => [{ id: "offline", name: "Adaptive Pair Offline Host Fixture",
      family: "native-history-fixture", version: "1", maxInputTokens: 4096, maxOutputTokens: 1024,
      capabilities: { toolCalling: false } }],
    provideLanguageModelChatResponse: () => {
      modelCalls += 1;
      return Promise.reject(new Error("Native checkpoint routes must not call a model."));
    },
    provideTokenCount: () => { tokenCountCalls += 1; return Promise.resolve(1); },
  }));
  const api: NativeHistoryApi = {
    bootId: randomUUID(), snapshot: () => runtime.sessionController.snapshotNow(), activity: () => runtime.ledger.snapshot(),
    invocations: () => [...invocations],
    metrics: () => ({ modelCalls, tokenCountCalls, setupConfirmations: [...setupConfirmations],
      checkpointConfirmations, verificationConfirmations }),
  };
  setImmediate(() => {
    void runNativeHistoryDriver(api, context).catch((error: unknown) => console.error(error))
      .finally(() => vscode.commands.executeCommand("workbench.action.quit"));
  });
  return api;
};
