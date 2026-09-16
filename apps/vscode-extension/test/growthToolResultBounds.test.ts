import { nativeToolName } from "@adaptive-pair/harness";
import { describe, expect, it } from "vitest";
import type { PairToolResult } from "@adaptive-pair/runtime";
import {
  FakeCoordinator,
  FakeModel,
  asModel,
  createGrowthModel,
  growthSnapshot,
} from "./growthTestHarness.js";

const { untrustedToolResult } = await import("../src/growthModelMessages.js");

const resultFor = (query = ""): PairToolResult => ({
  operationId: "operation-original",
  runtimeRevision: 4,
  authorityEpoch: 0,
  status: "confirmed",
  summary: "Searched the agreed scope.",
  observation: { query, matches: [] },
  sensitiveData: false,
  partial: false,
});

const textOf = (part: ReturnType<typeof untrustedToolResult>): string =>
  (part.content[0] as { readonly value: string }).value;

describe("Growth complete tool result boundary", () => {
  it.each([false, true])("budgets the complete trust-prefixed text (escaped: %s)", escaped => {
    const empty = textOf(untrustedToolResult("call-original", resultFor(), 12_000));
    const budget = 12_000 - empty.length;
    const query = escaped ? `${'"'.repeat(Math.floor(budget / 2))}${"x".repeat(budget % 2)}` : "x".repeat(budget);
    const result = resultFor(query);

    const published = untrustedToolResult("call-original", result, 12_000);

    expect(textOf(published)).toHaveLength(12_000);
    expect(published.callId).toBe("call-original");
    expect(textOf(published)).toContain("UNTRUSTED_TOOL_RESULT");
    expect(result.observation["query"]).toBe(query);
    expect(() => untrustedToolResult("call-original", resultFor(`${query}x`), 12_000))
      .toThrow("GROWTH_TOOL_RESULT_TOO_LARGE");
  });

  it("stops before another model request when the native-size result exceeds Growth's rendered budget", async () => {
    const empty = resultFor();
    const query = "x".repeat(12_000 - JSON.stringify(empty).length);
    const result = resultFor(query);
    expect(JSON.stringify(result)).toHaveLength(12_000);
    const coordinator = new FakeCoordinator(growthSnapshot({ runtimeRevision: 4 }), { resultFor: () => result });
    const model = new FakeModel([
      { toolCalls: [{ callId: "search-call", name: nativeToolName("pair_search_scope"), input: { query: "retry" } }] },
      { text: JSON.stringify({ level: 1, kind: "question", text: "A follow-up must not be requested." }) },
    ]);
    const prepared = await coordinator.prepareTurn({});
    const adapter = createGrowthModel(asModel(model), coordinator);

    await expect(adapter.request(prepared.instructions, prepared.tools, new AbortController().signal))
      .rejects.toMatchObject({ code: "GROWTH_TOOL_RESULT_TOO_LARGE" });
    expect(model.sendCount).toBe(1);
    expect(coordinator.invokeCalls).toHaveLength(1);
    expect(result.observation["query"]).toBe(query);
  });
});
