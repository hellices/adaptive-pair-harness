import { describe, expect, it } from "vitest";
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
