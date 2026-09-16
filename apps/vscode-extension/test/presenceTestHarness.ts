import { afterEach, vi } from "vitest";
import type { Scheduler } from "@adaptive-pair/evidence";
import type { JournalFileSystem } from "../src/storageAdapter.js";

interface FakeUri {
  readonly fsPath: string;
  readonly path: string;
  toString(): string;
}

interface FakeDisposable {
  dispose(): void;
}

interface DocumentChangeEvent {
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
}

type DocumentListener = (event: DocumentChangeEvent) => void;

const harness = vi.hoisted(() => {
  const createUri = (fsPath: string): FakeUri => ({
    fsPath,
    path: fsPath,
    toString: () => `file://${fsPath}`,
  });

  const state = {
    commandHandlers: new Map<string, (...args: unknown[]) => unknown>(),
    documentListeners: new Set<DocumentListener>(),
    contextKeys: new Map<string, unknown>(),
    warnings: [] as string[],
    warningResponses: [] as string[],
    infoMessages: [] as string[],
    statusText: "",
    workspaceTrusted: true,
    workspaceFolders: [{ uri: createUri("/workspace") }],
    textDocuments: [] as unknown[],
  };

  const reset = (): void => {
    state.commandHandlers.clear();
    state.documentListeners.clear();
    state.contextKeys.clear();
    state.warnings.length = 0;
    state.warningResponses.length = 0;
    state.infoMessages.length = 0;
    state.statusText = "";
    state.workspaceTrusted = true;
    state.workspaceFolders = [{ uri: createUri("/workspace") }];
    state.textDocuments = [];
  };

  const emitChange = (
    fsPath: string,
    options: {
      readonly isDirty?: boolean;
      readonly version?: number;
      readonly languageId?: string;
      readonly startLine?: number;
      readonly endLine?: number;
      readonly contentChanges?: boolean;
    } = {},
  ): void => {
    const event: DocumentChangeEvent = {
      document: {
        isDirty: options.isDirty ?? true,
        uri: createUri(fsPath),
        version: options.version ?? 2,
        languageId: options.languageId ?? "typescript",
      },
      contentChanges:
        options.contentChanges === false
          ? []
          : [
              {
                range: {
                  start: { line: options.startLine ?? 0 },
                  end: { line: options.endLine ?? 0 },
                },
              },
            ],
    };
    for (const listener of state.documentListeners) {
      listener(event);
    }
  };

  return { createUri, state, reset, emitChange };
});

export { harness };

vi.mock("vscode", () => {
  const createDisposable = (dispose: () => void): FakeDisposable => ({ dispose });

  return {
    StatusBarAlignment: { Left: 1, Right: 2 },
    commands: {
      registerCommand: (
        name: string,
        handler: (...args: unknown[]) => unknown,
      ): FakeDisposable => {
        harness.state.commandHandlers.set(name, handler);
        return createDisposable(() => harness.state.commandHandlers.delete(name));
      },
      executeCommand: async (name: string, ...args: unknown[]): Promise<unknown> => {
        if (name === "setContext") {
          harness.state.contextKeys.set(String(args[0]), args[1]);
          return undefined;
        }
        const handler = harness.state.commandHandlers.get(name);
        if (handler === undefined) {
          throw new Error(`Unknown command: ${name}`);
        }
        return await handler(...args);
      },
    },
    window: {
      createStatusBarItem: () => ({
        get text() { return harness.state.statusText; },
        set text(value: string) { harness.state.statusText = value; },
        tooltip: undefined,
        command: undefined,
        show: () => undefined,
        hide: () => undefined,
        dispose: () => undefined,
      }),
      showWarningMessage: (message: string): Promise<string | undefined> => {
        harness.state.warnings.push(message);
        return Promise.resolve(harness.state.warningResponses.shift());
      },
      showInformationMessage: (message: string): Promise<string | undefined> => {
        harness.state.infoMessages.push(message);
        return Promise.resolve(undefined);
      },
    },
    workspace: {
      get isTrusted() {
        return harness.state.workspaceTrusted;
      },
      get workspaceFolders() {
        return harness.state.workspaceFolders;
      },
      get textDocuments() {
        return harness.state.textDocuments;
      },
      asRelativePath: (value: FakeUri | string): string => {
        const text = typeof value === "string" ? value : value.fsPath;
        return text.replace(/^\/workspace\//u, "");
      },
      getWorkspaceFolder: (uri: FakeUri): unknown => {
        return uri.fsPath.startsWith("/workspace")
          ? harness.state.workspaceFolders[0]
          : undefined;
      },
      onDidChangeTextDocument: (listener: DocumentListener): FakeDisposable => {
        harness.state.documentListeners.add(listener);
        return createDisposable(() => harness.state.documentListeners.delete(listener));
      },
      getConfiguration: () => ({
        update: (): Promise<void> => Promise.resolve(),
        inspect: () => undefined,
      }),
    },
    languages: {
      getDiagnostics: (): readonly unknown[] => [],
    },
    extensions: {
      getExtension: (): undefined => undefined,
    },
  };
});

const vscode = await import("vscode");
export const { PresenceController } = await import("../src/presenceController.js");
export const { SessionController } = await import("../src/sessionController.js");
const { StatusView } = await import("../src/statusView.js");
const { PairToolContext } = await import("../src/tools/pairToolContext.js");
export const { NodeJournalFileSystem } = await import("../src/storageAdapter.js");

export class FakeScheduler implements Scheduler {
  private nextHandleId = 1;
  private now = 0;
  private readonly tasks = new Map<
    number,
    { readonly runAt: number; readonly callback: () => void }
  >();

  public schedule(delayMs: number, callback: () => void): number {
    const handle = this.nextHandleId++;
    this.tasks.set(handle, { runAt: this.now + delayMs, callback });
    return handle;
  }

  public cancel(handle: unknown): void {
    if (typeof handle === "number") {
      this.tasks.delete(handle);
    }
  }

  public pendingCount(): number {
    return this.tasks.size;
  }

  public advanceBy(milliseconds: number): void {
    this.now += milliseconds;
    let due = [...this.tasks.entries()].find(([, task]) => task.runAt <= this.now);
    while (due !== undefined) {
      const [handle, task] = due;
      this.tasks.delete(handle);
      task.callback();
      due = [...this.tasks.entries()].find(([, task]) => task.runAt <= this.now);
    }
  }
}

export class MemoryFs implements JournalFileSystem {
  public writes = 0;
  public readonly files = new Map<string, string>();
  public writeError: Error | undefined;

  public ensureDir(): Promise<void> {
    return Promise.resolve();
  }

  public readFile(path: string): Promise<string | undefined> {
    return Promise.resolve(this.files.get(path));
  }

  public writeFile(path: string, data: string): Promise<void> {
    if (this.writeError !== undefined) {
      return Promise.reject(this.writeError);
    }
    this.writes += 1;
    this.files.set(path, data);
    return Promise.resolve();
  }

  public fsync(): Promise<void> {
    return Promise.resolve();
  }

  public rename(from: string, to: string): Promise<void> {
    const data = this.files.get(from);
    if (data !== undefined) {
      this.files.set(to, data);
      this.files.delete(from);
    }
    return Promise.resolve();
  }

  public removes = 0;

  public remove(path: string): Promise<void> {
    this.removes += 1;
    this.files.delete(path);
    return Promise.resolve();
  }
}

export class DelayedReadMemoryFs extends MemoryFs {
  private nextRead:
    | {
        readonly started: () => void;
        readonly released: Promise<void>;
      }
    | undefined;

  public delayNextRead(): {
    readonly started: Promise<void>;
    readonly release: () => void;
  } {
    let markStarted: () => void = () => undefined;
    let release: () => void = () => undefined;
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    const released = new Promise<void>(resolve => {
      release = resolve;
    });
    this.nextRead = { started: markStarted, released };
    return { started, release };
  }

  public override async readFile(path: string): Promise<string | undefined> {
    const delayed = this.nextRead;
    if (delayed !== undefined) {
      this.nextRead = undefined;
      delayed.started();
      await delayed.released;
    }
    return await super.readFile(path);
  }
}

interface FakeContext {
  readonly subscriptions: FakeDisposable[];
  readonly globalStorageUri: { readonly fsPath: string };
}

const createContext = (): FakeContext => ({
  subscriptions: [],
  globalStorageUri: { fsPath: "/journal-storage" },
});

export const buildController = (
  scheduler: Scheduler,
  fs: JournalFileSystem,
): {
  readonly controller: InstanceType<typeof PresenceController>;
  readonly context: FakeContext;
  readonly sessionController: InstanceType<typeof SessionController>;
} => {
  const sessionController = new SessionController();
  const controller = new PresenceController(
    sessionController,
    new StatusView(),
    new PairToolContext(),
    { scheduler, journalFileSystem: fs },
  );
  const context = createContext();
  controller.register(context as unknown as Parameters<typeof controller.register>[0]);
  return { controller, context, sessionController };
};

export const run = async (name: string): Promise<unknown> =>
  await vscode.commands.executeCommand(name);

export const flush = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
};

afterEach(() => {
  harness.reset();
});
