export interface PairPosition {
  readonly line: number;
  readonly character: number;
}

export interface PairRange {
  readonly start: PairPosition;
  readonly end: PairPosition;
}

export interface EditEpisode {
  readonly uri: string;
  readonly languageId: string;
  readonly previousText: string;
  readonly currentText: string;
  readonly version: number;
  readonly observedAt: number;
}

export type EditSnapshot = EditEpisode;

export interface Evidence {
  readonly id: string;
  readonly kind:
    | "new-dependency"
    | "public-api-change"
    | "complexity-growth"
    | "diagnostic"
    | "external-harness";
  readonly severity: "info" | "warning" | "error";
  readonly title: string;
  readonly detail: string;
  readonly source: string;
  readonly confidence: number;
  readonly range: PairRange;
  readonly references: readonly string[];
}

export interface Scheduler {
  schedule(delayMs: number, callback: () => void): unknown;
  cancel(handle: unknown): void;
}
