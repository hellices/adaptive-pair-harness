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
const DEFAULT_PREFERENCES: PairPreferences = Object.freeze({
  interventionStyle: "balanced",
  interventionStyleExplicit: false,
  pauseThresholdMs: 1_000,
});
const EMPTY_MEMORY: StoredPairMemory = Object.freeze({
  version: 1,
  preferences: DEFAULT_PREFERENCES,
  dismissedEvidenceByRepository: freezeDismissals({}),
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

function validateDismissals(
  value: unknown,
): Readonly<Record<string, readonly string[]>> {
  if (!isRecord(value)) {
    throw invalidMemory(
      `dismissedEvidenceByRepository must be an object; received ${JSON.stringify(value)}`,
    );
  }

  const dismissals = createDismissalRecord();
  for (const [repositoryId, evidenceIds] of Object.entries(value)) {
    if (!Array.isArray(evidenceIds) || evidenceIds.some((evidenceId) => typeof evidenceId !== "string")) {
      throw invalidMemory(
        `dismissedEvidenceByRepository.${repositoryId} must be an array of strings; received ${JSON.stringify(evidenceIds)}`,
      );
    }

    dismissals[repositoryId] = evidenceIds.map(hashEvidenceIdentity);
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

    const kind = validateApprovedEvidenceKind(
      entry.kind,
      `approvedEvidence[${index}].kind`,
    );
    return Object.freeze({
      id: hashEvidenceIdentity(
        validateString(entry.id, `approvedEvidence[${index}].id`),
      ),
      kind,
      title: sanitizePersistedTitle(
        validateString(entry.title, `approvedEvidence[${index}].title`),
        kind,
      ),
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
    const stored = await this.loadStoredMemory();
    return this.scopeToRepository(stored);
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
    const stored = await this.options.store.get<unknown>(this.memoryKey);
    if (stored === undefined) {
      return {
        memory: this.scopeToRepository(EMPTY_MEMORY),
        warning: undefined,
        source: "default",
      };
    }
    try {
      return {
        memory: this.scopeToRepository(validateStoredMemory(stored)),
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

      if (!currentDismissed.includes(persistedEvidenceId)) {
        dismissedEvidenceByRepository[this.options.repositoryId] = [
          ...currentDismissed,
          persistedEvidenceId,
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
