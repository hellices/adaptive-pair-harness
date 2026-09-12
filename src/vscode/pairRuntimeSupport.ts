import type { Evidence, PairRange } from "../core/types";

export type PairInvocationSource = "automatic" | "manual" | "chat";

export type PairInvocationResult<T> =
  | {
      readonly kind: "completed";
      readonly source: PairInvocationSource;
      readonly value: T;
    }
  | {
      readonly kind: "disabled";
      readonly source: PairInvocationSource;
    };

export class PairInvocationGate {
  public constructor(public readonly enabled: boolean) {}

  public async run<T>(
    source: PairInvocationSource,
    operation: () => Promise<T>,
  ): Promise<PairInvocationResult<T>> {
    if (!this.enabled) {
      return { kind: "disabled", source };
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
    : "$(circle-slash) Pair: Disabled";
  return details.length === 0 ? headline : `${headline} · ${details.join(" · ")}`;
};

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
