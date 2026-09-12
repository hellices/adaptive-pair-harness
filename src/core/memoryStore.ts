import type { Evidence } from "./types";

export interface PairPreferences {
  readonly interventionStyle: "eco" | "balanced" | "active";
  readonly pauseThresholdMs: number;
}

export interface ApprovedEvidence {
  readonly id: string;
  readonly kind: Evidence["kind"];
  readonly title: string;
  readonly approvedAt: number;
}

export interface PairMemory {
  readonly version: 1;
  readonly preferences: PairPreferences;
  readonly dismissedEvidenceByRepository: Readonly<Record<string, readonly string[]>>;
  readonly approvedEvidence: readonly ApprovedEvidence[];
}

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  update<T>(key: string, value: T): Promise<void>;
}

export interface PairMemoryStoreOptions {
  readonly store: KeyValueStore;
  readonly repositoryId: string;
  readonly now?: () => number;
}

interface StoredPairMemory {
  readonly version: 1;
  readonly preferences: PairPreferences;
  readonly dismissedEvidenceByRepository: Readonly<Record<string, readonly string[]>>;
  readonly approvedEvidence: readonly ApprovedEvidence[];
}

const MEMORY_KEY = "adaptive-pair.memory";
const DEFAULT_PREFERENCES: PairPreferences = Object.freeze({
  interventionStyle: "balanced",
  pauseThresholdMs: 1_000,
});
const EMPTY_MEMORY: StoredPairMemory = Object.freeze({
  version: 1,
  preferences: DEFAULT_PREFERENCES,
  dismissedEvidenceByRepository: Object.freeze({}),
  approvedEvidence: Object.freeze([]),
});

function freezePreferences(preferences: PairPreferences): PairPreferences {
  return Object.freeze(preferences);
}

function freezeApprovedEvidence(
  approvedEvidence: ApprovedEvidence[],
): readonly ApprovedEvidence[] {
  return Object.freeze(
    approvedEvidence.map((entry) =>
      Object.freeze({
        id: entry.id,
        kind: entry.kind,
        title: entry.title,
        approvedAt: entry.approvedAt,
      }),
    ),
  );
}

function freezeDismissals(
  dismissals: Record<string, readonly string[]>,
): Readonly<Record<string, readonly string[]>> {
  const frozenDismissals: Record<string, readonly string[]> = {};
  for (const [repositoryId, evidenceIds] of Object.entries(dismissals)) {
    frozenDismissals[repositoryId] = Object.freeze([...evidenceIds]);
  }

  return Object.freeze(frozenDismissals);
}

function freezeMemory(memory: StoredPairMemory): StoredPairMemory {
  return Object.freeze({
    version: memory.version,
    preferences: freezePreferences({
      interventionStyle: memory.preferences.interventionStyle,
      pauseThresholdMs: memory.preferences.pauseThresholdMs,
    }),
    dismissedEvidenceByRepository: freezeDismissals(
      memory.dismissedEvidenceByRepository as Record<string, readonly string[]>,
    ),
    approvedEvidence: freezeApprovedEvidence([...memory.approvedEvidence]),
  });
}

function cloneDismissals(
  dismissals: Readonly<Record<string, readonly string[]>>,
): Record<string, readonly string[]> {
  const clonedDismissals: Record<string, readonly string[]> = {};
  for (const [repositoryId, evidenceIds] of Object.entries(dismissals)) {
    clonedDismissals[repositoryId] = [...evidenceIds];
  }

  return clonedDismissals;
}

export class PairMemoryStore {
  private readonly memoryKey = MEMORY_KEY;

  public constructor(private readonly options: PairMemoryStoreOptions) {}

  public async load(): Promise<PairMemory> {
    const stored = await this.loadStoredMemory();
    const dismissedEvidenceByRepository = stored.dismissedEvidenceByRepository[
      this.options.repositoryId
    ];

    return freezeMemory({
      version: 1,
      preferences: stored.preferences,
      dismissedEvidenceByRepository:
        dismissedEvidenceByRepository === undefined
          ? Object.freeze({})
          : freezeDismissals({
              [this.options.repositoryId]: dismissedEvidenceByRepository,
            }),
      approvedEvidence: stored.approvedEvidence,
    });
  }

  public async updatePreferences(
    preferences: Partial<PairPreferences>,
  ): Promise<void> {
    const stored = await this.loadStoredMemory();
    await this.saveStoredMemory({
      version: 1,
      preferences: freezePreferences({
        interventionStyle:
          preferences.interventionStyle ?? stored.preferences.interventionStyle,
        pauseThresholdMs:
          preferences.pauseThresholdMs ?? stored.preferences.pauseThresholdMs,
      }),
      dismissedEvidenceByRepository: stored.dismissedEvidenceByRepository,
      approvedEvidence: stored.approvedEvidence,
    });
  }

  public async dismissEvidence(evidenceId: string): Promise<void> {
    const stored = await this.loadStoredMemory();
    const dismissedEvidenceByRepository = cloneDismissals(
      stored.dismissedEvidenceByRepository,
    );
    const currentDismissed = dismissedEvidenceByRepository[this.options.repositoryId] ?? [];

    if (!currentDismissed.includes(evidenceId)) {
      dismissedEvidenceByRepository[this.options.repositoryId] = [
        ...currentDismissed,
        evidenceId,
      ];
    }

    await this.saveStoredMemory({
      version: 1,
      preferences: stored.preferences,
      dismissedEvidenceByRepository,
      approvedEvidence: stored.approvedEvidence,
    });
  }

  public async approveEvidence(
    evidence: Evidence,
    approvedAt: number = this.now(),
  ): Promise<void> {
    const stored = await this.loadStoredMemory();
    const updatedApprovedEvidence = stored.approvedEvidence.filter(
      (approved) => approved.id !== evidence.id,
    );
    updatedApprovedEvidence.push(
      Object.freeze({
        id: evidence.id,
        kind: evidence.kind,
        title: evidence.title,
        approvedAt,
      }),
    );

    await this.saveStoredMemory({
      version: 1,
      preferences: stored.preferences,
      dismissedEvidenceByRepository: stored.dismissedEvidenceByRepository,
      approvedEvidence: updatedApprovedEvidence,
    });
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private async loadStoredMemory(): Promise<StoredPairMemory> {
    const stored = await this.options.store.get<StoredPairMemory>(this.memoryKey);
    if (stored === undefined) {
      return EMPTY_MEMORY;
    }

    return freezeMemory({
      version: 1,
      preferences: stored.preferences,
      dismissedEvidenceByRepository: stored.dismissedEvidenceByRepository,
      approvedEvidence: stored.approvedEvidence,
    });
  }

  private async saveStoredMemory(memory: StoredPairMemory): Promise<void> {
    await this.options.store.update(this.memoryKey, freezeMemory(memory));
  }
}
