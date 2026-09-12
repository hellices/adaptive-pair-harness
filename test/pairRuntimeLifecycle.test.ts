import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import type { PairConfig } from "../src/config/pairConfig";
import {
  hashEvidenceIdentity,
  PairMemoryStore,
} from "../src/core/memoryStore";
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
    listeners.push(listener);
    return {
      dispose: () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) {
          listeners.splice(index, 1);
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
            },
          };
          vscodeState.commentThreads.push(thread);
          return thread;
        },
        dispose: () => undefined,
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
    },
  };
});

import {
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
  vscodeState.statusItems.length = 0;
  vscodeState.commentThreads.length = 0;
  vscodeState.diagnostics.length = 0;
  vscodeState.activeTextEditor = undefined;
  vscodeState.warningMessages.length = 0;
  vi.unstubAllGlobals();
});

describe("PairRuntime lifecycle ownership", () => {
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

  it("keeps credential-bearing automatic evidence local", async () => {
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
    expect(vscodeState.commentThreads).toHaveLength(1);
    expect(vscodeState.statusItems[0]?.text).toContain(
      "sensitive evidence suppressed",
    );
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

  it("refunds an exact pre-dispatch Copilot reservation after stop", async () => {
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
    await expect(pending).rejects.toMatchObject({
      name: "CopilotModelUnavailableError",
      requestMayHaveBeenSent: false,
    });

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
