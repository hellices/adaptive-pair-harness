import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionContext } from "vscode";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PAIR_TOOL_CATALOG,
  nativeToolName,
} from "@adaptive-pair/harness";
import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import {
  PairCoordinator,
  type EffectPort,
  type EffectRequest,
  type EffectResult,
  type PairCoordinatorPort,
  type PairStore,
} from "@adaptive-pair/runtime";
import { growthRuntime } from "@adaptive-pair/testkit";

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

const fakeVscode = vi.hoisted(() => {
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

  type DocumentListener = (event: {
    readonly document: {
      readonly isDirty: boolean;
      readonly uri: FakeUri;
    };
  }) => void;

  const state = {
    commandHandlers: new Map<string, (...args: unknown[]) => unknown>(),
    contextKeys: new Map<string, unknown>(),
    registeredTools: [] as RegisteredTool[],
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

  const module = {
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

  const emitDocumentChange = (path: string, isDirty = true): void => {
    const event = {
      document: {
        isDirty,
        uri: createUri(path),
      },
    };
    for (const listener of state.documentListeners) {
      listener(event);
    }
  };

  return {
    module,
    state,
    reset,
    createUri,
    emitDocumentChange,
  };
});

vi.mock("vscode", () => fakeVscode.module);

class MemoryPairStore implements PairStore {
  public constructor(private snapshotValue: PairRuntimeSnapshot) {}

  private readonly commandIds = new Set<string>();

  public load(): Promise<{
    readonly snapshot: PairRuntimeSnapshot;
    readonly seenCommandIds: ReadonlySet<string>;
  }> {
    return Promise.resolve({
      snapshot: structuredClone(this.snapshotValue),
      seenCommandIds: new Set(this.commandIds),
    });
  }

  public append(
    streamId: string,
    events: readonly {
      readonly commandId: string;
    }[],
  ): Promise<void> {
    void streamId;
    for (const event of events) {
      this.commandIds.add(event.commandId);
    }
    return Promise.resolve();
  }

  public saveSnapshot(
    streamId: string,
    snapshot: PairRuntimeSnapshot,
  ): Promise<void> {
    void streamId;
    this.snapshotValue = structuredClone(snapshot);
    return Promise.resolve();
  }

  public replace(snapshot: PairRuntimeSnapshot): void {
    this.snapshotValue = structuredClone(snapshot);
  }
}

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
  readonly store: MemoryPairStore;
} => {
  const store = new MemoryPairStore(snapshot);
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

describe("registerPairTools", () => {
  it("registers the same native tools contributed by the manifest", async () => {
    const manifest = JSON.parse(
      readFileSync(resolve("apps/vscode-extension/package.json"), "utf8"),
    ) as {
      contributes: {
        languageModelTools: { name: string }[];
      };
    };

    const { registerPairTools } = await import("../src/tools/registerPairTools.js");
    const { coordinator } = createCoordinator(
      createPairRuntime(),
      new EffectPortDouble(request => ({
        operationId: request.operationId,
        status: "confirmed",
        summary: "confirmed",
        observation: {},
        sensitiveData: false,
        partial: false,
      })),
    );

    const context = asExtensionContext(createContext());
    registerPairTools(context, coordinator);

    expect(fakeVscode.state.registeredTools.map(item => item.name).sort()).toEqual(
      manifest.contributes.languageModelTools.map(tool => tool.name).sort(),
    );
  });
});

describe("PairLanguageModelTool", () => {
  it("shows mode, owner, scope, and operation class during preparation", async () => {
    const { PairLanguageModelTool } = await import("../src/tools/pairTool.js");
    const { coordinator } = createCoordinator(
      createPairRuntime(),
      new EffectPortDouble(request => ({
        operationId: request.operationId,
        status: "confirmed",
        summary: "confirmed",
        observation: {},
        sensitiveData: false,
        partial: false,
      })),
    );
    const descriptor = PAIR_TOOL_CATALOG.find(
      tool => tool.name === "pair_run_verification",
    );

    if (descriptor === undefined) {
      throw new Error("Missing pair_run_verification descriptor.");
    }

    const tool = new PairLanguageModelTool(
      nativeToolName(descriptor.name),
      descriptor,
      coordinator,
    );
    const prepared = await tool.prepareInvocation(
      { input: { plan: "npm test" } },
      createToken() as never,
    );

    expect(prepared.invocationMessage).toContain("pair_run_verification");
    expect(prepared.invocationMessage).toContain("verification");
    const details = confirmationText(prepared.confirmationMessages?.message);

    expect(details).toContain("Mode: pair");
    expect(details).toContain("owner: ai");
    expect(details).toContain("scope: src/pair.ts");
    expect(details).toContain(
      "operation class: verification",
    );
  });

  it("reads the latest coordinator state instead of trusting an earlier visible state", async () => {
    const { PairLanguageModelTool } = await import("../src/tools/pairTool.js");
    const effectPort = new EffectPortDouble(request => ({
      operationId: request.operationId,
      status: "confirmed",
      summary: "confirmed",
      observation: {},
      sensitiveData: false,
      partial: false,
    }));
    const { coordinator, store } = createCoordinator(createPairRuntime(), effectPort);
    const descriptor = PAIR_TOOL_CATALOG.find(
      tool => tool.name === "pair_apply_edit",
    );

    if (descriptor === undefined) {
      throw new Error("Missing pair_apply_edit descriptor.");
    }

    store.replace(createGrowthRuntime());
    const tool = new PairLanguageModelTool(
      nativeToolName(descriptor.name),
      descriptor,
      coordinator,
    );
    const result = await tool.invoke(
      {
        input: {
          path: "src/pair.ts",
          expectedHash: "a".repeat(64),
          patch: "diff --git",
        },
      } as never,
      createToken() as never,
    );
    const payload = parseToolPayload(result);

    expect(payload).toMatchObject({
      status: "denied",
      reason: "tool-hidden",
    });
    expect(effectPort.calls).toHaveLength(0);
  });

  it("denies a Growth edit-shaped tool call even when invoked by name", async () => {
    const { PairLanguageModelTool } = await import("../src/tools/pairTool.js");
    const effectPort = new EffectPortDouble(request => ({
      operationId: request.operationId,
      status: "confirmed",
      summary: "confirmed",
      observation: {},
      sensitiveData: false,
      partial: false,
    }));
    const { coordinator } = createCoordinator(createGrowthRuntime(), effectPort);
    const descriptor = PAIR_TOOL_CATALOG.find(
      tool => tool.name === "pair_apply_edit",
    );

    if (descriptor === undefined) {
      throw new Error("Missing pair_apply_edit descriptor.");
    }

    const tool = new PairLanguageModelTool(
      nativeToolName(descriptor.name),
      descriptor,
      coordinator,
    );
    const result = await tool.invoke(
      {
        input: {
          path: "src/pair.ts",
          expectedHash: "a".repeat(64),
          patch: "diff --git",
        },
      } as never,
      createToken() as never,
    );

    expect(parseToolPayload(result)).toMatchObject({
      status: "denied",
      reason: "tool-hidden",
    });
  });

  it("returns structured stale revision and authority denials", async () => {
    const { PairLanguageModelTool } = await import("../src/tools/pairTool.js");
    const descriptor = PAIR_TOOL_CATALOG.find(
      tool => tool.name === "pair_read_scope",
    );

    if (descriptor === undefined) {
      throw new Error("Missing pair_read_scope descriptor.");
    }

    const { coordinator } = createCoordinator(
      createPairRuntime(),
      new EffectPortDouble(request => ({
        operationId: request.operationId,
        status: "confirmed",
        summary: "confirmed",
        observation: {},
        sensitiveData: false,
        partial: false,
      })),
    );
    const tool = new PairLanguageModelTool(
      nativeToolName(descriptor.name),
      descriptor,
      coordinator,
    );
    const result = await tool.invoke(
      {
        input: {
          path: "src/pair.ts",
          runtimeRevision: 1,
          authorityEpoch: 99,
        },
      } as never,
      createToken() as never,
    );

    expect(parseToolPayload(result)).toMatchObject({
      status: "denied",
      reason: "stale-tool-view",
    });
  });

  it("sanitizes private host failures out of tool results", async () => {
    const { PairLanguageModelTool } = await import("../src/tools/pairTool.js");
    const descriptor = PAIR_TOOL_CATALOG.find(
      tool => tool.name === "pair_read_scope",
    );

    if (descriptor === undefined) {
      throw new Error("Missing pair_read_scope descriptor.");
    }

    const { coordinator } = createCoordinator(
      createPairRuntime(),
      new EffectPortDouble(() => {
        throw new Error("HOST_SECRET:/workspace/private.log");
      }),
    );
    const tool = new PairLanguageModelTool(
      nativeToolName(descriptor.name),
      descriptor,
      coordinator,
    );
    const result = await tool.invoke(
      {
        input: {
          path: "src/pair.ts",
        },
      } as never,
      createToken() as never,
    );
    const payload = parseToolPayload(result);

    expect(payload).toMatchObject({
      status: "failed",
      reason: "host-error",
    });
    expect(JSON.stringify(payload)).not.toContain("HOST_SECRET");
  });
});

describe("extension lifecycle", () => {
  it("stays inactive on activation until an Adaptive Pair command runs", async () => {
    const { activate } = await import("../src/extension.js");
    const api = activate(asExtensionContext(createContext())) as AdaptivePairExtensionApi;

    expect(api.getState().presenceStatus).toBe("off");
    expect(fakeVscode.state.documentListeners.size).toBe(0);
    expect(fakeVscode.state.workspaceReads).toBe(0);
    expect(fakeVscode.state.modelRequests).toBe(0);
    expect(fakeVscode.state.statusItems).toHaveLength(1);
    expect(fakeVscode.state.statusItems[0]?.text).toBe("$(circle-slash) Pair: off");
  });

  it("enables presence idempotently and does not write external settings", async () => {
    const { activate } = await import("../src/extension.js");
    const api = activate(asExtensionContext(createContext())) as AdaptivePairExtensionApi;

    await fakeVscode.module.commands.executeCommand("adaptivePair.enablePresence");
    const first = api.getState();
    await fakeVscode.module.commands.executeCommand("adaptivePair.enablePresence");
    const second = api.getState();

    expect(first.presenceStatus).toBe("observing");
    expect(second.presenceStatus).toBe("observing");
    expect(second.runtimeRevision).toBe(first.runtimeRevision);
    expect(fakeVscode.state.documentListeners.size).toBe(1);
    expect(fakeVscode.state.settingsWrites).toEqual([]);
  });

  it("keeps the local observation window when switching to quiet", async () => {
    const { activate } = await import("../src/extension.js");
    const api = activate(asExtensionContext(createContext())) as AdaptivePairExtensionApi;

    await fakeVscode.module.commands.executeCommand("adaptivePair.enablePresence");
    fakeVscode.emitDocumentChange("/workspace/src/pair.ts");
    expect(api.getState().observationCount).toBe(1);

    await fakeVscode.module.commands.executeCommand("adaptivePair.stayQuiet");

    expect(api.getState().presenceStatus).toBe("quiet");
    expect(api.getState().observationCount).toBe(1);
    expect(fakeVscode.state.documentListeners.size).toBe(1);
    expect(fakeVscode.state.statusItems[0]?.text).toBe("$(mute) Pair: quiet");
  });

  it("disposes document listeners when paused", async () => {
    const { activate } = await import("../src/extension.js");
    const api = activate(asExtensionContext(createContext())) as AdaptivePairExtensionApi;

    await fakeVscode.module.commands.executeCommand("adaptivePair.enablePresence");
    expect(fakeVscode.state.documentListeners.size).toBe(1);

    await fakeVscode.module.commands.executeCommand("adaptivePair.pausePresence");

    expect(api.getState().presenceStatus).toBe("paused");
    expect(fakeVscode.state.documentListeners.size).toBe(0);
    expect(api.getState().contextKeys).toMatchObject({
      "adaptivePair.presenceEnabled": false,
      "adaptivePair.sessionActive": false,
      "adaptivePair.mode": "",
      "adaptivePair.aiCanEdit": false,
    });
  });

  it("clears local continuity after confirmation when disabled", async () => {
    const { activate } = await import("../src/extension.js");
    const api = activate(asExtensionContext(createContext())) as AdaptivePairExtensionApi;

    await fakeVscode.module.commands.executeCommand("adaptivePair.enablePresence");
    fakeVscode.emitDocumentChange("/workspace/src/pair.ts");
    expect(api.getState().observationCount).toBe(1);

    fakeVscode.state.warningResponses.push("Disable and clear");
    await fakeVscode.module.commands.executeCommand("adaptivePair.disablePresence");

    expect(api.getState()).toMatchObject({
      presenceStatus: "off",
      sessionStatus: "inactive",
      observationCount: 0,
      documentListenerActive: false,
    });
    expect(fakeVscode.state.statusItems[0]?.text).toBe("$(circle-slash) Pair: off");
  });

  it("keeps presence off in an untrusted workspace and surfaces the reason", async () => {
    const { activate } = await import("../src/extension.js");
    fakeVscode.state.workspaceTrusted = false;
    const api = activate(asExtensionContext(createContext())) as AdaptivePairExtensionApi;

    await fakeVscode.module.commands.executeCommand("adaptivePair.enablePresence");

    expect(api.getState().presenceStatus).toBe("off");
    expect(fakeVscode.state.documentListeners.size).toBe(0);
    expect(fakeVscode.state.warnings[0]?.message).toContain("trusted workspace");
  });

  it("does not write native chat, copilot, model, permission, keybinding, or isolation settings", async () => {
    const { activate } = await import("../src/extension.js");
    activate(asExtensionContext(createContext()));

    fakeVscode.state.textDocuments = [{
      isDirty: true,
      uri: fakeVscode.createUri("/workspace/src/pair.ts"),
    }];
    fakeVscode.state.visibleTextEditors = [{
      document: {
        uri: fakeVscode.createUri("/workspace/src/pair.ts"),
      },
    }];
    fakeVscode.state.warningResponses.push("Disable and clear");

    await fakeVscode.module.commands.executeCommand("adaptivePair.enablePresence");
    await fakeVscode.module.commands.executeCommand("adaptivePair.startSession");
    await fakeVscode.module.commands.executeCommand("adaptivePair.joinInProgress");
    await fakeVscode.module.commands.executeCommand("adaptivePair.stayQuiet");
    await fakeVscode.module.commands.executeCommand("adaptivePair.pausePresence");
    await fakeVscode.module.commands.executeCommand("adaptivePair.disablePresence");

    expect(fakeVscode.state.settingsWrites).toEqual([]);
  });
});

describe("manifest and harness parity", () => {
  it("keeps every registered native name inside the harness catalog", () => {
    const contributedNames = JSON.parse(
      readFileSync(resolve("apps/vscode-extension/package.json"), "utf8"),
    ) as {
      contributes: {
        languageModelTools: { name: string }[];
      };
    };

    const harnessNames = new Set<string>(
      PAIR_TOOL_CATALOG.map(tool => nativeToolName(tool.name)),
    );

    expect(
      contributedNames.contributes.languageModelTools.every(tool => harnessNames.has(tool.name)),
    ).toBe(true);
  });
});
