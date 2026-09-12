import { describe, expect, it, vi } from "vitest";
import type { Evidence } from "../src/core/types";
import {
  hashEvidenceIdentity,
  PAIR_MEMORY_RETENTION_LIMITS,
  PairMemoryStore,
} from "../src/core/memoryStore";

const repositoryA = "/workspace/repo-a";
const repositoryB = "/workspace/repo-b";

const evidence: Evidence = {
  id: "evidence-1",
  kind: "public-api-change",
  severity: "warning",
  title: "Exported API changed",
  detail: "Changed the signature of the exported loader.",
  source: "src/core/semanticAnalyzer.ts",
  confidence: 0.98,
  range: {
    start: { line: 1, character: 0 },
    end: { line: 1, character: 12 },
  },
  references: ["./src/core/semanticAnalyzer.ts"],
};
const evidenceHash = hashEvidenceIdentity(evidence.id);

interface StoredValue {
  readonly [key: string]: unknown;
}

interface PersistedMemory {
  readonly approvedEvidence?: readonly Readonly<Record<string, unknown>>[];
  readonly dismissedEvidenceByRepository?: Readonly<
    Record<string, readonly string[]>
  >;
  readonly dismissedRepositoryOrder?: readonly string[];
}

class InMemoryKeyValueStore {
  public readonly values = new Map<string, unknown>();

  public async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  public async update<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  public snapshot(key: string): StoredValue | undefined {
    const value = this.values.get(key);
    if (value === undefined || typeof value !== "object" || value === null) {
      return undefined;
    }

    return value as StoredValue;
  }
}

class ControlledUpdateKeyValueStore extends InMemoryKeyValueStore {
  private readonly pendingUpdates: Array<() => void> = [];

  public override async update<T>(key: string, value: T): Promise<void> {
    await new Promise<void>((resolve) => {
      this.pendingUpdates.push(() => {
        this.values.set(key, value);
        resolve();
      });
    });
  }

  public get updateCallCount(): number {
    return this.pendingUpdates.length;
  }

  public releaseUpdate(index: number): void {
    const release = this.pendingUpdates[index];
    if (release === undefined) {
      throw new Error(`No update at index ${index}`);
    }

    release();
  }
}

class FailingUpdateKeyValueStore extends InMemoryKeyValueStore {
  public constructor(private remainingFailures: number) {
    super();
  }

  public override async update<T>(key: string, value: T): Promise<void> {
    if (this.remainingFailures > 0) {
      this.remainingFailures -= 1;
      throw new Error("simulated write failure");
    }

    this.values.set(key, value);
  }
}

describe("PairMemoryStore", () => {
  it("loads defaults when storage is empty", async () => {
    const store = new InMemoryKeyValueStore();
    const memoryStore = new PairMemoryStore({
      store,
      repositoryId: repositoryA,
    });

    await expect(memoryStore.load()).resolves.toEqual({
      version: 1,
      preferences: {
        interventionStyle: "balanced",
        interventionStyleExplicit: false,
        pauseThresholdMs: 1_000,
      },
      dismissedEvidenceByRepository: {},
      approvedEvidence: [],
    });
  });

  it.each(["constructor", "__proto__"])(
    "loads dismissals for the own repository key %s",
    async (repositoryId) => {
      const store = new InMemoryKeyValueStore();
      const dismissals = Object.assign(Object.create(null), {
        [repositoryId]: [evidence.id],
      }) as Record<string, readonly string[]>;
      await store.update("adaptive-pair.memory", {
        version: 1,
        preferences: {
          interventionStyle: "balanced",
          pauseThresholdMs: 1_000,
        },
        dismissedEvidenceByRepository: dismissals,
        approvedEvidence: [],
      });
      const memoryStore = new PairMemoryStore({
        store,
        repositoryId,
      });

      const memory = await memoryStore.load();

      expect(Object.getPrototypeOf(memory.dismissedEvidenceByRepository)).toBeNull();
      expect(memory.dismissedEvidenceByRepository).toHaveProperty(
        repositoryId,
        [evidenceHash],
      );
    },
  );

  it.each(["constructor", "__proto__"])(
    "dismisses evidence for the own repository key %s",
    async (repositoryId) => {
      const store = new InMemoryKeyValueStore();
      const memoryStore = new PairMemoryStore({
        store,
        repositoryId,
      });

      await memoryStore.dismissEvidence(evidence.id);
      const memory = await memoryStore.load();

      expect(Object.getPrototypeOf(memory.dismissedEvidenceByRepository)).toBeNull();
      expect(memory.dismissedEvidenceByRepository).toHaveProperty(
        repositoryId,
        [evidenceHash],
      );
    },
  );

  it("treats legacy balanced version-1 preferences as defaults while preserving legacy non-default selections", async () => {
    const store = new InMemoryKeyValueStore();
    const memoryStore = new PairMemoryStore({
      store,
      repositoryId: repositoryA,
    });
    await store.update("adaptive-pair.memory", {
      version: 1,
      preferences: {
        interventionStyle: "balanced",
        pauseThresholdMs: 1_000,
      },
      dismissedEvidenceByRepository: {},
      approvedEvidence: [],
    });

    await expect(memoryStore.load()).resolves.toMatchObject({
      preferences: {
        interventionStyle: "balanced",
        interventionStyleExplicit: false,
      },
    });

    await store.update("adaptive-pair.memory", {
      version: 1,
      preferences: {
        interventionStyle: "active",
        pauseThresholdMs: 1_000,
      },
      dismissedEvidenceByRepository: {},
      approvedEvidence: [],
    });

    await expect(memoryStore.load()).resolves.toMatchObject({
      preferences: {
        interventionStyle: "active",
        interventionStyleExplicit: true,
      },
    });
  });

  it("normalizes legacy version-1 raw evidence identities on read", async () => {
    const store = new InMemoryKeyValueStore();
    await store.update("adaptive-pair.memory", {
      version: 1,
      preferences: {
        interventionStyle: "balanced",
        pauseThresholdMs: 1_000,
      },
      dismissedEvidenceByRepository: {
        [repositoryA]: [evidence.id],
      },
      approvedEvidence: [
        {
          id: evidence.id,
          kind: evidence.kind,
          title: evidence.title,
          approvedAt: 1_717_171_717,
        },
      ],
    });
    const memoryStore = new PairMemoryStore({
      store,
      repositoryId: repositoryA,
    });

    await expect(memoryStore.load()).resolves.toMatchObject({
      preferences: {
        interventionStyleExplicit: false,
      },
      dismissedEvidenceByRepository: {
        [repositoryA]: [evidenceHash],
      },
      approvedEvidence: [
        {
          id: evidenceHash,
          title: evidence.title,
        },
      ],
    });
  });

  it("compacts legacy dismissal overflow on load to the most recent unique evidence and repositories", async () => {
    const repositoryIds = Array.from(
      {
        length:
          PAIR_MEMORY_RETENTION_LIMITS.dismissedRepositories + 1,
      },
      (_, index) => `/workspace/legacy-${index}`,
    );
    const retainedRepositoryId = repositoryIds.at(-1)!;
    const evidenceIds = Array.from(
      {
        length:
          PAIR_MEMORY_RETENTION_LIMITS.dismissedEvidencePerRepository + 1,
      },
      (_, index) => `legacy-evidence-${index}`,
    );
    const mostRecentDuplicate = evidenceIds[0]!;
    const oversizedEvidenceIds = [
      ...evidenceIds,
      mostRecentDuplicate,
    ];
    const dismissedEvidenceByRepository = Object.fromEntries(
      repositoryIds.map((repositoryId) => [
        repositoryId,
        repositoryId === retainedRepositoryId
          ? oversizedEvidenceIds
          : [`evidence-for-${repositoryId}`],
      ]),
    );
    const store = new InMemoryKeyValueStore();
    await store.update("adaptive-pair.memory", {
      version: 1,
      preferences: {
        interventionStyle: "balanced",
        interventionStyleExplicit: true,
        pauseThresholdMs: 1_000,
      },
      dismissedEvidenceByRepository,
      approvedEvidence: [],
    });
    const memoryStore = new PairMemoryStore({
      store,
      repositoryId: retainedRepositoryId,
    });

    const memory = await memoryStore.load();

    const expectedEvidenceIds = [
      ...evidenceIds.slice(2),
      mostRecentDuplicate,
    ].map(hashEvidenceIdentity);
    expect(memory.preferences.interventionStyleExplicit).toBe(true);
    expect(
      memory.dismissedEvidenceByRepository[retainedRepositoryId],
    ).toEqual(expectedEvidenceIds);

    const persisted = store.snapshot(
      "adaptive-pair.memory",
    ) as PersistedMemory;
    const expectedRepositoryOrder = repositoryIds.slice(1);
    expect(persisted.dismissedRepositoryOrder).toEqual(
      expectedRepositoryOrder,
    );
    expect(
      Object.keys(persisted.dismissedEvidenceByRepository ?? {}),
    ).toEqual(expectedRepositoryOrder);
    expect(
      persisted.dismissedEvidenceByRepository?.[retainedRepositoryId],
    ).toEqual(expectedEvidenceIds);
    expect(
      persisted.dismissedEvidenceByRepository?.[repositoryIds[0]!],
    ).toBeUndefined();
  });

  it("compacts approval overflow on load to the most recent unique summaries", async () => {
    expect(
      PAIR_MEMORY_RETENTION_LIMITS.approvedEvidenceSummaries,
    ).toBe(256);
    const approvalLimit =
      PAIR_MEMORY_RETENTION_LIMITS.approvedEvidenceSummaries;
    const uniqueApprovals = Array.from(
      {
        length: approvalLimit + 1,
      },
      (_, index) => ({
        id: `approved-evidence-${index}`,
        kind: "public-api-change",
        title: `Approved summary ${index}`,
        approvedAt: index,
      }),
    );
    const latestDuplicate = {
      ...uniqueApprovals[0]!,
      title: "Most recent approved summary",
      approvedAt: uniqueApprovals.length,
    };
    const store = new InMemoryKeyValueStore();
    await store.update("adaptive-pair.memory", {
      version: 1,
      preferences: {
        interventionStyle: "balanced",
        interventionStyleExplicit: false,
        pauseThresholdMs: 1_000,
      },
      dismissedEvidenceByRepository: {},
      approvedEvidence: [...uniqueApprovals, latestDuplicate],
    });
    const memoryStore = new PairMemoryStore({
      store,
      repositoryId: repositoryA,
    });

    const memory = await memoryStore.load();

    expect(memory.approvedEvidence).toHaveLength(
      approvalLimit,
    );
    expect(memory.approvedEvidence[0]?.id).toBe(
      hashEvidenceIdentity(uniqueApprovals[2]!.id),
    );
    expect(memory.approvedEvidence.at(-1)).toEqual({
      id: hashEvidenceIdentity(latestDuplicate.id),
      kind: latestDuplicate.kind,
      title: latestDuplicate.title,
      approvedAt: latestDuplicate.approvedAt,
    });
    const persisted = store.snapshot(
      "adaptive-pair.memory",
    ) as PersistedMemory;
    expect(persisted.approvedEvidence).toEqual(memory.approvedEvidence);
  });

  it("bounds approved summaries before saving a new unique approval", async () => {
    const approvalLimit =
      PAIR_MEMORY_RETENTION_LIMITS.approvedEvidenceSummaries;
    const existingApprovals = Array.from(
      { length: approvalLimit },
      (_, index) => ({
        id: `existing-approval-${index}`,
        kind: evidence.kind,
        title: `Existing approval ${index}`,
        approvedAt: index,
      }),
    );
    const store = new InMemoryKeyValueStore();
    await store.update("adaptive-pair.memory", {
      version: 1,
      preferences: {
        interventionStyle: "eco",
        interventionStyleExplicit: true,
        pauseThresholdMs: 1_000,
      },
      dismissedEvidenceByRepository: {},
      approvedEvidence: existingApprovals,
    });
    const memoryStore = new PairMemoryStore({
      store,
      repositoryId: repositoryA,
    });
    const newestEvidence = {
      ...evidence,
      id: "newest-approved-evidence",
      title: "Newest approved summary",
    };

    await memoryStore.approveEvidence(newestEvidence, approvalLimit);

    const persisted = store.snapshot(
      "adaptive-pair.memory",
    ) as PersistedMemory;
    expect(persisted.approvedEvidence).toHaveLength(approvalLimit);
    expect(persisted.approvedEvidence?.[0]?.id).toBe(
      hashEvidenceIdentity(existingApprovals[1]!.id),
    );
    expect(persisted.approvedEvidence?.at(-1)).toEqual({
      id: hashEvidenceIdentity(newestEvidence.id),
      kind: newestEvidence.kind,
      title: newestEvidence.title,
      approvedAt: approvalLimit,
    });
  });

  it("refreshes dismissal recency while bounding evidence and repositories before save", async () => {
    const repositoryIds = Array.from(
      {
        length: PAIR_MEMORY_RETENTION_LIMITS.dismissedRepositories,
      },
      (_, index) => `/workspace/current-${index}`,
    );
    const refreshedRepositoryId = repositoryIds[0]!;
    const existingEvidenceIds = Array.from(
      {
        length:
          PAIR_MEMORY_RETENTION_LIMITS.dismissedEvidencePerRepository,
      },
      (_, index) => `current-evidence-${index}`,
    );
    const store = new InMemoryKeyValueStore();
    await store.update("adaptive-pair.memory", {
      version: 1,
      preferences: {
        interventionStyle: "active",
        interventionStyleExplicit: true,
        pauseThresholdMs: 2_000,
      },
      dismissedEvidenceByRepository: Object.fromEntries(
        repositoryIds.map((repositoryId) => [
          repositoryId,
          repositoryId === refreshedRepositoryId
            ? existingEvidenceIds
            : [`evidence-for-${repositoryId}`],
        ]),
      ),
      dismissedRepositoryOrder: repositoryIds,
      approvedEvidence: [],
    });
    const memoryStore = new PairMemoryStore({
      store,
      repositoryId: refreshedRepositoryId,
    });

    await memoryStore.dismissEvidence(existingEvidenceIds[0]!);
    await memoryStore
      .forRepository("/workspace/newest")
      .dismissEvidence("newest-evidence");

    const persisted = store.snapshot(
      "adaptive-pair.memory",
    ) as PersistedMemory;
    expect(persisted.dismissedRepositoryOrder).toEqual([
      ...repositoryIds.slice(2),
      refreshedRepositoryId,
      "/workspace/newest",
    ]);
    expect(
      persisted.dismissedEvidenceByRepository?.[refreshedRepositoryId],
    ).toEqual(
      [...existingEvidenceIds.slice(1), existingEvidenceIds[0]!].map(
        hashEvidenceIdentity,
      ),
    );
    expect(
      persisted.dismissedEvidenceByRepository?.[repositoryIds[1]!],
    ).toBeUndefined();
    expect(persisted.dismissedEvidenceByRepository?.["/workspace/newest"])
      .toEqual([hashEvidenceIdentity("newest-evidence")]);
  });

  it("persists preferences and repository-scoped dismissals", async () => {
    const store = new InMemoryKeyValueStore();
    const memoryStoreA = new PairMemoryStore({
      store,
      repositoryId: repositoryA,
    });
    const memoryStoreB = new PairMemoryStore({
      store,
      repositoryId: repositoryB,
    });

    await memoryStoreA.updatePreferences({
      interventionStyle: "active",
      pauseThresholdMs: 2_500,
    });
    await memoryStoreA.dismissEvidence(evidence.id);

    await expect(memoryStoreA.load()).resolves.toMatchObject({
      preferences: {
        interventionStyle: "active",
        pauseThresholdMs: 2_500,
      },
      dismissedEvidenceByRepository: {
        [repositoryA]: [evidenceHash],
      },
    });
    await expect(memoryStoreB.load()).resolves.toMatchObject({
      preferences: {
        interventionStyle: "active",
        pauseThresholdMs: 2_500,
      },
      dismissedEvidenceByRepository: {},
    });
  });

  it("serializes concurrent mutations so preference changes, approvals, and dismissals are all preserved", async () => {
    const store = new ControlledUpdateKeyValueStore();
    const memoryStore = new PairMemoryStore({
      store,
      repositoryId: repositoryA,
    });

    const updatePreferences = memoryStore.updatePreferences({
      interventionStyle: "active",
    });
    const dismissEvidence = memoryStore.dismissEvidence(evidence.id);
    const approveEvidence = memoryStore.approveEvidence(evidence, 1_717_171_717);

    await vi.waitFor(() => {
      expect(store.updateCallCount).toBeGreaterThanOrEqual(1);
    });
    store.releaseUpdate(0);

    await vi.waitFor(() => {
      expect(store.updateCallCount).toBeGreaterThanOrEqual(2);
    });
    store.releaseUpdate(1);

    await vi.waitFor(() => {
      expect(store.updateCallCount).toBeGreaterThanOrEqual(3);
    });
    store.releaseUpdate(2);

    await Promise.all([updatePreferences, dismissEvidence, approveEvidence]);

    await expect(memoryStore.load()).resolves.toMatchObject({
      preferences: {
        interventionStyle: "active",
      },
      dismissedEvidenceByRepository: {
        [repositoryA]: [evidenceHash],
      },
      approvedEvidence: [
        {
          id: evidenceHash,
          kind: evidence.kind,
          title: evidence.title,
          approvedAt: 1_717_171_717,
        },
      ],
    });
  });

  it("serializes concurrent mutations across store instances that share the same adapter", async () => {
    const store = new ControlledUpdateKeyValueStore();
    const memoryStoreA = new PairMemoryStore({
      store,
      repositoryId: repositoryA,
    });
    const memoryStoreB = new PairMemoryStore({
      store,
      repositoryId: repositoryB,
    });

    const updatePreferences = memoryStoreA.updatePreferences({
      interventionStyle: "active",
    });
    const dismissEvidence = memoryStoreB.dismissEvidence(evidence.id);

    await vi.waitFor(() => {
      expect(store.updateCallCount).toBeGreaterThanOrEqual(1);
    });
    store.releaseUpdate(0);

    await vi.waitFor(() => {
      expect(store.updateCallCount).toBeGreaterThanOrEqual(2);
    });
    store.releaseUpdate(1);

    await Promise.all([updatePreferences, dismissEvidence]);

    await expect(memoryStoreA.load()).resolves.toMatchObject({
      preferences: {
        interventionStyle: "active",
      },
    });
    await expect(memoryStoreB.load()).resolves.toMatchObject({
      preferences: {
        interventionStyle: "active",
      },
      dismissedEvidenceByRepository: {
        [repositoryB]: [evidenceHash],
      },
    });
  });

  it("allows later valid mutations after an earlier write failure", async () => {
    const store = new FailingUpdateKeyValueStore(1);
    const memoryStore = new PairMemoryStore({
      store,
      repositoryId: repositoryA,
    });

    await expect(
      memoryStore.updatePreferences({ interventionStyle: "active" }),
    ).rejects.toThrow("simulated write failure");

    await expect(memoryStore.dismissEvidence(evidence.id)).resolves.toBeUndefined();
    await expect(memoryStore.load()).resolves.toMatchObject({
      preferences: {
        interventionStyle: "balanced",
      },
      dismissedEvidenceByRepository: {
        [repositoryA]: [evidenceHash],
      },
    });
  });

  it("rejects malformed persisted memory without overwriting the stored value", async () => {
    const corruptedMemory = {
      version: 1,
      preferences: {
        interventionStyle: "loud",
        pauseThresholdMs: 1_000,
      },
      dismissedEvidenceByRepository: {},
      approvedEvidence: [],
    };
    const store = new InMemoryKeyValueStore();
    await store.update("adaptive-pair.memory", corruptedMemory);
    const memoryStore = new PairMemoryStore({
      store,
      repositoryId: repositoryA,
    });

    const loadError = await memoryStore.load().catch((error: unknown) => error);
    expect(loadError).toBeInstanceOf(Error);
    expect((loadError as Error).name).toBe("InvalidPairMemoryError");
    expect((loadError as Error).message).toContain("preferences.interventionStyle");

    await expect(
      memoryStore.updatePreferences({ pauseThresholdMs: 2_000 }),
    ).rejects.toMatchObject({
      name: "InvalidPairMemoryError",
      message: expect.stringContaining("preferences.interventionStyle"),
    });
    expect(store.values.get("adaptive-pair.memory")).toEqual(corruptedMemory);
  });

  it("recovers corrupt memory in memory without overwriting it", async () => {
    const corruptedMemory = {
      version: 99,
      credential: "preserve-this-opaque-corrupt-record",
    };
    const store = new InMemoryKeyValueStore();
    await store.update("adaptive-pair.memory", corruptedMemory);
    const memoryStore = new PairMemoryStore({
      store,
      repositoryId: repositoryA,
    });

    const recovered = await memoryStore.loadOrDefault();

    expect(recovered.warning).toContain("corrupt");
    expect(recovered.memory).toEqual({
      version: 1,
      preferences: {
        interventionStyle: "balanced",
        interventionStyleExplicit: false,
        pauseThresholdMs: 1_000,
      },
      dismissedEvidenceByRepository: {},
      approvedEvidence: [],
    });
    expect(store.values.get("adaptive-pair.memory")).toEqual(corruptedMemory);
  });

  it("resets corrupt memory only through an explicit reset", async () => {
    const corruptedMemory = { version: "broken" };
    const store = new InMemoryKeyValueStore();
    await store.update("adaptive-pair.memory", corruptedMemory);
    const memoryStore = new PairMemoryStore({
      store,
      repositoryId: repositoryA,
    });

    await memoryStore.reset();

    await expect(memoryStore.load()).resolves.toMatchObject({
      version: 1,
      preferences: {
        interventionStyle: "balanced",
      },
    });
    expect(store.values.get("adaptive-pair.memory")).not.toEqual(
      corruptedMemory,
    );
  });

  it("stores approved evidence without raw source text or complete code", async () => {
    const store = new InMemoryKeyValueStore();
    const memoryStore = new PairMemoryStore({
      store,
      repositoryId: repositoryA,
    });
    const approvedAt = 1_717_171_717;

    await memoryStore.approveEvidence(evidence, approvedAt);

    const memory = await memoryStore.load();
    expect(memory.approvedEvidence).toEqual([
      {
        id: evidenceHash,
        kind: evidence.kind,
        title: evidence.title,
        approvedAt,
      },
    ]);

    const persisted = store.snapshot("adaptive-pair.memory") as PersistedMemory | undefined;
    expect(persisted?.approvedEvidence).toEqual([
      {
        id: evidenceHash,
        kind: evidence.kind,
        title: evidence.title,
        approvedAt,
      },
    ]);
    const approvedEntry = persisted?.approvedEvidence?.[0];
    expect(approvedEntry).toBeDefined();
    expect(approvedEntry).not.toHaveProperty("detail");
    expect(approvedEntry).not.toHaveProperty("source");
    expect(approvedEntry).not.toHaveProperty("references");
    expect(approvedEntry).not.toHaveProperty("range");
  });

  it("hashes evidence identities and sanitizes bounded titles before persistence", async () => {
    const store = new InMemoryKeyValueStore();
    const memoryStore = new PairMemoryStore({
      store,
      repositoryId: repositoryA,
    });
    const privateUri =
      "file:///Users/example/private-workspace/src/credential.ts";
    const privateRelativePath = "src/private/credential.ts";
    const secret = "sk-privateCredential123456789";
    const sensitiveEvidence: Evidence = {
      ...evidence,
      id: `diagnostic:${privateUri}:4:2:0`,
      title: `Review ${privateRelativePath} and ${privateUri} authorization: Bearer ${secret} ${"x".repeat(200)}`,
      source: privateUri,
      detail: `The source contained ${secret}.`,
      references: [privateUri],
    };

    await memoryStore.dismissEvidence(sensitiveEvidence.id);
    await memoryStore.approveEvidence(sensitiveEvidence, 1_717_171_717);

    const persisted = store.snapshot("adaptive-pair.memory");
    const serialized = JSON.stringify(persisted);
    expect(serialized).not.toContain(privateUri);
    expect(serialized).not.toContain(secret);
    expect(persisted).toMatchObject({
      dismissedEvidenceByRepository: {
        [repositoryA]: [expect.stringMatching(/^sha256:[a-f0-9]{64}$/u)],
      },
      approvedEvidence: [
        {
          id: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
          title: expect.any(String),
        },
      ],
    });
    const approvedTitle = (
      persisted as {
        approvedEvidence: Array<{ title: string }>;
      }
    ).approvedEvidence[0]!.title;
    expect(approvedTitle).not.toContain("src");
    expect(approvedTitle.length).toBeLessThanOrEqual(120);
  });
});
