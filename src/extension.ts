import * as vscode from "vscode";
import { readPairConfig } from "./config/pairConfig";
import { PairSharedContext, registerPairChatParticipant } from "./vscode/pairChatParticipant";
import { PairRuntime } from "./vscode/pairRuntime";
import type {
  CopilotModelReference,
  VsCodeLanguageModelApi,
  VsCodeRequestCancellation,
} from "./vscode/vsCodeLanguageModelProvider";

const API_KEY_SECRET = "adaptivePair.openaiCompatibleApiKey";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const sharedContext = new PairSharedContext({
    goal: "Navigate with concise, evidence-backed, ask-first questions.",
    role: "navigator",
    provider: "local-template",
    remainingCalls: 0,
    remainingInputTokens: 0,
    controlNotice: undefined,
  });
  const languageModelApi = createLanguageModelApi(context);
  let runtime: PairRuntime | undefined;
  let extensionDisposed = false;
  let rebuildQueue = Promise.resolve();

  const rebuildNow = async (): Promise<void> => {
    const previous = runtime;
    runtime = undefined;
    previous?.dispose();

    const config = readPairConfig(
      vscode.workspace.getConfiguration("adaptivePair"),
    );
    const apiKey = await context.secrets.get(API_KEY_SECRET);
    const next = new PairRuntime({
      config,
      extensionContext: context,
      sharedContext,
      languageModelApi,
      apiKey,
    });
    runtime = next;
    await next.start();
    if (extensionDisposed || runtime !== next) {
      next.dispose();
    }
  };

  const rebuild = (): Promise<void> => {
    const work = rebuildQueue.then(rebuildNow, rebuildNow);
    rebuildQueue = work.then(
      () => undefined,
      () => undefined,
    );
    return work;
  };

  const reportRuntimeError = async (error: unknown): Promise<void> => {
    if (!(error instanceof Error)) {
      throw error;
    }
    await vscode.window.showErrorMessage(
      `Adaptive Pair runtime failed: ${error.message}`,
    );
  };

  const participant = registerPairChatParticipant(
    (id, handler) => vscode.chat.createChatParticipant(id, handler),
    sharedContext,
    {
      generate: async (goal, evidence, signal) => {
        const activeRuntime = runtime;
        if (activeRuntime === undefined) {
          throw new Error("Adaptive Pair runtime is rebuilding.");
        }
        return activeRuntime.generate(goal, evidence, signal);
      },
    },
  );

  const toggle = vscode.commands.registerCommand(
    "adaptivePair.toggle",
    async () => {
      const configuration = vscode.workspace.getConfiguration("adaptivePair");
      const current = configuration.get<boolean>("enabled", true);
      await configuration.update(
        "enabled",
        !current,
        vscode.ConfigurationTarget.Workspace,
      );
    },
  );
  const reviewCurrentBlock = vscode.commands.registerCommand(
    "adaptivePair.reviewCurrentBlock",
    async () => {
      const activeRuntime = runtime;
      if (activeRuntime === undefined) {
        await vscode.window.showWarningMessage(
          "Adaptive Pair runtime is rebuilding. Try again in a moment.",
        );
        return;
      }
      await activeRuntime.reviewCurrentBlock();
    },
  );
  const setApiKey = vscode.commands.registerCommand(
    "adaptivePair.setApiKey",
    async () => {
      const apiKey = await vscode.window.showInputBox({
        ignoreFocusOut: true,
        password: true,
        prompt:
          "OpenAI-compatible API key (leave empty to remove the stored key)",
        title: "Adaptive Pair",
      });
      if (apiKey === undefined) {
        return;
      }
      if (apiKey.trim().length === 0) {
        await context.secrets.delete(API_KEY_SECRET);
      } else {
        await context.secrets.store(API_KEY_SECRET, apiKey.trim());
      }
      await rebuild().catch(reportRuntimeError);
    },
  );
  const configurationListener = vscode.workspace.onDidChangeConfiguration(
    (event) => {
      if (event.affectsConfiguration("adaptivePair")) {
        void rebuild().catch(reportRuntimeError);
      }
    },
  );

  context.subscriptions.push(
    participant,
    toggle,
    reviewCurrentBlock,
    setApiKey,
    configurationListener,
    {
      dispose: () => {
        extensionDisposed = true;
        runtime?.dispose();
        runtime = undefined;
      },
    },
  );

  await rebuild();
}

const createLanguageModelApi = (
  context: vscode.ExtensionContext,
): VsCodeLanguageModelApi => {
  const nativeModels = new WeakMap<
    CopilotModelReference,
    vscode.LanguageModelChat
  >();
  const nativeCancellationSources = new WeakMap<
    VsCodeRequestCancellation,
    vscode.CancellationTokenSource
  >();

  return {
    selectChatModels: async () => {
      const selected = await vscode.lm.selectChatModels({ vendor: "copilot" });
      return selected.map((model) => {
        const reference: CopilotModelReference = {
          id: model.id,
          name: model.name,
        };
        nativeModels.set(reference, model);
        return reference;
      });
    },
    canSendRequest: (modelReference) => {
      const model = nativeModels.get(modelReference);
      if (model === undefined) {
        return undefined;
      }
      return context.languageModelAccessInformation.canSendRequest(model);
    },
    createCancellationTokenSource: () => {
      const source = new vscode.CancellationTokenSource();
      const handle: VsCodeRequestCancellation = {
        cancel: () => {
          source.cancel();
        },
        dispose: () => {
          nativeCancellationSources.delete(handle);
          source.dispose();
        },
      };
      nativeCancellationSources.set(handle, source);
      return handle;
    },
    sendRequest: async (modelReference, prompt, cancellation) => {
      const model = nativeModels.get(modelReference);
      if (model === undefined) {
        throw new Error("Selected GitHub Copilot model is no longer available.");
      }
      const source = nativeCancellationSources.get(cancellation);
      if (source === undefined) {
        throw new Error("GitHub Copilot request cancellation source is unavailable.");
      }
      const response = await model.sendRequest(
        [vscode.LanguageModelChatMessage.User(prompt)],
        {
          justification:
            "Generate navigator-only guidance from structured editor evidence.",
        },
        source.token,
      );
      return response.text;
    },
  };
};

export function deactivate(): void {}
