import { durableJournalLimits, parseDurableJournal, type DurableCommit, type DurableFact } from "@adaptive-pair/protocol";
import { describe, expect, it } from "vitest";
import type { DurableStore } from "../src/durableStore.js";
import {
  durableBaseFacts, durableCommit, durableKey, durableWire, emptyDurableText, generationKey, namespaceKey, sessionKey,
} from "./durableFixtures.js";

/** Named publication/erasure boundaries from docs/design.md; each fires at most once per opened store. */
export type DurableStoreFault =
  | "before-head-publication" | "after-publication" | "during-cleanup" | "after-erased-publication";

export interface DurableStoreOpenOptions {
  /** Bind the opened store to a different namespace over the same storage area. */
  readonly namespaceKey?: string;
  readonly fault?: DurableStoreFault;
  /** Awaited once the operation holds its request and before it compares and publishes under writer exclusion. */
  readonly pause?: (operation: "create" | "append" | "erase") => Promise<void>;
}

/** Adapter-specific storage damage described by its meaning, so the suite never reads adapter internals. */
export type DurableStoreDamage =
  | { readonly kind: "missing control" } | { readonly kind: "corrupt control" }
  | { readonly kind: "control field" | "head text" | "orphaned copy"; readonly text: string };

export interface DurableStoreHarness {
  /** Opens another store over the same storage area, like a new process or a cold restart. */
  open(options?: DurableStoreOpenOptions): DurableStore;
  damage(damage: DurableStoreDamage): void;
  /** Opaque serialization of every retained byte in the storage area. */
  persisted(): string;
}

const presenceCommit = (expectedSequence = 0): DurableCommit =>
  durableCommit([{ type: "PresenceRecorded", status: "engaged" }], expectedSequence);
const freshGeneration = durableKey(90);
const freshText = (key = freshGeneration): string => JSON.stringify({ ...durableWire(), generationKey: key });
const canary = "PRIVATE_CANARY_RETAINED";

const journalOf = async (store: DurableStore) => {
  const result = await store.load();
  if (result.status !== "present") throw new Error(`Expected a present head, got ${result.status}`);
  return parseDurableJournal(result.text);
};

const barrier = (operation: "create" | "append" | "erase") => {
  let signal!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { signal = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  const pause = (current: string): Promise<void> => {
    if (current !== operation) return Promise.resolve();
    signal();
    return released;
  };
  return { entered, release, pause };
};

type Suite = (namespaceKey: string) => DurableStoreHarness;

const expectUnchanged = async (harness: DurableStoreHarness, action: () => Promise<unknown>) => {
  const before = harness.persisted();
  await action();
  expect(harness.persisted()).toBe(before);
};

const ready = async (createHarness: Suite) => {
  const harness = createHarness(namespaceKey);
  const store = harness.open();
  expect((await store.create(emptyDurableText(), null)).status).toBe("committed");
  return { harness, store };
};

const publication = (createHarness: Suite) => describe("publication", () => {
  it("starts empty and creates only an empty, namespace-bound generation with frozen results", async () => {
    const store = createHarness(namespaceKey).open();
    expect(await store.load()).toEqual({ status: "empty" });
    const created = await store.create(emptyDurableText(), null);
    expect(created).toEqual({ status: "committed", receipt: { namespaceKey, generationKey, commitKey: null, headSequence: 0 } });
    expect(Object.isFrozen(created)).toBe(true);
    const loaded = await store.load();
    expect(loaded).toEqual({ status: "present", text: emptyDurableText() });
    expect(Object.isFrozen(loaded)).toBe(true);
  });

  it("does not auto-create on append or erase of an absent generation", async () => {
    const store = createHarness(namespaceKey).open();
    expect(await store.append(generationKey, presenceCommit())).toEqual({ status: "not-committed", code: "GENERATION_CONFLICT" });
    expect(await store.erase(generationKey)).toEqual({ status: "not-erased", code: "GENERATION_CONFLICT" });
    expect(await store.load()).toEqual({ status: "empty" });
  });

  it("refuses create over a present generation, even for identical text", async () => {
    const { harness, store } = await ready(createHarness);
    await expectUnchanged(harness, async () => {
      for (const expected of [null, generationKey]) {
        expect(await store.create(emptyDurableText(), expected)).toEqual({ status: "not-committed", code: "HEAD_CONFLICT" });
      }
    });
  });

  it("publishes every fact and command of a batch as one complete head visible to a new opener", async () => {
    const { harness, store } = await ready(createHarness);
    const commit = { ...durableCommit(durableBaseFacts), commandKeys: [durableKey(40), durableKey(41)] };
    const result = await store.append(generationKey, commit);
    expect(result).toEqual({
      status: "committed", receipt: { namespaceKey, generationKey, commitKey: commit.commitKey, headSequence: 10 },
    });
    if (result.status === "committed") expect(Object.isFrozen(result.receipt)).toBe(true);
    expect(await journalOf(harness.open())).toEqual(durableWire([commit]));
  });

  it("rejects a stale head, command reuse and an unknown generation without changing storage", async () => {
    const { harness, store } = await ready(createHarness);
    const original = presenceCommit();
    await store.append(generationKey, original);
    await expectUnchanged(harness, async () => {
      expect(await store.append(generationKey, { ...presenceCommit(1), commandKeys: original.commandKeys }))
        .toEqual({ status: "not-committed", code: "IDENTITY_CONFLICT" });
      expect(await store.append(generationKey, { ...presenceCommit(), commitKey: durableKey(89), commandKeys: [durableKey(88)] }))
        .toEqual({ status: "not-committed", code: "HEAD_CONFLICT" });
      expect(await store.append(durableKey(91), original)).toEqual({ status: "not-committed", code: "GENERATION_CONFLICT" });
    });
  });

  it("returns the original receipt for an identical canonical retry after a later append and reopen", async () => {
    const { harness, store } = await ready(createHarness);
    const original = presenceCommit();
    const receipt = await store.append(generationKey, original);
    expect(receipt).toMatchObject({ status: "committed", receipt: { headSequence: 1 } });
    expect((await store.append(generationKey, presenceCommit(1))).status).toBe("committed");
    const canonicalRetry: DurableCommit = {
      facts: [{ status: "engaged", type: "PresenceRecorded" }],
      commandKeys: [...original.commandKeys], expectedSequence: 0, commitKey: original.commitKey,
    };
    await expectUnchanged(harness, async () => {
      expect(await harness.open().append(generationKey, canonicalRetry)).toEqual(receipt);
    });
  });

  it.each([
    ["expected head", { ...presenceCommit(), expectedSequence: 1 }],
    ["command identity", { ...presenceCommit(), commandKeys: [durableKey(444)] }],
    ["fact payload", { ...presenceCommit(), facts: [{ type: "PresenceRecorded", status: "quiet" }] }],
    ["command order", { ...presenceCommit(), commandKeys: [durableKey(2_001), durableKey(2_000)] }],
  ] as const)("treats a same-key retry with a changed %s as an identity conflict", async (_label, retry) => {
    const { harness, store } = await ready(createHarness);
    await store.append(generationKey, { ...presenceCommit(), commandKeys: [durableKey(2_000), durableKey(2_001)] });
    await expectUnchanged(harness, async () => {
      expect(await store.append(generationKey, retry)).toEqual({ status: "not-committed", code: "IDENTITY_CONFLICT" });
    });
  });
});

const validationAndBounds = (createHarness: Suite) => describe("validation and bounds", () => {
  it.each([
    ["invalid JSON", "broken", null, "INVALID_REQUEST"],
    ["foreign namespace", JSON.stringify({ ...durableWire(), namespaceKey: durableKey(99) }), null, "BINDING_MISMATCH"],
    ["nonempty generation", JSON.stringify(durableWire([presenceCommit()])), null, "INVALID_REQUEST"],
    ["unknown envelope field", JSON.stringify({ ...durableWire(), summary: canary }), null, "INVALID_REQUEST"],
    ["prior generation for a never-owned namespace", emptyDurableText(), generationKey, "GENERATION_CONFLICT"],
  ] as const)("rejects create with %s without storing anything", async (_label, text, expected, code) => {
    const harness = createHarness(namespaceKey);
    const store = harness.open();
    await expectUnchanged(harness, async () => {
      expect(await store.create(text, expected)).toEqual({ status: "not-committed", code });
    });
    expect(await store.load()).toEqual({ status: "empty" });
  });

  const fact = { type: "PresenceRecorded", status: "engaged" };
  it.each([
    ["unknown fact", { ...presenceCommit(), facts: [{ type: "ExecuteTool", input: canary }] }],
    ["omitted live field", { ...presenceCommit(), facts: [{ ...fact, diagnosticText: canary }] }],
    ["extra commit field", { ...presenceCommit(), input: canary }],
    ["empty batch", { ...presenceCommit(), facts: [] }],
    ["batch that fails full replay", { ...presenceCommit(), facts: [fact, { type: "ModeRecorded", sessionKey, mode: "growth" }] }],
    ["duplicate command key", { ...presenceCommit(), commandKeys: [durableKey(2_000), durableKey(2_000)] }],
    ["fractional sequence", { ...presenceCommit(), expectedSequence: 0.5 }],
  ] as const)("rejects an append with %s, publishing none of it and retaining no input", async (_label, request) => {
    const { harness, store } = await ready(createHarness);
    await expectUnchanged(harness, async () => {
      expect(await store.append(generationKey, request as unknown as DurableCommit))
        .toEqual({ status: "not-committed", code: "INVALID_REQUEST" });
    });
    expect(harness.persisted()).not.toContain(canary);
  });

  it("bounds create text at 1 MiB and stores only the canonical envelope", async () => {
    const store = createHarness(namespaceKey).open();
    expect(await store.create(" ".repeat(durableJournalLimits.textCodeUnits) + emptyDurableText(), null))
      .toEqual({ status: "not-committed", code: "LIMIT_EXCEEDED" });
    expect((await store.create(emptyDurableText().padEnd(durableJournalLimits.textCodeUnits, " "), null)).status)
      .toBe("committed");
    expect(await store.load()).toEqual({ status: "present", text: emptyDurableText() });
  });

  it("enforces request and cumulative budgets while erasure stays available", async () => {
    const { harness, store } = await ready(createHarness);
    const keys = (count: number) => Array.from({ length: count }, (_, index) => durableKey(10_000 + index));
    expect(await store.append(generationKey, { ...presenceCommit(), commandKeys: keys(durableJournalLimits.commandKeys + 1) }))
      .toEqual({ status: "not-committed", code: "LIMIT_EXCEEDED" });
    const facts: DurableFact[] = Array.from({ length: durableJournalLimits.facts }, () => ({ type: "PresenceRecorded", status: "engaged" }));
    expect((await store.append(generationKey, { ...presenceCommit(), facts })).status).toBe("committed");
    await expectUnchanged(harness, async () => {
      expect(await store.append(generationKey, presenceCommit(durableJournalLimits.facts)))
        .toEqual({ status: "not-committed", code: "LIMIT_EXCEEDED" });
    });
    expect(await store.erase(generationKey)).toEqual({ status: "erased" });
  });
});

const failureOutcomes = (createHarness: Suite) => describe("failure outcomes", () => {
  it.each(["before-head-publication", "after-publication"] as const)(
    "exposes a create indeterminate at %s only as the complete head", async fault => {
      const harness = createHarness(namespaceKey);
      expect(await harness.open({ fault }).create(emptyDurableText(), null)).toEqual({ status: "indeterminate" });
      const loaded = await harness.open().load();
      if (fault === "after-publication") expect(loaded).toEqual({ status: "present", text: emptyDurableText() });
      else expect(["empty", "blocked"]).toContain(loaded.status);
    },
  );

  it.each(["before-head-publication", "after-publication"] as const)(
    "resolves an indeterminate append at %s by inspection and identical retry without duplication", async fault => {
      const { harness } = await ready(createHarness);
      const commit = presenceCommit();
      expect(await harness.open({ fault }).append(generationKey, commit)).toEqual({ status: "indeterminate" });
      const reopened = harness.open();
      expect((await journalOf(reopened)).headSequence).toBe(fault === "before-head-publication" ? 0 : 1);
      const receipt = await reopened.append(generationKey, commit);
      expect(receipt).toMatchObject({ status: "committed", receipt: { headSequence: 1 } });
      expect(await reopened.append(generationKey, commit)).toEqual(receipt);
      expect((await journalOf(reopened)).commits).toEqual([commit]);
    },
  );
});

const concurrency = (createHarness: Suite) => describe("concurrency", () => {
  it.each(["first", "second"] as const)("lets only the %s released writer publish at a shared head", async winner => {
    const { harness, store } = await ready(createHarness);
    const entries = [presenceCommit(), { ...presenceCommit(), commitKey: durableKey(70), commandKeys: [durableKey(71)] }]
      .map(commit => {
        const gate = barrier("append");
        return { commit, gate, write: harness.open({ pause: gate.pause }).append(generationKey, commit) };
      });
    await Promise.all(entries.map(entry => entry.gate.entered));
    expect((await journalOf(store)).headSequence).toBe(0);
    const [win, lose] = winner === "first" ? entries : [...entries].reverse();
    if (win === undefined || lose === undefined) throw new Error("Expected two writers");
    win.gate.release();
    expect((await win.write).status).toBe("committed");
    lose.gate.release();
    expect(await lose.write).toEqual({ status: "not-committed", code: "HEAD_CONFLICT" });
    expect((await journalOf(store)).commits).toEqual([win.commit]);
  });

  it("serializes competing creates instead of replacing the winner", async () => {
    const harness = createHarness(namespaceKey);
    const [first, second] = [barrier("create"), barrier("create")];
    const firstWrite = harness.open({ pause: first.pause }).create(emptyDurableText(), null);
    const secondWrite = harness.open({ pause: second.pause }).create(freshText(), null);
    await Promise.all([first.entered, second.entered]);
    first.release();
    expect((await firstWrite).status).toBe("committed");
    second.release();
    expect(await secondWrite).toEqual({ status: "not-committed", code: "HEAD_CONFLICT" });
    expect((await journalOf(harness.open())).generationKey).toBe(generationKey);
  });

  it.each(["pending", "erased", "recreated", "recreated (exact retry)"] as const)(
    "rejects a late append once the generation is %s", async state => {
      const { harness, store } = await ready(createHarness);
      if (state === "recreated (exact retry)") await store.append(generationKey, presenceCommit());
      const gate = barrier("append");
      const late = harness.open({ pause: gate.pause }).append(generationKey, presenceCommit());
      await gate.entered;
      const eraser = harness.open(state === "pending" ? { fault: "during-cleanup" } : {});
      expect((await eraser.erase(generationKey)).status).toBe(state === "pending" ? "cleanup-pending" : "erased");
      if (state.startsWith("recreated")) expect((await eraser.create(freshText(), generationKey)).status).toBe("committed");
      await expectUnchanged(harness, async () => {
        gate.release();
        expect(await late).toEqual({ status: "not-committed", code: state === "pending" ? "ERASURE_PENDING" : "GENERATION_CONFLICT" });
      });
      if (state.startsWith("recreated")) expect((await journalOf(eraser)).headSequence).toBe(0);
      else expect(await eraser.load()).toEqual(state === "pending" ? { status: "blocked" } : { status: "erased", generationKey });
    },
  );

  it("returns one original receipt for two scheduled identical writes after a lost acknowledgement", async () => {
    const { harness, store } = await ready(createHarness);
    const [first, second] = [barrier("append"), barrier("append")];
    const commit = presenceCommit();
    const firstWrite = harness.open({ pause: first.pause, fault: "after-publication" }).append(generationKey, commit);
    const secondWrite = harness.open({ pause: second.pause }).append(generationKey, commit);
    await Promise.all([first.entered, second.entered]);
    first.release();
    expect(await firstWrite).toEqual({ status: "indeterminate" });
    expect((await store.append(generationKey, presenceCommit(1))).status).toBe("committed");
    second.release();
    expect(await secondWrite).toEqual({
      status: "committed", receipt: { namespaceKey, generationKey, commitKey: commit.commitKey, headSequence: 1 },
    });
    expect((await journalOf(store)).commits).toHaveLength(2);
  });

  it("snapshots the request before awaiting publication", async () => {
    const { harness, store } = await ready(createHarness);
    const gate = barrier("append");
    const commit = structuredClone(presenceCommit());
    const pending = harness.open({ pause: gate.pause }).append(generationKey, commit);
    await gate.entered;
    Reflect.set(commit, "commandKeys", [durableKey(555)]);
    Reflect.set(commit, "facts", [{ type: "PresenceRecorded", status: "quiet" }]);
    gate.release();
    expect((await pending).status).toBe("committed");
    expect((await journalOf(store)).commits).toEqual([presenceCommit()]);
  });

  it("serializes an append ahead of an erasure paused before fence publication", async () => {
    const { harness, store } = await ready(createHarness);
    const gate = barrier("erase");
    const erasing = harness.open({ pause: gate.pause }).erase(generationKey);
    await gate.entered;
    expect((await store.append(generationKey, presenceCommit())).status).toBe("committed");
    gate.release();
    expect(await erasing).toEqual({ status: "erased" });
    expect(await store.load()).toEqual({ status: "erased", generationKey });
  });

  it("does not let a late eraser remove a newly created generation", async () => {
    const { harness, store } = await ready(createHarness);
    const gate = barrier("erase");
    const late = harness.open({ pause: gate.pause }).erase(generationKey);
    await gate.entered;
    await store.erase(generationKey);
    await store.create(freshText(), generationKey);
    await expectUnchanged(harness, async () => {
      gate.release();
      expect(await late).toEqual({ status: "not-erased", code: "GENERATION_CONFLICT" });
    });
    expect((await journalOf(store)).generationKey).toBe(freshGeneration);
  });
});

const erasure = (createHarness: Suite) => describe("erasure", () => {
  it.each(["after-publication", "during-cleanup"] as const)(
    "keeps every operation blocked from a persisted erasing fence at %s until erasure completes", async fault => {
      const { harness, store } = await ready(createHarness);
      const commit = durableCommit(durableBaseFacts);
      await store.append(generationKey, commit);
      expect(await harness.open({ fault }).erase(generationKey))
        .toEqual({ status: fault === "after-publication" ? "indeterminate" : "cleanup-pending" });
      const reopened = harness.open();
      await expectUnchanged(harness, async () => {
        expect(await reopened.load()).toEqual({ status: "blocked" });
        for (const key of [generationKey, durableKey(999)]) {
          expect(await reopened.append(key, commit)).toEqual({ status: "not-committed", code: "ERASURE_PENDING" });
        }
        for (const expected of [null, generationKey]) {
          expect(await reopened.create(freshText(), expected)).toEqual({ status: "not-committed", code: "ERASURE_PENDING" });
        }
      });
      expect(await reopened.erase(generationKey)).toEqual({ status: "erased" });
      expect(await reopened.load()).toEqual({ status: "erased", generationKey });
      expect(harness.persisted()).not.toContain(commit.commitKey);
      expect((await reopened.create(freshText(), generationKey)).status).toBe("committed");
    },
  );

  it("resolves a lost final acknowledgement through the completed fence", async () => {
    const { harness } = await ready(createHarness);
    expect(await harness.open({ fault: "after-erased-publication" }).erase(generationKey)).toEqual({ status: "indeterminate" });
    const reopened = harness.open();
    expect(await reopened.load()).toEqual({ status: "erased", generationKey });
    expect(await reopened.erase(generationKey)).toEqual({ status: "erased" });
  });

  it("retains no erased session data and gives a fresh generation no old identities", async () => {
    const { harness, store } = await ready(createHarness);
    const commit = durableCommit(durableBaseFacts);
    await store.append(generationKey, commit);
    expect(await store.erase(generationKey)).toEqual({ status: "erased" });
    for (const retained of [commit.commitKey, ...commit.commandKeys, sessionKey]) {
      expect(harness.persisted()).not.toContain(retained);
    }
    await expectUnchanged(harness, async () => {
      expect(await store.append(generationKey, commit)).toEqual({ status: "not-committed", code: "GENERATION_CONFLICT" });
      for (const expected of [null, durableKey(99)]) {
        expect(await store.create(freshText(), expected)).toEqual({ status: "not-committed", code: "GENERATION_CONFLICT" });
      }
      expect(await store.create(emptyDurableText(), generationKey)).toEqual({ status: "not-committed", code: "GENERATION_CONFLICT" });
    });
    expect((await store.create(freshText(), generationKey)).status).toBe("committed");
    expect((await journalOf(store)).commits).toEqual([]);
    expect(await store.append(freshGeneration, commit)).toMatchObject({
      status: "committed", receipt: { generationKey: freshGeneration, headSequence: durableBaseFacts.length },
    });
    expect(await store.erase(generationKey)).toEqual({ status: "not-erased", code: "GENERATION_CONFLICT" });
    await store.erase(freshGeneration);
    expect(await store.create(freshText(durableKey(91)), null)).toEqual({ status: "not-committed", code: "GENERATION_CONFLICT" });
    expect(await store.create(freshText(), freshGeneration)).toEqual({ status: "not-committed", code: "GENERATION_CONFLICT" });
  });

  it("does not trust an erased fence while an owned copy survives", async () => {
    const { harness, store } = await ready(createHarness);
    await store.erase(generationKey);
    harness.damage({ kind: "orphaned copy", text: emptyDurableText() });
    const reopened = harness.open();
    expect(await reopened.load()).toEqual({ status: "blocked" });
    expect(await reopened.create(freshText(), generationKey)).toEqual({ status: "not-committed", code: "ERASURE_PENDING" });
    expect(await reopened.append(generationKey, presenceCommit())).toEqual({ status: "not-committed", code: "ERASURE_PENDING" });
    expect(await reopened.erase(generationKey)).toEqual({ status: "erased" });
    expect(await reopened.load()).toEqual({ status: "erased", generationKey });
  });

  it("refuses to report erased while private data survives in malformed control metadata", async () => {
    const { harness } = await ready(createHarness);
    harness.damage({ kind: "control field", text: canary });
    const reopened = harness.open();
    await expectUnchanged(harness, async () => {
      expect(await reopened.load()).toEqual({ status: "blocked" });
      expect((await reopened.erase(generationKey)).status).toBe("not-erased");
    });
  });

  it("still erases an owned corrupt head behind the fence", async () => {
    const { harness } = await ready(createHarness);
    harness.damage({ kind: "head text", text: canary });
    const reopened = harness.open();
    expect(await reopened.load()).toEqual({ status: "blocked" });
    expect(await reopened.erase(generationKey)).toEqual({ status: "erased" });
    expect(harness.persisted()).not.toContain(canary);
  });

  it("publishes no fence and reports not erased when interrupted before fence publication", async () => {
    const { harness, store } = await ready(createHarness);
    await store.append(generationKey, presenceCommit());
    const head = await store.load();
    const interrupted = harness.open({
      pause: operation => operation === "erase" ? Promise.reject(new Error("pre-fence interruption")) : Promise.resolve(),
    });
    await expectUnchanged(harness, async () => {
      expect((await interrupted.erase(generationKey)).status).toBe("not-erased");
    });
    expect(await harness.open().load()).toEqual(head);
  });
});

const corruptionAndBinding = (createHarness: Suite) => describe("corruption and binding", () => {
  it.each([
    ["missing control", { kind: "missing control" }],
    ["corrupt control", { kind: "corrupt control" }],
    ["corrupt head", { kind: "head text", text: "not JSON" }],
    ["unreplayable head", {
      kind: "head text",
      text: JSON.stringify({ ...durableWire(), commits: [{ ...presenceCommit(), expectedSequence: 2 }], headSequence: 1 }),
    }],
    ["foreign head", { kind: "head text", text: JSON.stringify({ ...durableWire([presenceCommit()]), namespaceKey: durableKey(555) }) }],
    ["retired-generation head", {
      kind: "head text", text: JSON.stringify({ ...durableWire([presenceCommit()]), generationKey: durableKey(556) }),
    }],
    ["rolled-back head", { kind: "head text", text: emptyDurableText() }],
  ] as const)("blocks with %s without falling back or overwriting it", async (_label, damage) => {
    const { harness, store } = await ready(createHarness);
    await store.append(generationKey, presenceCommit());
    harness.damage(damage);
    const reopened = harness.open();
    await expectUnchanged(harness, async () => {
      expect(await reopened.load()).toEqual({ status: "blocked" });
      expect((await reopened.append(generationKey, presenceCommit(1))).status).toBe("not-committed");
      expect((await reopened.create(freshText(), null)).status).toBe("not-committed");
    });
  });

  it("refuses a store bound to another namespace over the same storage", async () => {
    const { harness } = await ready(createHarness);
    const misbound = harness.open({ namespaceKey: durableKey(80) });
    await expectUnchanged(harness, async () => {
      expect(await misbound.load()).toEqual({ status: "blocked" });
      expect(await misbound.append(generationKey, presenceCommit())).toEqual({ status: "not-committed", code: "BINDING_MISMATCH" });
      expect(await misbound.erase(generationKey)).toEqual({ status: "not-erased", code: "BINDING_MISMATCH" });
    });
  });
});

/** Runs the port-level DurableStore contract from docs/design.md against any adapter harness. */
export const describeDurableStoreConformance = (name: string, createHarness: Suite): void => {
  describe(`DurableStore conformance: ${name}`, () => {
    publication(createHarness);
    validationAndBounds(createHarness);
    failureOutcomes(createHarness);
    concurrency(createHarness);
    erasure(createHarness);
    corruptionAndBinding(createHarness);
  });
};
