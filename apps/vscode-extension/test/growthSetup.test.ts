import { describe, expect, it, vi } from "vitest";
import { InMemoryJournal, PairCoordinator } from "@adaptive-pair/runtime";
import { FakeClock, FakeIdSource } from "@adaptive-pair/testkit";
import {
  runGrowthSetup,
  type GrowthSetupDependencies,
  type GrowthSetupInput,
  type GrowthSetupStage,
} from "../src/growthSetup.js";

const input: GrowthSetupInput = {
  objective: "Fix the retry boundary",
  allowedPath: "src/retry.mjs",
  independentCheck: "Try a different retry limit independently",
  verificationPlan: "npm test",
};

const createHarness = async () => {
  const store = new InMemoryJournal("workspace-setup");
  const ids = new FakeIdSource();
  const effects = { execute: vi.fn(() => { throw new Error("Unexpected effect"); }) };
  const coordinator = new PairCoordinator({
    store, ids, effects, clock: new FakeClock(100), streamId: "workspace-setup",
  });
  await coordinator.setPresence("observing", "workspace-setup");
  await coordinator.dispatch({
    type: "StartSession", sessionId: "fresh-session", protocolVersion: 1,
    commandId: ids.next("command"), expectedRevision: store.snapshotNow().revision,
    actor: "human", observedAt: 100,
  });
  const controller = new AbortController();
  const confirmations: GrowthSetupStage[] = [];
  const collect = vi.fn<() => Promise<GrowthSetupInput | undefined>>(() => Promise.resolve(input));
  const confirm = vi.fn((stage: GrowthSetupStage): Promise<boolean> => {
    confirmations.push(stage);
    return Promise.resolve(true);
  });
  const prepareEntry = vi.fn(async (signal: AbortSignal) => {
    signal.throwIfAborted();
    return coordinator.dispatch({
      type: "CaptureEntry", protocolVersion: 1, commandId: ids.next("command"),
      expectedRevision: store.snapshotNow().revision, actor: "human", observedAt: 101,
      entry: {
        workspaceId: "workspace-setup", dirtyPaths: [],
        openPaths: [input.allowedPath], diagnostics: [], protectedPaths: [], capturedAt: 101,
      },
    });
  });
  const dependencies: GrowthSetupDependencies = {
    coordinator, snapshotNow: () => store.snapshotNow(), prepareEntry,
    ui: { collect, confirm },
  };
  return { store, coordinator, effects, controller, confirmations, collect, confirm, prepareEntry, dependencies };
};

describe("first-use Growth setup through the real coordinator", () => {
  it("starts in briefing without a ready-made agreement or work unit", async () => {
    const harness = await createHarness();
    expect(harness.store.snapshotNow().session).toMatchObject({
      status: "briefing", learningAgreement: undefined, workUnit: undefined,
    });
    expect(harness.effects.execute).not.toHaveBeenCalled();
  });

  it("reaches an agreed human-owned work unit with three actual confirmations", async () => {
    const harness = await createHarness();
    expect(await runGrowthSetup(harness.dependencies, harness.controller.signal)).toBe("completed");
    expect(harness.confirmations).toEqual(["learning", "mode", "work-unit"]);
    const session = harness.store.snapshotNow().session;
    expect(session?.workUnit).toMatchObject({
      mode: "growth", owner: "human", status: "agreed", objective: input.objective,
      allowedPaths: [input.allowedPath], verificationPlan: "npm run test",
    });
    expect(session?.learningAgreement).toMatchObject({
      maximumHintLevel: 4, independentCheck: input.independentCheck,
      humanOwnedCapabilities: ["implementation", "diagnosis", "repair"],
    });
    expect(session?.userActionGrants).toHaveLength(3);
    expect(session?.userActionGrants.every(grant => grant.status === "consumed")).toBe(true);
    expect(harness.effects.execute).not.toHaveBeenCalled();
  });

  it.each(["off", "paused"] as const)("does nothing while Presence is %s", async status => {
    const harness = await createHarness();
    await harness.coordinator.setPresence(status);
    const before = harness.store.snapshotNow();
    expect(await runGrowthSetup(harness.dependencies, harness.controller.signal)).toBe("unavailable");
    expect(harness.collect).not.toHaveBeenCalled();
    expect(harness.prepareEntry).not.toHaveBeenCalled();
    expect(harness.store.snapshotNow()).toEqual(before);
  });

  it("does not replace an operational work unit", async () => {
    const harness = await createHarness();
    await runGrowthSetup(harness.dependencies, harness.controller.signal);
    const before = harness.store.snapshotNow();
    harness.collect.mockClear();
    expect(await runGrowthSetup(harness.dependencies, harness.controller.signal)).toBe("unavailable");
    expect(harness.collect).not.toHaveBeenCalled();
    expect(harness.store.snapshotNow()).toEqual(before);
  });

  it("cancels before collection without touching the runtime", async () => {
    const harness = await createHarness();
    harness.controller.abort();
    const before = harness.store.snapshotNow();
    expect(await runGrowthSetup(harness.dependencies, harness.controller.signal)).toBe("cancelled");
    expect(harness.collect).not.toHaveBeenCalled();
    expect(harness.store.snapshotNow()).toEqual(before);
  });

  it("does not capture entry when input is cancelled", async () => {
    const harness = await createHarness();
    harness.collect.mockResolvedValue(undefined);
    const before = harness.store.snapshotNow();
    expect(await runGrowthSetup(harness.dependencies, harness.controller.signal)).toBe("cancelled");
    expect(harness.prepareEntry).not.toHaveBeenCalled();
    expect(harness.store.snapshotNow()).toEqual(before);
  });
});

describe("Growth setup admission boundaries", () => {
  it.each(["learning", "mode", "work-unit"] as const)("honors cancellation during the %s confirmation", async cancelledStage => {
    const harness = await createHarness();
    harness.confirm.mockImplementation(stage => {
      if (stage === cancelledStage) { harness.controller.abort(); }
      return Promise.resolve(true);
    });
    expect(await runGrowthSetup(harness.dependencies, harness.controller.signal)).toBe("cancelled");
    expect(harness.store.snapshotNow().session?.workUnit).toBeUndefined();
  });

  it("invalidates a revoked host admission without needing a runtime revision change", async () => {
    const harness = await createHarness();
    let available = true;
    harness.confirm.mockImplementation(() => { available = false; return Promise.resolve(true); });
    expect(await runGrowthSetup({ ...harness.dependencies, isAvailable: () => available }, harness.controller.signal)).toBe("stale");
    expect(harness.store.snapshotNow().session?.userActionGrants).toHaveLength(0);
  });

  it.each(["learning", "mode", "work-unit"] as const)("does not agree work when %s is declined", async rejected => {
    const harness = await createHarness();
    harness.confirm.mockImplementation(stage => {
      harness.confirmations.push(stage);
      return Promise.resolve(stage !== rejected);
    });
    expect(await runGrowthSetup(harness.dependencies, harness.controller.signal)).toBe("cancelled");
    expect(harness.store.snapshotNow().session?.workUnit).toBeUndefined();
    expect(harness.store.snapshotNow().session?.status).toBe("briefing");
    harness.confirm.mockResolvedValue(true);
    expect(await runGrowthSetup(harness.dependencies, harness.controller.signal)).toBe("completed");
  });

  it.each(["learning", "mode", "work-unit"] as const)("invalidates a stale %s confirmation", async staleStage => {
    const harness = await createHarness();
    harness.confirm.mockImplementation(async stage => {
      if (stage === staleStage) {
        await harness.coordinator.observeWorkspace();
      }
      return true;
    });
    expect(await runGrowthSetup(harness.dependencies, harness.controller.signal)).toBe("stale");
    expect(harness.store.snapshotNow().session?.workUnit).toBeUndefined();
    expect(harness.effects.execute).not.toHaveBeenCalled();
  });

  it.each(["off", "paused"] as const)("never admits a queued confirmation after %s", async status => {
    const harness = await createHarness();
    harness.confirm.mockImplementation(async () => {
      await harness.coordinator.setPresence(status);
      return true;
    });
    expect(await runGrowthSetup(harness.dependencies, harness.controller.signal)).toBe("stale");
    expect(harness.store.snapshotNow().session?.workUnit).toBeUndefined();
  });

  it("rejects state changes during input collection before entry capture", async () => {
    const harness = await createHarness();
    harness.collect.mockImplementation(async () => {
      await harness.coordinator.observeWorkspace();
      return input;
    });
    expect(await runGrowthSetup(harness.dependencies, harness.controller.signal)).toBe("stale");
    expect(harness.prepareEntry).not.toHaveBeenCalled();
    expect(harness.confirm).not.toHaveBeenCalled();
  });

  it("honors cancellation while entry capture is pending", async () => {
    const harness = await createHarness();
    harness.prepareEntry.mockImplementation(signal => {
      harness.controller.abort();
      signal.throwIfAborted();
      return Promise.resolve(harness.store.snapshotNow());
    });
    expect(await runGrowthSetup(harness.dependencies, harness.controller.signal)).toBe("cancelled");
    expect(harness.confirm).not.toHaveBeenCalled();
  });

  it("does not expose raw failures or claim success after a failed action", async () => {
    const harness = await createHarness();
    vi.spyOn(harness.coordinator, "invokeTool").mockRejectedValue(new Error("private-source-sentinel"));
    expect(await runGrowthSetup(harness.dependencies, harness.controller.signal)).toBe("failed");
    expect(harness.store.snapshotNow().session?.workUnit).toBeUndefined();
  });

  it("admits only one of two concurrent setups", async () => {
    const harness = await createHarness();
    const outcomes = await Promise.all([
      runGrowthSetup(harness.dependencies, harness.controller.signal),
      runGrowthSetup(harness.dependencies, harness.controller.signal),
    ]);
    expect(outcomes.filter(outcome => outcome === "completed")).toHaveLength(1);
    expect(harness.store.snapshotNow().session?.userActionGrants).toHaveLength(3);
  });

  it.each([
    { objective: "" }, { objective: "long".repeat(100) },
    { independentCheck: "" }, { allowedPath: "../secret.ts" },
    { allowedPath: "/outside.ts" }, { allowedPath: ".env" },
    { allowedPath: "src/picture.png" }, { allowedPath: "src/\u0000bad.ts" },
    { verificationPlan: "npm test && touch marker" }, { verificationPlan: "npm run deploy" },
    { verificationPlan: `test${" ".repeat(200)}` },
  ])("refuses invalid setup input before any entry capture: %j", async invalid => {
    const harness = await createHarness();
    harness.collect.mockResolvedValue({ ...input, ...invalid });
    const before = harness.store.snapshotNow();
    expect(await runGrowthSetup(harness.dependencies, harness.controller.signal)).toBe("unavailable");
    expect(harness.prepareEntry).not.toHaveBeenCalled();
    expect(harness.store.snapshotNow()).toEqual(before);
  });
});
