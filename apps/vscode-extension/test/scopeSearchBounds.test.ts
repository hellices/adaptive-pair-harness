import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ActivityLedger } from "../src/activityLedger.js";
import {
  filesystem,
  openBuffer,
  scopeRequest,
  workspace,
} from "./scopeCompositionFixtures.js";

const { VscodeScopeAccess } = await import("../src/scopeAccess.js");
const { BoundedScopeEffectRunner } = await import("../src/scopeEffect.js");
const RESULT_CHARACTER_LIMIT = 12_000;

const search = async (query: unknown, signal = new AbortController().signal) => {
  const ledger = new ActivityLedger();
  const result = await new BoundedScopeEffectRunner(new VscodeScopeAccess(filesystem.root, ledger)).run(
    scopeRequest("pair_search_scope", ["src"], { query }),
    signal,
  );
  return { result, ledger };
};

const queryBudget = async (matches: readonly unknown[] = []): Promise<number> => {
  const { result } = await search("absent-budget-control");
  return RESULT_CHARACTER_LIMIT - JSON.stringify({ ...result, observation: { query: "", matches } }).length;
};

describe("Scope search — complete effect result budget", () => {
  it("rejects a query when metadata makes its otherwise fitting observation oversized", async () => {
    workspace.foundPaths = [];
    const query = "x".repeat(11_975);
    expect(JSON.stringify({ query, matches: [] })).toHaveLength(12_000);

    const { result, ledger } = await search(query);

    expect(result.status).toBe("declined");
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(12_000);
    expect(ledger.isInactive()).toBe(true);
    expect(workspace.searches).toEqual([]);
  });

  it.each([
    { name: "empty discovery", query: "x".repeat(12_000), empty: true, matching: false },
    { name: "unmatched files", query: "x".repeat(12_000), empty: false, matching: false },
    { name: "matched files", query: "retry".repeat(2_400), empty: false, matching: true },
    { name: "JSON-escaped query", query: '"'.repeat(6_000), empty: true, matching: false },
  ])("rejects an unrepresentable query with $name before workspace access", async ({ query, empty, matching }) => {
    if (empty) {
      workspace.foundPaths = [];
    }
    if (matching) {
      await writeFile(join(filesystem.source, "main.ts"), query);
    }
    const getText = openBuffer(join(filesystem.source, "main.ts"), matching ? query : "retry dirty control");

    const { result, ledger } = await search(query);

    expect(JSON.stringify(result).length).toBeLessThanOrEqual(RESULT_CHARACTER_LIMIT);
    expect(result).toMatchObject({
      status: "declined",
      observation: { reason: "search-result-too-large" },
      partial: false,
    });
    expect(result.observation?.["query"]).toBeUndefined();
    expect(result.observation?.["matches"]).toBeUndefined();
    expect(ledger.isInactive()).toBe(true);
    expect(workspace.searches).toEqual([]);
    expect(getText).not.toHaveBeenCalled();
  });

  it.each([false, true])("keeps an exact-limit complete empty result unchanged (escaped: %s)", async escaped => {
    const budget = await queryBudget();
    const query = escaped ? `${'"'.repeat(Math.floor(budget / 2))}${"x".repeat(budget % 2)}` : "x".repeat(budget);
    workspace.foundPaths = [];

    const { result } = await search(query);

    expect(result).toMatchObject({ status: "confirmed", partial: false });
    expect(result.observation).toEqual({ query, matches: [] });
    expect(JSON.stringify(result)).toHaveLength(RESULT_CHARACTER_LIMIT);
  });

  it.each([false, true])("budgets escaped matches and complete identities (overflow: %s)", async overflow => {
    const directory = `src/${"segment".repeat(20)}`;
    const path = `${directory}/main.ts`;
    const match = { path, line: 1, text: '"'.repeat(300) };
    const budget = await queryBudget([match]);
    const query = `${'"'.repeat(Math.floor(budget / 2))}${"x".repeat(budget % 2)}`;
    await mkdir(join(filesystem.root, directory));
    await writeFile(join(filesystem.root, path), overflow ? `${query}\n${query}` : query);
    workspace.foundPaths = [join(filesystem.root, path)];

    const { result } = await search(query);

    expect(result).toMatchObject({ status: "confirmed", partial: overflow });
    expect(result.observation).toEqual({ query, matches: [match] });
    expect(JSON.stringify(result)).toHaveLength(RESULT_CHARACTER_LIMIT - (overflow ? 1 : 0));
  });

  it("preserves exact query whitespace and case-insensitive matching semantics", async () => {
    await writeFile(join(filesystem.source, "main.ts"), "retry\nprefix retry suffix");

    const { result } = await search(" ReTrY ");

    expect(result).toMatchObject({ status: "confirmed", partial: false });
    expect(result.observation).toEqual({
      query: " ReTrY ",
      matches: [{ path: "src/main.ts", line: 2, text: "prefix retry suffix" }],
    });
  });

  it("keeps the match-count early return inside the complete result budget", async () => {
    await writeFile(join(filesystem.source, "main.ts"), Array.from({ length: 60 }, () => "retry").join("\n"));

    const { result } = await search("retry");

    expect(result).toMatchObject({ status: "confirmed", partial: true });
    expect(result.observation).toEqual({
      query: "retry",
      matches: Array.from({ length: 50 }, (_, index) => ({ path: "src/main.ts", line: index + 1, text: "retry" })),
    });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(RESULT_CHARACTER_LIMIT);
  });
});

describe("Scope search — preflight controls", () => {
  it.each(["", "   ", undefined, 42])("keeps invalid query %j bounded and inactive", async query => {
    const { result, ledger } = await search(query);

    expect(result).toMatchObject({ status: "declined", observation: { reason: "invalid-search-query" } });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(RESULT_CHARACTER_LIMIT);
    expect(ledger.isInactive()).toBe(true);
  });

  it("prioritizes cancellation over an oversized query without workspace reads", async () => {
    const controller = new AbortController();
    controller.abort();

    const { result, ledger } = await search("x".repeat(12_000), controller.signal);

    expect(result).toMatchObject({ status: "cancelled", observation: { reason: "scope-read-cancelled" } });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(RESULT_CHARACTER_LIMIT);
    expect(ledger.isInactive()).toBe(true);
  });
});
