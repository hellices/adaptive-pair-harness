import * as vscode from "vscode";
import {
  apiKeySecretNameForEndpoint,
  canonicalEndpointOrigin,
  readPairConfig,
} from "./config/pairConfig";
import { PairMemoryStore } from "./core/memoryStore";
import type { KeyValueStore } from "./core/memoryStore";
import type { PairRange } from "./core/types";
import { TokenBudget } from "./core/tokenBudget";
import {
  PairSharedContext,
  registerPairChatParticipant,
} from "./vscode/pairChatParticipant";
import type { PairSymbolContextProvider } from "./vscode/pairChatParticipant";
import { PairRuntime } from "./vscode/pairRuntime";
import {
  createPairSessionCommandHandlers,
  createRuntimeAfterSecretLookup,
  rebuildRuntimeAfterDisposal,
} from "./vscode/pairRuntimeSupport";
import { mapLanguageModelAccessKind } from "./vscode/languageModelAccess";
import type { LanguageModelAccessKindValues } from "./vscode/languageModelAccess";
import type {
  CopilotModelReference,
  VsCodeLanguageModelApi,
  VsCodeRequestCancellation,
} from "./vscode/vsCodeLanguageModelProvider";
import { createVsCodeChatResponse } from "./vscode/vsCodeChatResponse";
import { findCurrentSymbol } from "./vscode/symbolContext";
import { createWorkingCommandHandlers } from "./vscode/workingCommands";
import { PairAgentSession, type PairAgentFocusedFile } from "./vscode/pairAgentSession";
import { createPairAgentModel } from "./vscode/pairAgentModel";
import { createPairWorkspaceTools } from "./vscode/pairWorkspaceTools";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const sharedContext = new PairSharedContext({
    enabled: true,
    active: false,
    generation: 0,
    goal: "Goal not confirmed — start Pair and use @pair /plan.",
    role: "navigator",
    provider: "local-template",
    remainingCalls: 0,
    remainingInputTokens: 0,
    remainingOutputTokens: 0,
    controlNotice: undefined,
    configurationWarning: undefined,
  });
  const languageModelApi = createLanguageModelApi(context);
  const memoryBackend: KeyValueStore = {
    get: async <T>(key: string): Promise<T | undefined> =>
      context.globalState.get<T>(key),
    update: async <T>(key: string, value: T): Promise<void> =>
      context.globalState.update(key, value),
  };
  const memoryStore = new PairMemoryStore({
    repositoryId:
      vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? "no-workspace",
    store: memoryBackend,
  });
  let runtime: PairRuntime | undefined;
  let sharedBudget: TokenBudget | undefined;
  let extensionDisposed = false;
  let rebuildQueue = Promise.resolve();

  const rebuildNow = async (): Promise<void> => {
    const previous = runtime;
    await rebuildRuntimeAfterDisposal(
      previous,
      async () => {
        const config = readPairConfig(
          vscode.workspace.getConfiguration("adaptivePair"),
        );
        if (sharedBudget === undefined) {
          sharedBudget = new TokenBudget(config.budget);
        } else {
          sharedBudget.reconfigure(config.budget);
        }
        const budget = sharedBudget;
        return createRuntimeAfterSecretLookup<PairRuntime>(
          () =>
            config.provider === "openai-compatible" &&
            config.baseUrl !== undefined
              ? context.secrets.get(
                  apiKeySecretNameForEndpoint(config.baseUrl),
                )
              : Promise.resolve(undefined),
          () => extensionDisposed,
          (apiKey) =>
            new PairRuntime({
              config,
              extensionContext: context,
              sharedContext,
              languageModelApi,
              apiKey,
              budget,
              budgetFollowsInterventionStyle: true,
              memoryStore,
            }),
        );
      },
      (next) => {
        runtime = next;
      },
      () => !extensionDisposed && runtime === undefined,
    );
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

  const requireRuntime = (): PairRuntime => {
    if (runtime === undefined) {
      throw new Error("Adaptive Pair runtime is rebuilding. Try again in a moment.");
    }
    return runtime;
  };

  let agentRuntime: PairRuntime | undefined;
  let workspaceAgent: PairAgentSession | undefined;
  const requireWorkspaceAgent = (): PairAgentSession => {
    const activeRuntime = requireRuntime();
    if (workspaceAgent === undefined || agentRuntime !== activeRuntime) {
      workspaceAgent?.dispose();
      agentRuntime = activeRuntime;
      workspaceAgent = new PairAgentSession({
        snapshot: () => sharedContext.snapshot(),
        isTrusted: () => runtime === activeRuntime && vscode.workspace.isTrusted,
        createModel: createPairAgentModel,
        createTools: (rootUri, isCurrent) => createPairWorkspaceTools({ rootUri: vscode.Uri.parse(rootUri), isCurrent }),
        focusedFiles: focusedFilesForPair,
        approveWorkspace: async (destination, rootUri, signal) => {
          signal.throwIfAborted();
          const choice = await vscode.window.showInformationMessage(
            "Allow the selected Chat model to inspect this project for pairing?",
            {
              modal: true,
              detail: `Model: ${destination}\nWorkspace: ${vscode.Uri.parse(rootUri).fsPath}\n\nPair can send bounded document/source excerpts and same-scope dialogue to this model and use read/search tools. Each file edit still needs a reviewed diff and Apply and save confirmation; each validation run needs separate approval. Access is scoped to this session, goal/context epoch and exact model. Use @pair /access to revoke it. Background navigator sharing is unchanged.`,
            },
            "Allow workspace context",
          );
          signal.throwIfAborted();
          return choice === "Allow workspace context";
        },
        onComplete: (conversationId, prompt, phase) => {
          if (!activeRuntime.completeAgentTurn(conversationId, prompt, phase)) {
            throw new Error("The working session changed before this response could be recorded.");
          }
        },
      });
    }
    return workspaceAgent;
  };

  const participant = registerPairChatParticipant(
    (id, handler) =>
      vscode.chat.createChatParticipant(
        id,
        (request, chatContext, response, token) =>
          handler(
            request,
            chatContext,
            createVsCodeChatResponse(response),
            token,
          ),
      ),
    {
      captureRuntimeFence: () => sharedContext.captureRuntimeFence(),
      captureRevisionFence: () => sharedContext.captureRevisionFence(),
      isRevisionFenceCurrent: (fence) =>
        sharedContext.isRevisionFenceCurrent(fence),
      snapshot: () => {
        runtime?.refreshSession();
        return sharedContext.snapshot();
      },
    },
    {
      generate: async (
        uri,
        goal,
        evidence,
        signal,
        requestContext,
        purpose,
        revisionFence,
      ) => {
        const activeRuntime = runtime;
        if (activeRuntime === undefined) {
          throw new Error("Adaptive Pair runtime is rebuilding.");
        }
        return activeRuntime.generate(
          uri,
          goal,
          evidence,
          signal,
          requestContext,
          purpose,
          revisionFence,
        );
      },
    },
    {
      workspaceAgent: {
        enabled: () => runtime?.isWorkspaceAgentEnabled() === true,
        run: (request, chatContext, response, signal) => requireWorkspaceAgent().run(request, chatContext, response, signal),
      },
      workingControl: {
        setGoal: (prompt, signal) => requireRuntime().setWorkingGoal(prompt, signal),
        refreshContext: (signal) => requireRuntime().refreshProjectContext(signal),
        draftBrief: (signal) => requireRuntime().draftWorkingAgreement(signal),
        recordDecision: (prompt, signal) => requireRuntime().recordWorkingDecision(prompt, signal),
      },
      symbolContextProvider: createSymbolContextProvider(),
      sessionControl: {
        isSessionActive: () => runtime?.isSessionActive() ?? false,
        startSession: async () => {
          const activeRuntime = runtime;
          if (activeRuntime === undefined) {
            return {
              kind: "already-stopped",
              active: false,
              message:
                "Adaptive Pair runtime is rebuilding. Try again in a moment.",
            };
          }
          return activeRuntime.startSession();
        },
        stopSession: () => {
          const activeRuntime = runtime;
          if (activeRuntime === undefined) {
            return {
              kind: "already-stopped",
              active: false,
              message:
                "Adaptive Pair runtime is rebuilding. Try again in a moment.",
            };
          }
          return activeRuntime.stopSession();
        },
      },
      requestLifecycle: {
        register: (uri, request) => {
          const activeRuntime = runtime;
          if (activeRuntime === undefined) {
            request.abort();
            return { dispose: () => undefined };
          }
          return activeRuntime.registerChatRequest(uri, request);
        },
      },
      isOfficialCancellationError: isOfficialVsCodeCancellationError,
    },
  );

  const sessionHandlers = createPairSessionCommandHandlers(
    () => runtime,
    (message) => vscode.window.showInformationMessage(message),
  );
  const startSession = vscode.commands.registerCommand(
    "adaptivePair.startSession",
    sessionHandlers.start,
  );
  const stopSession = vscode.commands.registerCommand(
    "adaptivePair.stopSession",
    sessionHandlers.stop,
  );
  const toggle = vscode.commands.registerCommand(
    "adaptivePair.toggle",
    sessionHandlers.toggle,
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
      const config = readPairConfig(
        vscode.workspace.getConfiguration("adaptivePair"),
      );
      if (config.baseUrl === undefined) {
        await vscode.window.showWarningMessage(
          "Set a valid, safe application-level adaptivePair.model.baseUrl before storing a key.",
        );
        return;
      }
      const origin = canonicalEndpointOrigin(config.baseUrl);
      const apiKey = await vscode.window.showInputBox({
        ignoreFocusOut: true,
        password: true,
        prompt: `API key for ${origin} (leave empty to remove this origin's key)`,
        title: `Adaptive Pair · ${origin}`,
      });
      if (apiKey === undefined) {
        return;
      }
      const secretName = apiKeySecretNameForEndpoint(config.baseUrl);
      if (apiKey.trim().length === 0) {
        await context.secrets.delete(secretName);
      } else {
        await context.secrets.store(secretName, apiKey.trim());
      }
      await rebuild().catch(reportRuntimeError);
    },
  );
  const resetMemory = vscode.commands.registerCommand(
    "adaptivePair.resetMemory",
    async () => {
      const activeRuntime = runtime;
      if (activeRuntime === undefined) {
        await vscode.window.showWarningMessage(
          "Adaptive Pair runtime is rebuilding. Try again in a moment.",
        );
        return;
      }
      await activeRuntime.resetMemory();
    },
  );
  const dismissCurrentEvidence = vscode.commands.registerCommand(
    "adaptivePair.dismissCurrentEvidence",
    async () => {
      const activeRuntime = runtime;
      if (activeRuntime === undefined) {
        await vscode.window.showWarningMessage(
          "Adaptive Pair runtime is rebuilding. Try again in a moment.",
        );
        return;
      }
      const result = await activeRuntime.dismissCurrentEvidence();
      await vscode.window.showInformationMessage(result.message);
    },
  );
  const approveCurrentEvidence = vscode.commands.registerCommand(
    "adaptivePair.approveCurrentEvidence",
    async () => {
      const activeRuntime = runtime;
      if (activeRuntime === undefined) {
        await vscode.window.showWarningMessage(
          "Adaptive Pair runtime is rebuilding. Try again in a moment.",
        );
        return;
      }
      const result = await activeRuntime.approveCurrentEvidence();
      await vscode.window.showInformationMessage(result.message);
    },
  );
  const setInterventionStyle = vscode.commands.registerCommand(
    "adaptivePair.setInterventionStyle",
    async () => {
      const selected = await vscode.window.showQuickPick(
        [
          {
            label: "Eco",
            description: "Only the highest-confidence evidence",
            value: "eco" as const,
          },
          {
            label: "Balanced",
            description: "Moderate evidence threshold and budget",
            value: "balanced" as const,
          },
          {
            label: "Active",
            description: "More frequent evidence-backed interventions",
            value: "active" as const,
          },
        ],
        {
          title: "Adaptive Pair intervention style",
          placeHolder: "Choose a style to persist in local Pair memory",
        },
      );
      if (selected === undefined) {
        return;
      }
      const activeRuntime = runtime;
      if (activeRuntime === undefined) {
        await vscode.window.showWarningMessage(
          "Adaptive Pair runtime is rebuilding. Try again in a moment.",
        );
        return;
      }
      const result = await activeRuntime.setInterventionStyle(selected.value);
      await vscode.window.showInformationMessage(result.message);
    },
  );
  const configurationListener = vscode.workspace.onDidChangeConfiguration(
    (event) => {
      if (event.affectsConfiguration("adaptivePair")) {
        void rebuild().catch(reportRuntimeError);
      }
    },
  );

  const workingCommands = createWorkingCommandHandlers(
    () => runtime,
    (message) => vscode.window.showInformationMessage(message),
  ).map((command) => vscode.commands.registerCommand(command.id, command.run));

  context.subscriptions.push(
    participant,
    startSession,
    stopSession,
    toggle,
    reviewCurrentBlock,
    setApiKey,
    resetMemory,
    dismissCurrentEvidence,
    approveCurrentEvidence,
    setInterventionStyle,
    configurationListener,
    ...workingCommands,
    {
      dispose: () => {
        extensionDisposed = true;
        workspaceAgent?.dispose();
        runtime?.dispose();
        runtime = undefined;
      },
    },
  );

  await rebuild();
}

const focusedFilesForPair = (request: vscode.ChatRequest, rootUri: string): readonly PairAgentFocusedFile[] => {
  const root = vscode.Uri.parse(rootUri);
  const files: PairAgentFocusedFile[] = [];
  const add = (uri: vscode.Uri, range?: vscode.Range): void => {
    if (vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() !== rootUri) {
      return;
    }
    const path = uri.path.slice(root.path.replace(/\/+$/u, "").length + 1);
    if (path.length === 0 || path.startsWith("/") || path.split("/").some((segment) => segment === ".." || segment === ".")) {
      return;
    }
    if (!files.some((file) => file.path === path)) {
      files.push({ path, ...(range === undefined ? {} : { startLine: range.start.line + 1, endLine: range.end.line + 1 }) });
    }
  };
  for (const reference of request.references ?? []) {
    if (reference.value instanceof vscode.Uri) {
      add(reference.value);
    } else if (reference.value instanceof vscode.Location) {
      add(reference.value.uri, reference.value.range);
    }
  }
  const editor = vscode.window.activeTextEditor;
  if (editor !== undefined) {
    add(editor.document.uri, editor.selection);
  }
  return files.slice(0, 8);
};

const createLanguageModelApi = (
  context: vscode.ExtensionContext,
): VsCodeLanguageModelApi => {
  const languageModelAccessKinds = (
    vscode as unknown as {
      readonly LanguageModelAccessKind?: LanguageModelAccessKindValues;
    }
  ).LanguageModelAccessKind ?? {
    Allowed: true,
    Disallowed: false,
    NeedsConsent: undefined,
  };
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
        return false;
      }
      return mapLanguageModelAccessKind(
        context.languageModelAccessInformation.canSendRequest(model),
        languageModelAccessKinds,
      );
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
    classifyError: (error) => {
      if (isOfficialVsCodeCancellationError(error)) {
        return "cancelled";
      }
      if (!(error instanceof vscode.LanguageModelError)) {
        return "unknown";
      }
      if (error.code === vscode.LanguageModelError.NoPermissions.name) {
        return "no-permissions";
      }
      if (error.code === vscode.LanguageModelError.NotFound.name) {
        return "not-found";
      }
      if (error.code === vscode.LanguageModelError.Blocked.name) {
        return "blocked";
      }
      return "unknown";
    },
    countTokens: async (modelReference, text, cancellation) => {
      const model = nativeModels.get(modelReference);
      if (model === undefined) {
        throw new Error("Selected GitHub Copilot model is no longer available.");
      }
      const source = nativeCancellationSources.get(cancellation);
      if (source === undefined) {
        throw new Error("GitHub Copilot request cancellation source is unavailable.");
      }
      return model.countTokens(text, source.token);
    },
    sendRequest: async (
      modelReference,
      prompt,
      cancellation,
      maxOutputTokens,
    ) => {
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
          modelOptions: {
            max_tokens: maxOutputTokens,
          },
        },
        source.token,
      );
      return response.text;
    },
  };
};

const createSymbolContextProvider = (): PairSymbolContextProvider => ({
  forEvidence: async (uri, range, signal) => {
    signal.throwIfAborted();
    const document = vscode.workspace.textDocuments.find(
      (candidate) => candidate.uri.toString() === uri,
    );
    if (document === undefined) {
      return undefined;
    }
    const symbols = await vscode.commands.executeCommand<
      readonly (vscode.DocumentSymbol | vscode.SymbolInformation)[] | undefined
    >("vscode.executeDocumentSymbolProvider", document.uri);
    signal.throwIfAborted();
    if (symbols === undefined) {
      return undefined;
    }
    const evidence = evidenceRange(document, range);
    return findCurrentSymbol(symbols, document.uri, evidence.start, evidence.end);
  },
});

const evidenceRange = (
  document: vscode.TextDocument,
  range: PairRange,
): vscode.Range =>
  new vscode.Range(
    evidencePosition(document, range.start),
    evidencePosition(document, range.end),
  );

const evidencePosition = (
  document: vscode.TextDocument,
  position: PairRange["start"],
): vscode.Position => {
  const line = Math.min(
    Math.max(position.line, 0),
    Math.max(document.lineCount - 1, 0),
  );
  const character = Math.min(
    Math.max(position.character, 0),
    document.lineAt(line).text.length,
  );
  return new vscode.Position(line, character);
};

const isOfficialVsCodeCancellationError = (error: unknown): boolean =>
  error instanceof vscode.CancellationError ||
  (error instanceof vscode.LanguageModelError &&
    error.cause instanceof vscode.CancellationError);

export function deactivate(): void {}
