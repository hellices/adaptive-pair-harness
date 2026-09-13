import { createHash } from "node:crypto";
import {
  boundEvidenceDetail,
  boundEvidenceReference,
  boundEvidenceSource,
} from "../core/evidencePresentation";
import type { Evidence, PairRange } from "../core/types";
import type { SemanticAnalysisResult } from "../core/semanticAnalyzer";

export type PairInvocationSource = "automatic" | "manual" | "chat";

export interface PairDisposable {
  dispose(): void;
}

export const runCleanupSteps = (
  steps: readonly (() => void)[],
  message: string,
  initialErrors: readonly unknown[] = [],
): void => {
  const errors = [...initialErrors];
  for (const step of steps) {
    try {
      step();
    } catch (error: unknown) {
      errors.push(error);
    }
  }
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, message);
  }
};

export const createRuntimeAfterSecretLookup = async <TRuntime>(
  lookupSecret: () => PromiseLike<string | undefined>,
  isDisposed: () => boolean,
  createRuntime: (apiKey: string | undefined) => TRuntime,
): Promise<TRuntime | undefined> => {
  const apiKey = await lookupSecret();
  return isDisposed() ? undefined : createRuntime(apiKey);
};

export interface PairSessionLifecyclePorts {
  prepare(
    context: PairSessionPreparationContext,
  ): Promise<PairSessionPreparation | void>;
  registerDocumentListeners(): PairDisposable;
  cancelPendingWork(): void;
  clearTransientState(): void;
}

export interface PairSessionPreparation {
  commit(): boolean;
}

export interface PairSessionPreparationContext {
  readonly signal: AbortSignal;
  isCurrent(): boolean;
}

const MAX_SESSION_PREPARATION_ATTEMPTS = 3;
const PREPARATION_CHURN_MESSAGE =
  "Adaptive Pair could not prepare the session because workspace state kept changing.";

interface PendingSessionRefresh {
  readonly generation: number;
  readonly abortController: AbortController;
  readonly promise: Promise<boolean>;
}

export interface PairLifecycleFence {
  readonly generation: number;
  isCurrent(): boolean;
}

export interface PairSessionActionResult {
  readonly kind:
    | "started"
    | "already-active"
    | "stopped"
    | "already-stopped"
    | "disabled";
  readonly active: boolean;
  readonly message: string;
}

export class PairSessionLifecycle {
  private listener: PairDisposable | undefined;
  private generation = 0;
  private pendingStart:
    | {
        readonly generation: number;
        readonly promise: Promise<PairSessionActionResult>;
        readonly abortController: AbortController;
      }
    | undefined;
  private pendingRefresh: PendingSessionRefresh | undefined;
  private isDisposed = false;
  private isActive = false;
  private isRefreshing = false;

  public constructor(
    private readonly isEnabled: () => boolean,
    private readonly ports: PairSessionLifecyclePorts,
  ) {}

  public get active(): boolean {
    return this.isActive;
  }

  public get ready(): boolean {
    return this.isActive && !this.isRefreshing;
  }

  public get sessionGeneration(): number {
    return this.generation;
  }

  public captureFence(requireActive = false): PairLifecycleFence {
    const generation = this.generation;
    return {
      generation,
      isCurrent: () =>
        !this.isDisposed &&
        generation === this.generation &&
        (!requireActive || (this.isActive && !this.isRefreshing)),
    };
  }

  public start(): Promise<PairSessionActionResult> {
    if (this.isDisposed) {
      return Promise.resolve({
        kind: "already-stopped",
        active: false,
        message: "Adaptive Pair is unavailable because the runtime was disposed.",
      });
    }
    if (!this.isEnabled()) {
      return Promise.resolve({
        kind: "disabled",
        active: false,
        message:
          "Adaptive Pair is disabled by adaptivePair.enabled. Enable it before starting a session.",
      });
    }
    if (this.isActive) {
      return Promise.resolve({
        kind: "already-active",
        active: true,
        message: "Adaptive Pair session is already active.",
      });
    }
    if (this.pendingStart?.generation === this.generation) {
      return this.pendingStart.promise;
    }

    const generation = ++this.generation;
    const abortController = new AbortController();
    const promise = this.startOnce(generation, abortController);
    const pendingStart = { generation, promise, abortController };
    this.pendingStart = pendingStart;
    const clearStart = (): void => {
      if (this.pendingStart === pendingStart) {
        this.pendingStart = undefined;
      }
    };
    void promise.then(clearStart, clearStart);
    return promise;
  }

  public stop(): PairSessionActionResult {
    const wasActive =
      this.isActive ||
      this.pendingStart !== undefined ||
      this.pendingRefresh !== undefined;
    const pendingStart = this.pendingStart;
    const pendingRefresh = this.pendingRefresh;
    this.generation += 1;
    this.pendingStart = undefined;
    this.pendingRefresh = undefined;
    this.isRefreshing = false;
    this.cleanupStoppedState(
      [
        pendingStart?.abortController,
        pendingRefresh?.abortController,
      ],
      [],
      "Failed to stop the Adaptive Pair session cleanly.",
    );
    return {
      kind: wasActive ? "stopped" : "already-stopped",
      active: false,
      message: wasActive
        ? "Adaptive Pair session stopped and transient context cleared."
        : "Adaptive Pair session is already stopped.",
    };
  }

  public refresh(): Promise<boolean> {
    if (this.isDisposed || !this.isActive) {
      return Promise.resolve(false);
    }
    if (this.pendingRefresh?.generation === this.generation) {
      return this.pendingRefresh.promise;
    }

    const generation = ++this.generation;
    const abortController = new AbortController();
    let resolveRefresh!: (refreshed: boolean) => void;
    let rejectRefresh!: (error: unknown) => void;
    const promise = new Promise<boolean>((resolve, reject) => {
      resolveRefresh = resolve;
      rejectRefresh = reject;
    });
    const refresh = { generation, abortController, promise };
    this.pendingRefresh = refresh;
    this.isRefreshing = true;
    void this.runRefresh(refresh).then(resolveRefresh, rejectRefresh);
    return promise;
  }

  private async runRefresh(
    refresh: PendingSessionRefresh,
  ): Promise<boolean> {
    let refreshed: boolean;
    try {
      runCleanupSteps(
        [
          () => this.ports.cancelPendingWork(),
          () => this.ports.clearTransientState(),
        ],
        "Failed to prepare the Adaptive Pair session refresh.",
      );
      refreshed = await this.refreshOnce(
        refresh.generation,
        refresh.abortController,
      );
    } catch (error: unknown) {
      if (this.pendingRefresh !== refresh) {
        return false;
      }
      this.pendingRefresh = undefined;
      this.isRefreshing = false;
      this.cleanupStoppedState(
        [refresh.abortController],
        [error],
        "Adaptive Pair refresh and rollback both failed.",
      );
      throw error;
    }
    if (this.pendingRefresh !== refresh) {
      return false;
    }
    this.pendingRefresh = undefined;
    this.isRefreshing = false;
    if (!refreshed) {
      this.cleanupStoppedState(
        [refresh.abortController],
        [],
        "Failed to stop the disabled Adaptive Pair session after refresh.",
      );
    }
    return refreshed;
  }

  public dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    this.stop();
  }

  private async refreshOnce(
    generation: number,
    abortController: AbortController,
  ): Promise<boolean> {
    const lifecycleFence = this.captureFence();
    const preparationContext: PairSessionPreparationContext = {
      signal: abortController.signal,
      isCurrent: () =>
        !abortController.signal.aborted &&
        lifecycleFence.generation === generation &&
        lifecycleFence.isCurrent(),
    };
    try {
      for (
        let attempt = 0;
        attempt < MAX_SESSION_PREPARATION_ATTEMPTS;
        attempt += 1
      ) {
        const preparation = await this.ports.prepare(preparationContext);
        if (!preparationContext.isCurrent() || !this.isEnabled()) {
          return false;
        }
        if (preparation === undefined || preparation.commit()) {
          return preparationContext.isCurrent() && this.isEnabled();
        }
        if (!preparationContext.isCurrent()) {
          return false;
        }
        this.ports.clearTransientState();
      }
      throw new Error(PREPARATION_CHURN_MESSAGE);
    } catch (error: unknown) {
      if (!preparationContext.isCurrent()) {
        return false;
      }
      throw error;
    }
  }

  private async startOnce(
    generation: number,
    abortController: AbortController,
  ): Promise<PairSessionActionResult> {
    const lifecycleFence = this.captureFence();
    const preparationContext: PairSessionPreparationContext = {
      signal: abortController.signal,
      isCurrent: () =>
        !abortController.signal.aborted &&
        lifecycleFence.generation === generation &&
        lifecycleFence.isCurrent(),
    };
    let listener: PairDisposable | undefined;
    try {
      for (
        let attempt = 0;
        attempt < MAX_SESSION_PREPARATION_ATTEMPTS;
        attempt += 1
      ) {
        const preparation = await this.ports.prepare(preparationContext);
        if (!preparationContext.isCurrent()) {
          return {
            kind: "already-stopped",
            active: false,
            message: "Adaptive Pair session remained stopped.",
          };
        }
        if (!this.isEnabled()) {
          this.cleanupStoppedState(
            [abortController],
            [],
            "Failed to roll back disabled Adaptive Pair startup.",
          );
          return {
            kind: "already-stopped",
            active: false,
            message: "Adaptive Pair session remained stopped.",
          };
        }
        if (listener === undefined) {
          listener = this.ports.registerDocumentListeners();
          if (!preparationContext.isCurrent()) {
            listener.dispose();
            return {
              kind: "already-stopped",
              active: false,
              message: "Adaptive Pair session remained stopped.",
            };
          }
          this.listener = listener;
        }
        if (preparation === undefined || preparation.commit()) {
          if (
            !preparationContext.isCurrent() ||
            !this.isEnabled()
          ) {
            this.cleanupStoppedState(
              [abortController],
              [],
              "Failed to roll back interrupted Adaptive Pair startup.",
            );
            return {
              kind: "already-stopped",
              active: false,
              message: "Adaptive Pair session remained stopped.",
            };
          }
          this.isActive = true;
          return {
            kind: "started",
            active: true,
            message:
              "Adaptive Pair session started. You drive - Pair navigates.",
          };
        }
        if (!preparationContext.isCurrent()) {
          return {
            kind: "already-stopped",
            active: false,
            message: "Adaptive Pair session remained stopped.",
          };
        }
        this.ports.clearTransientState();
      }
      throw new Error(PREPARATION_CHURN_MESSAGE);
    } catch (error: unknown) {
      if (!preparationContext.isCurrent()) {
        return {
          kind: "already-stopped",
          active: false,
          message: "Adaptive Pair session remained stopped.",
        };
      }
      this.cleanupFailedStart(error, abortController);
    }
  }

  private cleanupFailedStart(
    error: unknown,
    abortController: AbortController,
  ): never {
    this.cleanupStoppedState(
      [abortController],
      [error],
      "Adaptive Pair startup and rollback both failed.",
    );
    throw error;
  }

  private cleanupStoppedState(
    abortControllers: readonly (AbortController | undefined)[],
    initialErrors: readonly unknown[],
    message: string,
  ): void {
    const listener = this.listener;
    this.listener = undefined;
    this.isActive = false;
    this.isRefreshing = false;
    runCleanupSteps(
      [
        ...abortControllers.map(
          (abortController) => () => abortController?.abort(),
        ),
        () => listener?.dispose(),
        () => this.ports.cancelPendingWork(),
        () => this.ports.clearTransientState(),
      ],
      message,
      initialErrors,
    );
  }
}

export interface PairSessionControlPort {
  isSessionActive(): boolean;
  startSession(): Promise<PairSessionActionResult>;
  stopSession(): PairSessionActionResult;
}

export interface PairSessionCommandHandlers {
  start(): Promise<void>;
  stop(): Promise<void>;
  toggle(): Promise<void>;
}

export const createPairSessionCommandHandlers = (
  getRuntime: () => PairSessionControlPort | undefined,
  report: (message: string) => PromiseLike<unknown> | unknown,
): PairSessionCommandHandlers => {
  const withRuntime = async (
    action: (runtime: PairSessionControlPort) =>
      | PairSessionActionResult
      | Promise<PairSessionActionResult>,
  ): Promise<void> => {
    const runtime = getRuntime();
    if (runtime === undefined) {
      await report("Adaptive Pair runtime is rebuilding. Try again in a moment.");
      return;
    }
    const result = await action(runtime);
    await report(result.message);
  };

  return {
    start: () => withRuntime((runtime) => runtime.startSession()),
    stop: () => withRuntime((runtime) => runtime.stopSession()),
    toggle: () =>
      withRuntime((runtime) =>
        runtime.isSessionActive()
          ? runtime.stopSession()
          : runtime.startSession(),
      ),
  };
};

export type PairInvocationResult<T> =
  | {
      readonly kind: "completed";
      readonly source: PairInvocationSource;
      readonly value: T;
    }
  | {
      readonly kind: "disabled";
      readonly source: PairInvocationSource;
    }
  | {
      readonly kind: "inactive";
      readonly source: PairInvocationSource;
    };

export class PairInvocationGate {
  public constructor(
    public readonly enabled: boolean,
    private active = true,
  ) {}

  public setActive(active: boolean): void {
    this.active = active;
  }

  public get sessionActive(): boolean {
    return this.active;
  }

  public async run<T>(
    source: PairInvocationSource,
    operation: () => Promise<T>,
  ): Promise<PairInvocationResult<T>> {
    if (!this.enabled) {
      return { kind: "disabled", source };
    }
    if (!this.active) {
      return { kind: "inactive", source };
    }
    return {
      kind: "completed",
      source,
      value: await operation(),
    };
  }
}

export class PairDisabledError extends Error {
  public constructor(public readonly source: PairInvocationSource) {
    super(`Adaptive Pair is disabled (${source}).`);
    this.name = "PairDisabledError";
  }
}

export class PairInactiveError extends Error {
  public constructor(public readonly source: PairInvocationSource) {
    super(`Adaptive Pair session is off (${source}).`);
    this.name = "PairInactiveError";
  }
}

export class PairDocumentState {
  private readonly previousTextByUri = new Map<string, string>();
  private readonly lastStableTextByUri = new Map<string, string>();
  private readonly latestEvidenceByUri = new Map<string, readonly Evidence[]>();

  public seed(uri: string, text: string, stable = true): void {
    this.previousTextByUri.set(uri, text);
    if (stable) {
      this.lastStableTextByUri.set(uri, text);
    } else {
      this.lastStableTextByUri.delete(uri);
    }
  }

  public updateText(uri: string, text: string): string | undefined {
    const previous = this.previousTextByUri.get(uri);
    this.previousTextByUri.set(uri, text);
    return previous;
  }

  public recordAnalysis(
    uri: string,
    text: string,
    analysis: SemanticAnalysisResult,
  ): void {
    if (analysis.stability === "unstable") {
      this.latestEvidenceByUri.delete(uri);
      return;
    }
    this.lastStableTextByUri.set(uri, text);
    this.latestEvidenceByUri.set(uri, analysis.evidence);
  }

  public previousText(uri: string): string | undefined {
    return this.previousTextByUri.get(uri);
  }

  public lastAnalyzedText(uri: string): string | undefined {
    return this.lastStableText(uri);
  }

  public lastStableText(uri: string): string | undefined {
    return this.lastStableTextByUri.get(uri);
  }

  public latestEvidence(uri: string): readonly Evidence[] {
    return this.latestEvidenceByUri.get(uri) ?? [];
  }

  public invalidateEvidence(uri: string): void {
    this.latestEvidenceByUri.delete(uri);
  }

  public close(uri: string): void {
    this.previousTextByUri.delete(uri);
    this.lastStableTextByUri.delete(uri);
    this.latestEvidenceByUri.delete(uri);
  }

  public clear(): void {
    this.previousTextByUri.clear();
    this.lastStableTextByUri.clear();
    this.latestEvidenceByUri.clear();
  }
}

export class PairRequestRegistry {
  private readonly requestsByUri = new Map<string, Set<AbortController>>();

  public add(uri: string, request: AbortController): void {
    const existing = this.requestsByUri.get(uri);
    if (existing === undefined) {
      this.requestsByUri.set(uri, new Set([request]));
      return;
    }
    existing.add(request);
  }

  public remove(uri: string, request: AbortController): void {
    const existing = this.requestsByUri.get(uri);
    existing?.delete(request);
    if (existing?.size === 0) {
      this.requestsByUri.delete(uri);
    }
  }

  public has(uri: string, request: AbortController): boolean {
    return this.requestsByUri.get(uri)?.has(request) === true;
  }

  public cancelUri(uri: string): void {
    const existing = this.requestsByUri.get(uri);
    if (existing === undefined) {
      return;
    }
    this.requestsByUri.delete(uri);
    for (const request of existing) {
      request.abort();
    }
  }

  public cancelAll(): void {
    for (const requests of this.requestsByUri.values()) {
      for (const request of requests) {
        request.abort();
      }
    }
    this.requestsByUri.clear();
  }
}

export const buildPairStatusText = (
  enabled: boolean,
  details: readonly string[],
): string => {
  const headline = enabled
    ? "$(hubot) Pair: You drive - Pair navigates"
    : "$(circle-slash) Pair: off";
  return details.length === 0 ? headline : `${headline} · ${details.join(" · ")}`;
};

export const shouldSuppressCancellation = (
  signalCancelled: boolean,
  error: unknown,
  isOfficialCancellationError: (error: unknown) => boolean,
): boolean => signalCancelled || isOfficialCancellationError(error);

export interface ManualEvidenceCandidates {
  readonly selection: PairRange;
  readonly diagnostics: readonly Evidence[];
  readonly latest: readonly Evidence[];
  readonly analyzed: readonly Evidence[];
}

export const selectManualEvidence = (
  candidates: ManualEvidenceCandidates,
): Evidence | undefined => {
  for (const source of [
    candidates.diagnostics,
    candidates.latest,
    candidates.analyzed,
  ]) {
    const match = source.find((evidence) =>
      pairRangesOverlap(evidence.range, candidates.selection),
    );
    if (match !== undefined) {
      return match;
    }
  }
  return undefined;
};

export const diagnosticCodeReference = (
  code:
    | string
    | number
    | { readonly value: string | number; readonly target: unknown }
    | undefined,
): readonly string[] => {
  if (code === undefined) {
    return [];
  }
  return [String(typeof code === "object" ? code.value : code)];
};

export interface DiagnosticEvidenceInput {
  readonly uri: string;
  readonly range: PairRange;
  readonly message: string;
  readonly severity: Evidence["severity"];
  readonly confidence: number;
  readonly source?: string | undefined;
  readonly code?:
    | string
    | number
    | { readonly value: string | number; readonly target: unknown }
    | undefined;
}

export const buildDiagnosticEvidence = (
  input: DiagnosticEvidenceInput,
): Evidence => {
  const source = input.source ?? "vscode-diagnostics";
  const codeReferences = diagnosticCodeReference(input.code);
  return {
    id: stableDiagnosticEvidenceId(
      input.uri,
      input.range,
      source,
      codeReferences,
      input.message,
    ),
    kind: "diagnostic",
    severity: input.severity,
    title: "Editor diagnostic",
    detail: boundEvidenceDetail(input.message),
    source: boundEvidenceSource(source),
    confidence: input.confidence,
    range: input.range,
    references: codeReferences.map(boundEvidenceReference),
  };
};

export const stableDiagnosticEvidenceId = (
  uri: string,
  range: PairRange,
  source: string,
  codeReferences: readonly string[],
  message: string,
): string => {
  const uriHash = boundedSha256(uri);
  const sourceAndCodeHash = boundedSha256(
    `${source}\u0000${codeReferences.join("\u0000")}`,
  );
  const messageHash = boundedSha256(message);
  return [
    "diagnostic",
    uriHash,
    `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`,
    sourceAndCodeHash,
    messageHash,
  ].join(":");
};

const boundedSha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);

interface RepositoryUri {
  toString(): string;
}

interface RepositoryWorkspaceFolder {
  readonly uri: RepositoryUri;
}

export const repositoryIdentityForDocument = <TUri extends RepositoryUri>(
  documentUri: TUri,
  getWorkspaceFolder:
    | ((
        uri: TUri,
      ) => RepositoryWorkspaceFolder | undefined)
    | undefined,
): string =>
  getWorkspaceFolder?.(documentUri)?.uri.toString() ?? "no-workspace";

export const pairRangesOverlap = (
  left: PairRange,
  right: PairRange,
): boolean => {
  const leftStartsBeforeRightEnds =
    left.start.line < right.end.line ||
    (left.start.line === right.end.line &&
      left.start.character <= right.end.character);
  const rightStartsBeforeLeftEnds =
    right.start.line < left.end.line ||
    (right.start.line === left.end.line &&
      right.start.character <= left.end.character);
  return leftStartsBeforeRightEnds && rightStartsBeforeLeftEnds;
};
