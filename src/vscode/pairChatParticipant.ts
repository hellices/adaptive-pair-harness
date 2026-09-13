import type * as vscode from "vscode";
import type { PairProvider } from "../config/pairConfig";
import type {
  ModelRequestContext,
  ModelResponse,
  ModelSymbolContext,
} from "../core/modelRouter";
import type { Evidence, PairRange } from "../core/types";
import type {
  PairDisposable,
  PairSessionControlPort,
} from "./pairRuntimeSupport";

export interface PairSessionSnapshot {
  readonly enabled: boolean;
  readonly active: boolean;
  readonly generation: number;
  readonly goal: string;
  readonly role: "navigator";
  readonly provider: PairProvider;
  readonly remainingCalls: number;
  readonly remainingInputTokens: number;
  readonly remainingOutputTokens?: number;
  readonly controlNotice: string | undefined;
  readonly configurationWarning: string | undefined;
}

export interface PairPublishedEvidence {
  readonly uri: string;
  readonly evidence: Evidence;
  readonly question: string;
}

export interface PairContextSnapshot {
  readonly revision: number;
  readonly session: PairSessionSnapshot;
  readonly latest: PairPublishedEvidence | undefined;
}

declare const pairRuntimeRevisionBrand: unique symbol;
export type PairRuntimeRevision = number & {
  readonly [pairRuntimeRevisionBrand]: true;
};

export const PAIR_SHARED_CONTEXT_URI_REVISION_LIMIT = 256;

export class PairSharedContext {
  private latest: PairPublishedEvidence | undefined;
  private session: PairSessionSnapshot;
  private revision = 0;
  private evidenceEpoch = 0;
  private readonly evidenceRevisionByUri = new Map<string, number>();
  private currentRuntimeRevision = 0;

  public constructor(
    session: Omit<PairSessionSnapshot, "generation"> & {
      readonly generation?: number;
    },
  ) {
    this.session = {
      ...session,
      generation: session.generation ?? 0,
    };
  }

  public beginRuntime(): PairRuntimeRevision {
    this.currentRuntimeRevision += 1;
    this.revision += 1;
    this.releaseAllEvidenceUris();
    this.latest = undefined;
    return this.currentRuntimeRevision as PairRuntimeRevision;
  }

  public endRuntime(runtimeRevision: PairRuntimeRevision): void {
    if (runtimeRevision !== this.currentRuntimeRevision) {
      return;
    }
    this.currentRuntimeRevision += 1;
    this.revision += 1;
    this.releaseAllEvidenceUris();
    this.latest = undefined;
  }

  public updateSession(
    session: PairSessionSnapshot,
    runtimeRevision?: PairRuntimeRevision,
  ): void {
    if (
      runtimeRevision !== undefined &&
      runtimeRevision !== this.currentRuntimeRevision
    ) {
      return;
    }
    if (
      session.enabled !== this.session.enabled ||
      session.active !== this.session.active ||
      session.generation !== this.session.generation
    ) {
      this.revision += 1;
    }
    this.session = session;
  }

  public publishEvidence(
    latest: PairPublishedEvidence,
    runtimeRevision?: PairRuntimeRevision,
  ): void {
    if (
      runtimeRevision !== undefined &&
      runtimeRevision !== this.currentRuntimeRevision
    ) {
      return;
    }
    this.revision += 1;
    this.bumpEvidenceRevision(latest.uri);
    this.latest = latest;
  }

  public clearEvidence(
    uri?: string,
    runtimeRevision?: PairRuntimeRevision,
  ): void {
    if (
      runtimeRevision !== undefined &&
      runtimeRevision !== this.currentRuntimeRevision
    ) {
      return;
    }
    if (uri === undefined) {
      this.releaseAllEvidenceUris();
      if (this.latest !== undefined) {
        this.revision += 1;
      }
      this.latest = undefined;
      return;
    }

    this.bumpEvidenceRevision(uri);
    if (this.latest?.uri === uri) {
      this.revision += 1;
      this.latest = undefined;
    }
  }

  public releaseEvidenceUri(
    uri: string,
    runtimeRevision?: PairRuntimeRevision,
  ): void {
    if (
      runtimeRevision !== undefined &&
      runtimeRevision !== this.currentRuntimeRevision
    ) {
      return;
    }
    if (this.evidenceRevisionByUri.has(uri)) {
      this.nextEvidenceRevision();
      this.evidenceRevisionByUri.delete(uri);
    }
    if (this.latest?.uri === uri) {
      this.revision += 1;
      this.latest = undefined;
    }
  }

  public evidenceRevisionForUri(uri: string): number | undefined {
    const revision = this.evidenceRevisionByUri.get(uri);
    if (revision === undefined) {
      return undefined;
    }
    this.evidenceRevisionByUri.delete(uri);
    this.evidenceRevisionByUri.set(uri, revision);
    return revision;
  }

  public captureEvidenceRevisionForUri(uri: string): number {
    const revision = this.evidenceRevisionForUri(uri);
    if (revision !== undefined) {
      return revision;
    }
    return this.storeEvidenceRevision(uri, this.nextEvidenceRevision());
  }

  public snapshot(): PairContextSnapshot {
    return {
      revision: this.revision,
      session: this.session,
      latest: this.latest,
    };
  }

  private bumpEvidenceRevision(uri: string): void {
    this.storeEvidenceRevision(uri, this.nextEvidenceRevision());
  }

  private storeEvidenceRevision(uri: string, revision: number): number {
    this.evidenceRevisionByUri.delete(uri);
    this.evidenceRevisionByUri.set(uri, revision);
    if (
      this.evidenceRevisionByUri.size >
      PAIR_SHARED_CONTEXT_URI_REVISION_LIMIT
    ) {
      const leastRecentlyUsedUri =
        this.evidenceRevisionByUri.keys().next().value;
      if (leastRecentlyUsedUri !== undefined) {
        this.evidenceRevisionByUri.delete(leastRecentlyUsedUri);
      }
    }
    return revision;
  }

  private releaseAllEvidenceUris(): void {
    if (this.evidenceRevisionByUri.size === 0) {
      return;
    }
    this.nextEvidenceRevision();
    this.evidenceRevisionByUri.clear();
  }

  private nextEvidenceRevision(): number {
    if (this.evidenceEpoch >= Number.MAX_SAFE_INTEGER) {
      throw new Error("Pair shared-context evidence revision exhausted.");
    }
    this.evidenceEpoch += 1;
    return this.evidenceEpoch;
  }
}

export type PairChatPlan =
  | { readonly kind: "message"; readonly markdown: string }
  | {
      readonly kind: "generate";
      readonly uri: string;
      readonly goal: string;
      readonly evidence: Evidence;
      readonly context: ModelRequestContext;
      readonly purpose: "why" | "explain" | "trace";
    };

export interface PairChatRequestContext {
  readonly prompt: string;
  readonly symbol?: ModelSymbolContext;
}

export const buildPairChatPlan = (
  command: string | undefined,
  context: PairContextSnapshot,
  requestContext: PairChatRequestContext = { prompt: "" },
): PairChatPlan => {
  if (!context.session.enabled) {
    return {
      kind: "message",
      markdown:
        "Adaptive Pair is disabled. Enable it before requesting navigator guidance.",
    };
  }

  if (!context.session.active) {
    return {
      kind: "message",
      markdown:
        "Adaptive Pair is off. Run `@pair /start` or **Adaptive Pair: Start Pairing Session** first.",
    };
  }

  if (command === "session") {
    const sessionLines = [
      `**Goal:** ${context.session.goal}`,
      `**Role:** ${context.session.role} (you remain the driver)`,
      `**Provider:** ${context.session.provider}`,
      `**Remaining budget:** ${context.session.remainingCalls} calls / ${context.session.remainingInputTokens} input tokens${
        context.session.remainingOutputTokens === undefined
          ? ""
          : ` / ${context.session.remainingOutputTokens} output tokens`
      }`,
    ];
    if (context.session.controlNotice !== undefined) {
      sessionLines.push(`**Coexistence:** ${context.session.controlNotice}`);
    }
    if (context.session.configurationWarning !== undefined) {
      sessionLines.push(
        `**Configuration:** ${context.session.configurationWarning}`,
      );
    }
    return {
      kind: "message",
      markdown: sessionLines.join("\n\n"),
    };
  }

  const latest = context.latest;
  if (latest === undefined) {
    return {
      kind: "message",
      markdown:
        "No active evidence yet. Select code or run **Adaptive Pair: Review Current Block**.",
    };
  }
  if (command === "trace" && requestContext.symbol === undefined) {
    return {
      kind: "message",
      markdown:
        "No current symbol could be resolved through VS Code's document symbol providers.",
    };
  }

  return {
    kind: "generate",
    uri: latest.uri,
    evidence: latest.evidence,
    goal: goalForCommand(command),
    context: {
      ...(requestContext.prompt.trim().length === 0
        ? {}
        : { userPrompt: requestContext.prompt }),
      ...(requestContext.symbol === undefined
        ? {}
        : { symbol: requestContext.symbol }),
    },
    purpose: purposeForCommand(command),
  };
};

const purposeForCommand = (
  command: string | undefined,
): "why" | "explain" | "trace" => {
  switch (command) {
    case "trace":
      return "trace";
    case "why":
      return "why";
    case "explain":
    default:
      return "explain";
  }
};

const goalForCommand = (
  command: string | undefined,
): string => {
  switch (command) {
    case "trace":
      return "Describe the relevant control and data flow for this evidence without inventing code context.";
    case "why":
      return "Explain why the current evidence matters and ask one useful follow-up question.";
    case "explain":
    default:
      return "Explain the current evidence and its trade-off, then ask one useful follow-up question.";
  }
};

export interface PairChatGenerator {
  generate(
    uri: string,
    goal: string,
    evidence: Evidence,
    signal: AbortSignal,
    context: ModelRequestContext,
    purpose?: "why" | "explain" | "trace",
  ): Promise<ModelResponse>;
}

export interface PairChatContextSource {
  snapshot(): PairContextSnapshot;
}

export interface PairSymbolContextProvider {
  forEvidence(
    uri: string,
    range: PairRange,
    signal: AbortSignal,
  ): Promise<ModelSymbolContext | undefined>;
}

const NO_SYMBOL_CONTEXT: PairSymbolContextProvider = {
  forEvidence: async () => undefined,
};

export interface PairChatParticipantOptions {
  readonly symbolContextProvider?: PairSymbolContextProvider;
  readonly sessionControl?: PairSessionControlPort;
  readonly requestLifecycle?: {
    register(uri: string, request: AbortController): PairDisposable;
  };
  readonly isOfficialCancellationError?: (error: unknown) => boolean;
}

export const registerPairChatParticipant = (
  register: (
    id: string,
    handler: vscode.ChatRequestHandler,
  ) => vscode.ChatParticipant,
  context: PairChatContextSource,
  generator: PairChatGenerator,
  options: PairChatParticipantOptions = {},
): vscode.ChatParticipant => {
  const symbolContextProvider =
    options.symbolContextProvider ?? NO_SYMBOL_CONTEXT;
  const handler: vscode.ChatRequestHandler = async (
    request,
    _chatContext,
    response,
    token,
  ) => {
    const abortController = new AbortController();
    let requestRegistration: PairDisposable | undefined;
    let requestRevision: number | undefined;
    if (token.isCancellationRequested) {
      abortController.abort();
    }
    const cancellationListener = token.onCancellationRequested(() => {
      abortController.abort();
    });
    try {
      if (abortController.signal.aborted) {
        return;
      }
      if (request.command === "start" || request.command === "stop") {
        const sessionControl = options.sessionControl;
        if (sessionControl === undefined) {
          response.markdown(
            "Adaptive Pair session controls are temporarily unavailable.",
          );
          return;
        }
        const result =
          request.command === "start"
            ? await sessionControl.startSession()
            : sessionControl.stopSession();
        if (!abortController.signal.aborted) {
          response.markdown(result.message);
        }
        return;
      }

      let snapshot = context.snapshot();
      requestRevision = snapshot.revision;
      if (
        snapshot.session.enabled &&
        snapshot.session.active &&
        snapshot.latest !== undefined
      ) {
        requestRegistration = options.requestLifecycle?.register(
          snapshot.latest.uri,
          abortController,
        );
        if (abortController.signal.aborted) {
          return;
        }
      }
      const traceLookupStarted =
        request.command === "trace" &&
        snapshot.session.enabled &&
        snapshot.session.active &&
        snapshot.latest !== undefined;
      const symbol =
        traceLookupStarted
          ? await (async (): Promise<ModelSymbolContext | undefined> => {
              const traceRevision = snapshot.revision;
              const traceUri = snapshot.latest!.uri;
              const traceRange = snapshot.latest!.evidence.range;
              const resolved = await symbolContextProvider.forEvidence(
                traceUri,
                traceRange,
                abortController.signal,
              );
              if (abortController.signal.aborted) {
                return undefined;
              }
              const current = context.snapshot();
              if (
                !current.session.enabled ||
                !current.session.active ||
                current.revision !== traceRevision
              ) {
                return undefined;
              }
              snapshot = current;
              return resolved;
            })()
          : undefined;
      if (abortController.signal.aborted) {
        return;
      }
      if (traceLookupStarted && symbol === undefined) {
        const current = context.snapshot();
        if (
          !current.session.enabled ||
          !current.session.active ||
          current.revision !== snapshot.revision
        ) {
          return;
        }
      }
      const plan = buildPairChatPlan(request.command, snapshot, {
        prompt: request.prompt,
        ...(symbol === undefined ? {} : { symbol }),
      });
      if (plan.kind === "message") {
        response.markdown(plan.markdown);
        return;
      }

      const generated = await generator.generate(
        plan.uri,
        plan.goal,
        plan.evidence,
        abortController.signal,
        plan.context,
        plan.purpose,
      );
      const current = context.snapshot();
      if (
        abortController.signal.aborted ||
        !isCurrentGeneratedResponse(current, snapshot)
      ) {
        return;
      }
      response.markdown(generated.text);
    } catch (error: unknown) {
      if (
        abortController.signal.aborted ||
        options.isOfficialCancellationError?.(error) === true ||
        (requestRevision !== undefined &&
          context.snapshot().revision !== requestRevision)
      ) {
        return;
      }
      if (!(error instanceof Error)) {
        throw error;
      }
      return {
        errorDetails: {
          message: `Adaptive Pair could not answer: ${error.message}`,
        },
      };
    } finally {
      requestRegistration?.dispose();
      cancellationListener.dispose();
    }
  };

  return register("adaptivePair.chat", handler);
};

const isCurrentGeneratedResponse = (
  current: PairContextSnapshot,
  started: PairContextSnapshot,
): boolean =>
  current.session.enabled &&
  current.session.active &&
  current.revision === started.revision;
