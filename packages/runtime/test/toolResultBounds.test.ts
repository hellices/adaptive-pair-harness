import { describe, expect, it } from "vitest";
import { FakeClock, FakeIdSource, growthRuntime } from "@adaptive-pair/testkit";
import { InMemoryJournal, PairCoordinator, type IdSource } from "../src/index.js";

const createFixture = (
  query = "",
  ids: IdSource = new FakeIdSource(),
  snapshot = growthRuntime(),
) => {
  const store = new InMemoryJournal("workspace-1", snapshot);
  const coordinator = new PairCoordinator({
    store,
    ids,
    clock: new FakeClock(),
    streamId: "workspace-1",
    effects: {
      execute: request => Promise.resolve({
        operationId: request.operationId,
        status: "confirmed",
        summary: "Searched the agreed scope.",
        observation: { query, matches: [] },
        sensitiveData: false,
        partial: false,
      }),
    },
  });
  const search = () => coordinator.invokeTool("pair_search_scope", { query: "retry" }, new AbortController().signal);
  return { store, coordinator, search };
};

describe("Complete runtime tool result budget", () => {
  it("rejects an oversized envelope even when its observation fits the catalog limit", async () => {
    const query = "x".repeat(11_975);
    expect(JSON.stringify({ query, matches: [] })).toHaveLength(12_000);
    const fixture = createFixture(query);

    await expect(fixture.search()).rejects.toThrow("TOOL_RESULT_TOO_LARGE");
    expect(fixture.store.snapshotNow().session?.operations.at(-1)?.status).toBe("confirmed");
  });

  it.each([false, true])("accepts exactly the complete result limit (escaped: %s)", async escaped => {
    const empty = await createFixture().search();
    const budget = 12_000 - JSON.stringify(empty).length;
    const query = escaped ? `${'"'.repeat(Math.floor(budget / 2))}${"x".repeat(budget % 2)}` : "x".repeat(budget);
    const result = await createFixture(query).search();

    expect(result.observation).toEqual({ query, matches: [] });
    expect(JSON.stringify(result)).toHaveLength(12_000);
    await expect(createFixture(`${query}x`).search()).rejects.toThrow("TOOL_RESULT_TOO_LARGE");
  });

  it("does not truncate or invent a large state-result identity", async () => {
    const fixture = createFixture("", { next: () => "private-id".repeat(1_000) });
    const before = fixture.store.snapshotNow();

    await expect(fixture.coordinator.invokeTool("pair_get_state", {}, new AbortController().signal))
      .rejects.toThrow("TOOL_RESULT_TOO_LARGE");
    expect(fixture.store.snapshotNow()).toBe(before);
  });

  it("preserves a committed contract when only its returned identity exceeds the limit", async () => {
    const ids = new FakeIdSource();
    const fixture = createFixture("", {
      next: prefix => prefix === "state" ? "large-state-id".repeat(1_000) : ids.next(prefix),
    }, growthRuntime({ session: { status: "briefing", mode: undefined, workUnit: undefined, assistance: undefined } }));
    const signal = new AbortController().signal;
    const userActionId = await fixture.coordinator.grantUserAction("pair_select_mode", signal);

    await expect(fixture.coordinator.invokeTool("pair_select_mode", { mode: "growth" }, signal, { userActionId }))
      .rejects.toThrow("TOOL_RESULT_TOO_LARGE");
    expect(fixture.store.snapshotNow().session?.mode).toBe("growth");
  });
});
