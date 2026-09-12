import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import type { PairConfig } from "../src/config/pairConfig";
import type { Evidence } from "../src/core/types";

interface TestDocument {
  readonly uri: {
    readonly scheme: string;
    toString(): string;
  };
  readonly languageId: string;
  readonly version: number;
  getText(): string;
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
    public constructor(public readonly value: string) {}
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
    LanguageModelError,
    MarkdownString,
    StatusBarAlignment: { Right: 1 },
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
      getDiagnostics: () => [],
    },
    window: {
      activeTextEditor: undefined,
      createStatusBarItem: () => {
        const status = new TestStatusBarItem();
        vscodeState.statusItems.push(status);
        return status;
      },
      showErrorMessage: async () => undefined,
      showInformationMessage: async () => undefined,
    },
    workspace: {
      workspaceFolders: [
        {
          uri: {
            toString: () => "file:///workspace",
          },
        },
      ],
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

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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
  sendRequest: async () =>
    (async function* (): AsyncIterable<string> {
      yield "response";
    })(),
});

const extensionContext = {
  workspaceState: {
    get: () => undefined,
    update: async () => undefined,
  },
} as unknown as vscode.ExtensionContext;

const document = (uri: string, text: string, version = 1): TestDocument => ({
  uri: {
    scheme: "file",
    toString: () => uri,
  },
  languageId: "typescript",
  version,
  getText: () => text,
});

beforeEach(() => {
  vscodeState.textDocuments = [];
  vscodeState.findFiles.mockReset();
  vscodeState.findFiles.mockResolvedValue([]);
  vscodeState.openListeners.length = 0;
  vscodeState.closeListeners.length = 0;
  vscodeState.changeListeners.length = 0;
  vscodeState.statusItems.length = 0;
  vscodeState.commentThreads.length = 0;
  vi.unstubAllGlobals();
});

describe("PairRuntime lifecycle ownership", () => {
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
