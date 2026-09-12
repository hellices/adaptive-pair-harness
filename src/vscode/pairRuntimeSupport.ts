import type { Evidence, PairRange } from "../core/types";

export type PairInvocationSource = "automatic" | "manual" | "chat";

export interface PairDisposable {
  dispose(): void;
}

export interface PairSessionLifecyclePorts {
  prepare(): Promise<void>;
  registerDocumentListeners(): PairDisposable;
  cancelPendingWork(): void;
  clearTransientState(): void;
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
  private startPromise: Promise<PairSessionActionResult> | undefined;
  private isDisposed = false;
  private isActive = false;

  public constructor(
    private readonly isEnabled: () => boolean,
    private readonly ports: PairSessionLifecyclePorts,
  ) {}

  public get active(): boolean {
    return this.isActive;
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
    if (this.startPromise !== undefined) {
      return this.startPromise;
    }

    const generation = ++this.generation;
    const start = this.startOnce(generation);
    this.startPromise = start;
    const clearStart = (): void => {
      if (this.startPromise === start) {
        this.startPromise = undefined;
      }
    };
    void start.then(clearStart, clearStart);
    return start;
  }

  public stop(): PairSessionActionResult {
    const wasActive = this.isActive || this.startPromise !== undefined;
    this.generation += 1;
    this.isActive = false;
    this.listener?.dispose();
    this.listener = undefined;
    this.ports.cancelPendingWork();
    this.ports.clearTransientState();
    return {
      kind: wasActive ? "stopped" : "already-stopped",
      active: false,
      message: wasActive
        ? "Adaptive Pair session stopped and transient context cleared."
        : "Adaptive Pair session is already stopped.",
    };
  }

  public dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.stop();
    this.isDisposed = true;
  }

  private async startOnce(
    generation: number,
  ): Promise<PairSessionActionResult> {
    try {
      await this.ports.prepare();
    } catch (error: unknown) {
      this.ports.cancelPendingWork();
      this.ports.clearTransientState();
      throw error;
    }
    if (
      this.isDisposed ||
      generation !== this.generation ||
      !this.isEnabled()
    ) {
      this.ports.cancelPendingWork();
      this.ports.clearTransientState();
      return {
        kind: "already-stopped",
        active: false,
        message: "Adaptive Pair session remained stopped.",
      };
    }

    this.listener = this.ports.registerDocumentListeners();
    this.isActive = true;
    return {
      kind: "started",
      active: true,
      message: "Adaptive Pair session started. You drive - Pair navigates.",
    };
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
  private readonly lastAnalyzedTextByUri = new Map<string, string>();
  private readonly latestEvidenceByUri = new Map<string, readonly Evidence[]>();

  public seed(uri: string, text: string): void {
    this.previousTextByUri.set(uri, text);
    this.lastAnalyzedTextByUri.set(uri, text);
  }

  public updateText(uri: string, text: string): string | undefined {
    const previous = this.previousTextByUri.get(uri);
    this.previousTextByUri.set(uri, text);
    return previous;
  }

  public recordAnalysis(
    uri: string,
    text: string,
    evidence: readonly Evidence[],
  ): void {
    this.lastAnalyzedTextByUri.set(uri, text);
    this.latestEvidenceByUri.set(uri, evidence);
  }

  public previousText(uri: string): string | undefined {
    return this.previousTextByUri.get(uri);
  }

  public lastAnalyzedText(uri: string): string | undefined {
    return this.lastAnalyzedTextByUri.get(uri);
  }

  public latestEvidence(uri: string): readonly Evidence[] {
    return this.latestEvidenceByUri.get(uri) ?? [];
  }

  public close(uri: string): void {
    this.previousTextByUri.delete(uri);
    this.lastAnalyzedTextByUri.delete(uri);
    this.latestEvidenceByUri.delete(uri);
  }

  public clear(): void {
    this.previousTextByUri.clear();
    this.lastAnalyzedTextByUri.clear();
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

const pairRangesOverlap = (left: PairRange, right: PairRange): boolean => {
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
