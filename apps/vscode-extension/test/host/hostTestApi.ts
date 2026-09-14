import type * as vscode from "vscode";
import type { PairCoordinatorPort } from "@adaptive-pair/runtime";
import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import type { GrowthModel } from "../../src/modelAdapter.js";
import {
  GrowthEvaluationLog,
  GrowthParticipant,
  ModelConsentRegistry,
  type GrowthEvaluationRecord,
  type GrowthTransferState,
} from "../../src/growthParticipant.js";
import type {
  ActivityLedger,
  ActivitySnapshot,
} from "../../src/activityLedger.js";
import { PresenceController } from "../../src/presenceController.js";
import { SessionController } from "../../src/sessionController.js";
import { StatusView } from "../../src/statusView.js";
import { PairToolContext } from "../../src/tools/pairToolContext.js";
import type { JournalFileSystem } from "../../src/storageAdapter.js";

/**
 * A namespaced surface that exists only in the host-test entry point
 * (`test/host/extension.host.ts`). It is compiled into the throwaway
 * `.host-test` development extension, never into `dist/extension.cjs`, so no
 * released build can reach it.
 *
 * It exposes the real runtime coordinator, activity ledger, and presence
 * controller so the isolated Extension Host smoke can drive genuine runtime
 * behavior deterministically without a live language model. It contributes no
 * command, view, or other production UX.
 */
export interface HostTestApi {
  readonly coordinator: PairCoordinatorPort;
  activity(): ActivitySnapshot;
  getState(): ReturnType<PresenceController["getState"]>;
  driveGrowthTurn(options: DriveGrowthTurnOptions): Promise<DriveGrowthTurnResult>;
  performDisable(): Promise<void>;
  restartReconcile(): Promise<{ readonly observationCount: number }>;
}

export interface DriveGrowthTurnOptions {
  readonly prompt: string;
  readonly command?: string;
  /** Untrusted repository/task text injected as a reference for the turn. */
  readonly repositoryContext?: string;
  readonly model: GrowthModel;
  readonly grantConsent?: boolean;
  readonly confirmReveal?: boolean;
  readonly signal?: AbortSignal;
}

export interface DriveGrowthTurnResult {
  readonly emitted: readonly string[];
  readonly evaluations: readonly GrowthEvaluationRecord[];
  readonly transfer: GrowthTransferState | undefined;
  readonly snapshotBefore: PairRuntimeSnapshot;
  readonly snapshotAfter: PairRuntimeSnapshot;
}

export interface HostTestApiDependencies {
  readonly coordinator: PairCoordinatorPort;
  readonly ledger: ActivityLedger;
  readonly presenceController: PresenceController;
  readonly sessionController: SessionController;
  readonly context: vscode.ExtensionContext;
  readonly journalFileSystem?: JournalFileSystem;
}

/** The subset of `vscode.ChatRequest` the Growth participant actually reads. */
interface HostChatRequest {
  readonly prompt: string;
  readonly command: string | undefined;
  readonly references: readonly { readonly id: string; readonly value: string }[];
  readonly model: vscode.LanguageModelChat;
  readonly toolReferences: readonly never[];
}

/** The subset of `vscode.ChatResponseStream` the Growth participant writes to. */
interface HostChatResponseStream {
  markdown(value: string | { readonly value: string }): void;
  progress(value: string): void;
  button(value: unknown): void;
  anchor(value: unknown): void;
  filetree(value: unknown): void;
  reference(value: unknown): void;
  push(value: unknown): void;
}

const tokenFromSignal = (signal: AbortSignal): vscode.CancellationToken => ({
  get isCancellationRequested(): boolean {
    return signal.aborted;
  },
  onCancellationRequested: (listener: (event: unknown) => unknown) => {
    if (signal.aborted) {
      queueMicrotask(() => listener(undefined));
      return { dispose: () => undefined };
    }
    const handler = (): void => {
      listener(undefined);
    };
    signal.addEventListener("abort", handler, { once: true });
    return { dispose: () => signal.removeEventListener("abort", handler) };
  },
});

/**
 * A stand-in chat model identity. The host test never calls the real model
 * service: every turn is answered by the injected {@link GrowthModel}, so any
 * `sendRequest` here is a programming error rather than a silent fallback.
 */
const modelStub = (): vscode.LanguageModelChat => {
  const stub = {
    id: "adaptive-pair-host-test-model",
    name: "Adaptive Pair Host Test Model",
    vendor: "adaptive-pair-host-test",
    family: "host-test",
    version: "1",
    maxInputTokens: 20_000,
    countTokens: () => Promise.resolve(1),
    sendRequest: () => {
      throw new Error("The host test model is driven through an injected GrowthModel.");
    },
  };
  return stub;
};

export const createHostTestApi = (deps: HostTestApiDependencies): HostTestApi => {
  const driveGrowthTurn = async (
    options: DriveGrowthTurnOptions,
  ): Promise<DriveGrowthTurnResult> => {
    const consent = new ModelConsentRegistry();
    const evaluations = new GrowthEvaluationLog();
    const participant = new GrowthParticipant({
      coordinator: deps.coordinator,
      consent,
      evaluations,
      createModel: () => ({
        request: (instructions, tools, signal) => {
          deps.ledger.recordModelRequest();
          return options.model.request(instructions, tools, signal);
        },
      }),
      requestWorkspaceConsent: () => Promise.resolve(options.grantConsent ?? true),
      confirmSolutionReveal: () => Promise.resolve(options.confirmReveal ?? false),
      // The production quiet route, wired exactly as the shipped entry wires it.
      stayQuiet: () => deps.sessionController.stayQuiet(),
    });

    const emitted: string[] = [];
    const responseShape: HostChatResponseStream = {
      markdown: value => {
        emitted.push(typeof value === "string" ? value : value.value);
      },
      progress: () => undefined,
      button: () => undefined,
      anchor: () => undefined,
      filetree: () => undefined,
      reference: () => undefined,
      push: () => undefined,
    };
    const response = responseShape as unknown as vscode.ChatResponseStream;

    const requestShape: HostChatRequest = {
      prompt: options.prompt,
      command: options.command,
      references:
        options.repositoryContext === undefined
          ? []
          : [{ id: "host-test-repository", value: options.repositoryContext }],
      model: modelStub(),
      toolReferences: [],
    };
    const request = requestShape as unknown as vscode.ChatRequest;
    const context = { history: [] } as unknown as vscode.ChatContext;
    const token = tokenFromSignal(options.signal ?? new AbortController().signal);

    const snapshotBefore = await deps.coordinator.snapshot();
    await participant.handle(request, context, response, token);
    const snapshotAfter = await deps.coordinator.snapshot();

    return {
      emitted,
      evaluations: evaluations.records,
      transfer: participant.transferStatus(),
      snapshotBefore,
      snapshotAfter,
    };
  };

  /**
   * Reconcile a brand-new presence controller from the durable on-disk journal,
   * exactly as a fresh activation would. The shared ledger is reused so the
   * reconciliation's own boundary activity stays visible to the smoke test.
   */
  const restartReconcile = async (): Promise<{ readonly observationCount: number }> => {
    const storagePath = deps.context.globalStorageUri?.fsPath ?? "";
    const controllerOptions =
      deps.journalFileSystem === undefined
        ? { ledger: deps.ledger }
        : { ledger: deps.ledger, journalFileSystem: deps.journalFileSystem };
    const controller = new PresenceController(
      new SessionController(),
      new StatusView(),
      new PairToolContext(),
      controllerOptions,
    );
    await controller.reconcileFromStorage(storagePath);
    const observationCount = controller.getState().observationCount;
    controller.dispose();
    return { observationCount };
  };

  return {
    coordinator: deps.coordinator,
    activity: () => deps.ledger.snapshot(),
    getState: () => deps.presenceController.getState(),
    driveGrowthTurn,
    performDisable: () => deps.presenceController.performDisable(),
    restartReconcile,
  };
};
