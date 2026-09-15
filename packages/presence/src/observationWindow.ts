export type ObservationKind =
  | "edit-episode"
  | "diagnostic"
  | "navigation"
  | "verification"
  | "workspace";

export interface ObservationPosition {
  readonly line: number;
  readonly character: number;
}

export interface ObservationRange {
  readonly start: ObservationPosition;
  readonly end: ObservationPosition;
}

export interface ObservationEpisode {
  readonly kind: ObservationKind;
  readonly range?: ObservationRange;
  readonly summary: string;
  readonly observedAt: number;
}

const freezeRangePosition = (
  position: ObservationPosition,
): ObservationPosition => {
  if (!Number.isSafeInteger(position.line) || position.line < 0) {
    throw new Error("Observation range lines must be non-negative safe integers.");
  }

  if (!Number.isSafeInteger(position.character) || position.character < 0) {
    throw new Error(
      "Observation range characters must be non-negative safe integers.",
    );
  }

  return Object.freeze({
    line: position.line,
    character: position.character,
  });
};

const freezeRange = (range: ObservationRange): ObservationRange =>
  Object.freeze({
    start: freezeRangePosition(range.start),
    end: freezeRangePosition(range.end),
  });

const normalizeEpisode = (episode: ObservationEpisode): ObservationEpisode => {
  if (episode.summary.length === 0 || episode.summary.length > 500) {
    throw new Error("Observation summary must contain 1-500 characters.");
  }

  if (!Number.isFinite(episode.observedAt)) {
    throw new Error("Observation timestamps must be finite numbers.");
  }

  const normalized = {
    kind: episode.kind,
    summary: episode.summary,
    observedAt: episode.observedAt,
    ...(episode.range === undefined ? {} : { range: freezeRange(episode.range) }),
  } satisfies ObservationEpisode;

  return Object.freeze(normalized);
};

export class ObservationWindow {
  private readonly episodes: ObservationEpisode[] = [];

  public constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error("Observation capacity must be a positive safe integer.");
    }
  }

  public record(episode: ObservationEpisode): void {
    this.episodes.push(normalizeEpisode(episode));
    if (this.episodes.length > this.capacity) {
      this.episodes.shift();
    }
  }

  public snapshot(): readonly ObservationEpisode[] {
    return Object.freeze(this.episodes.map(episode => normalizeEpisode(episode)));
  }
}
