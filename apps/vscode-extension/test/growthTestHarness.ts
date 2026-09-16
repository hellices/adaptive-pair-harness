import { vi } from "vitest";
import { compileInstructions, toolsFor, type PairToolDescriptor, type PairToolView } from "@adaptive-pair/harness";
import { type PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import {
  PairCoordinator,
  InMemoryJournal,
  type Clock,
  type EffectPort,
  type EffectRequest,
  type EffectResult,
  type IdSource,
  type InvokeToolOptions,
  type PairCoordinatorPort,
  type PairToolResult,
  type PrepareTurnInput,
  type PreparedTurn,
} from "@adaptive-pair/runtime";
import { growthRuntime } from "@adaptive-pair/testkit";

const vscodeMock = vi.hoisted(() => {
  class LanguageModelTextPart {
    public constructor(public readonly value: string) {}
  }
  class LanguageModelToolCallPart {
    public constructor(
      public readonly callId: string,
      public readonly name: string,
      public readonly input: object,
    ) {}
  }
  class LanguageModelToolResultPart {
    public constructor(
      public readonly callId: string,
      public readonly content: readonly unknown[],
    ) {}
  }
  class MarkdownString {
    public value = "";
    public appendText(text: string): this {
      this.value += text;
      return this;
    }
  }
  const LanguageModelChatMessage = {
    User: (content: unknown) => ({ role: 1, content }),
    Assistant: (content: unknown) => ({ role: 2, content }),
  };
  const LanguageModelChatToolMode = { Auto: 1, Required: 2 } as const;

  return {
    module: {
      LanguageModelTextPart,
      LanguageModelToolCallPart,
      LanguageModelToolResultPart,
      MarkdownString,
      LanguageModelChatMessage,
      LanguageModelChatToolMode,
    },
  };
});

vi.mock("vscode", () => vscodeMock.module);

// Imports that depend on the vscode mock must come after vi.mock.
const {
  createGrowthModel,
  isGrowthModelResult,
  toGrowthChatTools,
  GrowthModelFailure,
  GROWTH_TURN_CAPS,
} = await import("../src/modelAdapter.js");

const {
  GrowthParticipant,
  GrowthEvaluationLog,
  GROWTH_COMMAND_INTENTS,
  isDistinctVariation,
  ModelConsentRegistry,
  WITHHELD_RESPONSE_MESSAGE,
  interpretGrowthIntent,
} = await import("../src/growthParticipant.js");

type ScriptedTurn = {
  readonly text?: string;
  readonly toolCalls?: readonly {
    readonly callId: string;
    readonly name: string;
    readonly input: object;
  }[];
};

class FakeModel {
  public readonly name = "Fake Model";
  public readonly id = "fake-model-id";
  public readonly vendor = "test-vendor";
  public readonly family = "test-family";
  public readonly version = "1.0";
  public readonly maxInputTokens = 100_000;

  public sendCount = 0;
  public countTokensCount = 0;
  public readonly sentMessages: unknown[][] = [];

  public constructor(
    private readonly turns: readonly ScriptedTurn[],
    private readonly opts: {
      readonly countText?: (text: string) => number;
    } = {},
  ) {}

  public countTokens(text: string | { readonly content?: unknown }): Promise<number> {
    this.countTokensCount += 1;
    if (typeof text === "string") {
      return Promise.resolve(this.opts.countText?.(text) ?? text.length);
    }
    return Promise.resolve(1);
  }

  public sendRequest(
    messages: unknown[],
    options?: unknown,
    token?: unknown,
  ): Promise<{
    readonly stream: AsyncIterable<unknown>;
    readonly text: AsyncIterable<string>;
  }> {
    void options;
    void token;
    this.sentMessages.push(messages);
    const turn = this.turns[this.sendCount] ?? {};
    this.sendCount += 1;
    const parts: unknown[] = [];
    for (const call of turn.toolCalls ?? []) {
      parts.push(
        new vscodeMock.module.LanguageModelToolCallPart(
          call.callId,
          call.name,
          call.input,
        ),
      );
    }
    if (turn.text !== undefined) {
      parts.push(new vscodeMock.module.LanguageModelTextPart(turn.text));
    }

    async function* streamGen(): AsyncIterable<unknown> {
      await Promise.resolve();
      for (const part of parts) {
        yield part;
      }
    }
    async function* textGen(): AsyncIterable<string> {
      await Promise.resolve();
      if (turn.text !== undefined) {
        yield turn.text;
      }
    }

    return Promise.resolve({ stream: streamGen(), text: textGen() });
  }
}

const asModel = (model: FakeModel): import("vscode").LanguageModelChat =>
  model;

const confirmedResult = (
  snapshot: PairRuntimeSnapshot,
  name: string,
): PairToolResult =>
  Object.freeze({
    operationId: `op-${name}`,
    runtimeRevision: snapshot.revision,
    authorityEpoch: snapshot.session?.authorityEpoch,
    status: "confirmed",
    summary: `applied ${name}`,
    observation: Object.freeze({}),
    sensitiveData: false,
    partial: false,
  });

type InvokeCall = {
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly options: InvokeToolOptions | undefined;
};

class FakeCoordinator implements PairCoordinatorPort {
  public readonly prepareInputs: PrepareTurnInput[] = [];
  public readonly invokeCalls: InvokeCall[] = [];
  public readonly grantCalls: string[] = [];
  public snapshotProvider: () => PairRuntimeSnapshot;

  public constructor(
    private baseSnapshot: PairRuntimeSnapshot,
    private readonly hooks: {
      readonly onInvoke?: (call: InvokeCall) => void;
      readonly resultFor?: (call: InvokeCall) => PairToolResult | undefined;
    } = {},
  ) {
    this.snapshotProvider = () => this.baseSnapshot;
  }

  public setSnapshot(snapshot: PairRuntimeSnapshot): void {
    this.baseSnapshot = snapshot;
  }

  public snapshotNow(): PairRuntimeSnapshot {
    return this.snapshotProvider();
  }

  public snapshot(): Promise<PairRuntimeSnapshot> {
    return Promise.resolve(this.snapshotProvider());
  }

  public dispatch(): Promise<PairRuntimeSnapshot> {
    return Promise.resolve(this.snapshotProvider());
  }

  public grantUserAction(name: string): Promise<string> {
    this.grantCalls.push(name);
    return Promise.resolve(`grant-${name}`);
  }

  public prepareTurn(input: PrepareTurnInput): Promise<PreparedTurn> {
    this.prepareInputs.push(input);
    const snapshot = this.snapshotProvider();
    return Promise.resolve(
      Object.freeze({
        instructions: compileInstructions({
          snapshot,
          ...(input.userRequest === undefined
            ? {}
            : { userRequest: input.userRequest }),
          ...(input.repositoryContext === undefined
            ? {}
            : { repositoryContext: input.repositoryContext }),
          ...(input.presenceSummary === undefined
            ? {}
            : { presenceSummary: input.presenceSummary }),
          ...(input.toolResults === undefined
            ? {}
            : { toolResults: input.toolResults }),
        }),
        tools: toolsFor(snapshot),
      }),
    );
  }

  public invokeTool(
    name: string,
    input: Readonly<Record<string, unknown>>,
    _signal: AbortSignal,
    options?: InvokeToolOptions,
  ): Promise<PairToolResult> {
    const call: InvokeCall = { name, input, options };
    this.invokeCalls.push(call);
    this.hooks.onInvoke?.(call);
    return Promise.resolve(
      this.hooks.resultFor?.(call) ?? confirmedResult(this.snapshotProvider(), name),
    );
  }

  public reconcile(): Promise<PairRuntimeSnapshot> {
    return Promise.resolve(this.snapshotProvider());
  }
}

const realCoordinator = (
  snapshot: PairRuntimeSnapshot,
  store = new InMemoryJournal("workspace-1", snapshot),
): PairCoordinator & { readonly snapshotNow: () => PairRuntimeSnapshot } => {
  let id = 0;
  const clock: Clock = { now: () => 1_000 + id };
  const ids: IdSource = {
    next: (prefix: string) => `${prefix}-${++id}`,
  };
  const effects: EffectPort = {
    execute: (
      request: EffectRequest,
      signal: AbortSignal,
    ): Promise<EffectResult> => {
      void signal;
      return Promise.resolve({
        operationId: request.operationId,
        status: "confirmed",
        summary: "Read the agreed scope.",
        observation: { excerpt: "bounded context" },
        sensitiveData: false,
        partial: false,
      });
    },
  };
  const coordinator = new PairCoordinator({
    store,
    effects,
    clock,
    ids,
    streamId: "workspace-1",
  });
  return Object.assign(coordinator, { snapshotNow: () => store.snapshotNow() });
};

type CollectedResponse = {
  readonly markdown: string[];
};

const createResponseStream = (): {
  readonly stream: import("vscode").ChatResponseStream;
  readonly collected: CollectedResponse;
} => {
  const collected: CollectedResponse = { markdown: [] };
  const stream = {
    markdown: (value: string | { readonly value: string }) => {
      collected.markdown.push(typeof value === "string" ? value : value.value);
    },
    progress: () => undefined,
    button: () => undefined,
    anchor: () => undefined,
    reference: () => undefined,
    push: () => undefined,
    filetree: () => undefined,
  } as unknown as import("vscode").ChatResponseStream;
  return { stream, collected };
};

const createToken = (): import("vscode").CancellationToken =>
  ({
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => undefined }),
  });

const createRequest = (
  model: FakeModel,
  overrides: {
    readonly prompt?: string;
    readonly command?: string;
  } = {},
): import("vscode").ChatRequest =>
  ({
    prompt: overrides.prompt ?? "",
    command: overrides.command,
    references: [],
    toolReferences: [],
    toolInvocationToken: undefined,
    model: asModel(model),
  }) as unknown as import("vscode").ChatRequest;

const createContext = (
  history: readonly unknown[] = [],
): import("vscode").ChatContext =>
  ({ history }) as unknown as import("vscode").ChatContext;

const growthSnapshot = (
  overrides: Parameters<typeof growthRuntime>[0] = {},
): PairRuntimeSnapshot => growthRuntime(overrides);

const buildParticipant = (
  coordinator: PairCoordinatorPort & { readonly snapshotNow: () => PairRuntimeSnapshot },
  overrides: {
    readonly consent?: InstanceType<typeof ModelConsentRegistry>;
    readonly evaluations?: InstanceType<typeof GrowthEvaluationLog>;
    readonly requestWorkspaceConsent?: (
      model: import("vscode").LanguageModelChat,
    ) => Promise<boolean>;
    readonly confirmSolutionReveal?: (
      model: import("vscode").LanguageModelChat,
    ) => Promise<boolean>;
    readonly model?: FakeModel;
  } = {},
): {
  readonly participant: InstanceType<typeof GrowthParticipant>;
  readonly consent: InstanceType<typeof ModelConsentRegistry>;
  readonly evaluations: InstanceType<typeof GrowthEvaluationLog>;
} => {
  const consent = overrides.consent ?? new ModelConsentRegistry();
  const evaluations = overrides.evaluations ?? new GrowthEvaluationLog();
  const participant = new GrowthParticipant({
    coordinator,
    snapshotNow: () => coordinator.snapshotNow(),
    consent,
    evaluations,
    createModel: model => createGrowthModel(model, coordinator),
    requestWorkspaceConsent:
      overrides.requestWorkspaceConsent ?? (() => Promise.resolve(true)),
    confirmSolutionReveal:
      overrides.confirmSolutionReveal ?? (() => Promise.resolve(true)),
    now: () => 1_000,
  });
  return { participant, consent, evaluations };
};

const mutationDescriptor: PairToolDescriptor = Object.freeze({
  name: "pair_apply_edit",
  effectClass: "mutation",
  modes: ["pair", "delivery"] as const,
  requiredEditOwner: "ai",
  requiresExplicitUserAction: false,
  requiresConsent: true,
  retry: "never",
  maximumResultCharacters: 8_000,
});

const readDescriptor: PairToolDescriptor = Object.freeze({
  name: "pair_read_scope",
  effectClass: "read",
  modes: ["growth", "pair", "delivery"] as const,
  requiredEditOwner: "either",
  requiresExplicitUserAction: false,
  requiresConsent: true,
  retry: "bounded-read",
  maximumResultCharacters: 8_000,
});

const explicitModeDescriptor: PairToolDescriptor = Object.freeze({
  name: "pair_select_mode",
  effectClass: "state",
  modes: ["growth", "pair", "delivery"] as const,
  requiredEditOwner: "either",
  requiresExplicitUserAction: true,
  requiresConsent: false,
  retry: "same-key",
  maximumResultCharacters: 2_000,
});

const viewWith = (
  tools: readonly PairToolDescriptor[],
  runtimeRevision = 7,
): PairToolView =>
  Object.freeze({
    catalogVersion: 1,
    runtimeRevision,
    authorityEpoch: 0,
    tools: Object.freeze([...tools]),
  });

export {
  createGrowthModel,
  isGrowthModelResult,
  toGrowthChatTools,
  GrowthModelFailure,
  GROWTH_TURN_CAPS,
  GrowthParticipant,
  GrowthEvaluationLog,
  GROWTH_COMMAND_INTENTS,
  isDistinctVariation,
  ModelConsentRegistry,
  WITHHELD_RESPONSE_MESSAGE,
  interpretGrowthIntent,
  type ScriptedTurn,
  FakeModel,
  asModel,
  FakeCoordinator,
  realCoordinator,
  createResponseStream,
  createToken,
  createRequest,
  createContext,
  growthSnapshot,
  buildParticipant,
  mutationDescriptor,
  readDescriptor,
  explicitModeDescriptor,
  viewWith,
};
