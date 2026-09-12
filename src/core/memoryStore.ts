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

export interface PairMemoryRecovery {
  readonly memory: PairMemory;
  readonly warning: string | undefined;
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
const INTERVENTION_STYLES = ["eco", "balanced", "active"] as const;
const EVIDENCE_KINDS = [
  "new-dependency",
  "public-api-change",
  "complexity-growth",
  "diagnostic",
  "external-harness",
] as const;
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

const mutationQueues = new WeakMap<KeyValueStore, Promise<void>>();

export class InvalidPairMemoryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidPairMemoryError";
  }
}

function freezePreferences(preferences: PairPreferences): PairPreferences {
  return Object.freeze({
    interventionStyle: preferences.interventionStyle,
    pauseThresholdMs: preferences.pauseThresholdMs,
  });
}

function freezeApprovedEvidence(
  approvedEvidence: readonly ApprovedEvidence[],
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
  dismissals: Readonly<Record<string, readonly string[]>>,
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
    preferences: freezePreferences(memory.preferences),
    dismissedEvidenceByRepository: freezeDismissals(
      memory.dismissedEvidenceByRepository,
    ),
    approvedEvidence: freezeApprovedEvidence(memory.approvedEvidence),
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

function invalidMemory(message: string): InvalidPairMemoryError {
  return new InvalidPairMemoryError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateInterventionStyle(value: unknown, path: string): PairPreferences["interventionStyle"] {
  if (
    typeof value !== "string" ||
    !INTERVENTION_STYLES.includes(value as PairPreferences["interventionStyle"])
  ) {
    throw invalidMemory(
      `${path} must be one of ${INTERVENTION_STYLES.join(", ")}; received ${JSON.stringify(value)}`,
    );
  }

  return value as PairPreferences["interventionStyle"];
}

function validateFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalidMemory(`${path} must be a finite number; received ${JSON.stringify(value)}`);
  }

  return value;
}

function validateString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw invalidMemory(`${path} must be a string; received ${JSON.stringify(value)}`);
  }

  return value;
}

function validatePreferences(value: unknown): PairPreferences {
  if (!isRecord(value)) {
    throw invalidMemory(`preferences must be an object; received ${JSON.stringify(value)}`);
  }

  return freezePreferences({
    interventionStyle: validateInterventionStyle(
      value.interventionStyle,
      "preferences.interventionStyle",
    ),
    pauseThresholdMs: validateFiniteNumber(
      value.pauseThresholdMs,
      "preferences.pauseThresholdMs",
    ),
  });
}

function validateDismissals(
  value: unknown,
): Readonly<Record<string, readonly string[]>> {
  if (!isRecord(value)) {
    throw invalidMemory(
      `dismissedEvidenceByRepository must be an object; received ${JSON.stringify(value)}`,
    );
  }

  const dismissals: Record<string, readonly string[]> = {};
  for (const [repositoryId, evidenceIds] of Object.entries(value)) {
    if (!Array.isArray(evidenceIds) || evidenceIds.some((evidenceId) => typeof evidenceId !== "string")) {
      throw invalidMemory(
        `dismissedEvidenceByRepository.${repositoryId} must be an array of strings; received ${JSON.stringify(evidenceIds)}`,
      );
    }

    dismissals[repositoryId] = [...evidenceIds];
  }

  return freezeDismissals(dismissals);
}

function validateApprovedEvidenceKind(value: unknown, path: string): Evidence["kind"] {
  if (typeof value !== "string" || !EVIDENCE_KINDS.includes(value as Evidence["kind"])) {
    throw invalidMemory(
      `${path} must be one of ${EVIDENCE_KINDS.join(", ")}; received ${JSON.stringify(value)}`,
    );
  }

  return value as Evidence["kind"];
}

function validateApprovedEvidence(value: unknown): readonly ApprovedEvidence[] {
  if (!Array.isArray(value)) {
    throw invalidMemory(`approvedEvidence must be an array; received ${JSON.stringify(value)}`);
  }

  const approvedEvidence = value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw invalidMemory(
        `approvedEvidence[${index}] must be an object; received ${JSON.stringify(entry)}`,
      );
    }

    return Object.freeze({
      id: validateString(entry.id, `approvedEvidence[${index}].id`),
      kind: validateApprovedEvidenceKind(entry.kind, `approvedEvidence[${index}].kind`),
      title: validateString(entry.title, `approvedEvidence[${index}].title`),
      approvedAt: validateFiniteNumber(entry.approvedAt, `approvedEvidence[${index}].approvedAt`),
    });
  });

  return Object.freeze(approvedEvidence);
}

function validateStoredMemory(value: unknown): StoredPairMemory {
  if (!isRecord(value)) {
    throw invalidMemory(`persisted pair memory must be an object; received ${JSON.stringify(value)}`);
  }

  if (value.version !== 1) {
    throw invalidMemory(`version must be 1; received ${JSON.stringify(value.version)}`);
  }

  return freezeMemory({
    version: 1,
    preferences: validatePreferences(value.preferences),
    dismissedEvidenceByRepository: validateDismissals(value.dismissedEvidenceByRepository),
    approvedEvidence: validateApprovedEvidence(value.approvedEvidence),
  });
}

export class PairMemoryStore {
  private readonly memoryKey = MEMORY_KEY;

  public constructor(private readonly options: PairMemoryStoreOptions) {}

  public async load(): Promise<PairMemory> {
    const stored = await this.loadStoredMemory();
    const dismissedEvidence = stored.dismissedEvidenceByRepository[this.options.repositoryId];

    return freezeMemory({
      version: 1,
      preferences: stored.preferences,
      dismissedEvidenceByRepository:
        dismissedEvidence === undefined
          ? Object.freeze({})
          : freezeDismissals({
              [this.options.repositoryId]: dismissedEvidence,
            }),
      approvedEvidence: stored.approvedEvidence,
    });
  }

  public async loadOrDefault(): Promise<PairMemoryRecovery> {
    try {
      return {
        memory: await this.load(),
        warning: undefined,
      };
    } catch (error: unknown) {
      if (!(error instanceof InvalidPairMemoryError)) {
        throw error;
      }
      return {
        memory: freezeMemory(EMPTY_MEMORY),
        warning:
          "Stored Adaptive Pair memory is corrupt. Safe in-memory defaults are active; the stored record was preserved. Run Adaptive Pair: Reset Local Memory to replace it.",
      };
    }
  }

  public async reset(): Promise<void> {
    const previousMutation =
      mutationQueues.get(this.options.store) ?? Promise.resolve();
    const mutation = previousMutation
      .catch(() => undefined)
      .then(async () => {
        await this.saveStoredMemory(EMPTY_MEMORY);
      });
    mutationQueues.set(
      this.options.store,
      mutation.then(
        () => undefined,
        () => undefined,
      ),
    );
    return mutation;
  }

  public async updatePreferences(
    preferences: Partial<PairPreferences>,
  ): Promise<void> {
    await this.enqueueMutation((stored) => ({
      version: 1,
      preferences: freezePreferences({
        interventionStyle:
          preferences.interventionStyle ?? stored.preferences.interventionStyle,
        pauseThresholdMs:
          preferences.pauseThresholdMs ?? stored.preferences.pauseThresholdMs,
      }),
      dismissedEvidenceByRepository: stored.dismissedEvidenceByRepository,
      approvedEvidence: stored.approvedEvidence,
    }));
  }

  public async dismissEvidence(evidenceId: string): Promise<void> {
    await this.enqueueMutation((stored) => {
      const dismissedEvidenceByRepository = cloneDismissals(
        stored.dismissedEvidenceByRepository,
      );
      const currentDismissed =
        dismissedEvidenceByRepository[this.options.repositoryId] ?? [];

      if (!currentDismissed.includes(evidenceId)) {
        dismissedEvidenceByRepository[this.options.repositoryId] = [
          ...currentDismissed,
          evidenceId,
        ];
      }

      return {
        version: 1,
        preferences: stored.preferences,
        dismissedEvidenceByRepository,
        approvedEvidence: stored.approvedEvidence,
      };
    });
  }

  public async approveEvidence(
    evidence: Evidence,
    approvedAt: number = this.now(),
  ): Promise<void> {
    await this.enqueueMutation((stored) => {
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

      return {
        version: 1,
        preferences: stored.preferences,
        dismissedEvidenceByRepository: stored.dismissedEvidenceByRepository,
        approvedEvidence: updatedApprovedEvidence,
      };
    });
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private async enqueueMutation(
    mutate: (stored: StoredPairMemory) => StoredPairMemory | Promise<StoredPairMemory>,
  ): Promise<void> {
    const previousMutation = mutationQueues.get(this.options.store) ?? Promise.resolve();
    const mutation = previousMutation.catch(() => undefined).then(async () => {
      const stored = await this.loadStoredMemory();
      const next = await mutate(stored);
      await this.saveStoredMemory(next);
    });

    mutationQueues.set(
      this.options.store,
      mutation.then(
        () => undefined,
        () => undefined,
      ),
    );

    return mutation;
  }

  private async loadStoredMemory(): Promise<StoredPairMemory> {
    const stored = await this.options.store.get<unknown>(this.memoryKey);
    if (stored === undefined) {
      return EMPTY_MEMORY;
    }

    return validateStoredMemory(stored);
  }

  private async saveStoredMemory(memory: StoredPairMemory): Promise<void> {
    await this.options.store.update(this.memoryKey, freezeMemory(memory));
  }
}
