import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import type { PairConfig } from "../src/config/pairConfig";
import {
  hashEvidenceIdentity,
  PairMemoryStore,
} from "../src/core/memoryStore";
import type {
  ModelRequest,
  ModelResponse,
} from "../src/core/modelRouter";
import { TokenBudget } from "../src/core/tokenBudget";
import type { Evidence } from "../src/core/types";

interface TestDocument {
  readonly uri: {
    readonly scheme: string;
    toString(): string;
  };
  readonly languageId: string;
  readonly version: number;
  readonly lineCount: number;
  getText(): string;
  lineAt(line: number): {
    readonly text: string;
    readonly range: unknown;
  };
}

interface TestStatusItem {
  text: string;
  tooltip: string;
  readonly writes: string[];
  readonly writesAfterDispose: string[];
  disposed: boolean;
  dispose(): void;
}

interface TestCommentThread {
  readonly uri: string;
  disposed: boolean;
  dispose(): void;
}

const vscodeState = vi.hoisted(() => ({
  textDocuments: [] as TestDocument[],
  workspaceFolders: [] as Array<{
    readonly uri: { toString(): string };
  }>,
  getWorkspaceFolder: vi.fn<
    (uri: { toString(): string }) =>
      { readonly uri: { toString(): string } } | undefined
  >(() => undefined),
  findFiles: vi.fn<
    () => Promise<
      ReadonlyArray<{ relativePath: string; toString(): string }>
    >
  >(async () => []),
  openListeners: [] as Array<(document: TestDocument) => void>,
  closeListeners: [] as Array<(document: TestDocument) => void>,
  changeListeners: [] as Array<(event: unknown) => void>,
  workspaceFolderListeners: [] as Array<
    (event: {
      readonly added: ReadonlyArray<{
        readonly uri: { toString(): string };
      }>;
      readonly removed: ReadonlyArray<{
        readonly uri: { toString(): string };
      }>;
    }) => void
  >,
  listenerRegistrationCallCount: 0,
  listenerRegistrationFailure:
    undefined as Error | undefined,
  listenerRegistrationFailureAt:
    undefined as number | undefined,
  listenerDisposalFailureAt:
    undefined as number | undefined,
  listenerDisposalOrder: [] as number[],
  commentControllerDisposed: false,
  commentControllerDisposalFailure: undefined as Error | undefined,
  commentThreadDisposalFailures: new Set<string>(),
  statusItems: [] as TestStatusItem[],
  commentThreads: [] as TestCommentThread[],
  diagnostics: [] as Array<{
    readonly range: {
      readonly start: { readonly line: number; readonly character: number };
      readonly end: { readonly line: number; readonly character: number };
    };
    readonly message: string;
    readonly severity: number;
    readonly source?: string;
    readonly code?: string | number;
  }>,
  activeTextEditor: undefined as unknown,
  warningMessages: [] as string[],
}));

vi.mock("vscode", () => {
  class TestStatusBarItem implements TestStatusItem {
    public readonly writes: string[] = [];
    public readonly writesAfterDispose: string[] = [];
    public disposed = false;
    public tooltip = "";
    public name = "";
    public command = "";
    private currentText = "";

    public set text(value: string) {
      this.currentText = value;
      this.writes.push(value);
      if (this.disposed) {
        this.writesAfterDispose.push(value);
      }
    }

    public get text(): string {
      return this.currentText;
    }

    public show(): void {}

    public dispose(): void {
      this.disposed = true;
    }
  }

  class MarkdownString {
    public constructor(public value: string) {}

    public appendText(value: string): this {
      this.value += value;
      return this;
    }

    public appendMarkdown(value: string): this {
      this.value += value;
      return this;
    }
  }

  class Range {
    public readonly start: { readonly line: number; readonly character: number };
    public readonly end: { readonly line: number; readonly character: number };

    public constructor(
      startLine: number,
      startCharacter: number,
      endLine: number,
      endCharacter: number,
    ) {
      this.start = { line: startLine, character: startCharacter };
      this.end = { line: endLine, character: endCharacter };
    }
  }

  class CancellationError extends Error {}
  class LanguageModelError extends Error {}

  const registerListener = <T>(
    listeners: Array<(value: T) => void>,
    listener: (value: T) => void,
  ) => {
    vscodeState.listenerRegistrationCallCount += 1;
    const registrationNumber = vscodeState.listenerRegistrationCallCount;
    if (
      registrationNumber ===
      vscodeState.listenerRegistrationFailureAt
    ) {
      throw vscodeState.listenerRegistrationFailure;
    }
    listeners.push(listener);
    return {
      dispose: () => {
        vscodeState.listenerDisposalOrder.push(registrationNumber);
        const index = listeners.indexOf(listener);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
        if (
          registrationNumber === vscodeState.listenerDisposalFailureAt
        ) {
          throw new Error(
            `listener disposal ${registrationNumber} failed`,
          );
        }
      },
    };
  };

  return {
    CancellationError,
    CommentMode: { Preview: 1 },
    DiagnosticSeverity: {
      Error: 0,
      Warning: 1,
      Information: 2,
      Hint: 3,
    },
    LanguageModelError,
    MarkdownString,
    Range,
    StatusBarAlignment: { Right: 1 },
    Uri: {
      parse: (value: string) => ({
        scheme: value.slice(0, value.indexOf(":")),
        toString: () => value,
      }),
    },
    comments: {
      createCommentController: () => ({
        createCommentThread: (uri: { toString(): string }) => {
          const thread: TestCommentThread & {
            canReply: boolean;
            label: string;
          } = {
            uri: uri.toString(),
            disposed: false,
            canReply: false,
            label: "",
            dispose() {
              this.disposed = true;
              if (vscodeState.commentThreadDisposalFailures.has(this.uri)) {
                throw new Error(`${this.uri} disposal failed`);
              }
            },
          };
          vscodeState.commentThreads.push(thread);
          return thread;
        },
        dispose: () => {
          vscodeState.commentControllerDisposed = true;
          if (vscodeState.commentControllerDisposalFailure !== undefined) {
            throw vscodeState.commentControllerDisposalFailure;
          }
        },
      }),
    },
    extensions: { all: [] },
    languages: {
      getDiagnostics: () => vscodeState.diagnostics,
    },
    window: {
      get activeTextEditor() {
        return vscodeState.activeTextEditor;
      },
      createStatusBarItem: () => {
        const status = new TestStatusBarItem();
        vscodeState.statusItems.push(status);
        return status;
      },
      showErrorMessage: async () => undefined,
      showInformationMessage: async () => undefined,
      showWarningMessage: async (message: string) => {
        vscodeState.warningMessages.push(message);
      },
    },
    workspace: {
      get workspaceFolders() {
        return vscodeState.workspaceFolders;
      },
      getWorkspaceFolder: (uri: { toString(): string }) =>
        vscodeState.getWorkspaceFolder(uri),
      get textDocuments() {
        return vscodeState.textDocuments;
      },
      findFiles: vscodeState.findFiles,
      asRelativePath: (uri: { relativePath: string }) => uri.relativePath,
      onDidOpenTextDocument: (listener: (document: TestDocument) => void) =>
        registerListener(vscodeState.openListeners, listener),
      onDidCloseTextDocument: (listener: (document: TestDocument) => void) =>
        registerListener(vscodeState.closeListeners, listener),
      onDidChangeTextDocument: (listener: (event: unknown) => void) =>
        registerListener(vscodeState.changeListeners, listener),
      onDidChangeWorkspaceFolders: (
        listener: (event: {
          readonly added: ReadonlyArray<{
            readonly uri: { toString(): string };
          }>;
          readonly removed: ReadonlyArray<{
            readonly uri: { toString(): string };
          }>;
        }) => void,
      ) => registerListener(vscodeState.workspaceFolderListeners, listener),
    },
  };
});

import {
  PAIR_SHARED_CONTEXT_URI_REVISION_LIMIT,
  PairSharedContext,
  registerPairChatParticipant,
} from "../src/vscode/pairChatParticipant";
import { PairRuntime } from "../src/vscode/pairRuntime";
import type {
  CopilotModelReference,
  VsCodeLanguageModelApi,
  VsCodeRequestCancellation,
} from "../src/vscode/vsCodeLanguageModelProvider";
import { stableDiagnosticEvidenceId } from "../src/vscode/pairRuntimeSupport";

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const evidence: Evidence = {
  id: "dependency:repository",
  kind: "new-dependency",
  severity: "warning",
  title: "New dependency introduced",
  detail: "Imported a new module dependency.",
  source: "typescript-semantic-analyzer",
  confidence: 0.94,
  range: {
    start: { line: 2, character: 0 },
    end: { line: 2, character: 10 },
  },
  references: ["./repository"],
};
const evidenceHash = hashEvidenceIdentity(evidence.id);

const config = (
  overrides: Partial<PairConfig> = {},
): PairConfig => ({
  enabled: true,
  debounceMs: 500,
  interventionStyle: "balanced",
  provider: "local-template",
  baseUrl: undefined,
  modelName: "pair-test",
  budget: {
    maxCalls: 4,
    maxInputTokens: 6_000,
    maxOutputTokens: 720,
    maxOutputTokensPerCall: 180,
    windowMs: 600_000,
  },
  statusWarning: undefined,
  ...overrides,
});

const sharedContext = () =>
  new PairSharedContext({
    enabled: true,
    active: false,
    goal: "test",
    role: "navigator",
    provider: "local-template",
    remainingCalls: 4,
    remainingInputTokens: 6_000,
    controlNotice: undefined,
    configurationWarning: undefined,
  });

const languageModelApi = (
  models: readonly CopilotModelReference[] = [],
): VsCodeLanguageModelApi => ({
  selectChatModels: async () => models,
  canSendRequest: () => true,
  createCancellationTokenSource: (): VsCodeRequestCancellation => ({
    cancel: () => undefined,
    dispose: () => undefined,
  }),
  classifyError: () => "unknown",
  countTokens: async (_model, text) =>
    Math.max(1, Math.ceil(text.length / 4)),
  sendRequest: async () =>
    (async function* (): AsyncIterable<string> {
      yield "response";
    })(),
});

const extensionContext = {
  globalState: {
    get: () => undefined,
    update: async () => undefined,
  },
  workspaceState: {
    get: () => undefined,
    update: async () => undefined,
  },
} as unknown as vscode.ExtensionContext;

const document = (
  uri: string,
  text: string,
  version = 1,
  scheme = "file",
  languageId = "typescript",
): TestDocument => ({
  uri: {
    scheme,
    toString: () => uri,
  },
  languageId,
  version,
  lineCount: text.split("\n").length,
  getText: () => text,
  lineAt: (line) => {
    const lineText = text.split("\n")[line] ?? "";
    return {
      text: lineText,
      range: {
        start: { line, character: 0 },
        end: { line, character: lineText.length },
      },
    };
  },
});

beforeEach(() => {
  vscodeState.textDocuments = [];
  vscodeState.workspaceFolders = [
    {
      uri: {
        toString: () => "file:///workspace",
      },
    },
  ];
  vscodeState.getWorkspaceFolder.mockReset();
  vscodeState.getWorkspaceFolder.mockImplementation((uri) =>
    uri.toString().startsWith("file:///workspace/")
      ? vscodeState.workspaceFolders[0]
      : undefined,
  );
  vscodeState.findFiles.mockReset();
  vscodeState.findFiles.mockResolvedValue([]);
  vscodeState.openListeners.length = 0;
  vscodeState.closeListeners.length = 0;
  vscodeState.changeListeners.length = 0;
  vscodeState.workspaceFolderListeners.length = 0;
  vscodeState.listenerRegistrationCallCount = 0;
  vscodeState.listenerRegistrationFailure = undefined;
  vscodeState.listenerRegistrationFailureAt = undefined;
  vscodeState.listenerDisposalFailureAt = undefined;
  vscodeState.listenerDisposalOrder.length = 0;
  vscodeState.commentControllerDisposed = false;
  vscodeState.commentControllerDisposalFailure = undefined;
  vscodeState.commentThreadDisposalFailures.clear();
  vscodeState.statusItems.length = 0;
  vscodeState.commentThreads.length = 0;
  vscodeState.diagnostics.length = 0;
  vscodeState.activeTextEditor = undefined;
  vscodeState.warningMessages.length = 0;
  vi.unstubAllGlobals();
});

describe("PairRuntime lifecycle ownership", () => {
  it.each([
    ["first", 1],
    ["second", 2],
    ["third", 3],
    ["fourth", 4],
  ] as const)(
    "rolls back prepared state when the %s session listener registration throws",
    async (_label, failureAt) => {
      const seededUri = "file:///workspace/prepared.ts";
      vscodeState.textDocuments = [
        document(seededUri, "export const prepared = true;"),
      ];
      const failure = new Error(
        `listener registration ${failureAt} failed`,
      );
      vscodeState.listenerRegistrationFailure = failure;
      vscodeState.listenerRegistrationFailureAt = failureAt;
      const runtime = new PairRuntime({
        config: config(),
        extensionContext,
        sharedContext: sharedContext(),
        languageModelApi: languageModelApi(),
        apiKey: undefined,
      });

      await expect(runtime.startSession()).rejects.toBe(failure);

      expect(runtime.isSessionActive()).toBe(false);
      expect(vscodeState.openListeners).toHaveLength(0);
      expect(vscodeState.closeListeners).toHaveLength(0);
      expect(vscodeState.changeListeners).toHaveLength(0);
      expect(vscodeState.workspaceFolderListeners).toHaveLength(0);
      const state = (
        runtime as unknown as {
          documentState: {
            previousText(uri: string): string | undefined;
          };
        }
      ).documentState;
      expect(state.previousText(seededUri)).toBeUndefined();
      runtime.dispose();
    },
  );

  it("disposes every listener and later runtime resource when one listener throws", async () => {
    vscodeState.listenerDisposalFailureAt = 4;
    const runtime = new PairRuntime({
      config: config(),
      extensionContext,
      sharedContext: sharedContext(),
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();

    expect(() => runtime.dispose()).toThrow(
      "listener disposal 4 failed",
    );

    expect(vscodeState.listenerDisposalOrder).toEqual([4, 3, 2, 1]);
    expect(vscodeState.openListeners).toHaveLength(0);
    expect(vscodeState.closeListeners).toHaveLength(0);
    expect(vscodeState.changeListeners).toHaveLength(0);
    expect(vscodeState.workspaceFolderListeners).toHaveLength(0);
    expect(vscodeState.commentControllerDisposed).toBe(true);
    expect(vscodeState.statusItems[0]?.disposed).toBe(true);
    expect(runtime.isSessionActive()).toBe(false);
    expect(() => runtime.dispose()).not.toThrow();
  });

  it("propagates one aggregate after outer cleanup observes complete inline disposal", () => {
    const runtime = new PairRuntime({
      config: config(),
      extensionContext,
      sharedContext: sharedContext(),
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    const inlineController = (
      runtime as unknown as {
        inlineController: {
          render(
            uri: vscode.Uri,
            range: vscode.Range,
            question: string,
            evidence: Evidence,
          ): void;
        };
      }
    ).inlineController;
    inlineController.render(
      { toString: () => "file:///workspace/a.ts" } as vscode.Uri,
      {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      } as vscode.Range,
      "Question A?",
      evidence,
    );
    inlineController.render(
      { toString: () => "file:///workspace/b.ts" } as vscode.Uri,
      {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      } as vscode.Range,
      "Question B?",
      evidence,
    );
    vscodeState.commentThreadDisposalFailures.add(
      "file:///workspace/a.ts",
    );
    vscodeState.commentThreadDisposalFailures.add(
      "file:///workspace/b.ts",
    );
    vscodeState.commentControllerDisposalFailure = new Error(
      "comment controller disposal failed",
    );

    let failure: unknown;
    try {
      runtime.dispose();
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    expect(vscodeState.commentThreads).toHaveLength(2);
    expect(
      vscodeState.commentThreads.every((thread) => thread.disposed),
    ).toBe(true);
    expect(vscodeState.commentControllerDisposed).toBe(true);
    expect(vscodeState.statusItems[0]?.disposed).toBe(true);
    const outerErrors = (failure as AggregateError).errors;
    expect(outerErrors).toHaveLength(2);
    expect(outerErrors[0]).toBeInstanceOf(AggregateError);
    expect((outerErrors[0] as AggregateError).errors).toHaveLength(2);
    expect(outerErrors[1]).toBe(
      vscodeState.commentControllerDisposalFailure,
    );
    expect(() => runtime.dispose()).not.toThrow();
  });

  it("seeds file and vscode-remote TypeScript documents but rejects unrelated schemes and languages", async () => {
    const remoteUri =
      "vscode-remote://ssh-remote+pair-host/workspace/remote.ts";
    const fileUri = "file:///workspace/local.js";
    const unsupportedSchemeUri = "untitled:pair.ts";
    const unsupportedLanguageUri =
      "vscode-remote://ssh-remote+pair-host/workspace/pair.py";
    vscodeState.textDocuments = [
      document(remoteUri, "export const remote = true;", 1, "vscode-remote"),
      document(fileUri, "export const local = true;", 1, "file", "javascript"),
      document(
        unsupportedSchemeUri,
        "export const scratch = true;",
        1,
        "untitled",
      ),
      document(
        unsupportedLanguageUri,
        "remote = True",
        1,
        "vscode-remote",
        "python",
      ),
    ];
    const runtime = new PairRuntime({
      config: config(),
      extensionContext,
      sharedContext: sharedContext(),
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });

    await runtime.startSession();

    const state = (
      runtime as unknown as {
        documentState: {
          previousText(uri: string): string | undefined;
        };
      }
    ).documentState;
    expect(state.previousText(remoteUri)).toBe("export const remote = true;");
    expect(state.previousText(fileUri)).toBe("export const local = true;");
    expect(state.previousText(unsupportedSchemeUri)).toBeUndefined();
    expect(state.previousText(unsupportedLanguageUri)).toBeUndefined();
    runtime.dispose();
  });

  it("persists personal memory through global state, not workspace state", async () => {
    const globalUpdate = vi.fn(async () => undefined);
    const workspaceUpdate = vi.fn(async () => undefined);
    const runtime = new PairRuntime({
      config: config(),
      extensionContext: {
        globalState: {
          get: () => undefined,
          update: globalUpdate,
        },
        workspaceState: {
          get: () => undefined,
          update: workspaceUpdate,
        },
      } as unknown as vscode.ExtensionContext,
      sharedContext: sharedContext(),
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });

    await runtime.resetMemory();

    expect(globalUpdate).toHaveBeenCalledWith(
      "adaptive-pair.memory",
      expect.objectContaining({
        dismissedEvidenceByRepository: {},
      }),
    );
    expect(workspaceUpdate).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it("dismisses current evidence only for its owning workspace root", async () => {
    const firstRoot = {
      uri: { toString: () => "file:///workspace/first" },
    };
    const secondRoot = {
      uri: {
        toString: () =>
          "vscode-remote://ssh-remote+pair-host/workspace/second",
      },
    };
    vscodeState.workspaceFolders = [firstRoot, secondRoot];
    vscodeState.getWorkspaceFolder.mockImplementation((uri) =>
      uri.toString().startsWith(secondRoot.uri.toString())
        ? secondRoot
        : uri.toString().startsWith(firstRoot.uri.toString())
          ? firstRoot
          : undefined,
    );
    let stored: unknown;
    const memoryContext = {
      globalState: {
        get: () => stored,
        update: async (_key: string, value: unknown) => {
          stored = value;
        },
      },
    } as unknown as vscode.ExtensionContext;
    const shared = sharedContext();
    const runtime = new PairRuntime({
      config: config(),
      extensionContext: memoryContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();
    shared.publishEvidence({
      uri: `${secondRoot.uri.toString()}/src/pair.ts`,
      evidence,
      question: "Current evidence",
    });

    await expect(runtime.dismissCurrentEvidence()).resolves.toMatchObject({
      kind: "dismissed",
    });

    expect(stored).toMatchObject({
      dismissedEvidenceByRepository: {
        [secondRoot.uri.toString()]: [evidenceHash],
      },
    });
    expect(
      (
        stored as {
          dismissedEvidenceByRepository: Record<string, readonly string[]>;
        }
      ).dismissedEvidenceByRepository[firstRoot.uri.toString()],
    ).toBeUndefined();
    expect(shared.snapshot().latest).toBeUndefined();
    runtime.dispose();
  });

  it("cleans up a dismissed URI when unrelated URI evidence arrives during persistence", async () => {
    const persistence = deferred<void>();
    let persistenceStarted = false;
    let stored: unknown;
    const memoryContext = {
      globalState: {
        get: () => stored,
        update: async (_key: string, value: unknown) => {
          persistenceStarted = true;
          await persistence.promise;
          stored = value;
        },
      },
    } as unknown as vscode.ExtensionContext;
    const targetUri = "file:///workspace/src/target.ts";
    const unrelatedUri = "file:///workspace/src/unrelated.ts";
    const targetDocument = document(targetUri, "export const target = 1;");
    const unrelatedDocument = document(
      unrelatedUri,
      "export const unrelated = 1;",
    );
    vscodeState.textDocuments = [targetDocument, unrelatedDocument];
    const shared = sharedContext();
    const runtime = new PairRuntime({
      config: config(),
      extensionContext: memoryContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();
    const renderIntervention = (
      runtime as unknown as {
        renderIntervention(
          document: vscode.TextDocument,
          evidence: Evidence,
          question: string,
        ): void;
      }
    ).renderIntervention.bind(runtime);
    renderIntervention(
      targetDocument as unknown as vscode.TextDocument,
      evidence,
      "Target question",
    );

    const pendingDismiss = runtime.dismissCurrentEvidence();
    await vi.waitFor(() => {
      expect(persistenceStarted).toBe(true);
    });
    renderIntervention(
      unrelatedDocument as unknown as vscode.TextDocument,
      { ...evidence, id: "dependency:unrelated" },
      "Unrelated question",
    );
    persistence.resolve();
    await pendingDismiss;

    expect(vscodeState.commentThreads[0]?.disposed).toBe(true);
    expect(vscodeState.commentThreads[1]?.disposed).toBe(false);
    expect(shared.snapshot().latest?.uri).toBe(unrelatedUri);
    runtime.dispose();
  });

  it("returns no-evidence when dismissal has no current evidence", async () => {
    const shared = sharedContext();
    const runtime = new PairRuntime({
      config: config(),
      extensionContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });

    await expect(runtime.dismissCurrentEvidence()).resolves.toEqual({
      kind: "no-evidence",
      message: "Adaptive Pair has no current evidence to dismiss.",
    });
    runtime.dispose();
  });

  it("does not clear replacement evidence after both URI fences are evicted during dismissal", async () => {
    const persistence = deferred<void>();
    let persistenceStarted = false;
    const memoryContext = {
      globalState: {
        get: () => undefined,
        update: async () => {
          persistenceStarted = true;
          await persistence.promise;
        },
      },
    } as unknown as vscode.ExtensionContext;
    const uri = "file:///workspace/src/double-evicted.ts";
    const currentDocument = document(uri, "export const value = 1;");
    vscodeState.textDocuments = [currentDocument];
    const shared = sharedContext();
    const runtime = new PairRuntime({
      config: config(),
      extensionContext: memoryContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();
    const renderIntervention = (
      runtime as unknown as {
        renderIntervention(
          document: vscode.TextDocument,
          evidence: Evidence,
          question: string,
        ): void;
      }
    ).renderIntervention.bind(runtime);
    renderIntervention(
      currentDocument as unknown as vscode.TextDocument,
      evidence,
      "Original question",
    );
    for (
      let index = 0;
      index < PAIR_SHARED_CONTEXT_URI_REVISION_LIMIT;
      index += 1
    ) {
      shared.clearEvidence(`file:///workspace/before-dismiss-${index}.ts`);
    }
    expect(shared.evidenceRevisionForUri(uri)).toBeUndefined();

    const pendingDismiss = runtime.dismissCurrentEvidence();
    await vi.waitFor(() => {
      expect(persistenceStarted).toBe(true);
    });
    renderIntervention(
      currentDocument as unknown as vscode.TextDocument,
      { ...evidence, id: "dependency:replacement-after-eviction" },
      "Replacement question",
    );
    for (
      let index = 0;
      index < PAIR_SHARED_CONTEXT_URI_REVISION_LIMIT;
      index += 1
    ) {
      shared.clearEvidence(`file:///workspace/during-dismiss-${index}.ts`);
    }
    expect(shared.evidenceRevisionForUri(uri)).toBeUndefined();

    persistence.resolve();
    await pendingDismiss;

    expect(shared.snapshot().latest).toMatchObject({
      uri,
      evidence: { id: "dependency:replacement-after-eviction" },
      question: "Replacement question",
    });
    expect(vscodeState.commentThreads[0]?.disposed).toBe(true);
    expect(vscodeState.commentThreads[1]?.disposed).toBe(false);
    runtime.dispose();
  });

  it("does not clear same-URI evidence published after a close while dismissal persists", async () => {
    const persistence = deferred<void>();
    let persistenceStarted = false;
    const memoryContext = {
      globalState: {
        get: () => undefined,
        update: async () => {
          persistenceStarted = true;
          await persistence.promise;
        },
      },
    } as unknown as vscode.ExtensionContext;
    const uri = "file:///workspace/src/reused.ts";
    const currentDocument = document(uri, "export const value = 1;");
    vscodeState.textDocuments = [currentDocument];
    const shared = sharedContext();
    const runtime = new PairRuntime({
      config: config(),
      extensionContext: memoryContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();
    const renderIntervention = (
      runtime as unknown as {
        renderIntervention(
          document: vscode.TextDocument,
          evidence: Evidence,
          question: string,
        ): void;
      }
    ).renderIntervention.bind(runtime);
    renderIntervention(
      currentDocument as unknown as vscode.TextDocument,
      evidence,
      "Original question",
    );
    const originalRevision = shared.captureEvidenceRevisionForUri(uri);

    const pendingDismiss = runtime.dismissCurrentEvidence();
    await vi.waitFor(() => {
      expect(persistenceStarted).toBe(true);
    });
    vscodeState.closeListeners[0]?.(currentDocument);
    expect(shared.evidenceRevisionForUri(uri)).toBeUndefined();
    renderIntervention(
      currentDocument as unknown as vscode.TextDocument,
      { ...evidence, id: "dependency:reused-after-close" },
      "Reused URI question",
    );
    const reusedRevision = shared.captureEvidenceRevisionForUri(uri);
    expect(reusedRevision).toBeGreaterThan(originalRevision);

    persistence.resolve();
    await pendingDismiss;

    expect(shared.snapshot().latest).toMatchObject({
      uri,
      evidence: { id: "dependency:reused-after-close" },
      question: "Reused URI question",
    });
    expect(shared.evidenceRevisionForUri(uri)).toBe(reusedRevision);
    expect(vscodeState.commentThreads[0]?.disposed).toBe(true);
    expect(vscodeState.commentThreads[1]?.disposed).toBe(false);
    runtime.dispose();
  });

  it("retires URI revisions across runtime replacement and current-runtime disposal", () => {
    const uri = "file:///workspace/src/runtime-reuse.ts";
    const currentDocument = document(uri, "export const value = 1;");
    const shared = sharedContext();
    const firstRuntime = new PairRuntime({
      config: config(),
      extensionContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    const renderFirst = (
      firstRuntime as unknown as {
        renderIntervention(
          document: vscode.TextDocument,
          evidence: Evidence,
          question: string,
        ): void;
      }
    ).renderIntervention.bind(firstRuntime);
    renderFirst(
      currentDocument as unknown as vscode.TextDocument,
      evidence,
      "First runtime question",
    );
    const firstRevision = shared.captureEvidenceRevisionForUri(uri);

    const secondRuntime = new PairRuntime({
      config: config(),
      extensionContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });

    expect(shared.evidenceRevisionForUri(uri)).toBeUndefined();

    const renderSecond = (
      secondRuntime as unknown as {
        renderIntervention(
          document: vscode.TextDocument,
          evidence: Evidence,
          question: string,
        ): void;
      }
    ).renderIntervention.bind(secondRuntime);
    renderSecond(
      currentDocument as unknown as vscode.TextDocument,
      { ...evidence, id: "dependency:second-runtime" },
      "Second runtime question",
    );
    const secondRevision = shared.captureEvidenceRevisionForUri(uri);
    expect(secondRevision).toBeGreaterThan(firstRevision);

    firstRuntime.dispose();

    expect(shared.evidenceRevisionForUri(uri)).toBe(secondRevision);
    expect(shared.snapshot().latest?.evidence.id).toBe(
      "dependency:second-runtime",
    );

    secondRuntime.dispose();

    expect(shared.evidenceRevisionForUri(uri)).toBeUndefined();
    expect(shared.snapshot().latest).toBeUndefined();
  });

  it("bounds dynamic evidence before publishing shared UI context", async () => {
    const uri = "file:///workspace/src/bounded.ts";
    const currentDocument = document(uri, "export const value = 1;", 1);
    const shared = sharedContext();
    const runtime = new PairRuntime({
      config: config(),
      extensionContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();
    const huge = (prefix: string): string =>
      `${prefix}\n${"payload".repeat(300)}`;
    const rawEvidence: Evidence = {
      ...evidence,
      id: "external:private-full-identity",
      kind: "external-harness",
      title: huge("Title prefix"),
      detail: huge("Detail prefix"),
      source: huge("Source prefix"),
      references: Array.from({ length: 12 }, (_, index) =>
        huge(`Reference ${index}`),
      ),
    };

    (
      runtime as unknown as {
        renderIntervention(
          document: vscode.TextDocument,
          evidence: Evidence,
          question: string,
        ): void;
      }
    ).renderIntervention(
      currentDocument as unknown as vscode.TextDocument,
      rawEvidence,
      huge("Question prefix"),
    );

    const latest = shared.snapshot().latest;
    expect(latest?.evidence.id).toBe(rawEvidence.id);
    expect(latest?.question.length).toBeLessThanOrEqual(1_000);
    expect(latest?.evidence.title.length).toBeLessThanOrEqual(120);
    expect(latest?.evidence.detail.length).toBeLessThanOrEqual(500);
    expect(latest?.evidence.source.length).toBeLessThanOrEqual(120);
    expect(latest?.evidence.references).toHaveLength(8);
    for (const field of [
      latest?.question,
      latest?.evidence.title,
      latest?.evidence.detail,
      latest?.evidence.source,
      ...(latest?.evidence.references ?? []),
    ]) {
      expect(field).not.toMatch(/[\r\n]/u);
      expect(field?.endsWith("…")).toBe(true);
    }
    runtime.dispose();
  });

  it("keeps dismissed diagnostic evidence out of manual review", async () => {
    const uri = "file:///workspace/src/pair.ts";
    const currentDocument = document(uri, "export const value = 1;", 1);
    const diagnosticEvidence: Evidence = {
      ...evidence,
      id: stableDiagnosticEvidenceId(
        uri,
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 6 },
        },
        "typescript",
        ["TS2322"],
        "Type mismatch",
      ),
      kind: "diagnostic",
      title: "Editor diagnostic",
      detail: "Type mismatch",
      source: "typescript",
      references: ["TS2322"],
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 6 },
      },
    };
    vscodeState.textDocuments = [currentDocument];
    vscodeState.activeTextEditor = {
      document: currentDocument,
      selection: {
        isEmpty: false,
        active: { line: 0, character: 0 },
        start: diagnosticEvidence.range.start,
        end: diagnosticEvidence.range.end,
      },
    };
    vscodeState.diagnostics.push({
      range: diagnosticEvidence.range,
      message: diagnosticEvidence.detail,
      severity: 1,
      source: diagnosticEvidence.source,
      code: diagnosticEvidence.references[0]!,
    });
    const shared = sharedContext();
    const runtime = new PairRuntime({
      config: config(),
      extensionContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();
    shared.publishEvidence({
      uri,
      evidence: diagnosticEvidence,
      question: "Current diagnostic",
    });
    await runtime.dismissCurrentEvidence();

    await runtime.reviewCurrentBlock();

    expect(vscodeState.commentThreads).toHaveLength(0);
    runtime.dispose();
  });

  it("keeps a dismissed diagnostic suppressed when unrelated diagnostics reorder", async () => {
    const uri = "file:///Users/private/workspace/src/pair.ts";
    const currentDocument = document(uri, "export const value = 1;", 1);
    const target = {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 6 },
      },
      message: "Type mismatch",
      severity: 1,
      source: "typescript",
      code: "TS2322",
    };
    const unrelated = {
      range: {
        start: { line: 0, character: 15 },
        end: { line: 0, character: 20 },
      },
      message: "Unused value",
      severity: 1,
      source: "typescript",
      code: "TS6133",
    };
    vscodeState.textDocuments = [currentDocument];
    vscodeState.activeTextEditor = {
      document: currentDocument,
      selection: {
        isEmpty: false,
        active: { line: 0, character: 0 },
        start: target.range.start,
        end: target.range.end,
      },
    };
    vscodeState.diagnostics.push(target, unrelated);
    const shared = sharedContext();
    const runtime = new PairRuntime({
      config: config(),
      extensionContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();

    await runtime.reviewCurrentBlock();
    const firstId = shared.snapshot().latest?.evidence.id;
    expect(firstId).toBeDefined();
    expect(firstId).not.toContain(uri);
    await runtime.dismissCurrentEvidence();

    vscodeState.diagnostics.splice(0, 2, unrelated, target);
    await runtime.reviewCurrentBlock();

    expect(vscodeState.commentThreads).toHaveLength(1);
    expect(shared.snapshot().latest).toBeUndefined();
    runtime.dispose();
  });

  it("publishes bounded multiline diagnostic evidence with a full-input identity", async () => {
    const uri = "file:///workspace/src/diagnostic.ts";
    const currentDocument = document(uri, "export const value = 1;", 1);
    const range = {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 6 },
    };
    const message = `Useful diagnostic prefix\n${"message".repeat(200)}`;
    const source = `typescript\n${"source".repeat(100)}`;
    const code = `TS2322\n${"code".repeat(100)}`;
    vscodeState.textDocuments = [currentDocument];
    vscodeState.activeTextEditor = {
      document: currentDocument,
      selection: {
        isEmpty: false,
        active: range.start,
        start: range.start,
        end: range.end,
      },
    };
    vscodeState.diagnostics.push({
      range,
      message,
      severity: 0,
      source,
      code,
    });
    const shared = sharedContext();
    const runtime = new PairRuntime({
      config: config(),
      extensionContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();

    await runtime.reviewCurrentBlock();

    const published = shared.snapshot().latest?.evidence;
    expect(published).toBeDefined();
    expect(published?.id).toBe(
      stableDiagnosticEvidenceId(uri, range, source, [code], message),
    );
    expect(published?.detail.length).toBeLessThanOrEqual(500);
    expect(published?.source.length).toBeLessThanOrEqual(120);
    expect(published?.references[0]?.length).toBeLessThanOrEqual(240);
    for (const field of [
      published?.detail,
      published?.source,
      published?.references[0],
    ]) {
      expect(field).not.toMatch(/[\r\n]/u);
      expect(field?.endsWith("…")).toBe(true);
    }
    expect(vscodeState.commentThreads).toHaveLength(1);
    runtime.dispose();
  });

  it("matches current diagnostic identities to hashed dismissals after a runtime rebuild", async () => {
    const uri = "file:///workspace/src/private.ts";
    const currentDocument = document(uri, "export const value = 1;", 1);
    const diagnosticEvidence: Evidence = {
      ...evidence,
      id: stableDiagnosticEvidenceId(
        uri,
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 6 },
        },
        "typescript",
        ["TS2322"],
        "Type mismatch",
      ),
      kind: "diagnostic",
      title: "Editor diagnostic",
      detail: "Type mismatch",
      source: "typescript",
      references: ["TS2322"],
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 6 },
      },
    };
    vscodeState.textDocuments = [currentDocument];
    vscodeState.activeTextEditor = {
      document: currentDocument,
      selection: {
        isEmpty: false,
        active: { line: 0, character: 0 },
        start: diagnosticEvidence.range.start,
        end: diagnosticEvidence.range.end,
      },
    };
    vscodeState.diagnostics.push({
      range: diagnosticEvidence.range,
      message: diagnosticEvidence.detail,
      severity: 1,
      source: diagnosticEvidence.source,
      code: diagnosticEvidence.references[0]!,
    });
    let stored: unknown;
    const memoryContext = {
      globalState: {
        get: () => stored,
        update: async (_key: string, value: unknown) => {
          stored = value;
        },
      },
    } as unknown as vscode.ExtensionContext;
    const firstShared = sharedContext();
    const firstRuntime = new PairRuntime({
      config: config(),
      extensionContext: memoryContext,
      sharedContext: firstShared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await firstRuntime.startSession();
    firstShared.publishEvidence({
      uri,
      evidence: diagnosticEvidence,
      question: "Current diagnostic",
    });
    await firstRuntime.dismissCurrentEvidence();
    firstRuntime.dispose();

    expect(JSON.stringify(stored)).not.toContain(uri);

    const secondRuntime = new PairRuntime({
      config: config(),
      extensionContext: memoryContext,
      sharedContext: sharedContext(),
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await secondRuntime.startSession();
    await secondRuntime.reviewCurrentBlock();

    expect(vscodeState.commentThreads).toHaveLength(0);
    secondRuntime.dispose();
  });

  it("approves only the current evidence summary", async () => {
    let stored: unknown;
    const memoryContext = {
      globalState: {
        get: () => stored,
        update: async (_key: string, value: unknown) => {
          stored = value;
        },
      },
    } as unknown as vscode.ExtensionContext;
    const shared = sharedContext();
    const runtime = new PairRuntime({
      config: config(),
      extensionContext: memoryContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();
    shared.publishEvidence({
      uri: "file:///workspace/src/pair.ts",
      evidence,
      question: "Current evidence",
    });

    await expect(runtime.approveCurrentEvidence()).resolves.toMatchObject({
      kind: "approved",
    });

    const approved = (
      stored as {
        approvedEvidence: Array<Record<string, unknown>>;
      }
    ).approvedEvidence[0];
    expect(approved).toEqual({
      id: evidenceHash,
      kind: evidence.kind,
      title: evidence.title,
      approvedAt: expect.any(Number),
    });
    expect(JSON.stringify(approved)).not.toContain(evidence.detail);
    expect(JSON.stringify(approved)).not.toContain(evidence.references[0]);
    runtime.dispose();
  });

  it("persists a selected intervention style and reapplies its budget", async () => {
    let stored: unknown;
    const memoryContext = {
      globalState: {
        get: () => stored,
        update: async (_key: string, value: unknown) => {
          stored = value;
        },
      },
    } as unknown as vscode.ExtensionContext;
    const shared = sharedContext();
    const runtime = new PairRuntime({
      config: config({
        interventionStyle: "eco",
        budget: {
          maxCalls: 2,
          maxInputTokens: 2_000,
          maxOutputTokens: 360,
          maxOutputTokensPerCall: 180,
          windowMs: 600_000,
        },
      }),
      extensionContext: memoryContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();

    await expect(runtime.setInterventionStyle("active")).resolves.toMatchObject({
      kind: "style-updated",
    });

    expect(stored).toMatchObject({
      preferences: { interventionStyle: "active" },
    });
    expect(shared.snapshot().session.remainingCalls).toBe(8);
    runtime.dispose();
  });

  it("returns to the configured style after resetting an explicit preference", async () => {
    let stored: unknown;
    const memoryContext = {
      globalState: {
        get: () => stored,
        update: async (_key: string, value: unknown) => {
          stored = value;
        },
      },
    } as unknown as vscode.ExtensionContext;
    const shared = sharedContext();
    const runtime = new PairRuntime({
      config: config({
        interventionStyle: "eco",
        budget: {
          maxCalls: 2,
          maxInputTokens: 2_000,
          maxOutputTokens: 360,
          maxOutputTokensPerCall: 180,
          windowMs: 600_000,
        },
      }),
      extensionContext: memoryContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();
    await runtime.setInterventionStyle("active");
    expect(shared.snapshot().session.remainingCalls).toBe(8);

    await runtime.resetMemory();

    expect(shared.snapshot().session.remainingCalls).toBe(2);
    expect(stored).toMatchObject({
      preferences: {
        interventionStyle: "balanced",
        interventionStyleExplicit: false,
      },
    });
    runtime.dispose();
  });

  it("applies a loaded intervention preference to the next session", async () => {
    const before = "const load = (id: string): string => id;";
    const after =
      "export function load(id: string): string { return id; }";
    const uri = "file:///workspace/src/pair.ts";
    let stored: unknown = {
      version: 1,
      preferences: {
        interventionStyle: "active",
        pauseThresholdMs: 1_000,
      },
      dismissedEvidenceByRepository: {},
      approvedEvidence: [],
    };
    const memoryContext = {
      globalState: {
        get: () => stored,
        update: async (_key: string, value: unknown) => {
          stored = value;
        },
      },
    } as unknown as vscode.ExtensionContext;
    vscodeState.textDocuments = [document(uri, before, 1)];
    const shared = sharedContext();
    const runtime = new PairRuntime({
      config: config({ interventionStyle: "eco" }),
      extensionContext: memoryContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();
    vscodeState.textDocuments = [document(uri, after, 2)];

    await (
      runtime as unknown as {
        handleEpisode(episode: {
          uri: string;
          languageId: string;
          previousText: string;
          currentText: string;
          version: number;
          observedAt: number;
        }): Promise<void>;
      }
    ).handleEpisode({
      uri,
      languageId: "typescript",
      previousText: before,
      currentText: after,
      version: 2,
      observedAt: 1,
    });

    expect(shared.snapshot().session.remainingCalls).toBe(8);
    expect(vscodeState.commentThreads).toHaveLength(1);
    runtime.dispose();
  });

  it("uses the configured intervention style when no preference is stored", async () => {
    const shared = sharedContext();
    const runtime = new PairRuntime({
      config: config({
        interventionStyle: "eco",
        budget: {
          maxCalls: 2,
          maxInputTokens: 2_000,
          maxOutputTokens: 360,
          maxOutputTokensPerCall: 180,
          windowMs: 600_000,
        },
      }),
      extensionContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });

    await runtime.startSession();

    expect(shared.snapshot().session.remainingCalls).toBe(2);
    runtime.dispose();
  });

  it.each(["dismiss", "approve"] as const)(
    "does not let an unrelated %s write override the configured intervention style",
    async (action) => {
      let stored: unknown;
      const memoryContext = {
        globalState: {
          get: () => stored,
          update: async (_key: string, value: unknown) => {
            stored = value;
          },
        },
      } as unknown as vscode.ExtensionContext;
      const ecoConfig = config({
        interventionStyle: "eco",
        budget: {
          maxCalls: 2,
          maxInputTokens: 2_000,
          maxOutputTokens: 360,
          maxOutputTokensPerCall: 180,
          windowMs: 600_000,
        },
      });
      const firstShared = sharedContext();
      const firstRuntime = new PairRuntime({
        config: ecoConfig,
        extensionContext: memoryContext,
        sharedContext: firstShared,
        languageModelApi: languageModelApi(),
        apiKey: undefined,
      });
      await firstRuntime.startSession();
      firstShared.publishEvidence({
        uri: "file:///workspace/src/pair.ts",
        evidence,
        question: "Current evidence",
      });
      if (action === "dismiss") {
        await firstRuntime.dismissCurrentEvidence();
      } else {
        await firstRuntime.approveCurrentEvidence();
      }
      firstRuntime.dispose();

      const secondShared = sharedContext();
      const secondRuntime = new PairRuntime({
        config: ecoConfig,
        extensionContext: memoryContext,
        sharedContext: secondShared,
        languageModelApi: languageModelApi(),
        apiKey: undefined,
      });
      await secondRuntime.startSession();

      expect(secondShared.snapshot().session.remainingCalls).toBe(2);
      secondRuntime.dispose();
    },
  );

  it("keeps a style update made during deferred session preparation", async () => {
    const discovery = deferred<
      ReadonlyArray<{ relativePath: string; toString(): string }>
    >();
    vscodeState.findFiles.mockImplementationOnce(() => discovery.promise);
    const uri = "file:///workspace/src/pair.ts";
    const source = "export const value = 1;";
    vscodeState.textDocuments = [document(uri, source)];
    vscodeState.diagnostics.push({
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 6 },
      },
      message: "Moderate-confidence warning",
      severity: 1,
      source: "typescript",
      code: "TS1000",
    });
    let stored: unknown;
    const memoryContext = {
      globalState: {
        get: () => stored,
        update: async (_key: string, value: unknown) => {
          stored = value;
        },
      },
    } as unknown as vscode.ExtensionContext;
    const runtime = new PairRuntime({
      config: config({ interventionStyle: "eco" }),
      extensionContext: memoryContext,
      sharedContext: sharedContext(),
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });

    const pendingStart = runtime.startSession();
    await vi.waitFor(() => {
      expect(vscodeState.findFiles).toHaveBeenCalledOnce();
    });
    await runtime.setInterventionStyle("active");
    discovery.resolve([]);
    await pendingStart;
    expect(
      (runtime as unknown as { interventionStyle: string }).interventionStyle,
    ).toBe("active");

    await (
      runtime as unknown as {
        handleEpisode(episode: {
          uri: string;
          languageId: string;
          previousText: string;
          currentText: string;
          version: number;
          observedAt: number;
        }): Promise<void>;
      }
    ).handleEpisode({
      uri,
      languageId: "typescript",
      previousText: source,
      currentText: source,
      version: 1,
      observedAt: 1,
    });

    expect(vscodeState.commentThreads).toHaveLength(1);
    runtime.dispose();
  });

  it("serializes memory mutations across a runtime rebuild", async () => {
    let stored: unknown;
    let getCallCount = 0;
    const pendingWrites: Array<{
      readonly value: unknown;
      resolve(): void;
    }> = [];
    const memoryBackend = {
      get: async <T,>(key: string): Promise<T | undefined> => {
        expect(key).toBe("adaptive-pair.memory");
        getCallCount += 1;
        return stored as T | undefined;
      },
      update: async <T,>(key: string, value: T): Promise<void> => {
        expect(key).toBe("adaptive-pair.memory");
        await new Promise<void>((resolve) => {
          pendingWrites.push({
            value,
            resolve: () => {
              stored = value;
              resolve();
            },
          });
        });
      },
    };
    const memoryStore = new PairMemoryStore({
      repositoryId: "file:///workspace",
      store: memoryBackend,
    });
    const memoryContext = {
      globalState: memoryBackend,
    } as unknown as vscode.ExtensionContext;
    const firstRuntimeOptions = {
      config: config(),
      extensionContext: memoryContext,
      sharedContext: sharedContext(),
      languageModelApi: languageModelApi(),
      apiKey: undefined,
      memoryStore,
    };
    const firstRuntime = new PairRuntime(firstRuntimeOptions);
    const updateStyle = firstRuntime.setInterventionStyle("active");
    await vi.waitFor(() => {
      expect(pendingWrites).toHaveLength(1);
    });
    firstRuntime.dispose();

    const secondShared = sharedContext();
    const secondRuntimeOptions = {
      ...firstRuntimeOptions,
      sharedContext: secondShared,
    };
    const secondRuntime = new PairRuntime(secondRuntimeOptions);
    secondShared.publishEvidence({
      uri: "file:///workspace/src/pair.ts",
      evidence,
      question: "Current evidence",
    });
    const dismissEvidence = secondRuntime.dismissCurrentEvidence();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    const readsBeforeFirstWriteCompletes = getCallCount;

    pendingWrites[0]!.resolve();
    await vi.waitFor(() => {
      expect(pendingWrites).toHaveLength(2);
    });
    pendingWrites[1]!.resolve();
    await Promise.all([updateStyle, dismissEvidence]);

    expect(readsBeforeFirstWriteCompletes).toBe(1);
    await expect(memoryStore.load()).resolves.toMatchObject({
      preferences: {
        interventionStyle: "active",
        interventionStyleExplicit: true,
      },
      dismissedEvidenceByRepository: {
        "file:///workspace": [evidenceHash],
      },
    });
    secondRuntime.dispose();
  });

  it("starts with visible in-memory defaults when stored memory is corrupt", async () => {
    let stored: unknown = {
      version: 1,
      preferences: { interventionStyle: "invalid" },
    };
    const corruptContext = {
      globalState: {
        get: () => stored,
        update: async (_key: string, value: unknown) => {
          stored = value;
        },
      },
    } as unknown as vscode.ExtensionContext;
    const runtime = new PairRuntime({
      config: config(),
      extensionContext: corruptContext,
      sharedContext: sharedContext(),
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });

    await expect(runtime.startSession()).resolves.toMatchObject({
      kind: "started",
    });
    expect(vscodeState.warningMessages.join("\n")).toContain("corrupt");
    expect(vscodeState.statusItems[0]?.text).toContain("memory");

    await runtime.resetMemory();
    expect(stored).toMatchObject({
      version: 1,
      preferences: { interventionStyle: "balanced" },
    });
    runtime.dispose();
  });

  it.each([
    [
      "credential",
      "Explain password='correct horse battery staple' without sharing it.",
    ],
    ["local resource", "Explain file:///Users/alice/private/notes/"],
    ["Cookie header", "Cookie: session=exact-cookie-value"],
    [
      "Set-Cookie header",
      "Set-Cookie: session=exact-set-cookie-value; HttpOnly",
    ],
  ])("keeps an explicit Chat prompt containing a %s local", async (_label, userPrompt) => {
    const fetchImplementation = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "remote" } }],
          usage: { prompt_tokens: 10, completion_tokens: 1 },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchImplementation);
    const runtime = new PairRuntime({
      config: config({
        provider: "openai-compatible",
        baseUrl: new URL("https://models.example/v1"),
      }),
      extensionContext,
      sharedContext: sharedContext(),
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();

    await expect(
      runtime.generate(
        "file:///workspace/pair.ts",
        "Explain the current evidence.",
        evidence,
        new AbortController().signal,
        { userPrompt },
        "explain",
      ),
    ).resolves.toMatchObject({
      text: expect.stringContaining("Local explanation"),
      inputTokens: 0,
      outputTokens: 0,
    });

    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(vscodeState.statusItems[0]?.text).toContain(
      "sensitive Chat content kept local",
    );
    runtime.dispose();
  });

  it.each([
    [
      "new-dependency credential",
      {
        ...evidence,
        detail: "Imported module?api_key=workspace-secret",
      },
      "workspace-secret",
    ],
    [
      "diagnostic file URI",
      {
        ...evidence,
        kind: "diagnostic" as const,
        detail: "Failure in file:///Users/alice/private.ts",
      },
      "file:///Users/alice/private.ts",
    ],
    [
      "external-harness vscode-remote URI",
      {
        ...evidence,
        kind: "external-harness" as const,
        references: [
          "vscode-remote://ssh-remote+private-host/workspace/app.ts",
        ],
      },
      "vscode-remote://ssh-remote+private-host/workspace/app.ts",
    ],
  ])("keeps %s automatic evidence on the local provider", async (
    _label,
    sensitiveEvidence,
    rawValue,
  ) => {
    const fetchImplementation = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "remote" } }],
          usage: { prompt_tokens: 10, completion_tokens: 1 },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchImplementation);
    const runtime = new PairRuntime({
      config: config({
        provider: "openai-compatible",
        baseUrl: new URL("https://models.example/v1"),
      }),
      extensionContext,
      sharedContext: sharedContext(),
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();

    await expect(
      runtime.generate(
        "file:///workspace/pair.ts",
        "Explain the current evidence.",
        sensitiveEvidence,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
    });

    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(vscodeState.statusItems[0]?.text).toContain(
      "sensitive Chat content kept local",
    );
    expect(vscodeState.statusItems[0]?.text).not.toContain(rawValue);
    runtime.dispose();
  });

  it("keeps analyzer-produced credential evidence local", async () => {
    let requestBody = "";
    const fetchImplementation = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = String(init?.body ?? "");
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "remote" } }],
            usage: { prompt_tokens: 10, completion_tokens: 1 },
          }),
          { status: 200 },
        );
      },
    );
    vi.stubGlobal("fetch", fetchImplementation);
    const uri = "file:///workspace/pair.ts";
    const before = "export const value = 1;";
    const after =
      'import "https://packages.example/pkg?api_key=workspace-secret";\nexport const value = 1;';
    vscodeState.textDocuments = [document(uri, before, 1)];
    const runtime = new PairRuntime({
      config: config({
        provider: "openai-compatible",
        baseUrl: new URL("https://models.example/v1"),
      }),
      extensionContext,
      sharedContext: sharedContext(),
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();
    vscodeState.textDocuments = [document(uri, after, 2)];

    await (
      runtime as unknown as {
        handleEpisode(episode: {
          uri: string;
          languageId: string;
          previousText: string;
          currentText: string;
          version: number;
          observedAt: number;
        }): Promise<void>;
      }
    ).handleEpisode({
      uri,
      languageId: "typescript",
      previousText: before,
      currentText: after,
      version: 2,
      observedAt: 1,
    });

    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(requestBody).toBe("");
    expect(vscodeState.statusItems[0]?.text).toContain(
      "sensitive request content kept local",
    );
    expect(vscodeState.statusItems[0]?.text).not.toContain(
      "workspace-secret",
    );
    expect(vscodeState.commentThreads).toHaveLength(1);
    runtime.dispose();
  });

  it("uses the raw evidence for an unavailable Copilot local fallback", async () => {
    const originalDetail =
      "Original dependency detail with the module boundary context. ";
    const rawEvidence: Evidence = {
      ...evidence,
      id: "raw-copilot-evidence-file:///workspace/private.ts",
      title: "Original dependency title",
      detail: originalDetail.repeat(30),
      source: "original-analyzer-source",
      references: ["./private-module"],
    };
    const runtime = new PairRuntime({
      config: config({ provider: "vscode-copilot" }),
      extensionContext,
      sharedContext: sharedContext(),
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();

    await expect(
      runtime.generate(
        "file:///workspace/pair.ts",
        "Ask about the evidence.",
        rawEvidence,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      text: expect.stringContaining(originalDetail.repeat(3)),
      inputTokens: 0,
      outputTokens: 0,
    });
    const response = await runtime.generate(
      "file:///workspace/pair.ts",
      "Ask about the evidence.",
      rawEvidence,
      new AbortController().signal,
    );
    expect(response.text).toHaveLength(1_000);

    runtime.dispose();
  });

  it("projects a budget-denied Copilot prompt but uses raw evidence for the local fallback", async () => {
    const rawEvidence: Evidence = {
      ...evidence,
      id: "raw-budget-evidence-file:///workspace/private.ts",
      title: "Original budget title",
      detail: "Original budget detail with repository-specific context.",
      source: "original-budget-analyzer",
      references: ["./private-budget-module"],
    };
    let countedPrompt = "";
    const sendRequest = vi.fn(
      async () =>
        (async function* (): AsyncIterable<string> {
          yield "remote";
        })(),
    );
    const api: VsCodeLanguageModelApi = {
      ...languageModelApi([{ id: "copilot-test", name: "Copilot Test" }]),
      countTokens: async (_model, prompt) => {
        countedPrompt = prompt;
        return 501;
      },
      sendRequest,
    };
    const runtime = new PairRuntime({
      config: config({
        provider: "vscode-copilot",
        budget: {
          maxCalls: 1,
          maxInputTokens: 500,
          maxOutputTokens: 180,
          maxOutputTokensPerCall: 180,
          windowMs: 600_000,
        },
      }),
      extensionContext,
      sharedContext: sharedContext(),
      languageModelApi: api,
      apiKey: undefined,
    });
    await runtime.startSession();

    await expect(
      runtime.generate(
        "file:///workspace/pair.ts",
        "Ask about the evidence.",
        rawEvidence,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      text: expect.stringContaining(rawEvidence.detail),
      inputTokens: 0,
      outputTokens: 0,
    });

    expect(countedPrompt).toContain("Dependency change detected");
    expect(countedPrompt).not.toContain(rawEvidence.id);
    expect(countedPrompt).not.toContain(rawEvidence.title);
    expect(countedPrompt).not.toContain(rawEvidence.detail);
    expect(countedPrompt).not.toContain(rawEvidence.source);
    expect(countedPrompt).not.toContain(rawEvidence.references[0]);
    expect(sendRequest).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it("uses the raw evidence when an OpenAI-compatible provider is unavailable", async () => {
    const rawEvidence: Evidence = {
      ...evidence,
      id: "raw-openai-evidence-file:///workspace/private.ts",
      title: "Original OpenAI title",
      detail: "Original OpenAI detail with local debugging context.",
      source: "original-openai-analyzer",
      references: ["./private-openai-module"],
    };
    let requestBody = "";
    const fetchImplementation = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = String(init?.body ?? "");
        throw new TypeError("model endpoint unavailable");
      },
    );
    vi.stubGlobal("fetch", fetchImplementation);
    const runtime = new PairRuntime({
      config: config({
        provider: "openai-compatible",
        baseUrl: new URL("https://models.example/v1"),
      }),
      extensionContext,
      sharedContext: sharedContext(),
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();

    await expect(
      runtime.generate(
        "file:///workspace/pair.ts",
        "Ask about the evidence.",
        rawEvidence,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      text: expect.stringContaining(rawEvidence.detail),
      inputTokens: 0,
      outputTokens: 0,
    });

    expect(requestBody).toContain("Dependency change detected");
    expect(requestBody).not.toContain(rawEvidence.id);
    expect(requestBody).not.toContain(rawEvidence.title);
    expect(requestBody).not.toContain(rawEvidence.detail);
    expect(requestBody).not.toContain(rawEvidence.source);
    expect(requestBody).not.toContain(rawEvidence.references[0]);
    runtime.dispose();
  });

  it("retains the last stable source through an invalid edit", async () => {
    const uri = "file:///workspace/pair.ts";
    const before =
      "export function load(id: string): string { return id; }";
    const invalid = "export function load(id:";
    const after =
      "export function load(id: number): string { return String(id); }";
    vscodeState.textDocuments = [document(uri, before, 1)];
    const shared = sharedContext();
    const runtime = new PairRuntime({
      config: config(),
      extensionContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();
    const handleEpisode = (
      runtime as unknown as {
        handleEpisode(episode: {
          uri: string;
          languageId: string;
          previousText: string;
          currentText: string;
          version: number;
          observedAt: number;
        }): Promise<void>;
      }
    ).handleEpisode.bind(runtime);

    vscodeState.textDocuments = [document(uri, invalid, 2)];
    await handleEpisode({
      uri,
      languageId: "typescript",
      previousText: before,
      currentText: invalid,
      version: 2,
      observedAt: 1,
    });
    expect(vscodeState.commentThreads).toHaveLength(0);

    vscodeState.textDocuments = [document(uri, after, 3)];
    await handleEpisode({
      uri,
      languageId: "typescript",
      previousText: invalid,
      currentText: after,
      version: 3,
      observedAt: 2,
    });
    expect(vscodeState.commentThreads).toHaveLength(1);
    expect(shared.snapshot().latest?.evidence.references).toEqual(["load"]);
    runtime.dispose();
  });

  it("preserves a shared rolling budget across runtime rebuilds", async () => {
    const fetchImplementation = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "remote" } }],
          usage: { prompt_tokens: 10, completion_tokens: 1 },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchImplementation);
    const limitedConfig = config({
      provider: "openai-compatible",
      baseUrl: new URL("https://models.example/v1"),
      budget: {
        maxCalls: 1,
        maxInputTokens: 6_000,
        maxOutputTokens: 180,
        maxOutputTokensPerCall: 180,
        windowMs: 600_000,
      },
    });
    const budget = new TokenBudget(limitedConfig.budget);
    const first = new PairRuntime({
      config: limitedConfig,
      extensionContext,
      sharedContext: sharedContext(),
      languageModelApi: languageModelApi(),
      apiKey: undefined,
      budget,
    });
    await first.startSession();
    await first.generate(
      "file:///workspace/first.ts",
      "Ask.",
      evidence,
      new AbortController().signal,
    );
    first.dispose();

    const replacement = new PairRuntime({
      config: limitedConfig,
      extensionContext,
      sharedContext: sharedContext(),
      languageModelApi: languageModelApi(),
      apiKey: undefined,
      budget,
    });
    await replacement.startSession();
    await expect(
      replacement.generate(
        "file:///workspace/second.ts",
        "Ask again.",
        evidence,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
    });

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    replacement.dispose();
  });

  it("pre-reserves output capacity across concurrent remote calls", async () => {
    const providerCompletion = deferred<Response>();
    const fetchImplementation = vi.fn(() => providerCompletion.promise);
    vi.stubGlobal("fetch", fetchImplementation);
    const budgetConfig = {
      maxCalls: 2,
      maxInputTokens: 6_000,
      maxOutputTokens: 10,
      maxOutputTokensPerCall: 10,
      windowMs: 600_000,
    };
    const budget = new TokenBudget(budgetConfig);
    const runtime = new PairRuntime({
      config: config({
        provider: "openai-compatible",
        baseUrl: new URL("https://models.example/v1"),
        budget: budgetConfig,
      }),
      extensionContext,
      sharedContext: sharedContext(),
      languageModelApi: languageModelApi(),
      apiKey: undefined,
      budget,
    });
    await runtime.startSession();

    const first = runtime.generate(
      "file:///workspace/first.ts",
      "Ask.",
      evidence,
      new AbortController().signal,
    );
    await vi.waitFor(() => {
      expect(fetchImplementation).toHaveBeenCalledOnce();
    });
    await expect(
      runtime.generate(
        "file:///workspace/second.ts",
        "Ask concurrently.",
        evidence,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();

    providerCompletion.resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "okay" } }],
          usage: { prompt_tokens: 10, completion_tokens: 0 },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    await expect(first).resolves.toMatchObject({
      outputTokens: 4,
    });
    expect(budget.snapshot(Date.now()).remainingOutputTokens).toBe(6);
    runtime.dispose();
  });

  it("settles observed over-limit usage without releasing a concurrent reservation", async () => {
    const overLimitCompletion = deferred<Response>();
    const concurrentCompletion = deferred<Response>();
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => overLimitCompletion.promise)
      .mockImplementationOnce(() => concurrentCompletion.promise);
    vi.stubGlobal("fetch", fetchImplementation);
    const budgetConfig = {
      maxCalls: 2,
      maxInputTokens: 12_000,
      maxOutputTokens: 720,
      maxOutputTokensPerCall: 180,
      windowMs: 600_000,
    };
    const budget = new TokenBudget(budgetConfig);
    const shared = sharedContext();
    const runtime = new PairRuntime({
      config: config({
        provider: "openai-compatible",
        baseUrl: new URL("https://models.example/v1"),
        budget: budgetConfig,
      }),
      extensionContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
      budget,
    });
    await runtime.startSession();

    const overLimit = runtime.generate(
      "file:///workspace/over-limit.ts",
      "Ask.",
      evidence,
      new AbortController().signal,
    );
    await vi.waitFor(() => {
      expect(fetchImplementation).toHaveBeenCalledOnce();
    });
    const concurrent = runtime.generate(
      "file:///workspace/concurrent.ts",
      "Ask concurrently.",
      evidence,
      new AbortController().signal,
    );
    await vi.waitFor(() => {
      expect(fetchImplementation).toHaveBeenCalledTimes(2);
    });

    overLimitCompletion.resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "far beyond the cap" } }],
          usage: { prompt_tokens: 37, completion_tokens: 500 },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    await expect(overLimit).rejects.toMatchObject({
      name: "ModelOutputLimitError",
      inputTokens: 37,
      outputTokens: 500,
      requestDispatched: true,
    });
    expect(budget.snapshot(Date.now())).toMatchObject({
      remainingCalls: 0,
      remainingOutputTokens: 40,
    });
    expect(shared.snapshot().session.remainingOutputTokens).toBe(40);

    concurrentCompletion.resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "okay" } }],
          usage: { prompt_tokens: 10, completion_tokens: 0 },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    await expect(concurrent).resolves.toMatchObject({
      outputTokens: 4,
    });
    const settled = budget.snapshot(Date.now());
    expect(
      budgetConfig.maxOutputTokens - settled.remainingOutputTokens,
    ).toBe(504);
    expect(settled.remainingCalls).toBe(0);
    runtime.dispose();
  });

  it.each([
    ["CJK", "你好世界".repeat(40)],
    ["code-dense", "()=>{value?.map(x=>x+1)??=[];}".repeat(12)],
  ])(
    "uses the official Copilot count to reject an over-budget %s prompt before dispatch",
    async (_label, userPrompt) => {
      const countedTexts: string[] = [];
      const sendRequest = vi.fn(
        async () =>
          (async function* (): AsyncIterable<string> {
            yield "remote response";
          })(),
      );
      const budgetConfig = {
        maxCalls: 1,
        maxInputTokens: 500,
        maxOutputTokens: 180,
        maxOutputTokensPerCall: 180,
        windowMs: 600_000,
      };
      const budget = new TokenBudget(budgetConfig);
      const runtime = new PairRuntime({
        config: config({
          provider: "vscode-copilot",
          budget: budgetConfig,
        }),
        extensionContext,
        sharedContext: sharedContext(),
        languageModelApi: {
          ...languageModelApi([
            {
              id: "copilot-model",
              name: "Copilot model",
            },
          ]),
          countTokens: async (_model, text) => {
            countedTexts.push(text);
            return text.includes(userPrompt)
              ? budgetConfig.maxInputTokens + 1
              : Math.max(1, Math.ceil(text.length / 4));
          },
          sendRequest,
        },
        apiKey: undefined,
        budget,
      });
      await runtime.startSession();

      await expect(
        runtime.generate(
          "file:///workspace/pair.ts",
          "Ask.",
          evidence,
          new AbortController().signal,
          { userPrompt },
        ),
      ).resolves.toMatchObject({
        inputTokens: 0,
        outputTokens: 0,
      });

      expect(countedTexts).toEqual([
        expect.stringContaining(userPrompt),
      ]);
      expect(sendRequest).not.toHaveBeenCalled();
      expect(budget.snapshot(Date.now())).toEqual({
        remainingCalls: 1,
        remainingInputTokens: 500,
        remainingOutputTokens: 180,
      });
      expect(vscodeState.statusItems[0]?.text).toContain(
        "remote input-request-too-large; local-template fallback",
      );
      runtime.dispose();
    },
  );

  it("admits and owns a separate budget reservation for each dispatched Copilot candidate", async () => {
    const firstUnavailable = new Error("first model disappeared");
    const sentModelIds: string[] = [];
    const models = [
      { id: "first", name: "First model" },
      { id: "second", name: "Second model" },
    ];
    const budgetConfig = {
      maxCalls: 2,
      maxInputTokens: 120,
      maxOutputTokens: 360,
      maxOutputTokensPerCall: 180,
      windowMs: 600_000,
    };
    const budget = new TokenBudget(budgetConfig);
    const runtime = new PairRuntime({
      config: config({
        provider: "vscode-copilot",
        budget: budgetConfig,
      }),
      extensionContext,
      sharedContext: sharedContext(),
      languageModelApi: {
        ...languageModelApi(models),
        classifyError: (error) =>
          error === firstUnavailable ? "not-found" : "unknown",
        countTokens: async (model, text) =>
          text === "remote response"
            ? 3
            : model.id === "first"
              ? 40
              : 80,
        sendRequest: async (model) => {
          sentModelIds.push(model.id);
          if (model.id === "first") {
            throw firstUnavailable;
          }
          return (async function* (): AsyncIterable<string> {
            yield "remote response";
          })();
        },
      },
      apiKey: undefined,
      budget,
    });
    await runtime.startSession();

    await expect(
      runtime.generate(
        "file:///workspace/pair.ts",
        "Ask.",
        evidence,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      text: "remote response",
      inputTokens: 80,
      outputTokens: 3,
    });

    expect(sentModelIds).toEqual(["first", "second"]);
    expect(budget.snapshot(Date.now())).toEqual({
      remainingCalls: 0,
      remainingInputTokens: 0,
      remainingOutputTokens: 177,
    });
    runtime.dispose();
  });

  it("routes consent-needed Copilot access only from user actions", async () => {
    let sendCalls = 0;
    const api: VsCodeLanguageModelApi = {
      ...languageModelApi([
        {
          id: "copilot-model",
          name: "Copilot model",
        },
      ]),
      canSendRequest: () => undefined,
      sendRequest: async () => {
        sendCalls += 1;
        return (async function* (): AsyncIterable<string> {
          yield "remote response";
        })();
      },
    };
    const runtime = new PairRuntime({
      config: config({ provider: "vscode-copilot" }),
      extensionContext,
      sharedContext: sharedContext(),
      languageModelApi: api,
      apiKey: undefined,
    });
    await runtime.startSession();
    const automaticRequest: ModelRequest = {
      goal: "Ask.",
      evidence,
      interactionStyle: "ask-first",
    };

    await expect(
      (
        runtime as unknown as {
          generateWithProvider(
            request: ModelRequest,
            signal: AbortSignal,
            source: "automatic",
          ): Promise<ModelResponse>;
        }
      ).generateWithProvider(
        automaticRequest,
        new AbortController().signal,
        "automatic",
      ),
    ).resolves.toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(sendCalls).toBe(0);

    await expect(
      runtime.generate(
        "file:///workspace/pair.ts",
        "Ask.",
        evidence,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      text: "remote response",
    });
    expect(sendCalls).toBe(1);
    runtime.dispose();
  });

  it("disposes Copilot request resources and retains a dispatched timeout reservation", async () => {
    vi.useFakeTimers();
    const budgetConfig = {
      maxCalls: 1,
      maxInputTokens: 500,
      maxOutputTokens: 180,
      maxOutputTokensPerCall: 180,
      windowMs: 600_000,
    };
    const budget = new TokenBudget(budgetConfig);
    const send = deferred<AsyncIterable<string>>();
    const sendStarted = deferred<void>();
    let cancellationCancelled = false;
    let cancellationDisposed = false;
    const runtime = new PairRuntime({
      config: config({
        provider: "vscode-copilot",
        budget: budgetConfig,
      }),
      extensionContext,
      sharedContext: sharedContext(),
      languageModelApi: {
        ...languageModelApi([
          {
            id: "copilot-model",
            name: "Copilot model",
          },
        ]),
        createCancellationTokenSource: () => ({
          cancel: () => {
            cancellationCancelled = true;
          },
          dispose: () => {
            cancellationDisposed = true;
          },
        }),
        sendRequest: () => {
          sendStarted.resolve();
          return send.promise;
        },
      },
      apiKey: undefined,
      budget,
    });

    try {
      await runtime.startSession();
      const operation = runtime.generate(
        "file:///workspace/pair.ts",
        "Ask.",
        evidence,
        new AbortController().signal,
      );
      const rejection = operation.catch((error: unknown) => error);
      await sendStarted.promise;
      await vi.advanceTimersByTimeAsync(15_000);

      await expect(rejection).resolves.toMatchObject({
        name: "ModelProviderTimeoutError",
        providerId: "vscode-copilot",
        requestDispatched: true,
      });
      expect(cancellationCancelled).toBe(true);
      expect(cancellationDisposed).toBe(true);
      expect(budget.snapshot(Date.now()).remainingCalls).toBe(0);
      send.reject(new Error("late send failure"));
      await Promise.resolve();
    } finally {
      runtime.dispose();
      vi.useRealTimers();
    }
  });

  it("does not dispatch another Copilot candidate after its exact reservation is denied", async () => {
    const firstUnavailable = new Error("first model disappeared");
    const sentModelIds: string[] = [];
    const models = [
      { id: "first", name: "First model" },
      { id: "second", name: "Second model" },
    ];
    const budgetConfig = {
      maxCalls: 1,
      maxInputTokens: 120,
      maxOutputTokens: 180,
      maxOutputTokensPerCall: 180,
      windowMs: 600_000,
    };
    const budget = new TokenBudget(budgetConfig);
    const runtime = new PairRuntime({
      config: config({
        provider: "vscode-copilot",
        budget: budgetConfig,
      }),
      extensionContext,
      sharedContext: sharedContext(),
      languageModelApi: {
        ...languageModelApi(models),
        classifyError: (error) =>
          error === firstUnavailable ? "not-found" : "unknown",
        countTokens: async (model, text) =>
          text === "remote response"
            ? 3
            : model.id === "first"
              ? 40
              : 80,
        sendRequest: async (model) => {
          sentModelIds.push(model.id);
          if (model.id === "first") {
            throw firstUnavailable;
          }
          return (async function* (): AsyncIterable<string> {
            yield "remote response";
          })();
        },
      },
      apiKey: undefined,
      budget,
    });
    await runtime.startSession();

    await expect(
      runtime.generate(
        "file:///workspace/pair.ts",
        "Ask.",
        evidence,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
    });

    expect(sentModelIds).toEqual(["first"]);
    expect(budget.snapshot(Date.now()).remainingCalls).toBe(0);
    runtime.dispose();
  });

  it("does not reserve or dispatch when a session stops during Copilot input counting", async () => {
    const budgetConfig = {
      maxCalls: 1,
      maxInputTokens: 500,
      maxOutputTokens: 180,
      maxOutputTokensPerCall: 180,
      windowMs: 600_000,
    };
    const budget = new TokenBudget(budgetConfig);
    const sendRequest = vi.fn(
      async () =>
        (async function* (): AsyncIterable<string> {
          yield "remote response";
        })(),
    );
    const runtimeHolder: { current?: PairRuntime } = {};
    const runtime = new PairRuntime({
      config: config({
        provider: "vscode-copilot",
        budget: budgetConfig,
      }),
      extensionContext,
      sharedContext: sharedContext(),
      languageModelApi: {
        ...languageModelApi([
          {
            id: "copilot-model",
            name: "Copilot model",
          },
        ]),
        countTokens: async () => {
          runtimeHolder.current?.stopSession();
          return 10;
        },
        sendRequest,
      },
      apiKey: undefined,
      budget,
    });
    runtimeHolder.current = runtime;
    await runtime.startSession();

    await expect(
      runtime.generate(
        "file:///workspace/pair.ts",
        "Ask.",
        evidence,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(sendRequest).not.toHaveBeenCalled();
    expect(budget.snapshot(Date.now())).toEqual({
      remainingCalls: 1,
      remainingInputTokens: 500,
      remainingOutputTokens: 180,
    });
    runtime.dispose();
  });

  it("does not reserve an OpenAI request cancelled after provider preparation", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchImplementation);
    const budgetConfig = {
      maxCalls: 1,
      maxInputTokens: 6_000,
      maxOutputTokens: 180,
      maxOutputTokensPerCall: 180,
      windowMs: 600_000,
    };
    const budget = new TokenBudget(budgetConfig);
    const runtime = new PairRuntime({
      config: config({
        provider: "openai-compatible",
        baseUrl: new URL("https://models.example/v1"),
        budget: budgetConfig,
      }),
      extensionContext,
      sharedContext: sharedContext(),
      languageModelApi: languageModelApi(),
      apiKey: undefined,
      budget,
    });
    await runtime.startSession();
    const cancellation = new AbortController();

    const pending = runtime.generate(
      "file:///workspace/pair.ts",
      "Ask.",
      evidence,
      cancellation.signal,
    );
    cancellation.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(budget.snapshot(Date.now())).toEqual({
      remainingCalls: 1,
      remainingInputTokens: 6_000,
      remainingOutputTokens: 180,
    });
    runtime.dispose();
  });

  it("surfaces cancellation and preserves the budget after rejected selection following stop", async () => {
    const selection = deferred<readonly CopilotModelReference[]>();
    const selectionFailure = new Error("selection denied");
    let selectionStarted = false;
    const budgetConfig = config().budget;
    const budget = new TokenBudget({
      ...budgetConfig,
      maxCalls: 1,
    });
    const runtime = new PairRuntime({
      config: config({ provider: "vscode-copilot", budget: budgetConfig }),
      extensionContext,
      sharedContext: sharedContext(),
      languageModelApi: {
        ...languageModelApi(),
        selectChatModels: async () => {
          selectionStarted = true;
          return selection.promise;
        },
        classifyError: (error) =>
          error === selectionFailure ? "no-permissions" : "unknown",
      },
      apiKey: undefined,
      budget,
    });
    await runtime.startSession();

    const pending = runtime.generate(
      "file:///workspace/pair.ts",
      "Ask.",
      evidence,
      new AbortController().signal,
    );
    await vi.waitFor(() => {
      expect(selectionStarted).toBe(true);
    });
    runtime.stopSession();
    selection.reject(selectionFailure);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    expect(budget.snapshot(Date.now()).remainingCalls).toBe(1);
    runtime.dispose();
  });

  it("does not let a disposed provider completion overwrite replacement runtime state", async () => {
    const providerCompletion = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => providerCompletion.promise),
    );
    const shared = sharedContext();
    const oldRuntime = new PairRuntime({
      config: config({
        provider: "openai-compatible",
        baseUrl: new URL("https://model.example/v1"),
        statusWarning: "old runtime warning",
      }),
      extensionContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await oldRuntime.startSession();
    const pendingGeneration = oldRuntime.generate(
      "file:///workspace/old.ts",
      "Ask a question.",
      evidence,
      new AbortController().signal,
    );
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce();
    });

    oldRuntime.dispose();
    const oldStatus = vscodeState.statusItems[0]!;
    const replacementRuntime = new PairRuntime({
      config: config({ statusWarning: "replacement runtime detail" }),
      extensionContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await replacementRuntime.startSession();
    const replacementEvidence = {
      uri: "file:///workspace/replacement.ts",
      evidence: { ...evidence, id: "replacement-evidence" },
      question: "Replacement question",
    };
    shared.publishEvidence(replacementEvidence);
    const replacementSnapshot = shared.snapshot();

    providerCompletion.resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "stale provider response" } }],
          usage: { prompt_tokens: 10, completion_tokens: 3 },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    await expect(pendingGeneration).resolves.toMatchObject({
      text: "stale provider response",
    });

    expect(shared.snapshot()).toEqual(replacementSnapshot);
    expect(shared.snapshot().latest).toEqual(replacementEvidence);
    expect(oldStatus.writesAfterDispose).toEqual([]);
    replacementRuntime.dispose();
  });

  it("does not let a deferred reset overwrite replacement runtime state", async () => {
    const resetCompletion = deferred<void>();
    let resetStarted = false;
    const resetContext = {
      globalState: {
        get: () => undefined,
        update: async () => {
          resetStarted = true;
          await resetCompletion.promise;
        },
      },
    } as unknown as vscode.ExtensionContext;
    const shared = sharedContext();
    const oldRuntime = new PairRuntime({
      config: config({ statusWarning: "old runtime warning" }),
      extensionContext: resetContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await oldRuntime.startSession();

    const pendingReset = oldRuntime.resetMemory();
    await vi.waitFor(() => {
      expect(resetStarted).toBe(true);
    });
    oldRuntime.dispose();
    const oldStatus = vscodeState.statusItems[0]!;

    const replacementRuntime = new PairRuntime({
      config: config({ statusWarning: "replacement runtime detail" }),
      extensionContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await replacementRuntime.startSession();
    const replacementEvidence = {
      uri: "file:///workspace/replacement.ts",
      evidence: { ...evidence, id: "replacement-reset-evidence" },
      question: "Replacement reset question",
    };
    shared.publishEvidence(replacementEvidence);
    const replacementSnapshot = shared.snapshot();

    resetCompletion.resolve();
    await pendingReset;

    expect(shared.snapshot()).toEqual(replacementSnapshot);
    expect(oldStatus.writesAfterDispose).toEqual([]);
    replacementRuntime.dispose();
  });

  it("stops pending session preparation before memory reset can publish cleared state", async () => {
    const memoryLoad = deferred<unknown>();
    let loadStarted = false;
    let stored: unknown;
    const resetContext = {
      globalState: {
        get: async () => {
          loadStarted = true;
          return memoryLoad.promise;
        },
        update: async (_key: string, value: unknown) => {
          stored = value;
        },
      },
    } as unknown as vscode.ExtensionContext;
    const shared = sharedContext();
    const runtime = new PairRuntime({
      config: config(),
      extensionContext: resetContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });

    const pendingStart = runtime.startSession();
    await vi.waitFor(() => {
      expect(loadStarted).toBe(true);
    });
    await runtime.resetMemory();
    memoryLoad.resolve({
      version: 1,
      preferences: {
        interventionStyle: "active",
        pauseThresholdMs: 1_000,
      },
      dismissedEvidenceByRepository: {
        "file:///workspace": ["stale-evidence"],
      },
      approvedEvidence: [],
    });

    await expect(pendingStart).resolves.toMatchObject({
      kind: "already-stopped",
      active: false,
    });
    expect(runtime.isSessionActive()).toBe(false);
    expect(shared.snapshot().session.active).toBe(false);
    expect(stored).toMatchObject({
      version: 1,
      preferences: { interventionStyle: "balanced" },
      dismissedEvidenceByRepository: {},
    });
    runtime.dispose();
  });

  it("does not let an old start completion reset newer-generation status details", async () => {
    const oldDiscovery = deferred<
      ReadonlyArray<{ relativePath: string; toString(): string }>
    >();
    vscodeState.findFiles
      .mockImplementationOnce(() => oldDiscovery.promise)
      .mockResolvedValueOnce([
        {
          relativePath: "AGENTS.md",
          toString: () => "file:///workspace/AGENTS.md",
        },
      ]);
    const runtime = new PairRuntime({
      config: config({
        provider: "vscode-copilot",
      }),
      extensionContext,
      sharedContext: sharedContext(),
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });

    const oldStart = runtime.startSession();
    await vi.waitFor(() => {
      expect(vscodeState.findFiles).toHaveBeenCalledOnce();
    });
    runtime.stopSession();
    await expect(runtime.startSession()).resolves.toMatchObject({
      kind: "started",
    });
    await runtime.generate(
      "file:///workspace/new.ts",
      "Ask a question.",
      evidence,
      new AbortController().signal,
    );
    const status = vscodeState.statusItems[0]!;
    expect(status.text).toContain(
      "Copilot unavailable (no-model); local-template fallback",
    );
    expect(status.text).toContain("AGENTS.md instructions detected");
    const newGenerationStatus = status.text;

    oldDiscovery.resolve([]);
    await expect(oldStart).resolves.toMatchObject({
      kind: "already-stopped",
    });

    expect(status.text).toBe(newGenerationStatus);
    runtime.dispose();
  });

  it("keeps fallback status and provider state on redundant start", async () => {
    const shared = sharedContext();
    const runtime = new PairRuntime({
      config: config({
        provider: "vscode-copilot",
      }),
      extensionContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();
    await runtime.generate(
      "file:///workspace/pair.ts",
      "Ask a question.",
      evidence,
      new AbortController().signal,
    );
    const status = vscodeState.statusItems[0]!;
    const fallbackStatus = status.text;
    const fallbackSession = shared.snapshot().session;
    expect(fallbackStatus).toContain(
      "Copilot unavailable (no-model); local-template fallback",
    );
    expect(fallbackSession.provider).toBe("local-template");

    await expect(runtime.startSession()).resolves.toMatchObject({
      kind: "already-active",
    });

    expect(status.text).toBe(fallbackStatus);
    expect(shared.snapshot().session).toEqual(fallbackSession);
    runtime.dispose();
  });

  it("compares the first stable edit with the episode previous text when no stable snapshot exists", async () => {
    const uri = "file:///workspace/first-stable.ts";
    const invalid = "import {";
    const stable =
      'import { save } from "./repository";\nexport const value = save;';
    vscodeState.textDocuments = [document(uri, invalid, 1)];
    const runtime = new PairRuntime({
      config: config(),
      extensionContext,
      sharedContext: sharedContext(),
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();
    vscodeState.textDocuments = [document(uri, stable, 2)];

    await (
      runtime as unknown as {
        handleEpisode(episode: {
          uri: string;
          languageId: string;
          previousText: string;
          currentText: string;
          version: number;
          observedAt: number;
        }): Promise<void>;
      }
    ).handleEpisode({
      uri,
      languageId: "typescript",
      previousText: invalid,
      currentText: stable,
      version: 2,
      observedAt: 1,
    });
    const state = (
      runtime as unknown as {
        documentState: {
          latestEvidence(uri: string): readonly Evidence[];
        };
      }
    ).documentState;

    expect(state.latestEvidence(uri)).toEqual([
      expect.objectContaining({
        kind: "new-dependency",
        references: ["./repository"],
      }),
    ]);
    runtime.dispose();
  });

  it("invalidates URI evidence and deferred Chat output at the edit boundary", async () => {
    const modelCompletion = deferred<Response>();
    let providerSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        providerSignal = init?.signal ?? undefined;
        return modelCompletion.promise;
      }),
    );
    const uri = "file:///workspace/pair.ts";
    const initialDocument = document(uri, "const value = before;", 1);
    vscodeState.textDocuments = [initialDocument];
    const shared = sharedContext();
    const runtime = new PairRuntime({
      config: config({
        provider: "openai-compatible",
        baseUrl: new URL("https://model.example/v1"),
        budget: {
          maxCalls: 1,
          maxInputTokens: 6_000,
          maxOutputTokens: 180,
          maxOutputTokensPerCall: 180,
          windowMs: 600_000,
        },
      }),
      extensionContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();
    const inline = (
      runtime as unknown as {
        inlineController: {
          render(
            uri: vscode.Uri,
            range: vscode.Range,
            question: string,
            evidence: Evidence,
          ): void;
        };
      }
    ).inlineController;
    inline.render(
      initialDocument.uri as vscode.Uri,
      {} as vscode.Range,
      "Stale question",
      evidence,
    );
    const documentState = (
      runtime as unknown as {
        documentState: {
          recordAnalysis(
            uri: string,
            text: string,
            evidence: readonly Evidence[],
          ): void;
          latestEvidence(uri: string): readonly Evidence[];
        };
      }
    ).documentState;
    documentState.recordAnalysis(uri, initialDocument.getText(), [evidence]);
    shared.publishEvidence({
      uri,
      evidence,
      question: "Stale question",
    });
    let handler: vscode.ChatRequestHandler | undefined;
    const markdown = vi.fn();
    registerPairChatParticipant(
      (_id, registeredHandler) => {
        handler = registeredHandler;
        return { dispose: () => undefined } as vscode.ChatParticipant;
      },
      shared,
      runtime,
      {
        requestLifecycle: {
          register: (requestUri, request) =>
            runtime.registerChatRequest(requestUri, request),
        },
      },
    );

    const pendingResponse = handler!(
      { command: "why", prompt: "" } as vscode.ChatRequest,
      {} as vscode.ChatContext,
      { markdown } as unknown as vscode.ChatResponseStream,
      {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => undefined }),
      } as vscode.CancellationToken,
    );
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce();
    });
    await runtime.generate(
      "file:///workspace/other.ts",
      "Use the exhausted budget fallback.",
      evidence,
      new AbortController().signal,
    );
    const status = vscodeState.statusItems[0]!;
    expect(status.text).toContain("remote call-limit; local-template fallback");

    const editedDocument = document(uri, "const value = after;", 2);
    vscodeState.textDocuments = [editedDocument];
    vscodeState.changeListeners[0]!({
      document: editedDocument,
      contentChanges: [{ text: "after" }],
    });
    const stateAfterEdit = shared.snapshot();
    const statusAfterEdit = status.text;

    expect(providerSignal?.aborted).toBe(true);
    expect(stateAfterEdit.latest).toBeUndefined();
    expect(documentState.latestEvidence(uri)).toEqual([]);
    expect(vscodeState.commentThreads[0]?.disposed).toBe(true);

    modelCompletion.resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "stale provider response" } }],
          usage: { prompt_tokens: 10, completion_tokens: 3 },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    await pendingResponse;

    expect(markdown).not.toHaveBeenCalled();
    expect(shared.snapshot()).toEqual(stateAfterEdit);
    expect(status.text).toBe(statusAfterEdit);
    runtime.dispose();
  });

  it("atomically replaces removed roots with added-root memory and document seeds", async () => {
    const removedRoot = {
      uri: { toString: () => "file:///workspace/removed" },
    };
    const addedRoot = {
      uri: { toString: () => "file:///workspace/added" },
    };
    vscodeState.workspaceFolders = [removedRoot];
    vscodeState.getWorkspaceFolder.mockImplementation((uri) =>
      vscodeState.workspaceFolders.find((folder) =>
        uri.toString().startsWith(`${folder.uri.toString()}/`),
      ),
    );
    const removedDocument = document(
      `${removedRoot.uri.toString()}/removed.ts`,
      "export const removed = true;",
    );
    const addedDocument = document(
      `${addedRoot.uri.toString()}/added.ts`,
      "export const added = true;",
    );
    vscodeState.textDocuments = [removedDocument];
    const stored = {
      version: 1,
      preferences: {
        interventionStyle: "active",
        interventionStyleExplicit: true,
        pauseThresholdMs: 1_000,
      },
      dismissedEvidenceByRepository: {
        [removedRoot.uri.toString()]: [
          hashEvidenceIdentity("removed-evidence"),
        ],
        [addedRoot.uri.toString()]: [
          hashEvidenceIdentity("added-evidence"),
        ],
      },
      dismissedRepositoryOrder: [
        removedRoot.uri.toString(),
        addedRoot.uri.toString(),
      ],
      approvedEvidence: [],
    };
    const runtime = new PairRuntime({
      config: config({ interventionStyle: "eco" }),
      extensionContext: {
        globalState: {
          get: () => stored,
          update: async () => undefined,
        },
      } as unknown as vscode.ExtensionContext,
      sharedContext: sharedContext(),
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();

    vscodeState.workspaceFolders = [addedRoot];
    vscodeState.textDocuments = [addedDocument];
    vscodeState.workspaceFolderListeners[0]!({
      added: [addedRoot],
      removed: [removedRoot],
    });

    const state = (
      runtime as unknown as {
        documentState: {
          previousText(uri: string): string | undefined;
        };
      }
    ).documentState;
    const dismissals = () =>
      (
        runtime as unknown as {
          dismissedEvidenceIdsByRepository: Map<
            string,
            ReadonlySet<string>
          >;
        }
      ).dismissedEvidenceIdsByRepository;
    await vi.waitFor(() => {
      expect(state.previousText(addedDocument.uri.toString())).toBe(
        "export const added = true;",
      );
    });

    expect(state.previousText(removedDocument.uri.toString())).toBeUndefined();
    expect([...dismissals().keys()].sort()).toEqual(
      ["file:///workspace/added", "no-workspace"].sort(),
    );
    expect(dismissals().get(addedRoot.uri.toString())).toEqual(
      new Set([hashEvidenceIdentity("added-evidence")]),
    );
    expect(
      (runtime as unknown as { interventionStyle: string }).interventionStyle,
    ).toBe("active");
    expect(runtime.isSessionActive()).toBe(true);
    runtime.dispose();
  });

  it("blocks document work and cancels transient work during a deferred workspace refresh", async () => {
    const refreshDiscovery = deferred<
      ReadonlyArray<{ relativePath: string; toString(): string }>
    >();
    const uri = "file:///workspace/src/pair.ts";
    const initialDocument = document(uri, "export const initial = true;");
    const refreshedDocument = document(
      uri,
      "export const refreshed = true;",
      2,
    );
    const openedDuringRefresh = document(
      "file:///workspace/src/opened.ts",
      "export const opened = true;",
    );
    vscodeState.textDocuments = [initialDocument];
    const shared = sharedContext();
    const runtime = new PairRuntime({
      config: config(),
      extensionContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();
    vscodeState.findFiles.mockImplementationOnce(
      () => refreshDiscovery.promise,
    );
    (
      runtime as unknown as {
        renderIntervention(
          document: vscode.TextDocument,
          evidence: Evidence,
          question: string,
        ): void;
      }
    ).renderIntervention(
      initialDocument as unknown as vscode.TextDocument,
      evidence,
      "Pending question",
    );
    const modelRequest = new AbortController();
    (
      runtime as unknown as {
        requestByUri: Map<string, AbortController>;
      }
    ).requestByUri.set(uri, modelRequest);
    const chatRequest = new AbortController();
    runtime.registerChatRequest(uri, chatRequest);
    vscodeState.textDocuments = [refreshedDocument];

    vscodeState.workspaceFolderListeners[0]!({
      added: [],
      removed: [],
    });

    const state = (
      runtime as unknown as {
        documentState: {
          previousText(uri: string): string | undefined;
        };
      }
    ).documentState;
    expect(runtime.isSessionActive()).toBe(true);
    expect(modelRequest.signal.aborted).toBe(true);
    expect(chatRequest.signal.aborted).toBe(true);
    expect(shared.snapshot().latest).toBeUndefined();
    expect(shared.snapshot().session.active).toBe(true);
    expect(vscodeState.commentThreads[0]?.disposed).toBe(true);
    expect(state.previousText(uri)).toBeUndefined();

    const requestDuringRefresh = new AbortController();
    runtime.registerChatRequest(uri, requestDuringRefresh);
    expect(requestDuringRefresh.signal.aborted).toBe(true);
    vscodeState.openListeners[0]!(openedDuringRefresh);
    expect(
      state.previousText(openedDuringRefresh.uri.toString()),
    ).toBeUndefined();

    refreshDiscovery.resolve([]);
    await vi.waitFor(() => {
      expect(state.previousText(uri)).toBe(
        "export const refreshed = true;",
      );
      expect(shared.snapshot().session.active).toBe(true);
    });
    expect(runtime.isSessionActive()).toBe(true);
    runtime.dispose();
  });

  it("allows only the latest workspace-folder event to commit refreshed roots", async () => {
    const firstRefresh = deferred<
      ReadonlyArray<{ relativePath: string; toString(): string }>
    >();
    const secondRefresh = deferred<
      ReadonlyArray<{ relativePath: string; toString(): string }>
    >();
    const firstRoot = {
      uri: { toString: () => "file:///workspace/first-refresh" },
    };
    const secondRoot = {
      uri: { toString: () => "file:///workspace/second-refresh" },
    };
    const firstDocument = document(
      `${firstRoot.uri.toString()}/first.ts`,
      "export const first = true;",
    );
    const secondDocument = document(
      `${secondRoot.uri.toString()}/second.ts`,
      "export const second = true;",
    );
    vscodeState.getWorkspaceFolder.mockImplementation((uri) =>
      vscodeState.workspaceFolders.find((folder) =>
        uri.toString().startsWith(`${folder.uri.toString()}/`),
      ),
    );
    const runtime = new PairRuntime({
      config: config(),
      extensionContext,
      sharedContext: sharedContext(),
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();
    vscodeState.findFiles
      .mockImplementationOnce(() => firstRefresh.promise)
      .mockImplementationOnce(() => secondRefresh.promise);

    vscodeState.workspaceFolders = [firstRoot];
    vscodeState.textDocuments = [firstDocument];
    vscodeState.workspaceFolderListeners[0]!({
      added: [firstRoot],
      removed: [],
    });
    await vi.waitFor(() => {
      expect(vscodeState.findFiles).toHaveBeenCalledTimes(2);
    });

    vscodeState.workspaceFolders = [secondRoot];
    vscodeState.textDocuments = [secondDocument];
    vscodeState.workspaceFolderListeners[0]!({
      added: [secondRoot],
      removed: [firstRoot],
    });
    await vi.waitFor(() => {
      expect(vscodeState.findFiles).toHaveBeenCalledTimes(3);
    });

    secondRefresh.resolve([]);
    const state = (
      runtime as unknown as {
        documentState: {
          previousText(uri: string): string | undefined;
        };
      }
    ).documentState;
    await vi.waitFor(() => {
      expect(state.previousText(secondDocument.uri.toString())).toBe(
        "export const second = true;",
      );
    });
    firstRefresh.resolve([]);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(state.previousText(firstDocument.uri.toString())).toBeUndefined();
    expect(state.previousText(secondDocument.uri.toString())).toBe(
      "export const second = true;",
    );
    expect(runtime.isSessionActive()).toBe(true);
    runtime.dispose();
  });

  it("does not let a deferred workspace refresh overwrite a rapid stop and restart", async () => {
    const staleRefresh = deferred<
      ReadonlyArray<{ relativePath: string; toString(): string }>
    >();
    const staleDocument = document(
      "file:///workspace/stale.ts",
      "export const stale = true;",
    );
    const restartedDocument = document(
      "file:///workspace/restarted.ts",
      "export const restarted = true;",
    );
    const shared = sharedContext();
    const runtime = new PairRuntime({
      config: config(),
      extensionContext,
      sharedContext: shared,
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();
    vscodeState.findFiles.mockImplementationOnce(
      () => staleRefresh.promise,
    );
    vscodeState.textDocuments = [staleDocument];
    vscodeState.workspaceFolderListeners[0]!({
      added: [],
      removed: [],
    });
    await vi.waitFor(() => {
      expect(vscodeState.findFiles).toHaveBeenCalledTimes(2);
    });

    runtime.stopSession();
    vscodeState.textDocuments = [restartedDocument];
    await runtime.startSession();
    staleRefresh.resolve([]);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    const state = (
      runtime as unknown as {
        documentState: {
          previousText(uri: string): string | undefined;
        };
      }
    ).documentState;
    expect(state.previousText(staleDocument.uri.toString())).toBeUndefined();
    expect(state.previousText(restartedDocument.uri.toString())).toBe(
      "export const restarted = true;",
    );
    expect(runtime.isSessionActive()).toBe(true);
    expect(shared.snapshot().session.active).toBe(true);
    runtime.dispose();
  });

  it("does not let a deferred workspace refresh commit after disposal", async () => {
    const refreshDiscovery = deferred<
      ReadonlyArray<{ relativePath: string; toString(): string }>
    >();
    const refreshedDocument = document(
      "file:///workspace/refreshed-after-dispose.ts",
      "export const stale = true;",
    );
    const runtime = new PairRuntime({
      config: config(),
      extensionContext,
      sharedContext: sharedContext(),
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();
    vscodeState.findFiles.mockImplementationOnce(
      () => refreshDiscovery.promise,
    );
    vscodeState.textDocuments = [refreshedDocument];
    vscodeState.workspaceFolderListeners[0]!({
      added: [],
      removed: [],
    });
    await vi.waitFor(() => {
      expect(vscodeState.findFiles).toHaveBeenCalledTimes(2);
    });

    runtime.dispose();
    const status = vscodeState.statusItems[0]!;
    refreshDiscovery.resolve([]);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    const state = (
      runtime as unknown as {
        documentState: {
          previousText(uri: string): string | undefined;
        };
      }
    ).documentState;
    expect(state.previousText(refreshedDocument.uri.toString())).toBeUndefined();
    expect(vscodeState.workspaceFolderListeners).toHaveLength(0);
    expect(status.writesAfterDispose).toEqual([]);
  });

  it("loads a newly added root's dismissals before reviewing its documents", async () => {
    const existingRoot = {
      uri: { toString: () => "file:///workspace/existing" },
    };
    const addedRoot = {
      uri: { toString: () => "file:///workspace/new-root" },
    };
    const uri = `${addedRoot.uri.toString()}/src/private.ts`;
    const currentDocument = document(uri, "export const value = 1;");
    const diagnosticEvidence: Evidence = {
      ...evidence,
      id: stableDiagnosticEvidenceId(
        uri,
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 6 },
        },
        "typescript",
        ["TS2322"],
        "Type mismatch",
      ),
      kind: "diagnostic",
      title: "Editor diagnostic",
      detail: "Type mismatch",
      source: "typescript",
      references: ["TS2322"],
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 6 },
      },
    };
    const stored = {
      version: 1,
      preferences: {
        interventionStyle: "balanced",
        interventionStyleExplicit: false,
        pauseThresholdMs: 1_000,
      },
      dismissedEvidenceByRepository: {
        [addedRoot.uri.toString()]: [
          hashEvidenceIdentity(diagnosticEvidence.id),
        ],
      },
      dismissedRepositoryOrder: [addedRoot.uri.toString()],
      approvedEvidence: [],
    };
    vscodeState.workspaceFolders = [existingRoot];
    vscodeState.getWorkspaceFolder.mockImplementation((documentUri) =>
      vscodeState.workspaceFolders.find((folder) =>
        documentUri
          .toString()
          .startsWith(`${folder.uri.toString()}/`),
      ),
    );
    const runtime = new PairRuntime({
      config: config(),
      extensionContext: {
        globalState: {
          get: () => stored,
          update: async () => undefined,
        },
      } as unknown as vscode.ExtensionContext,
      sharedContext: sharedContext(),
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });
    await runtime.startSession();

    vscodeState.workspaceFolders = [existingRoot, addedRoot];
    vscodeState.textDocuments = [currentDocument];
    vscodeState.activeTextEditor = {
      document: currentDocument,
      selection: {
        isEmpty: false,
        active: { line: 0, character: 0 },
        start: diagnosticEvidence.range.start,
        end: diagnosticEvidence.range.end,
      },
    };
    vscodeState.diagnostics.push({
      range: diagnosticEvidence.range,
      message: diagnosticEvidence.detail,
      severity: 1,
      source: diagnosticEvidence.source,
      code: diagnosticEvidence.references[0]!,
    });
    vscodeState.workspaceFolderListeners[0]!({
      added: [addedRoot],
      removed: [],
    });
    await vi.waitFor(() => {
      const dismissals = (
        runtime as unknown as {
          dismissedEvidenceIdsByRepository: Map<
            string,
            ReadonlySet<string>
          >;
        }
      ).dismissedEvidenceIdsByRepository;
      expect(dismissals.get(addedRoot.uri.toString())).toContain(
        hashEvidenceIdentity(diagnosticEvidence.id),
      );
    });

    await runtime.reviewCurrentBlock();

    expect(vscodeState.commentThreads).toHaveLength(0);
    expect(runtime.isSessionActive()).toBe(true);
    runtime.dispose();
  });

  it("commits document seeds from the open documents at preparation commit", async () => {
    const discovery = deferred<
      ReadonlyArray<{ relativePath: string; toString(): string }>
    >();
    vscodeState.findFiles.mockImplementationOnce(() => discovery.promise);
    const oldDocument = document("file:///workspace/closed.ts", "closed seed");
    const currentDocument = document(
      "file:///workspace/current.ts",
      "current seed",
    );
    vscodeState.textDocuments = [oldDocument];
    const runtime = new PairRuntime({
      config: config(),
      extensionContext,
      sharedContext: sharedContext(),
      languageModelApi: languageModelApi(),
      apiKey: undefined,
    });

    const pendingStart = runtime.startSession();
    await vi.waitFor(() => {
      expect(vscodeState.findFiles).toHaveBeenCalledOnce();
    });
    vscodeState.textDocuments = [currentDocument];
    discovery.resolve([]);
    await pendingStart;

    const state = (
      runtime as unknown as {
        documentState: {
          previousText(uri: string): string | undefined;
        };
      }
    ).documentState;
    expect(state.previousText(oldDocument.uri.toString())).toBeUndefined();
    expect(state.previousText(currentDocument.uri.toString())).toBe(
      "current seed",
    );
    runtime.dispose();
  });
});
