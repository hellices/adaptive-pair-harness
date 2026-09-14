import * as vscode from "vscode";
import type { PairCoordinatorPort } from "@adaptive-pair/runtime";
import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import type { GrowthModel } from "./modelAdapter.js";
import {
  GrowthEvaluationLog,
  GrowthParticipant,
  ModelConsentRegistry,
  type GrowthEvaluationRecord,
} from "./growthParticipant.js";
import type { ActivityLedger, ActivitySnapshot } from "./activityLedger.js";
import { PresenceController } from "./presenceController.js";
import { SessionController } from "./sessionController.js";
import { StatusView } from "./statusView.js";
import { PairToolContext } from "./tools/pairToolContext.js";
import type { JournalFileSystem } from "./storageAdapter.js";

/**
 * A namespaced, host-test-only surface exposed from `activate()` when the
 * `ADAPTIVE_PAIR_HOST_TEST` environment flag is set. It exposes the real
 * runtime coordinator, activity ledger, and presence controller so the isolated
 * Extension Host smoke test can drive genuine runtime behavior deterministically
 * without a live language model. It contributes no command, view, or other
 * production UX and is never attached to a released build.
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
  readonly snapshotBefore: PairRuntimeSnapshot;
  readonly snapshotAfter: PairRuntimeSnapshot;
}

export interface HostTestApiDependencies {
  readonly coordinator: PairCoordinatorPort;
  readonly ledger: ActivityLedger;
  readonly presenceController: PresenceController;
  readonly context: vscode.ExtensionContext;
  readonly journalFileSystem?: JournalFileSystem;
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

const modelStub = () =>
  ({
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
  }) as unknown as vscode.LanguageModelChat;

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
    });

    const emitted: string[] = [];
    const response = {
      markdown: (value: unknown) => {
        emitted.push(
          typeof value === "string"
            ? value
            : String((value as { readonly value?: unknown })?.value ?? value),
        );
      },
      progress: () => undefined,
      button: () => undefined,
      anchor: () => undefined,
      filetree: () => undefined,
      reference: () => undefined,
      push: () => undefined,
    } as unknown as vscode.ChatResponseStream;

    const references =
      options.repositoryContext === undefined
        ? []
        : [{ id: "host-test-repository", value: options.repositoryContext }];
    const request = {
      prompt: options.prompt,
      command: options.command,
      references,
      model: modelStub(),
      toolReferences: [],
    } as unknown as vscode.ChatRequest;
    const context = { history: [] } as unknown as vscode.ChatContext;
    const token = tokenFromSignal(options.signal ?? new AbortController().signal);

    const snapshotBefore = await deps.coordinator.snapshot();
    await participant.handle(request, context, response, token);
    const snapshotAfter = await deps.coordinator.snapshot();

    return {
      emitted,
      evaluations: evaluations.records,
      snapshotBefore,
      snapshotAfter,
    };
  };

  const restartReconcile = async (): Promise<{ readonly observationCount: number }> => {
    const storagePath = deps.context.globalStorageUri?.fsPath ?? "";
    const freshLedger: ActivityLedger = deps.ledger;
    const controllerOptions =
      deps.journalFileSystem === undefined
        ? { ledger: freshLedger }
        : { ledger: freshLedger, journalFileSystem: deps.journalFileSystem };
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
