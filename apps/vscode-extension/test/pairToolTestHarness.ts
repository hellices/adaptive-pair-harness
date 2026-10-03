import { PAIR_TOOL_CATALOG, nativeToolName } from "@adaptive-pair/harness";
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

// Modals dismiss by default; push the action label onto
// `fakeVscode.state.warningResponses` to accept one.
const fakeVscode = await vi.hoisted(async () => {
  const { createFakeVscodeHost } = await import("./fakeHost.js");
  return createFakeVscodeHost();
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

const confirmedEffect = (request: EffectRequest): EffectResult => ({
  operationId: request.operationId,
  status: "confirmed",
  summary: "confirmed",
  observation: {},
  sensitiveData: false,
  partial: false,
});

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

// Imported per call because each test resets the module graph.
const createCatalogTool = async (name: string, coordinator: PairCoordinatorPort) => {
  const { PairLanguageModelTool } = await import("../src/tools/pairTool.js");
  const descriptor = PAIR_TOOL_CATALOG.find(tool => tool.name === name);
  if (descriptor === undefined) {
    throw new Error(`Missing ${name} descriptor.`);
  }
  return new PairLanguageModelTool(nativeToolName(descriptor.name), descriptor, coordinator);
};

const createContext = (): {
  readonly subscriptions: { dispose(): void }[];
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

export {
  EffectPortDouble,
  asExtensionContext,
  confirmationText,
  confirmedEffect,
  createCatalogTool,
  createContext,
  createCoordinator,
  createGrowthRuntime,
  createPairRuntime,
  createToken,
  fakeVscode,
  parseToolPayload,
  toolResultText,
  type AdaptivePairExtensionApi,
};
