import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import {
  InMemoryJournal,
  PairCoordinator,
  type EffectPort,
  type EffectRequest,
  type EffectResult,
  type PairCoordinatorPort,
} from "@adaptive-pair/runtime";
import { growthRuntime } from "@adaptive-pair/testkit";
import { beforeEach, vi } from "vitest";
import type { ExtensionContext } from "vscode";

type RegisteredTool = {
  readonly name: string;
  readonly tool: unknown;
};

type WarningCall = {
  readonly message: string;
  readonly items: readonly string[];
};

type FakeDisposable = {
  dispose(): void;
};

type FakeStatusBarItem = {
  text: string;
  tooltip: string | undefined;
  command: string | undefined;
  show(): void;
  hide(): void;
  dispose(): void;
  readonly disposed: boolean;
};

type AdaptivePairExtensionApi = {
  getState(): {
    readonly presenceStatus: string;
    readonly sessionStatus: string;
    readonly runtimeRevision: number;
    readonly observationCount: number;
    readonly documentListenerActive: boolean;
    readonly contextKeys: Readonly<Record<string, unknown>>;
  };
};

type FakeUri = {
  readonly fsPath: string;
  readonly path: string;
  toString(): string;
};

type FakeDiagnostic = {
  readonly fsPath: string;
  readonly message: string;
};

type DocumentListener = (event: {
    readonly document: {
      readonly isDirty: boolean;
      readonly uri: FakeUri;
    };
  }) => void;

function createPairToolHost() {
  const createDisposable = (dispose: () => void): FakeDisposable => ({
    dispose,
  });

  class MarkdownString {
    public value = "";

    public appendText(text: string): this {
      this.value += text;
      return this;
    }
  }

  class LanguageModelTextPart {
    public constructor(public readonly value: string) {}
  }

  class LanguageModelToolResult {
    public constructor(public readonly content: readonly LanguageModelTextPart[]) {}
  }

  class FakeCancellationToken {
    public isCancellationRequested = false;

    public onCancellationRequested(listener: () => void): FakeDisposable {
      return createDisposable(() => {
        void listener;
      });
    }
  }

  const createUri = (path: string): FakeUri => ({
    fsPath: path,
    path,
    toString: () => `file://${path}`,
  });

  const state = {
    commandHandlers: new Map<string, (...args: unknown[]) => unknown>(),
    contextKeys: new Map<string, unknown>(),
    registeredTools: [] as RegisteredTool[],
    chatParticipants: [] as { readonly id: string; readonly handler: unknown }[],
    documentListeners: new Set<DocumentListener>(),
    statusItems: [] as FakeStatusBarItem[],
    workspaceReads: 0,
    modelRequests: 0,
    warnings: [] as WarningCall[],
    warningResponses: [] as string[],
    infoMessages: [] as string[],
    settingsWrites: [] as { readonly section: string; readonly key: string }[],
    workspaceTrusted: true,
    workspaceFolders: [{ uri: createUri("/workspace") }],
    visibleTextEditors: [] as {
      readonly document: {
        readonly uri: FakeUri;
      };
    }[],
    textDocuments: [] as {
      readonly isDirty: boolean;
      readonly uri: FakeUri;
    }[],
    diagnostics: [] as FakeDiagnostic[],
  };

  const reset = (): void => {
    state.commandHandlers.clear();
    state.contextKeys.clear();
    state.registeredTools.length = 0;
    state.chatParticipants.length = 0;
    state.documentListeners.clear();
    state.statusItems.length = 0;
    state.workspaceReads = 0;
    state.modelRequests = 0;
    state.warnings.length = 0;
    state.warningResponses.length = 0;
    state.infoMessages.length = 0;
    state.settingsWrites.length = 0;
    state.workspaceTrusted = true;
    state.workspaceFolders = [{ uri: createUri("/workspace") }];
    state.visibleTextEditors = [];
    state.textDocuments = [];
    state.diagnostics = [];
  };

  const emitDocumentChange = (path: string, isDirty = true): void => {
    const event = {
      document: {
        isDirty,
        uri: createUri(path),
      },
      contentChanges: [
        {
          range: {
            start: { line: 0 },
            end: { line: 0 },
          },
        },
      ],
    };
    for (const listener of state.documentListeners) {
      listener(event);
    }
  };
  return { createDisposable, MarkdownString, LanguageModelTextPart, LanguageModelToolResult, FakeCancellationToken, createUri, state, reset, emitDocumentChange };
}

function createVscodeModule(host: ReturnType<typeof createPairToolHost>) {
  const { createDisposable, MarkdownString, LanguageModelTextPart, LanguageModelToolResult, FakeCancellationToken, createUri, state } = host;
  return {
    MarkdownString,
    LanguageModelTextPart,
    LanguageModelToolResult,
    FakeCancellationToken,
    StatusBarAlignment: {
      Left: 1,
      Right: 2,
    },
    commands: {
      registerCommand: (
        name: string,
        handler: (...args: unknown[]) => unknown,
      ): FakeDisposable => {
        state.commandHandlers.set(name, handler);
        return createDisposable(() => {
          state.commandHandlers.delete(name);
        });
      },
      executeCommand: async (
        name: string,
        ...args: unknown[]
      ): Promise<unknown> => {
        if (name === "setContext") {
          const key = args[0];
          const value = args[1];
          if (typeof key !== "string") {
            throw new Error("setContext requires a string key.");
          }
          state.contextKeys.set(key, value);
          return undefined;
        }

        const handler = state.commandHandlers.get(name);
        if (handler === undefined) {
          throw new Error(`Unknown command: ${name}`);
        }

        return await handler(...args);
      },
    },
    lm: {
      registerTool: (
        name: string,
        tool: unknown,
      ): FakeDisposable => {
        state.registeredTools.push({ name, tool });
        return createDisposable(() => {
          const index = state.registeredTools.findIndex(item => item.name === name);
          if (index >= 0) {
            state.registeredTools.splice(index, 1);
          }
        });
      },
      selectChatModels: (): Promise<readonly unknown[]> => {
        state.modelRequests += 1;
        return Promise.resolve([]);
      },
    },
    chat: {
      createChatParticipant: (
        id: string,
        handler: unknown,
      ): { readonly id: string; dispose(): void } => {
        state.chatParticipants.push({ id, handler });
        return {
          id,
          dispose: () => {
            const index = state.chatParticipants.findIndex(item => item.id === id);
            if (index >= 0) {
              state.chatParticipants.splice(index, 1);
            }
          },
        };
      },
    },
    window: {
      get visibleTextEditors() {
        return state.visibleTextEditors;
      },
      createStatusBarItem: (): FakeStatusBarItem => {
        let disposed = false;
        const item: FakeStatusBarItem = {
          text: "",
          tooltip: undefined,
          command: undefined,
          show: () => undefined,
          hide: () => undefined,
          dispose: () => {
            disposed = true;
          },
          get disposed() {
            return disposed;
          },
        };
        state.statusItems.push(item);
        return item;
      },
      showWarningMessage: (
        message: string,
        ...items: unknown[]
      ): Promise<string | undefined> => {
        const actionItems = items.filter(
          (item): item is string => typeof item === "string",
        );
        state.warnings.push({
          message,
          items: actionItems,
        });
        return Promise.resolve(state.warningResponses.shift() ?? actionItems[0]);
      },
      showInformationMessage: (message: string): Promise<string | undefined> => {
        state.infoMessages.push(message);
        return Promise.resolve(undefined);
      },
    },
    workspace: {
      get isTrusted() {
        return state.workspaceTrusted;
      },
      get workspaceFolders() {
        state.workspaceReads += 1;
        return state.workspaceFolders;
      },
      get textDocuments() {
        state.workspaceReads += 1;
        return state.textDocuments;
      },
      asRelativePath: (value: FakeUri | string): string => {
        const text = typeof value === "string" ? value : value.fsPath;
        return text.replace(/^\/workspace\//, "");
      },
      getWorkspaceFolder: (value: FakeUri): unknown => {
        const path = typeof value === "string" ? value : value.fsPath;
        return path.startsWith("/workspace")
          ? state.workspaceFolders[0]
          : undefined;
      },
      onDidChangeTextDocument: (listener: DocumentListener): FakeDisposable => {
        state.documentListeners.add(listener);
        return createDisposable(() => {
          state.documentListeners.delete(listener);
        });
      },
      getConfiguration: (section = "") => ({
        update: (key: string): Promise<void> => {
          state.settingsWrites.push({ section, key });
          return Promise.resolve();
        },
        inspect: () => undefined,
      }),
    },
    languages: {
      getDiagnostics: (): readonly [FakeUri, readonly { readonly message: string }[]][] => {
        state.workspaceReads += 1;
        return state.diagnostics.map(diagnostic => [
          createUri(diagnostic.fsPath),
          [{ message: diagnostic.message }],
        ]);
      },
    },
  };
}

const fakeVscode = vi.hoisted(() => {
  const host = createPairToolHost();
  return {
    module: createVscodeModule(host),
    state: host.state, reset: host.reset, createUri: host.createUri,
    emitDocumentChange: host.emitDocumentChange,
  };
});


vi.mock("vscode", () => fakeVscode.module);

class EffectPortDouble implements EffectPort {
  public readonly calls: EffectRequest[] = [];

  public constructor(
    private readonly responder:
      | ((request: EffectRequest) => Promise<EffectResult>)
      | ((request: EffectRequest) => EffectResult),
  ) {}

  public execute(
    request: EffectRequest,
    signal: AbortSignal,
  ): Promise<EffectResult> {
    void signal;
    this.calls.push(structuredClone(request));
    return Promise.resolve(this.responder(request));
  }
}

const createPairRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 12,
    session: {
      status: "active",
      mode: "pair",
      learningAgreement: undefined,
      assistance: undefined,
      workUnit: {
        id: "unit-1",
        objective: "Edit the bounded file",
        mode: "pair",
        learningValue: "mixed",
        capability: "implementation",
        owner: "ai",
        allowedPaths: ["src/pair.ts"],
        acceptanceChecks: ["npm test"],
        verificationPlan: "npm test",
        stoppingCondition: "All tests pass",
        baseline: {
          "src/pair.ts": "a".repeat(64),
        },
        status: "agreed",
      },
    },
  });

const createGrowthRuntime = (): PairRuntimeSnapshot =>
  growthRuntime({
    runtimeRevision: 4,
    session: {
      status: "active",
      mode: "growth",
      workUnit: {
        id: "unit-1",
        objective: "Practice without edits",
        mode: "growth",
        learningValue: "high",
        capability: "implementation",
        owner: "human",
        allowedPaths: ["src/pair.ts"],
        acceptanceChecks: ["npm test"],
        verificationPlan: "npm test",
        stoppingCondition: "Practice is complete",
        baseline: {},
        status: "agreed",
      },
    },
  });

const createCoordinator = (
  snapshot: PairRuntimeSnapshot,
  effectPort: EffectPort,
): {
  readonly coordinator: PairCoordinatorPort;
  readonly store: InMemoryJournal;
} => {
  const store = new InMemoryJournal("workspace-1", snapshot);
  let id = 0;
  const coordinator = new PairCoordinator({
    store,
    effects: effectPort,
    clock: {
      now: () => 1000,
    },
    ids: {
      next: (prefix: string) => {
        id += 1;
        return `${prefix}-${id}`;
      },
    },
    streamId: "workspace-1",
  });

  return { coordinator, store };
};

const createContext = (): {
  readonly subscriptions: FakeDisposable[];
} => ({
  subscriptions: [],
});

const asExtensionContext = (
  context: ReturnType<typeof createContext>,
): ExtensionContext => context as unknown as ExtensionContext;

const createToken = (): InstanceType<typeof fakeVscode.module.FakeCancellationToken> =>
  new fakeVscode.module.FakeCancellationToken();

const toolResultText = (result: { readonly content: readonly unknown[] }): string => {
  const first = result.content[0];
  if (typeof first === "object" && first !== null && "value" in first) {
    const value = Reflect.get(first, "value");
    if (typeof value === "string") {
      return value;
    }
  }

  return "{}";
};

const confirmationText = (
  message: string | InstanceType<typeof fakeVscode.module.MarkdownString> | undefined,
): string => {
  if (message === undefined) {
    return "";
  }

  return typeof message === "string" ? message : message.value;
};

const parseToolPayload = (
  result: { readonly content: readonly unknown[] },
): Record<string, unknown> =>
  JSON.parse(toolResultText(result)) as Record<string, unknown>;

beforeEach(() => {
  fakeVscode.reset();
  vi.resetModules();
});

export { EffectPortDouble,asExtensionContext,confirmationText,createContext,createCoordinator,createGrowthRuntime,createPairRuntime,createToken,fakeVscode,parseToolPayload,toolResultText,type AdaptivePairExtensionApi,type FakeDiagnostic,type FakeDisposable,type FakeStatusBarItem,type FakeUri,type RegisteredTool,type WarningCall };
