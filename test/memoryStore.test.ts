import { describe, expect, it, vi } from "vitest";
import type { Evidence } from "../src/core/types";
import { PairMemoryStore } from "../src/core/memoryStore";

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

interface StoredValue {
  readonly [key: string]: unknown;
}

interface PersistedMemory {
  readonly approvedEvidence?: readonly Readonly<Record<string, unknown>>[];
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
        pauseThresholdMs: 1_000,
      },
      dismissedEvidenceByRepository: {},
      approvedEvidence: [],
    });
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
        [repositoryA]: [evidence.id],
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
        [repositoryB]: [evidence.id],
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
        [repositoryA]: [evidence.id],
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
        id: evidence.id,
        kind: evidence.kind,
        title: evidence.title,
        approvedAt,
      },
    ]);

    const persisted = store.snapshot("adaptive-pair.memory") as PersistedMemory | undefined;
    expect(persisted?.approvedEvidence).toEqual([
      {
        id: evidence.id,
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
});
