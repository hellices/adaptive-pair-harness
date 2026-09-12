import * as vscode from "vscode";
import {
  budgetForInterventionStyle,
  type PairConfig,
} from "../config/pairConfig";
import { discoverHarnessSignals } from "../core/coexistence";
import { EditEpisodeAggregator } from "../core/editEpisodeAggregator";
import { InterventionPolicy } from "../core/interventionPolicy";
import {
  hashEvidenceIdentity,
  PairMemoryStore,
} from "../core/memoryStore";
import {
  LocalTemplateProvider,
  ModelOutputLimitError,
  ModelRouter,
  OpenAICompatibleProvider,
  prepareRemoteModelRequest,
} from "../core/modelRouter";
import type {
  ModelProvider,
  ModelRequest,
  ModelRequestContext,
  ModelResponse,
} from "../core/modelRouter";
import { TypeScriptSemanticAnalyzer } from "../core/semanticAnalyzer";
import { TokenBudget } from "../core/tokenBudget";
import type {
  EditEpisode,
  Evidence,
  PairRange,
  Scheduler,
} from "../core/types";
import { InlinePairController } from "./inlinePairController";
import type {
  PairChatGenerator,
  PairRuntimeRevision,
  PairSessionSnapshot,
  PairSharedContext,
} from "./pairChatParticipant";
import {
  CopilotModelUnavailableError,
  VsCodeLanguageModelProvider,
  releaseUnusedCopilotReservation,
} from "./vsCodeLanguageModelProvider";
import type { VsCodeLanguageModelApi } from "./vsCodeLanguageModelProvider";
import {
  PairDisabledError,
  PairDocumentState,
  PairInactiveError,
  PairInvocationGate,
  PairLifecycleFence,
  PairRequestRegistry,
  PairSessionLifecycle,
  buildPairStatusText,
  diagnosticCodeReference,
  selectManualEvidence,
  repositoryIdentityForDocument,
  stableDiagnosticEvidenceId,
  shouldSuppressCancellation,
} from "./pairRuntimeSupport";
import type {
  PairInvocationSource,
  PairSessionPreparationContext,
  PairSessionActionResult,
} from "./pairRuntimeSupport";

const PAIR_GOAL = "Navigate with concise, evidence-backed, ask-first questions.";
const SUPPORTED_LANGUAGE_IDS = new Set([
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
]);
const SUPPORTED_DOCUMENT_SCHEMES = new Set(["file", "vscode-remote"]);

export interface PairRuntimeOptions {
  readonly config: PairConfig;
  readonly extensionContext: vscode.ExtensionContext;
  readonly sharedContext: PairSharedContext;
  readonly languageModelApi: VsCodeLanguageModelApi;
  readonly apiKey: string | undefined;
  readonly budget?: TokenBudget;
  readonly budgetFollowsInterventionStyle?: boolean;
  readonly memoryStore?: PairMemoryStore;
}

export interface PairMemoryActionResult {
  readonly kind:
    | "dismissed"
    | "approved"
    | "style-updated"
    | "no-evidence";
  readonly message: string;
}

class TimeoutScheduler implements Scheduler, vscode.Disposable {
  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  public schedule(delayMs: number, callback: () => void): number {
    const id = this.nextId++;
    const timer = setTimeout(() => {
      this.timers.delete(id);
      callback();
    }, delayMs);
    this.timers.set(id, timer);
    return id;
  }

  public cancel(handle: unknown): void {
    if (typeof handle !== "number") {
      return;
    }
    const timer = this.timers.get(handle);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(handle);
    }
  }

  public dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}

export class PairRuntime implements vscode.Disposable, PairChatGenerator {
  private readonly documentState = new PairDocumentState();
  private readonly requestByUri = new Map<string, AbortController>();
  private readonly chatRequests = new PairRequestRegistry();
  private readonly analyzer = new TypeScriptSemanticAnalyzer();
  private readonly scheduler = new TimeoutScheduler();
  private readonly aggregator: EditEpisodeAggregator;
  private readonly budget: TokenBudget;
  private readonly policy: InterventionPolicy;
  private readonly localProvider = new LocalTemplateProvider();
  private readonly copilotProvider: VsCodeLanguageModelProvider;
  private readonly router: ModelRouter;
  private readonly memoryStore: PairMemoryStore;
  private readonly inlineController: InlinePairController;
  private readonly status: vscode.StatusBarItem;
  private readonly invocationGate: PairInvocationGate;
  private readonly sessionLifecycle: PairSessionLifecycle;
  private readonly runtimeRevision: PairRuntimeRevision;
  private readonly budgetFollowsInterventionStyle: boolean;
  private effectiveProvider: PairConfig["provider"];
  private interventionStyle: PairConfig["interventionStyle"];
  private dismissedEvidenceIdsByRepository = new Map<
    string,
    ReadonlySet<string>
  >();
  private controlNotice: string | undefined;
  private statusDetail: string | undefined;
  private memoryWarning: string | undefined;
  private disposed = false;

  public constructor(private readonly options: PairRuntimeOptions) {
    this.runtimeRevision = options.sharedContext.beginRuntime();
    this.budget = options.budget ?? new TokenBudget(options.config.budget);
    this.budgetFollowsInterventionStyle =
      options.budget === undefined ||
      options.budgetFollowsInterventionStyle === true;
    this.invocationGate = new PairInvocationGate(options.config.enabled, false);
    this.effectiveProvider = options.config.provider;
    this.interventionStyle = options.config.interventionStyle;
    this.policy = new InterventionPolicy({});
    this.copilotProvider = new VsCodeLanguageModelProvider(
      options.languageModelApi,
    );

    const providers: ModelProvider[] = [
      this.localProvider,
      this.copilotProvider,
    ];
    if (
      options.config.provider === "openai-compatible" &&
      options.config.baseUrl !== undefined
    ) {
      providers.push(
        new OpenAICompatibleProvider({
          baseUrl: options.config.baseUrl,
          model: options.config.modelName,
          fetch,
          ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
        }),
      );
    }
    this.router = new ModelRouter(providers);

    const repositoryId =
      vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? "no-workspace";
    this.memoryStore =
      options.memoryStore ??
      new PairMemoryStore({
        repositoryId,
        store: {
          get: async <T>(key: string): Promise<T | undefined> =>
            options.extensionContext.globalState.get<T>(key),
          update: async <T>(key: string, value: T): Promise<void> =>
            options.extensionContext.globalState.update(key, value),
        },
      });

    const commentController = vscode.comments.createCommentController(
      "adaptivePair",
      "Adaptive Pair",
    );
    this.inlineController = new InlinePairController({
      controller: commentController,
      createMarkdown: (value) => new vscode.MarkdownString(value),
      previewMode: vscode.CommentMode.Preview,
    });
    this.status = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.status.name = "Adaptive Pair";
    this.status.command = "adaptivePair.toggle";
    this.status.show();

    this.aggregator = new EditEpisodeAggregator(
      options.config.debounceMs,
      this.scheduler,
      (episode) => {
        void this.handleEpisode(episode);
      },
    );
    this.sessionLifecycle = new PairSessionLifecycle(
      () => this.options.config.enabled,
      {
        prepare: async (context) => {
          await this.prepareSession(context);
        },
        registerDocumentListeners: () => this.registerDocumentListeners(),
        cancelPendingWork: () => {
          this.cancelPendingWork();
        },
        clearTransientState: () => {
          this.clearTransientState();
        },
      },
    );
    this.statusDetail = this.inactiveStatusDetail();
    this.publishSession();
    this.renderStatus();
  }

  public async start(): Promise<void> {
    await this.startSession();
  }

  public isSessionActive(): boolean {
    return this.sessionLifecycle.active;
  }

  public async startSession(): Promise<PairSessionActionResult> {
    const previousGeneration = this.sessionLifecycle.sessionGeneration;
    const start = this.sessionLifecycle.start();
    const startedNewGeneration =
      this.sessionLifecycle.sessionGeneration !== previousGeneration;
    const lifecycleFence = this.sessionLifecycle.captureFence();
    const result = await start;
    if (
      !startedNewGeneration ||
      result.kind !== "started" ||
      !lifecycleFence.isCurrent()
    ) {
      return result;
    }
    const active = this.sessionLifecycle.active;
    this.invocationGate.setActive(active);
    this.statusDetail = active
      ? this.configurationWarning()
      : this.inactiveStatusDetail();
    this.publishSession();
    this.renderStatus();
    return result;
  }

  public registerChatRequest(
    uri: string,
    request: AbortController,
  ): vscode.Disposable {
    if (this.disposed || !this.sessionLifecycle.active) {
      request.abort();
      return { dispose: () => undefined };
    }
    this.chatRequests.add(uri, request);
    return {
      dispose: () => {
        this.chatRequests.remove(uri, request);
      },
    };
  }

  public stopSession(): PairSessionActionResult {
    this.invocationGate.setActive(false);
    const result = this.sessionLifecycle.stop();
    this.effectiveProvider = this.options.config.provider;
    this.controlNotice = undefined;
    this.statusDetail = this.inactiveStatusDetail();
    this.publishSession();
    this.renderStatus();
    return result;
  }

  private async prepareSession(
    context: PairSessionPreparationContext,
  ): Promise<void> {
    const repositoryIds = new Set([
      "no-workspace",
      ...(vscode.workspace.workspaceFolders?.map((folder) =>
        folder.uri.toString(),
      ) ?? []),
    ]);
    const loadMemorySnapshot = async (): Promise<
      | {
          readonly revision: number;
          readonly recoveredByRepository: ReadonlyArray<{
            readonly repositoryId: string;
            readonly recovered: Awaited<
              ReturnType<PairMemoryStore["loadOrDefault"]>
            >;
          }>;
        }
      | undefined
    > => {
      while (context.isCurrent()) {
        const revision = this.memoryStore.revision;
        const recoveredByRepository = await Promise.all(
          [...repositoryIds].map(async (repositoryId) => ({
            repositoryId,
            recovered: await this.memoryStore
              .forRepository(repositoryId)
              .loadOrDefault(),
          })),
        );
        if (revision === this.memoryStore.revision) {
          return { revision, recoveredByRepository };
        }
      }
      return undefined;
    };
    let memorySnapshot = await loadMemorySnapshot();
    if (memorySnapshot === undefined) {
      return;
    }
    const controlNotice = await this.discoverCoexistence();
    if (memorySnapshot.revision !== this.memoryStore.revision) {
      memorySnapshot = await loadMemorySnapshot();
      if (memorySnapshot === undefined) {
        return;
      }
    }
    const { recoveredByRepository } = memorySnapshot;
    const recoveredMemory = recoveredByRepository[0]?.recovered;
    if (recoveredMemory === undefined) {
      return;
    }
    const dismissedEvidenceIdsByRepository = new Map(
      recoveredByRepository.map(({ repositoryId, recovered }) => [
        repositoryId,
        new Set(
          recovered.memory.dismissedEvidenceByRepository[repositoryId] ?? [],
        ),
      ]),
    );

    if (!context.isCurrent()) {
      return;
    }
    this.memoryWarning = recoveredMemory.warning;
    this.interventionStyle =
      recoveredMemory.source === "stored" &&
      recoveredMemory.memory.preferences.interventionStyleExplicit
        ? recoveredMemory.memory.preferences.interventionStyle
        : recoveredMemory.source === "corrupt"
          ? "balanced"
          : this.options.config.interventionStyle;
    if (
      recoveredMemory.source === "corrupt" ||
      recoveredMemory.memory.preferences.interventionStyleExplicit
    ) {
      this.applyInterventionStyleBudget();
    }
    if (recoveredMemory.warning !== undefined) {
      void vscode.window.showWarningMessage(recoveredMemory.warning);
    }
    const documentSeeds = vscode.workspace.textDocuments
      .filter(isSupportedDocument)
      .map((document) => ({
        uri: document.uri,
        languageId: document.languageId,
        text: document.getText(),
      }));

    this.dismissedEvidenceIdsByRepository =
      dismissedEvidenceIdsByRepository;
    for (const seed of documentSeeds) {
      this.documentState.seed(
        seed.uri.toString(),
        seed.text,
        this.analyzer.isStable(
          seed.uri.toString(),
          seed.languageId,
          seed.text,
        ),
      );
    }
    this.controlNotice = controlNotice;
  }

  private registerDocumentListeners(): vscode.Disposable {
    const listeners = [
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (isSupportedDocument(document)) {
          const key = document.uri.toString();
          const text = document.getText();
          this.documentState.seed(
            key,
            text,
            this.analyzer.isStable(key, document.languageId, text),
          );
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.closeDocument(document.uri);
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        this.onDocumentChanged(event);
      }),
    ];
    return {
      dispose: () => {
        for (const listener of listeners) {
          listener.dispose();
        }
      },
    };
  }

  public async reviewCurrentBlock(): Promise<void> {
    if (!this.invocationGate.enabled) {
      await vscode.window.showInformationMessage(
        "Adaptive Pair is disabled. Enable it to review the current block.",
      );
      return;
    }
    if (!this.sessionLifecycle.active) {
      await vscode.window.showInformationMessage(
        "Adaptive Pair is off. Start a pairing session before reviewing the current block.",
      );
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (editor === undefined || !isSupportedDocument(editor.document)) {
      await vscode.window.showInformationMessage(
        "Open a TypeScript or JavaScript editor to review the current block.",
      );
      return;
    }

    const range = normalizedSelectionRange(editor);
    const key = editor.document.uri.toString();
    const selection = toPairRange(range);
    const currentText = editor.document.getText();
    const previousStableText = this.documentState.lastStableText(key);
    const hasUnanalyzedChanges = previousStableText !== currentText;
    const analysis = hasUnanalyzedChanges
      ? this.analyzer.analyze({
            uri: key,
            languageId: editor.document.languageId,
            previousText: previousStableText ?? currentText,
            currentText,
            version: editor.document.version,
            observedAt: Date.now(),
          })
      : { stability: "stable" as const, evidence: [] };
    this.aggregator.cancel(key);
    if (hasUnanalyzedChanges) {
      this.documentState.recordAnalysis(key, currentText, analysis);
    }
    if (analysis.stability === "unstable") {
      await vscode.window.showInformationMessage(
        "Adaptive Pair is waiting for the current TypeScript or JavaScript syntax to stabilize.",
      );
      return;
    }
    const dismissedEvidenceIds = this.dismissedEvidenceIdsForUri(
      editor.document.uri,
    );
    const excludeDismissed = (candidates: readonly Evidence[]) =>
      candidates.filter(
        (candidate) =>
          !dismissedEvidenceIds.has(hashEvidenceIdentity(candidate.id)),
      );
    const evidence = selectManualEvidence({
      selection,
      diagnostics: excludeDismissed(
        diagnosticEvidenceForDocument(editor.document),
      ),
      latest: excludeDismissed(this.documentState.latestEvidence(key)),
      analyzed: excludeDismissed(analysis.evidence),
    });
    if (evidence === undefined) {
      await vscode.window.showInformationMessage(
        "Adaptive Pair found no active evidence for the current block.",
      );
      return;
    }

    await this.intervene(
      editor.document,
      evidence,
      "manual",
      PAIR_GOAL,
    );
  }

  public async generate(
    uri: string,
    goal: string,
    evidence: Evidence,
    signal: AbortSignal,
    context: ModelRequestContext = {},
    purpose?: "why" | "explain" | "trace",
  ): Promise<ModelResponse> {
    const requestController = new AbortController();
    const cancelRequest = (): void => {
      requestController.abort();
    };
    signal.addEventListener("abort", cancelRequest, { once: true });
    if (signal.aborted) {
      cancelRequest();
    }
    this.chatRequests.add(uri, requestController);

    try {
      return await this.generateWithProvider(
        {
          goal,
          evidence,
          interactionStyle: "ask-first",
          context,
          ...(purpose === undefined ? {} : { purpose }),
        },
        requestController.signal,
        "chat",
      );
    } finally {
      signal.removeEventListener("abort", cancelRequest);
      this.chatRequests.remove(uri, requestController);
    }
  }

  private onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    const document = event.document;
    if (
      !this.invocationGate.enabled ||
      !this.invocationGate.sessionActive ||
      !isSupportedDocument(document) ||
      event.contentChanges.length === 0
    ) {
      return;
    }

    const key = document.uri.toString();
    this.cancelRequest(key);
    this.chatRequests.cancelUri(key);
    this.documentState.invalidateEvidence(key);
    this.options.sharedContext.clearEvidence(key, this.runtimeRevision);
    this.inlineController.disposeUri(document.uri);
    const currentText = document.getText();
    const previousText = this.documentState.updateText(key, currentText);
    if (previousText === undefined) {
      return;
    }

    this.aggregator.record({
      uri: key,
      languageId: document.languageId,
      previousText,
      currentText,
      version: document.version,
      observedAt: Date.now(),
    });
  }

  private async handleEpisode(episode: EditEpisode): Promise<void> {
    if (
      this.disposed ||
      !this.invocationGate.enabled ||
      !this.invocationGate.sessionActive
    ) {
      return;
    }

    const document = vscode.workspace.textDocuments.find(
      (candidate) => candidate.uri.toString() === episode.uri,
    );
    if (document === undefined || document.version !== episode.version) {
      return;
    }

    const previousStableText = this.documentState.lastStableText(episode.uri);
    const analysis = this.analyzer.analyze({
      ...episode,
      previousText: previousStableText ?? episode.previousText,
    });
    if (analysis.stability === "unstable") {
      this.documentState.recordAnalysis(
        episode.uri,
        episode.currentText,
        analysis,
      );
      return;
    }

    const evidence = [
      ...analysis.evidence,
      ...diagnosticEvidenceForDocument(document),
    ].filter(
      (candidate) =>
        !this.dismissedEvidenceIdsForUri(document.uri).has(
          hashEvidenceIdentity(candidate.id),
        ),
    );
    this.documentState.recordAnalysis(
      episode.uri,
      episode.currentText,
      {
        stability: "stable",
        evidence,
      },
    );
    const decision = this.policy.decide({
      evidence,
      style: this.interventionStyle,
      now: Date.now(),
      goal: PAIR_GOAL,
    });
    if (decision.kind === "quiet") {
      return;
    }

    const selected = evidence.find(
      (candidate) => candidate.id === decision.evidenceId,
    );
    if (selected === undefined) {
      return;
    }

    if (!decision.useModel) {
      this.renderIntervention(document, selected, decision.localMessage);
      return;
    }

    await this.intervene(document, selected, "automatic", PAIR_GOAL);
  }

  private async intervene(
    document: vscode.TextDocument,
    evidence: Evidence,
    source: "automatic" | "manual",
    goal: string,
  ): Promise<void> {
    const key = document.uri.toString();
    this.cancelRequest(key);
    const abortController = new AbortController();
    this.requestByUri.set(key, abortController);
    const expectedVersion = document.version;
    const lifecycleFence = this.sessionLifecycle.captureFence(true);

    try {
      const response = await this.generateWithProvider(
        {
          goal,
          evidence,
          interactionStyle: "ask-first",
        },
        abortController.signal,
        source,
      );
      if (
        !lifecycleFence.isCurrent() ||
        abortController.signal.aborted ||
        document.version !== expectedVersion ||
        this.requestByUri.get(key) !== abortController
      ) {
        return;
      }
      this.renderIntervention(document, evidence, response.text);
    } catch (error: unknown) {
      if (
        shouldSuppressCancellation(
          abortController.signal.aborted,
          error,
          isOfficialVsCodeCancellationError,
        )
      ) {
        return;
      }
      if (!lifecycleFence.isCurrent()) {
        return;
      }
      if (!(error instanceof Error)) {
        throw error;
      }
      this.statusDetail = `model error: ${error.message}`;
      this.renderStatus();
      await vscode.window.showErrorMessage(
        `Adaptive Pair model request failed: ${error.message}`,
      );
    } finally {
      if (this.requestByUri.get(key) === abortController) {
        this.requestByUri.delete(key);
      }
    }
  }

  private async generateWithProvider(
    request: ModelRequest,
    signal: AbortSignal,
    source: PairInvocationSource,
  ): Promise<ModelResponse> {
    const lifecycleFence = this.sessionLifecycle.captureFence(true);
    const result = await this.invocationGate.run(source, async () =>
      this.generateWhileEnabled(
        request,
        signal,
        source,
        lifecycleFence,
      ),
    );
    if (result.kind === "disabled") {
      throw new PairDisabledError(source);
    }
    if (result.kind === "inactive") {
      throw new PairInactiveError(source);
    }
    return result.value;
  }

  private async generateWhileEnabled(
    request: ModelRequest,
    signal: AbortSignal,
    source: PairInvocationSource,
    lifecycleFence: PairLifecycleFence,
  ): Promise<ModelResponse> {
    const provider = this.options.config.provider;
    if (provider === "local-template") {
      return this.router.generate(provider, request, signal);
    }

    const prepared = prepareRemoteModelRequest(request);
    if (prepared.sensitiveDataDetected) {
      this.effectiveProvider = "local-template";
      this.statusDetail =
        source === "chat"
          ? "sensitive Chat content kept local; local-template fallback"
          : "sensitive request content kept local; local-template fallback";
      this.publishSession();
      this.renderStatus();
      return this.router.generate(
        "local-template",
        {
          ...prepared.request,
          evidence: request.evidence,
        },
        signal,
      );
    }

    const now = Date.now();
    const maxOutputTokens = this.budget.outputTokenLimit(now);
    const availableBudget = this.budget.snapshot(now);
    const unavailableCapacity =
      availableBudget.remainingCalls === 0
        ? "call-limit"
        : availableBudget.remainingInputTokens === 0
          ? "input-token-limit"
          : maxOutputTokens === 0
            ? "output-token-limit"
            : undefined;
    if (unavailableCapacity !== undefined) {
      return this.fallbackForBudget(
        unavailableCapacity,
        request,
        signal,
      );
    }

    const remoteRequest: ModelRequest = {
      ...prepared.request,
      maxOutputTokens,
    };
    if (provider === "vscode-copilot") {
      return this.generateWithCopilotCandidates(
        remoteRequest,
        signal,
        source,
        lifecycleFence,
        maxOutputTokens,
      );
    }

    let dispatch;
    try {
      dispatch = await this.router.prepare(
        provider,
        remoteRequest,
        signal,
      );
    } catch (error: unknown) {
      if (!lifecycleFence.isCurrent() || signal.aborted) {
        throw error;
      }
      return this.fallbackForUnavailableCopilot(
        error,
        remoteRequest,
        signal,
        lifecycleFence,
      );
    }
    if (signal.aborted) {
      dispatch.dispose();
      signal.throwIfAborted();
    }

    const admission = this.budget.tryReserve(
      dispatch.inputTokens,
      maxOutputTokens,
      Date.now(),
    );
    if (!admission.allowed) {
      dispatch.dispose();
      return this.fallbackForBudget(admission.reason, request, signal);
    }

    this.publishSession();

    try {
      const response = await dispatch.send();
      this.budget.settle(
        admission.reservationId,
        response.inputTokens,
        response.outputTokens,
      );
      if (lifecycleFence.isCurrent() && !signal.aborted) {
        this.effectiveProvider = provider;
        this.statusDetail = this.configurationWarning();
        this.publishSession();
        this.renderStatus();
      }
      return response;
    } catch (error: unknown) {
      if (error instanceof ModelOutputLimitError) {
        if (error.requestDispatched) {
          this.budget.settle(
            admission.reservationId,
            error.inputTokens,
            error.outputTokens,
          );
        } else {
          this.budget.release(admission.reservationId);
        }
        if (lifecycleFence.isCurrent() && !signal.aborted) {
          this.publishSession();
        }
      }
      releaseUnusedCopilotReservation(
        this.budget,
        admission.reservationId,
        error,
      );
      if (!lifecycleFence.isCurrent() || signal.aborted) {
        throw error;
      }
      return this.fallbackForUnavailableCopilot(
        error,
        remoteRequest,
        signal,
        lifecycleFence,
      );
    } finally {
      dispatch.dispose();
    }
  }

  private async generateWithCopilotCandidates(
    request: ModelRequest,
    signal: AbortSignal,
    source: PairInvocationSource,
    lifecycleFence: PairLifecycleFence,
    maxOutputTokens: number,
  ): Promise<ModelResponse> {
    let candidates;
    try {
      candidates = await this.copilotProvider.prepareCandidates(
        request,
        signal,
        { userInitiated: source !== "automatic" },
      );
    } catch (error: unknown) {
      if (!lifecycleFence.isCurrent() || signal.aborted) {
        throw error;
      }
      return this.fallbackForUnavailableCopilot(
        error,
        request,
        signal,
        lifecycleFence,
      );
    }

    let previousUnavailable: CopilotModelUnavailableError | undefined;
    try {
      for (;;) {
        let dispatch;
        try {
          dispatch = await candidates.next(previousUnavailable);
          previousUnavailable = undefined;
        } catch (error: unknown) {
          if (!lifecycleFence.isCurrent() || signal.aborted) {
            throw error;
          }
          return this.fallbackForUnavailableCopilot(
            error,
            request,
            signal,
            lifecycleFence,
          );
        }

        if (!lifecycleFence.isCurrent() || signal.aborted) {
          dispatch.dispose();
          signal.throwIfAborted();
          throw new Error("Adaptive Pair request lifecycle is no longer current.");
        }

        const admission = this.budget.tryReserve(
          dispatch.inputTokens,
          maxOutputTokens,
          Date.now(),
        );
        if (!admission.allowed) {
          dispatch.dispose();
          return this.fallbackForBudget(admission.reason, request, signal);
        }
        this.publishSession();

        if (!lifecycleFence.isCurrent() || signal.aborted) {
          this.budget.release(admission.reservationId);
          dispatch.dispose();
          signal.throwIfAborted();
          throw new Error("Adaptive Pair request lifecycle is no longer current.");
        }

        try {
          const response = await dispatch.send();
          this.budget.settle(
            admission.reservationId,
            response.inputTokens,
            response.outputTokens,
          );
          if (lifecycleFence.isCurrent() && !signal.aborted) {
            this.effectiveProvider = "vscode-copilot";
            this.statusDetail = this.configurationWarning();
            this.publishSession();
            this.renderStatus();
          }
          return response;
        } catch (error: unknown) {
          if (error instanceof ModelOutputLimitError) {
            if (error.requestDispatched) {
              this.budget.settle(
                admission.reservationId,
                error.inputTokens,
                error.outputTokens,
              );
            } else {
              this.budget.release(admission.reservationId);
            }
            if (lifecycleFence.isCurrent() && !signal.aborted) {
              this.publishSession();
            }
          }
          releaseUnusedCopilotReservation(
            this.budget,
            admission.reservationId,
            error,
          );
          if (!lifecycleFence.isCurrent() || signal.aborted) {
            throw error;
          }
          if (!(error instanceof CopilotModelUnavailableError)) {
            throw error;
          }
          previousUnavailable = error;
        } finally {
          dispatch.dispose();
        }
      }
    } finally {
      candidates.dispose();
    }
  }

  private fallbackForBudget(
    reason: "call-limit" | "input-token-limit" | "output-token-limit",
    request: ModelRequest,
    signal: AbortSignal,
  ): Promise<ModelResponse> {
    this.effectiveProvider = "local-template";
    this.statusDetail = `remote ${reason}; local-template fallback`;
    this.publishSession();
    this.renderStatus();
    return this.router.generate("local-template", request, signal);
  }

  private async fallbackForUnavailableCopilot(
    error: unknown,
    request: ModelRequest,
    signal: AbortSignal,
    lifecycleFence: PairLifecycleFence,
  ): Promise<ModelResponse> {
    if (!(error instanceof CopilotModelUnavailableError)) {
      throw error;
    }
    if (!lifecycleFence.isCurrent()) {
      throw error;
    }
    this.effectiveProvider = "local-template";
    this.statusDetail = `Copilot unavailable (${error.reason}); local-template fallback`;
    this.publishSession();
    this.renderStatus();
    return this.router.generate("local-template", request, signal);
  }

  private renderIntervention(
    document: vscode.TextDocument,
    evidence: Evidence,
    question: string,
  ): void {
    this.inlineController.render(
      document.uri,
      safeRange(document, evidence.range),
      question,
      evidence,
    );
    this.policy.markRendered(evidence.id, Date.now());
    this.options.sharedContext.publishEvidence({
      uri: document.uri.toString(),
      evidence,
      question,
    }, this.runtimeRevision);
  }

  private cancelRequest(uri: string): void {
    const existing = this.requestByUri.get(uri);
    if (existing !== undefined) {
      existing.abort();
      this.requestByUri.delete(uri);
    }
  }

  private cancelPendingWork(): void {
    this.aggregator.clear();
    for (const request of this.requestByUri.values()) {
      request.abort();
    }
    this.requestByUri.clear();
    this.chatRequests.cancelAll();
  }

  private clearTransientState(): void {
    this.documentState.clear();
    this.policy.resetTransient();
    this.options.sharedContext.clearEvidence(undefined, this.runtimeRevision);
    this.inlineController.clear();
  }

  private inactiveStatusDetail(): string | undefined {
    if (!this.options.config.enabled) {
      return "disabled by adaptivePair.enabled";
    }
    return this.configurationWarning();
  }

  private configurationWarning(): string | undefined {
    return [this.options.config.statusWarning, this.memoryWarning]
      .filter((warning): warning is string => warning !== undefined)
      .join(" ") || undefined;
  }

  public async resetMemory(): Promise<void> {
    this.stopSession();
    const lifecycleFence = this.sessionLifecycle.captureFence();
    await this.memoryStore.reset();
    if (!lifecycleFence.isCurrent()) {
      return;
    }
    this.memoryWarning = undefined;
    this.interventionStyle = this.options.config.interventionStyle;
    this.applyInterventionStyleBudget();
    this.dismissedEvidenceIdsByRepository.clear();
    this.statusDetail = this.sessionLifecycle.active
      ? this.configurationWarning()
      : this.inactiveStatusDetail();
    this.publishSession();
    this.renderStatus();
    await vscode.window.showInformationMessage(
      "Adaptive Pair local memory was reset to safe defaults.",
    );
  }

  public async dismissCurrentEvidence(): Promise<PairMemoryActionResult> {
    const snapshot = this.options.sharedContext.snapshot();
    const latest = snapshot.latest;
    if (latest === undefined) {
      return {
        kind: "no-evidence",
        message: "Adaptive Pair has no current evidence to dismiss.",
      };
    }

    const uri = vscode.Uri.parse(latest.uri);
    const evidenceRevision =
      this.options.sharedContext.evidenceRevisionForUri(latest.uri);
    const repositoryId = this.repositoryIdForUri(uri);
    await this.memoryStoreForRepository(repositoryId).dismissEvidence(
      latest.evidence.id,
    );
    if (!this.disposed) {
      const dismissed = new Set(
        this.dismissedEvidenceIdsByRepository.get(repositoryId) ?? [],
      );
      dismissed.add(hashEvidenceIdentity(latest.evidence.id));
      this.dismissedEvidenceIdsByRepository.set(repositoryId, dismissed);
      if (
        this.options.sharedContext.evidenceRevisionForUri(latest.uri) ===
        evidenceRevision
      ) {
        this.documentState.invalidateEvidence(latest.uri);
        this.options.sharedContext.clearEvidence(
          latest.uri,
          this.runtimeRevision,
        );
        this.inlineController.disposeUri(uri);
      }
    }
    return {
      kind: "dismissed",
      message: "Adaptive Pair dismissed the current evidence for this repository.",
    };
  }

  public async approveCurrentEvidence(): Promise<PairMemoryActionResult> {
    const latest = this.options.sharedContext.snapshot().latest;
    if (latest === undefined) {
      return {
        kind: "no-evidence",
        message: "Adaptive Pair has no current evidence to approve.",
      };
    }

    await this.memoryStore.approveEvidence(latest.evidence);
    return {
      kind: "approved",
      message: "Adaptive Pair saved the current evidence summary as approved.",
    };
  }

  public async setInterventionStyle(
    style: PairConfig["interventionStyle"],
  ): Promise<PairMemoryActionResult> {
    await this.memoryStore.updatePreferences({
      interventionStyle: style,
    });
    if (!this.disposed) {
      this.interventionStyle = style;
      this.applyInterventionStyleBudget();
      this.publishSession();
      this.renderStatus();
    }
    return {
      kind: "style-updated",
      message: `Adaptive Pair intervention style is now ${style}.`,
    };
  }

  private closeDocument(uri: vscode.Uri): void {
    const key = uri.toString();
    this.documentState.close(key);
    this.aggregator.cancel(key);
    this.cancelRequest(key);
    this.chatRequests.cancelUri(key);
    this.options.sharedContext.clearEvidence(key, this.runtimeRevision);
    this.inlineController.disposeUri(uri);
  }

  private repositoryIdForUri(uri: vscode.Uri): string {
    return repositoryIdentityForDocument(
      uri,
      vscode.workspace.getWorkspaceFolder,
    );
  }

  private memoryStoreForRepository(repositoryId: string): PairMemoryStore {
    return this.memoryStore.forRepository(repositoryId);
  }

  private applyInterventionStyleBudget(): void {
    if (this.budgetFollowsInterventionStyle) {
      this.budget.reconfigure(
        budgetForInterventionStyle(this.interventionStyle),
      );
    }
  }

  private dismissedEvidenceIdsForUri(
    uri: vscode.Uri,
  ): ReadonlySet<string> {
    return (
      this.dismissedEvidenceIdsByRepository.get(
        this.repositoryIdForUri(uri),
      ) ?? new Set()
    );
  }

  private async discoverCoexistence(): Promise<string | undefined> {
    const workspaceUris = await vscode.workspace.findFiles(
      "{AGENTS.md,**/AGENTS.md,docs/superpowers/plans/*.md}",
      "**/node_modules/**",
      50,
    );
    const signals = discoverHarnessSignals({
      extensionIds: vscode.extensions.all.map((extension) => extension.id),
      workspacePaths: workspaceUris.map((uri) =>
        vscode.workspace.asRelativePath(uri, false),
      ),
    });
    if (signals.length === 0) {
      return undefined;
    }

    return `${signals.map((signal) => signal.label).join(", ")}; observing only`;
  }

  public refreshSession(now = Date.now()): void {
    this.publishSession(now);
  }

  private publishSession(now = Date.now()): void {
    const remainingBudget = this.budget.snapshot(now);
    const session: PairSessionSnapshot = {
      enabled: this.invocationGate.enabled,
      active: this.invocationGate.sessionActive,
      generation: this.sessionLifecycle.sessionGeneration,
      goal: PAIR_GOAL,
      role: "navigator",
      provider: this.effectiveProvider,
      remainingCalls: remainingBudget.remainingCalls,
      remainingInputTokens: remainingBudget.remainingInputTokens,
      remainingOutputTokens: remainingBudget.remainingOutputTokens,
      controlNotice: this.controlNotice,
      configurationWarning: this.configurationWarning(),
    };
    this.options.sharedContext.updateSession(session, this.runtimeRevision);
  }

  private renderStatus(): void {
    const details = [this.statusDetail, this.controlNotice].filter(
      (detail): detail is string => detail !== undefined,
    );
    this.status.text = buildPairStatusText(
      this.invocationGate.sessionActive,
      details,
    );
    this.status.tooltip =
      !this.invocationGate.enabled
        ? "Adaptive Pair is disabled by adaptivePair.enabled and will not invoke model providers."
        : this.invocationGate.sessionActive
        ? "Adaptive Pair is navigator-only and does not edit files or run commands."
        : "Adaptive Pair is off. Start a session to enable navigator guidance.";
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.invocationGate.setActive(false);
    this.sessionLifecycle.dispose();
    this.effectiveProvider = this.options.config.provider;
    this.controlNotice = undefined;
    this.statusDetail = this.inactiveStatusDetail();
    this.publishSession();
    this.aggregator.dispose();
    this.scheduler.dispose();
    this.inlineController.dispose();
    this.status.dispose();
  }
}

const isSupportedDocument = (document: vscode.TextDocument): boolean =>
  SUPPORTED_DOCUMENT_SCHEMES.has(document.uri.scheme) &&
  SUPPORTED_LANGUAGE_IDS.has(document.languageId);

const normalizedSelectionRange = (editor: vscode.TextEditor): vscode.Range => {
  if (!editor.selection.isEmpty) {
    return editor.selection;
  }
  return editor.document.lineAt(editor.selection.active.line).range;
};

const diagnosticEvidenceForDocument = (
  document: vscode.TextDocument,
): readonly Evidence[] =>
  vscode.languages
    .getDiagnostics(document.uri)
    .slice(0, 20)
    .map((diagnostic) => {
      const range = toPairRange(diagnostic.range);
      const source = diagnostic.source ?? "vscode-diagnostics";
      const references = diagnosticCodeReference(diagnostic.code);
      return {
        id: stableDiagnosticEvidenceId(
          document.uri.toString(),
          range,
          source,
          references,
          diagnostic.message,
        ),
        kind: "diagnostic",
        severity: diagnosticSeverity(diagnostic.severity),
        title: "Editor diagnostic",
        detail: diagnostic.message,
        source,
        confidence:
          diagnostic.severity === vscode.DiagnosticSeverity.Error
            ? 0.97
            : 0.82,
        range,
        references,
      };
    });

const diagnosticSeverity = (
  severity: vscode.DiagnosticSeverity,
): Evidence["severity"] => {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return "error";
    case vscode.DiagnosticSeverity.Warning:
      return "warning";
    default:
      return "info";
  }
};

const toPairRange = (range: vscode.Range): PairRange => ({
  start: {
    line: range.start.line,
    character: range.start.character,
  },
  end: {
    line: range.end.line,
    character: range.end.character,
  },
});

const safeRange = (
  document: vscode.TextDocument,
  range: PairRange,
): vscode.Range => {
  const lastLine = Math.max(0, document.lineCount - 1);
  const startLine = Math.min(lastLine, Math.max(0, range.start.line));
  const endLine = Math.min(lastLine, Math.max(startLine, range.end.line));
  const startCharacter = Math.min(
    document.lineAt(startLine).text.length,
    Math.max(0, range.start.character),
  );
  const endCharacter = Math.min(
    document.lineAt(endLine).text.length,
    Math.max(endLine === startLine ? startCharacter : 0, range.end.character),
  );
  return new vscode.Range(
    startLine,
    startCharacter,
    endLine,
    endCharacter,
  );
};

const isOfficialVsCodeCancellationError = (error: unknown): boolean =>
  error instanceof vscode.CancellationError ||
  (error instanceof vscode.LanguageModelError &&
    error.cause instanceof vscode.CancellationError);
