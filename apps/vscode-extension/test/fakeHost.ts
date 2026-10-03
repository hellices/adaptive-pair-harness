import type { JournalFileSystem } from "../src/storageAdapter.js";

/**
 * Shared in-memory VS Code host for extension unit tests.
 *
 * Load it through `await vi.hoisted(async () => await import("./fakeHost.js"))`
 * so one host instance backs the `vscode` mock for the whole test file.
 *
 * Modal warnings DISMISS by default: a test that needs the developer to accept
 * must push the exact action label onto `state.warningResponses` first.
 */

type FakeDisposable = {
  dispose(): void;
};

type FakeUri = {
  readonly fsPath: string;
  readonly path: string;
  toString(): string;
};

type RegisteredTool = {
  readonly name: string;
  readonly tool: unknown;
};

type WarningCall = {
  readonly message: string;
  readonly items: readonly string[];
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

type FakeDiagnostic = {
  readonly fsPath: string;
  readonly message: string;
};

type DocumentChangeEvent = {
  readonly document: {
    readonly isDirty: boolean;
    readonly uri: FakeUri;
    readonly version: number;
    readonly languageId: string;
  };
  readonly contentChanges: readonly {
    readonly range: {
      readonly start: { readonly line: number };
      readonly end: { readonly line: number };
    };
  }[];
};

type DocumentListener = (event: DocumentChangeEvent) => void;

type DocumentChangeOptions = {
  readonly isDirty?: boolean;
  readonly version?: number;
  readonly languageId?: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly contentChanges?: boolean;
};

const createDisposable = (dispose: () => void): FakeDisposable => ({ dispose });

const createUri = (fsPath: string): FakeUri => ({
  fsPath,
  path: fsPath,
  toString: () => `file://${fsPath}`,
});

const createHostState = () => ({
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
  visibleTextEditors: [] as { readonly document: { readonly uri: FakeUri } }[],
  textDocuments: [] as { readonly isDirty: boolean; readonly uri: FakeUri }[],
  diagnostics: [] as FakeDiagnostic[],
});

type FakeHostState = ReturnType<typeof createHostState>;

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

const createStatusBarItem = (state: FakeHostState): FakeStatusBarItem => {
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
};

const removeByKey = <T>(items: T[], matches: (item: T) => boolean): void => {
  const index = items.findIndex(matches);
  if (index >= 0) {
    items.splice(index, 1);
  }
};

const createVscodeModule = (state: FakeHostState) => ({
  MarkdownString,
  LanguageModelTextPart,
  LanguageModelToolResult,
  FakeCancellationToken,
  StatusBarAlignment: { Left: 1, Right: 2 },
  commands: {
    registerCommand: (name: string, handler: (...args: unknown[]) => unknown): FakeDisposable => {
      state.commandHandlers.set(name, handler);
      return createDisposable(() => {
        state.commandHandlers.delete(name);
      });
    },
    executeCommand: async (name: string, ...args: unknown[]): Promise<unknown> => {
      if (name === "setContext") {
        const key = args[0];
        if (typeof key !== "string") {
          throw new Error("setContext requires a string key.");
        }
        state.contextKeys.set(key, args[1]);
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
    registerTool: (name: string, tool: unknown): FakeDisposable => {
      state.registeredTools.push({ name, tool });
      return createDisposable(() => removeByKey(state.registeredTools, item => item.name === name));
    },
    selectChatModels: (): Promise<readonly unknown[]> => {
      state.modelRequests += 1;
      return Promise.resolve([]);
    },
  },
  chat: {
    createChatParticipant: (id: string, handler: unknown): { readonly id: string; dispose(): void } => {
      state.chatParticipants.push({ id, handler });
      return {
        id,
        dispose: () => removeByKey(state.chatParticipants, item => item.id === id),
      };
    },
  },
  window: {
    get visibleTextEditors() {
      return state.visibleTextEditors;
    },
    createStatusBarItem: (): FakeStatusBarItem => createStatusBarItem(state),
    showWarningMessage: (message: string, ...items: unknown[]): Promise<string | undefined> => {
      const actionItems = items.filter((item): item is string => typeof item === "string");
      state.warnings.push({ message, items: actionItems });
      // Like VS Code, a modal can only resolve to one of its offered actions.
      const response = state.warningResponses.shift();
      return Promise.resolve(response !== undefined && actionItems.includes(response) ? response : undefined);
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
      return text.replace(/^\/workspace\//u, "");
    },
    getWorkspaceFolder: (value: FakeUri): unknown =>
      value.fsPath.startsWith("/workspace") ? state.workspaceFolders[0] : undefined,
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
  extensions: {
    getExtension: (): undefined => undefined,
  },
});

export const createFakeVscodeHost = () => {
  const state = createHostState();

  const reset = (): void => {
    Object.assign(state, createHostState());
  };

  const emitChange = (fsPath: string, options: DocumentChangeOptions = {}): void => {
    const event: DocumentChangeEvent = {
      document: {
        isDirty: options.isDirty ?? true,
        uri: createUri(fsPath),
        version: options.version ?? 2,
        languageId: options.languageId ?? "typescript",
      },
      contentChanges: options.contentChanges === false
        ? []
        : [{ range: { start: { line: options.startLine ?? 0 }, end: { line: options.endLine ?? 0 } } }],
    };
    for (const listener of state.documentListeners) {
      listener(event);
    }
  };

  return { module: createVscodeModule(state), state, reset, createUri, emitChange };
};

/** In-memory journal filesystem that records the mutating operations it receives. */
export class MemoryFs implements JournalFileSystem {
  public readonly operations: string[] = [];
  public readonly files = new Map<string, string>();
  public writes = 0;
  public removes = 0;
  public writeError: Error | undefined;

  public ensureDir(dir: string): Promise<void> {
    this.operations.push(`ensureDir:${dir}`);
    return Promise.resolve();
  }

  public readFile(path: string): Promise<string | undefined> {
    return Promise.resolve(this.files.get(path));
  }

  public writeFile(path: string, data: string): Promise<void> {
    if (this.writeError !== undefined) {
      return Promise.reject(this.writeError);
    }
    this.operations.push(`writeFile:${path}`);
    this.writes += 1;
    this.files.set(path, data);
    return Promise.resolve();
  }

  public fsync(path: string): Promise<void> {
    this.operations.push(`fsync:${path}`);
    return Promise.resolve();
  }

  public rename(from: string, to: string): Promise<void> {
    this.operations.push(`rename:${from}->${to}`);
    const data = this.files.get(from);
    if (data !== undefined) {
      this.files.set(to, data);
      this.files.delete(from);
    }
    return Promise.resolve();
  }

  public remove(path: string): Promise<void> {
    this.operations.push(`remove:${path}`);
    this.removes += 1;
    this.files.delete(path);
    return Promise.resolve();
  }
}

