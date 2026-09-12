import * as vscode from "vscode";
import type { PairConfig } from "../config/pairConfig";
import { discoverHarnessSignals } from "../core/coexistence";
import { EditEpisodeAggregator } from "../core/editEpisodeAggregator";
import { InterventionPolicy } from "../core/interventionPolicy";
import { PairMemoryStore } from "../core/memoryStore";
import {
  LocalTemplateProvider,
  ModelRouter,
  OpenAICompatibleProvider,
  estimateOpenAICompatibleInputTokens,
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
  PairRequestRegistry,
  PairSessionLifecycle,
  buildPairStatusText,
  diagnosticCodeReference,
  selectManualEvidence,
  shouldSuppressCancellation,
} from "./pairRuntimeSupport";
import type {
  PairInvocationSource,
  PairSessionActionResult,
} from "./pairRuntimeSupport";

const PAIR_GOAL = "Navigate with concise, evidence-backed, ask-first questions.";
const SUPPORTED_LANGUAGE_IDS = new Set([
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
]);

export interface PairRuntimeOptions {
  readonly config: PairConfig;
  readonly extensionContext: vscode.ExtensionContext;
  readonly sharedContext: PairSharedContext;
  readonly languageModelApi: VsCodeLanguageModelApi;
  readonly apiKey: string | undefined;
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
  private effectiveProvider: PairConfig["provider"];
  private dismissedEvidenceIds = new Set<string>();
  private controlNotice: string | undefined;
  private statusDetail: string | undefined;
  private disposed = false;

  public constructor(private readonly options: PairRuntimeOptions) {
    this.budget = new TokenBudget(options.config.budget);
    this.invocationGate = new PairInvocationGate(options.config.enabled, false);
    this.effectiveProvider = options.config.provider;
    this.policy = new InterventionPolicy({
      model: options.config.modelName,
    });
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
    this.memoryStore = new PairMemoryStore({
      repositoryId,
      store: {
        get: async <T>(key: string): Promise<T | undefined> =>
          options.extensionContext.workspaceState.get<T>(key),
        update: async <T>(key: string, value: T): Promise<void> =>
          options.extensionContext.workspaceState.update(key, value),
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
        prepare: async () => {
          await this.prepareSession();
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
    const result = await this.sessionLifecycle.start();
    const active = this.sessionLifecycle.active;
    this.invocationGate.setActive(active);
    this.statusDetail = active
      ? this.options.config.statusWarning
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

  private async prepareSession(): Promise<void> {
    const memory = await this.memoryStore.load();
    const repositoryId =
      vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? "no-workspace";
    this.dismissedEvidenceIds = new Set(
      memory.dismissedEvidenceByRepository[repositoryId] ?? [],
    );

    for (const document of vscode.workspace.textDocuments) {
      if (isSupportedDocument(document)) {
        this.documentState.seed(document.uri.toString(), document.getText());
      }
    }
    await this.discoverCoexistence();
  }

  private registerDocumentListeners(): vscode.Disposable {
    const listeners = [
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (isSupportedDocument(document)) {
          const key = document.uri.toString();
          const text = document.getText();
          this.documentState.seed(key, text);
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
    const previousAnalyzedText =
      this.documentState.lastAnalyzedText(key) ?? currentText;
    const hasUnanalyzedChanges = previousAnalyzedText !== currentText;
    const analyzed = hasUnanalyzedChanges
      ? this.analyzer.analyze({
            uri: key,
            languageId: editor.document.languageId,
            previousText: previousAnalyzedText,
            currentText,
            version: editor.document.version,
            observedAt: Date.now(),
          })
      : [];
    this.aggregator.cancel(key);
    if (hasUnanalyzedChanges) {
      this.documentState.recordAnalysis(key, currentText, analyzed);
    }
    const evidence = selectManualEvidence({
      selection,
      diagnostics: diagnosticEvidenceForDocument(editor.document),
      latest: this.documentState.latestEvidence(key),
      analyzed,
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
      !isSupportedDocument(document)
    ) {
      return;
    }

    const key = document.uri.toString();
    this.cancelRequest(key);
    const currentText = document.getText();
    const previousText = this.documentState.updateText(key, currentText);
    if (previousText === undefined || event.contentChanges.length === 0) {
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

    const evidence = [
      ...this.analyzer.analyze(episode),
      ...diagnosticEvidenceForDocument(document),
    ].filter((candidate) => !this.dismissedEvidenceIds.has(candidate.id));
    this.documentState.recordAnalysis(
      episode.uri,
      episode.currentText,
      evidence,
    );
    const decision = this.policy.decide({
      evidence,
      style: this.options.config.interventionStyle,
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
    const result = await this.invocationGate.run(source, async () =>
      this.generateWhileEnabled(request, signal, source !== "automatic"),
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
    userInitiated: boolean,
  ): Promise<ModelResponse> {
    const provider = this.options.config.provider;
    if (provider === "local-template") {
      return this.router.generate(provider, request, signal);
    }

    const admission = this.budget.tryReserve(
      estimateOpenAICompatibleInputTokens(request, this.options.config.modelName),
      Date.now(),
    );
    if (!admission.allowed) {
      this.effectiveProvider = "local-template";
      this.statusDetail = `remote ${admission.reason}; local-template fallback`;
      this.publishSession();
      this.renderStatus();
      return this.router.generate("local-template", request, signal);
    }

    this.publishSession();

    try {
      const response =
        provider === "vscode-copilot" && userInitiated
          ? await this.copilotProvider.generateFromUserAction(request, signal)
          : await this.router.generate(provider, request, signal);
      this.effectiveProvider = provider;
      this.statusDetail = this.options.config.statusWarning;
      this.publishSession();
      this.renderStatus();
      return response;
    } catch (error: unknown) {
      return this.fallbackForUnavailableCopilot(
        error,
        request,
        signal,
        admission.reservationId,
      );
    }
  }

  private async fallbackForUnavailableCopilot(
    error: unknown,
    request: ModelRequest,
    signal: AbortSignal,
    reservationId: number,
  ): Promise<ModelResponse> {
    if (!(error instanceof CopilotModelUnavailableError)) {
      throw error;
    }
    releaseUnusedCopilotReservation(this.budget, reservationId, error);
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
    this.options.sharedContext.publishEvidence({
      uri: document.uri.toString(),
      evidence,
      question,
    });
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
    this.options.sharedContext.clearEvidence();
    this.inlineController.clear();
  }

  private inactiveStatusDetail(): string | undefined {
    if (!this.options.config.enabled) {
      return "disabled by adaptivePair.enabled";
    }
    return this.options.config.statusWarning;
  }

  private closeDocument(uri: vscode.Uri): void {
    const key = uri.toString();
    this.documentState.close(key);
    this.aggregator.cancel(key);
    this.cancelRequest(key);
    this.chatRequests.cancelUri(key);
    this.options.sharedContext.clearEvidence(key);
    this.inlineController.disposeUri(uri);
  }

  private async discoverCoexistence(): Promise<void> {
    const workspaceUris = await vscode.workspace.findFiles(
      "{AGENTS.md,**/AGENTS.md,docs/superpowers/plans/*-plan.md}",
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
      return;
    }

    this.controlNotice = `${signals.map((signal) => signal.label).join(", ")}; observing only`;
    this.publishSession();
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
      controlNotice: this.controlNotice,
      configurationWarning: this.options.config.statusWarning,
    };
    this.options.sharedContext.updateSession(session);
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
  document.uri.scheme === "file" &&
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
    .map((diagnostic, index) => ({
      id: `diagnostic:${document.uri.toString()}:${diagnostic.range.start.line}:${diagnostic.range.start.character}:${index}`,
      kind: "diagnostic",
      severity: diagnosticSeverity(diagnostic.severity),
      title: "Editor diagnostic",
      detail: diagnostic.message,
      source: diagnostic.source ?? "vscode-diagnostics",
      confidence: diagnostic.severity === vscode.DiagnosticSeverity.Error ? 0.97 : 0.82,
      range: toPairRange(diagnostic.range),
      references: diagnosticCodeReference(diagnostic.code),
    }));

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
