import { maximumHintLevelForSnapshot, PAIR_TOOL_CATALOG } from "@adaptive-pair/harness";
import type { OperationRecord, PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { FakeClock, FakeIdSource, growthRuntime } from "@adaptive-pair/testkit";
import { expect, it } from "vitest";
import { InMemoryJournal } from "../src/journal.js";
import { PairCoordinator } from "../src/coordinator.js";
import { createWorkUnit } from "./coordinatorFixtures.js";
import { FakeEffectPort } from "./fakes.js";

const createFixture = (snapshot = growthRuntime()) => {
  const store = new InMemoryJournal("workspace-1", snapshot);
  const effects = new FakeEffectPort([]);
  const coordinator = new PairCoordinator({
    store,
    effects,
    clock: new FakeClock(),
    ids: new FakeIdSource(),
    streamId: "workspace-1",
  });
  return { coordinator, store, effects };
};

const readState = (coordinator: PairCoordinator) => coordinator.invokeTool(
  "pair_get_state", {}, new AbortController().signal,
);

it("keeps diagnostics, source paths, raw inputs and grants behind the trusted snapshot port", async () => {
  const { coordinator, store } = createFixture(growthRuntime({
    session: {
      entrySnapshot: {
        workspaceId: "workspace-1",
        dirtyPaths: ["private-path-canary.ts"],
        openPaths: [],
        diagnostics: ["private-diagnostic-canary"],
        protectedPaths: [],
        capturedAt: 1,
      },
    },
  }));
  await coordinator.invokeTool("pair_search_scope", {
    query: "private-operation-input-canary",
  }, new AbortController().signal);
  const grantId = await coordinator.grantUserAction("pair_run_verification", new AbortController().signal);
  const before = store.snapshotNow();

  const result = await readState(coordinator);
  const serialized = JSON.stringify(result);

  for (const secret of ["private-path-canary", "private-diagnostic-canary", "private-operation-input-canary", grantId]) {
    expect.soft(serialized.includes(secret), secret).toBe(false);
    expect(JSON.stringify(before).includes(secret), secret).toBe(true);
  }
  expect(result.observation["snapshot"]).not.toBe(before);
  expect(Object.isFrozen(result.observation["snapshot"])).toBe(true);
  expect(store.snapshotNow()).toBe(before);
  expect(result.sensitiveData).toBe(false);
  expect(result.partial).toBe(false);
  expect(store.snapshotNow().session?.userActionGrants.at(-1)?.status).toBe("available");
});

it.each(["growth", "pair", "delivery"] as const)("preserves published %s state metadata", async mode => {
  const snapshot = growthRuntime({
    runtimeRevision: 7,
    session: {
      authorityEpoch: 2,
      mode,
      workUnit: createWorkUnit({ mode, owner: mode === "delivery" ? "ai" : "human" }),
    },
  });
  const { coordinator } = createFixture(snapshot);

  const result = await readState(coordinator);

  expect(result.observation).toMatchObject({
    snapshot: {
      protocolVersion: 1,
      revision: snapshot.revision,
      presence: { status: snapshot.presence.status, observationRevision: snapshot.presence.observationRevision },
      session: {
        sessionId: snapshot.session?.sessionId,
        authorityEpoch: 2,
        mode,
        status: "active",
        workUnit: { id: "unit-1", mode, owner: mode === "delivery" ? "ai" : "human" },
        assistance: { maximumHintLevel: maximumHintLevelForSnapshot(snapshot), attemptRecorded: false, hypothesisRecorded: false },
        verification: { latestStatus: "not-run", pendingCount: 0 },
      },
    },
  });
});

it("bounds state results independently of accumulated operation input", async () => {
  const { coordinator } = createFixture();
  for (let sequence = 0; sequence < 8; sequence += 1) {
    await coordinator.invokeTool("pair_search_scope", {
      query: `${sequence}:${"x".repeat(1_900)}`,
    }, new AbortController().signal);
  }
  const result = await readState(coordinator);
  const limit = PAIR_TOOL_CATALOG.find(tool => tool.name === "pair_get_state")?.maximumResultCharacters;

  expect(limit).toBe(8_000);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(limit ?? 0);
});

it.each(["x".repeat(20_000), "file:///private/local-resource-canary", "id\0control"])("omits unsafe or oversized identifiers without inventing replacements", async identifier => {
  const { coordinator, store } = createFixture(growthRuntime({
    session: { sessionId: identifier, workUnit: createWorkUnit({ id: identifier }) },
  }));
  const before = store.snapshotNow();

  const result = await readState(coordinator);

  expect(JSON.stringify(result).includes(identifier)).toBe(false);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(8_000);
  expect(result.partial).toBe(true);
  expect(store.snapshotNow()).toBe(before);
});

it("reports observed verification status without exposing input, summary or grant records", async () => {
  const { coordinator, store } = createFixture();
  const signal = new AbortController().signal;
  const userActionId = await coordinator.grantUserAction("pair_run_verification", signal);
  await coordinator.invokeTool("pair_run_verification", { plan: "private-plan-canary" }, signal, { userActionId });
  const before = store.snapshotNow();

  const result = await readState(coordinator);

  expect(result.observation).toMatchObject({ snapshot: { session: {
    verification: { latestStatus: "confirmed", pendingCount: 0 },
  } } });
  expect(JSON.stringify(result).includes("private-plan-canary")).toBe(false);
  expect(JSON.stringify(result).includes(userActionId)).toBe(false);
  expect(store.snapshotNow()).toBe(before);
  await expect(coordinator.invokeTool("pair_run_verification", { plan: "test" }, signal, { userActionId }))
    .rejects.toThrow("USER_ACTION_REQUIRED");
});

it("does not expose unknown future snapshot fields", async () => {
  const snapshot: PairRuntimeSnapshot = Object.assign(growthRuntime(), {
    internalDebugRecord: { token: "future-private-field-canary" },
  });
  const { coordinator, store } = createFixture(snapshot);

  const result = await readState(coordinator);

  expect(JSON.stringify(result).includes("future-private-field-canary")).toBe(false);
  expect(JSON.stringify(store.snapshotNow()).includes("future-private-field-canary")).toBe(true);
});

const verificationOperation = (overrides: Partial<OperationRecord> = {}): OperationRecord => ({
  id: "verification-1",
  workUnitId: "unit-1",
  toolName: "pair_run_verification",
  kind: "check",
  input: { plan: "private-verification-input" },
  runtimeRevision: 0,
  authorityEpoch: 0,
  status: "confirmed",
  summary: "private-verification-summary",
  userActionGrantId: "private-verification-grant",
  ...overrides,
});

it.each([
  "planned", "authorized", "started", "confirmed", "failed", "declined", "cancelled", "unknown",
] as const)("projects %s verification without confusing pending work with success", async status => {
  const { coordinator } = createFixture(growthRuntime({
    session: { operations: [verificationOperation({ status })] },
  }));

  const result = await readState(coordinator);

  expect(result.observation).toMatchObject({ snapshot: { session: {
    verification: { latestStatus: status, pendingCount: ["planned", "authorized", "started"].includes(status) ? 1 : 0 },
  } } });
  expect(JSON.stringify(result).includes("private-verification")).toBe(false);
});

it("does not attribute other tools, work units or authority epochs to current verification", async () => {
  const { coordinator } = createFixture(growthRuntime({ session: {
    authorityEpoch: 2,
    operations: [
      verificationOperation({ authorityEpoch: 2, status: "failed" }),
      verificationOperation({ id: "other-tool", authorityEpoch: 2, toolName: "pair_run_command", status: "authorized" }),
      verificationOperation({ id: "other-unit", authorityEpoch: 2, workUnitId: "unit-old" }),
      verificationOperation({ id: "old-epoch", authorityEpoch: 1 }),
    ],
  } }));

  const result = await readState(coordinator);

  expect(result.observation).toMatchObject({ snapshot: { session: {
    verification: { latestStatus: "failed", pendingCount: 0 },
  } } });
});
