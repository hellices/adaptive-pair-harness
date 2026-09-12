import { createHash } from "node:crypto";
import { sanitizePersistentText } from "./modelRouter";
import type { Evidence } from "./types";

export interface PairPreferences {
  readonly interventionStyle: "eco" | "balanced" | "active";
  readonly interventionStyleExplicit: boolean;
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
  readonly source: "stored" | "default" | "corrupt";
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
  readonly dismissedRepositoryOrder: readonly string[];
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
const PERSISTED_EVIDENCE_ID_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const TITLE_URI_PATTERN = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>"'`]+/gu;
const TITLE_PATH_PATTERN =
  /(?:[A-Za-z]:[\\/]|(?:\.{1,2})?[\\/]|(?:[\p{L}\p{N}_.@-]+[\\/])+)[^\s<>"'`]+/gu;
const MAX_PERSISTED_TITLE_LENGTH = 120;
export const PAIR_MEMORY_RETENTION_LIMITS = Object.freeze({
  approvedEvidenceSummaries: 256,
  dismissedEvidencePerRepository: 256,
  dismissedRepositories: 32,
});
const DEFAULT_PREFERENCES: PairPreferences = Object.freeze({
  interventionStyle: "balanced",
  interventionStyleExplicit: false,
  pauseThresholdMs: 1_000,
});
const EMPTY_MEMORY: StoredPairMemory = Object.freeze({
  version: 1,
  preferences: DEFAULT_PREFERENCES,
  dismissedEvidenceByRepository: freezeDismissals({}),
  dismissedRepositoryOrder: Object.freeze([]),
  approvedEvidence: Object.freeze([]),
});

interface MemoryCoordinator {
  revision: number;
  queue: Promise<void>;
}

const memoryCoordinators = new WeakMap<KeyValueStore, MemoryCoordinator>();

const coordinatorFor = (store: KeyValueStore): MemoryCoordinator => {
  const existing = memoryCoordinators.get(store);
  if (existing !== undefined) {
    return existing;
  }

  const coordinator = {
    revision: 0,
    queue: Promise.resolve(),
  };
  memoryCoordinators.set(store, coordinator);
  return coordinator;
};

export class InvalidPairMemoryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidPairMemoryError";
  }
}

function freezePreferences(preferences: PairPreferences): PairPreferences {
  return Object.freeze({
    interventionStyle: preferences.interventionStyle,
    interventionStyleExplicit: preferences.interventionStyleExplicit,
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
  const frozenDismissals = createDismissalRecord();
  for (const [repositoryId, evidenceIds] of Object.entries(dismissals)) {
    frozenDismissals[repositoryId] = Object.freeze([...evidenceIds]);
  }

  return Object.freeze(frozenDismissals);
}

function createDismissalRecord(): Record<string, readonly string[]> {
  return Object.create(null) as Record<string, readonly string[]>;
}

function ownDismissalsFor(
  dismissals: Readonly<Record<string, readonly string[]>>,
  repositoryId: string,
): readonly string[] | undefined {
  return Object.prototype.hasOwnProperty.call(dismissals, repositoryId)
    ? dismissals[repositoryId]
    : undefined;
}

function freezeStoredMemory(memory: StoredPairMemory): StoredPairMemory {
  return Object.freeze({
    version: memory.version,
    preferences: freezePreferences(memory.preferences),
    dismissedEvidenceByRepository: freezeDismissals(
      memory.dismissedEvidenceByRepository,
    ),
    dismissedRepositoryOrder: Object.freeze([
      ...memory.dismissedRepositoryOrder,
    ]),
    approvedEvidence: freezeApprovedEvidence(memory.approvedEvidence),
  });
}

function freezeMemory(memory: PairMemory): PairMemory {
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
  const clonedDismissals = createDismissalRecord();
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

export const hashEvidenceIdentity = (evidenceId: string): string =>
  PERSISTED_EVIDENCE_ID_PATTERN.test(evidenceId)
    ? evidenceId
    : `sha256:${createHash("sha256").update(evidenceId, "utf8").digest("hex")}`;

const sanitizePersistedTitle = (
  title: string,
  kind: Evidence["kind"],
): string => {
  if (kind === "diagnostic") {
    return "Editor diagnostic";
  }

  const withoutLocations = title
    .replace(TITLE_URI_PATTERN, "[location]")
    .replace(TITLE_PATH_PATTERN, "[path]");
  const sanitized = sanitizePersistentText(
    withoutLocations,
    MAX_PERSISTED_TITLE_LENGTH,
  );

  return sanitized.length > 0 ? sanitized : "Evidence summary";
};

function validatePreferences(value: unknown): PairPreferences {
  if (!isRecord(value)) {
    throw invalidMemory(`preferences must be an object; received ${JSON.stringify(value)}`);
  }

  const interventionStyle = validateInterventionStyle(
    value.interventionStyle,
    "preferences.interventionStyle",
  );
  if (
    value.interventionStyleExplicit !== undefined &&
    typeof value.interventionStyleExplicit !== "boolean"
  ) {
    throw invalidMemory(
      `preferences.interventionStyleExplicit must be a boolean; received ${JSON.stringify(value.interventionStyleExplicit)}`,
    );
  }

  return freezePreferences({
    interventionStyle,
    interventionStyleExplicit:
      value.interventionStyleExplicit ?? interventionStyle !== "balanced",
    pauseThresholdMs: validateFiniteNumber(
      value.pauseThresholdMs,
      "preferences.pauseThresholdMs",
    ),
  });
}

interface ValidatedDismissals {
  readonly dismissedEvidenceByRepository: Readonly<
    Record<string, readonly string[]>
  >;
  readonly dismissedRepositoryOrder: readonly string[];
  readonly compacted: boolean;
}

function validateDismissedEvidenceIds(
  value: unknown,
  path: string,
  retain: boolean,
): { readonly evidenceIds: readonly string[]; readonly compacted: boolean } {
  if (!Array.isArray(value)) {
    throw invalidMemory(
      `${path} must be an array of strings`,
    );
  }

  const retainedNewestFirst: string[] = [];
  const retainedIds = new Set<string>();
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const evidenceId = value[index];
    if (typeof evidenceId !== "string") {
      throw invalidMemory(
        `${path}[${index}] must be a string; received ${JSON.stringify(evidenceId)}`,
      );
    }
    if (
      !retain ||
      retainedNewestFirst.length >=
        PAIR_MEMORY_RETENTION_LIMITS.dismissedEvidencePerRepository
    ) {
      continue;
    }

    const persistedEvidenceId = hashEvidenceIdentity(evidenceId);
    if (retainedIds.has(persistedEvidenceId)) {
      continue;
    }
    retainedIds.add(persistedEvidenceId);
    retainedNewestFirst.push(persistedEvidenceId);
  }

  retainedNewestFirst.reverse();
  return {
    evidenceIds: Object.freeze(retainedNewestFirst),
    compacted: retain && retainedNewestFirst.length !== value.length,
  };
}

function validateDismissals(
  value: unknown,
  repositoryOrderValue: unknown,
): ValidatedDismissals {
  if (!isRecord(value)) {
    throw invalidMemory(
      `dismissedEvidenceByRepository must be an object; received ${JSON.stringify(value)}`,
    );
  }

  if (
    repositoryOrderValue !== undefined &&
    !Array.isArray(repositoryOrderValue)
  ) {
    throw invalidMemory(
      "dismissedRepositoryOrder must be an array of strings",
    );
  }

  const explicitlyOrderedRepositories = new Map<string, true>();
  if (Array.isArray(repositoryOrderValue)) {
    for (const repositoryId of repositoryOrderValue) {
      if (typeof repositoryId !== "string") {
        throw invalidMemory(
          `dismissedRepositoryOrder entries must be strings; received ${JSON.stringify(repositoryId)}`,
        );
      }
      if (
        !Object.prototype.hasOwnProperty.call(value, repositoryId)
      ) {
        continue;
      }
      explicitlyOrderedRepositories.delete(repositoryId);
      explicitlyOrderedRepositories.set(repositoryId, true);
      if (
        explicitlyOrderedRepositories.size >
        PAIR_MEMORY_RETENTION_LIMITS.dismissedRepositories
      ) {
        const oldestRepositoryId =
          explicitlyOrderedRepositories.keys().next().value;
        if (oldestRepositoryId !== undefined) {
          explicitlyOrderedRepositories.delete(oldestRepositoryId);
        }
      }
    }
  }

  const unorderedCapacity =
    PAIR_MEMORY_RETENTION_LIMITS.dismissedRepositories -
    explicitlyOrderedRepositories.size;
  const unorderedRepositories = new Map<string, true>();
  let repositoryCount = 0;
  for (const repositoryId in value) {
    if (!Object.prototype.hasOwnProperty.call(value, repositoryId)) {
      continue;
    }
    repositoryCount += 1;
    if (
      unorderedCapacity === 0 ||
      explicitlyOrderedRepositories.has(repositoryId)
    ) {
      continue;
    }
    unorderedRepositories.set(repositoryId, true);
    if (unorderedRepositories.size > unorderedCapacity) {
      const oldestRepositoryId =
        unorderedRepositories.keys().next().value;
      if (oldestRepositoryId !== undefined) {
        unorderedRepositories.delete(oldestRepositoryId);
      }
    }
  }

  const dismissedRepositoryOrder = Object.freeze([
    ...unorderedRepositories.keys(),
    ...explicitlyOrderedRepositories.keys(),
  ]);
  const retainedRepositories = new Set(dismissedRepositoryOrder);
  const retainedEvidenceByRepository = new Map<
    string,
    readonly string[]
  >();
  let compacted =
    repositoryCount !== dismissedRepositoryOrder.length ||
    (Array.isArray(repositoryOrderValue) &&
      (repositoryOrderValue.length !== dismissedRepositoryOrder.length ||
        dismissedRepositoryOrder.some(
          (repositoryId, index) =>
            repositoryOrderValue[index] !== repositoryId,
        )));

  for (const repositoryId in value) {
    if (!Object.prototype.hasOwnProperty.call(value, repositoryId)) {
      continue;
    }
    const validated = validateDismissedEvidenceIds(
      value[repositoryId],
      `dismissedEvidenceByRepository.${repositoryId}`,
      retainedRepositories.has(repositoryId),
    );
    if (retainedRepositories.has(repositoryId)) {
      retainedEvidenceByRepository.set(
        repositoryId,
        validated.evidenceIds,
      );
      compacted ||= validated.compacted;
    }
  }

  const dismissals = createDismissalRecord();
  for (const repositoryId of dismissedRepositoryOrder) {
    dismissals[repositoryId] =
      retainedEvidenceByRepository.get(repositoryId) ?? Object.freeze([]);
  }

  return {
    dismissedEvidenceByRepository: freezeDismissals(dismissals),
    dismissedRepositoryOrder,
    compacted,
  };
}

function validateApprovedEvidenceKind(value: unknown, path: string): Evidence["kind"] {
  if (typeof value !== "string" || !EVIDENCE_KINDS.includes(value as Evidence["kind"])) {
    throw invalidMemory(
      `${path} must be one of ${EVIDENCE_KINDS.join(", ")}; received ${JSON.stringify(value)}`,
    );
  }

  return value as Evidence["kind"];
}

function validateApprovedEvidence(
  value: unknown,
): {
  readonly approvedEvidence: readonly ApprovedEvidence[];
  readonly compacted: boolean;
} {
  if (!Array.isArray(value)) {
    throw invalidMemory(`approvedEvidence must be an array; received ${JSON.stringify(value)}`);
  }

  const retainedNewestFirst: ApprovedEvidence[] = [];
  const retainedIds = new Set<string>();
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const entry = value[index];
    if (!isRecord(entry)) {
      throw invalidMemory(
        `approvedEvidence[${index}] must be an object; received ${JSON.stringify(entry)}`,
      );
    }

    const kind = validateApprovedEvidenceKind(
      entry.kind,
      `approvedEvidence[${index}].kind`,
    );
    const id = validateString(
      entry.id,
      `approvedEvidence[${index}].id`,
    );
    const title = validateString(
      entry.title,
      `approvedEvidence[${index}].title`,
    );
    const approvedAt = validateFiniteNumber(
      entry.approvedAt,
      `approvedEvidence[${index}].approvedAt`,
    );
    if (
      retainedNewestFirst.length >=
      PAIR_MEMORY_RETENTION_LIMITS.approvedEvidenceSummaries
    ) {
      continue;
    }

    const persistedEvidenceId = hashEvidenceIdentity(id);
    if (retainedIds.has(persistedEvidenceId)) {
      continue;
    }
    retainedIds.add(persistedEvidenceId);
    retainedNewestFirst.push(
      Object.freeze({
        id: persistedEvidenceId,
        kind,
        title: sanitizePersistedTitle(title, kind),
        approvedAt,
      }),
    );
  }

  retainedNewestFirst.reverse();
  return {
    approvedEvidence: Object.freeze(retainedNewestFirst),
    compacted: retainedNewestFirst.length !== value.length,
  };
}

interface ValidatedStoredMemory {
  readonly memory: StoredPairMemory;
  readonly compacted: boolean;
}

function validateStoredMemory(value: unknown): ValidatedStoredMemory {
  if (!isRecord(value)) {
    throw invalidMemory(`persisted pair memory must be an object; received ${JSON.stringify(value)}`);
  }

  if (value.version !== 1) {
    throw invalidMemory(`version must be 1; received ${JSON.stringify(value.version)}`);
  }

  const validatedDismissals = validateDismissals(
    value.dismissedEvidenceByRepository,
    value.dismissedRepositoryOrder,
  );
  const validatedApprovedEvidence = validateApprovedEvidence(
    value.approvedEvidence,
  );
  return {
    memory: freezeStoredMemory({
      version: 1,
      preferences: validatePreferences(value.preferences),
      dismissedEvidenceByRepository:
        validatedDismissals.dismissedEvidenceByRepository,
      dismissedRepositoryOrder:
        validatedDismissals.dismissedRepositoryOrder,
      approvedEvidence: validatedApprovedEvidence.approvedEvidence,
    }),
    compacted:
      validatedDismissals.compacted ||
      validatedApprovedEvidence.compacted,
  };
}

export class PairMemoryStore {
  private readonly memoryKey = MEMORY_KEY;

  public constructor(private readonly options: PairMemoryStoreOptions) {}

  public forRepository(repositoryId: string): PairMemoryStore {
    if (repositoryId === this.options.repositoryId) {
      return this;
    }
    return new PairMemoryStore({
      ...this.options,
      repositoryId,
    });
  }

  public get revision(): number {
    return coordinatorFor(this.options.store).revision;
  }

  public async load(): Promise<PairMemory> {
    await this.waitForPendingMutations();
    const revision = this.revision;
    const stored = await this.options.store.get<unknown>(this.memoryKey);
    if (stored === undefined) {
      return this.scopeToRepository(EMPTY_MEMORY);
    }
    const validated = validateStoredMemory(stored);
    if (validated.compacted) {
      await this.persistCompactionIfCurrent(revision);
    }
    return this.scopeToRepository(validated.memory);
  }

  private scopeToRepository(stored: StoredPairMemory): PairMemory {
    const dismissedEvidence = ownDismissalsFor(
      stored.dismissedEvidenceByRepository,
      this.options.repositoryId,
    );

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
    await this.waitForPendingMutations();
    const revision = this.revision;
    const stored = await this.options.store.get<unknown>(this.memoryKey);
    if (stored === undefined) {
      return {
        memory: this.scopeToRepository(EMPTY_MEMORY),
        warning: undefined,
        source: "default",
      };
    }
    try {
      const validated = validateStoredMemory(stored);
      if (validated.compacted) {
        await this.persistCompactionIfCurrent(revision);
      }
      return {
        memory: this.scopeToRepository(validated.memory),
        warning: undefined,
        source: "stored",
      };
    } catch (error: unknown) {
      if (!(error instanceof InvalidPairMemoryError)) {
        throw error;
      }
      return {
        memory: freezeMemory(EMPTY_MEMORY),
        warning:
          "Stored Adaptive Pair memory is corrupt. Safe in-memory defaults are active; the stored record was preserved. Run Adaptive Pair: Reset Local Memory to replace it.",
        source: "corrupt",
      };
    }
  }

  public async reset(): Promise<void> {
    const coordinator = coordinatorFor(this.options.store);
    coordinator.revision += 1;
    const mutation = coordinator.queue
      .catch(() => undefined)
      .then(async () => {
        await this.saveStoredMemory(EMPTY_MEMORY);
      });
    coordinator.queue = mutation.then(
      () => undefined,
      () => undefined,
    );
    return mutation;
  }

  public async updatePreferences(
    preferences: Partial<
      Pick<PairPreferences, "interventionStyle" | "pauseThresholdMs">
    >,
  ): Promise<void> {
    await this.enqueueMutation((stored) => ({
      version: 1,
      preferences: freezePreferences({
        interventionStyle:
          preferences.interventionStyle ?? stored.preferences.interventionStyle,
        interventionStyleExplicit:
          preferences.interventionStyle === undefined
            ? stored.preferences.interventionStyleExplicit
            : true,
        pauseThresholdMs:
          preferences.pauseThresholdMs ?? stored.preferences.pauseThresholdMs,
      }),
      dismissedEvidenceByRepository: stored.dismissedEvidenceByRepository,
      dismissedRepositoryOrder: stored.dismissedRepositoryOrder,
      approvedEvidence: stored.approvedEvidence,
    }));
  }

  public async dismissEvidence(evidenceId: string): Promise<void> {
    const persistedEvidenceId = hashEvidenceIdentity(evidenceId);
    await this.enqueueMutation((stored) => {
      const dismissedEvidenceByRepository = cloneDismissals(
        stored.dismissedEvidenceByRepository,
      );
      const currentDismissed =
        ownDismissalsFor(
          dismissedEvidenceByRepository,
          this.options.repositoryId,
        ) ?? [];
      dismissedEvidenceByRepository[this.options.repositoryId] = [
        ...currentDismissed.filter(
          (dismissedId) => dismissedId !== persistedEvidenceId,
        ),
        persistedEvidenceId,
      ].slice(
        -PAIR_MEMORY_RETENTION_LIMITS.dismissedEvidencePerRepository,
      );
      const dismissedRepositoryOrder = [
        ...stored.dismissedRepositoryOrder.filter(
          (repositoryId) => repositoryId !== this.options.repositoryId,
        ),
        this.options.repositoryId,
      ];
      if (
        dismissedRepositoryOrder.length >
        PAIR_MEMORY_RETENTION_LIMITS.dismissedRepositories
      ) {
        const removedRepositoryId = dismissedRepositoryOrder.shift();
        if (removedRepositoryId !== undefined) {
          delete dismissedEvidenceByRepository[removedRepositoryId];
        }
      }

      return {
        version: 1,
        preferences: stored.preferences,
        dismissedEvidenceByRepository,
        dismissedRepositoryOrder,
        approvedEvidence: stored.approvedEvidence,
      };
    });
  }

  public async approveEvidence(
    evidence: Evidence,
    approvedAt: number = this.now(),
  ): Promise<void> {
    const persistedEvidenceId = hashEvidenceIdentity(evidence.id);
    await this.enqueueMutation((stored) => {
      const updatedApprovedEvidence = stored.approvedEvidence.filter(
        (approved) => approved.id !== persistedEvidenceId,
      );
      updatedApprovedEvidence.push(
        Object.freeze({
          id: persistedEvidenceId,
          kind: evidence.kind,
          title: sanitizePersistedTitle(evidence.title, evidence.kind),
          approvedAt,
        }),
      );
      if (
        updatedApprovedEvidence.length >
        PAIR_MEMORY_RETENTION_LIMITS.approvedEvidenceSummaries
      ) {
        updatedApprovedEvidence.shift();
      }

      return {
        version: 1,
        preferences: stored.preferences,
        dismissedEvidenceByRepository: stored.dismissedEvidenceByRepository,
        dismissedRepositoryOrder: stored.dismissedRepositoryOrder,
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
    const coordinator = coordinatorFor(this.options.store);
    coordinator.revision += 1;
    const mutation = coordinator.queue.catch(() => undefined).then(async () => {
      const stored = await this.loadStoredMemory();
      const next = await mutate(stored);
      await this.saveStoredMemory(next);
    });

    coordinator.queue = mutation.then(
      () => undefined,
      () => undefined,
    );

    return mutation;
  }

  private async waitForPendingMutations(): Promise<void> {
    const coordinator = coordinatorFor(this.options.store);
    let pending = coordinator.queue;
    await pending;
    while (pending !== coordinator.queue) {
      pending = coordinator.queue;
      await pending;
    }
  }

  private persistCompactionIfCurrent(revision: number): Promise<void> {
    const coordinator = coordinatorFor(this.options.store);
    const compaction = coordinator.queue
      .catch(() => undefined)
      .then(async () => {
        if (coordinator.revision !== revision) {
          return;
        }
        const current = await this.options.store.get<unknown>(
          this.memoryKey,
        );
        if (current === undefined) {
          return;
        }
        const validated = validateStoredMemory(current);
        if (
          validated.compacted &&
          coordinator.revision === revision
        ) {
          await this.saveStoredMemory(validated.memory);
        }
      });
    coordinator.queue = compaction.then(
      () => undefined,
      () => undefined,
    );
    return compaction;
  }

  private async loadStoredMemory(): Promise<StoredPairMemory> {
    const stored = await this.options.store.get<unknown>(this.memoryKey);
    if (stored === undefined) {
      return EMPTY_MEMORY;
    }

    const validated = validateStoredMemory(stored);
    return validated.memory;
  }

  private async saveStoredMemory(memory: StoredPairMemory): Promise<void> {
    const compacted = validateStoredMemory(memory).memory;
    await this.options.store.update(this.memoryKey, compacted);
  }
}
