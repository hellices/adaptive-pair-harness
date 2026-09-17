import { nativeToolName } from "@adaptive-pair/harness";
import { growthRuntime } from "@adaptive-pair/testkit";
import { describe, expect, it, vi } from "vitest";
import type { PairToolResult } from "@adaptive-pair/runtime";
import type { PairLanguageModelTool } from "../src/tools/pairTool.js";
import {
  EffectPortDouble,
  asExtensionContext,
  createContext,
  createCoordinator,
  createToken,
  fakeVscode,
  parseToolPayload,
  toolResultText,
} from "./pairToolTestHarness.js";

const fixture = async () => {
  const { registerPairTools } = await import("../src/tools/registerPairTools.js");
  const effects = new EffectPortDouble(request => ({
    operationId: request.operationId,
    status: "confirmed",
    summary: "Searched the agreed scope.",
    observation: { query: "retry", matches: [] },
    sensitiveData: false,
    partial: false,
  }));
  const { coordinator } = createCoordinator(growthRuntime(), effects);
  registerPairTools(asExtensionContext(createContext()), coordinator);
  const tool = fakeVscode.state.registeredTools.find(item => item.name === nativeToolName("pair_search_scope"))?.tool as PairLanguageModelTool;
  const invoke = () => tool.invoke({ input: { query: "retry" } } as never, createToken() as never);
  return { coordinator, invoke };
};

describe("Native complete tool result boundary", () => {
  it.each(["observation", "summary", "operationId"] as const)(
    "withholds oversized %s from a coordinator port without truncation",
    async field => {
      const { coordinator, invoke } = await fixture();
      const snapshot = await coordinator.snapshot();
      const oversized = "private-oversized-result".repeat(1_000);
      const result: PairToolResult = {
        operationId: field === "operationId" ? oversized : "operation-original",
        runtimeRevision: snapshot.revision,
        authorityEpoch: snapshot.session?.authorityEpoch,
        status: "confirmed",
        summary: field === "summary" ? oversized : "Searched the agreed scope.",
        observation: field === "observation" ? { query: oversized, matches: [] } : {},
        sensitiveData: false,
        partial: false,
      };
      vi.spyOn(coordinator, "invokeTool").mockResolvedValue(result);

      const published = await invoke();

      expect(toolResultText(published).length).toBeLessThanOrEqual(12_000);
      expect(toolResultText(published)).not.toContain("private-oversized-result");
      expect(parseToolPayload(published)).toMatchObject({ reason: "result-too-large" });
      expect(parseToolPayload(published)["operationId"]).toBeUndefined();
      expect(result[field]).toEqual(field === "observation" ? { query: oversized, matches: [] } : oversized);
    },
  );

  it("turns runtime budget rejection into a bounded disclosure failure", async () => {
    const { coordinator, invoke } = await fixture();
    vi.spyOn(coordinator, "invokeTool").mockRejectedValue(new Error("TOOL_RESULT_TOO_LARGE"));

    const result = await invoke();

    expect(parseToolPayload(result)).toMatchObject({ reason: "result-too-large" });
    expect(toolResultText(result)).toContain("not rolled back");
    expect(toolResultText(result).length).toBeLessThanOrEqual(12_000);
  });

  it("preserves an ordinary exact query and original operation identity", async () => {
    const { invoke } = await fixture();
    const result = await invoke();

    expect(parseToolPayload(result)).toMatchObject({ status: "confirmed", observation: { query: "retry", matches: [] } });
    expect(parseToolPayload(result)["operationId"]).toEqual(expect.any(String));
    expect(toolResultText(result).length).toBeLessThanOrEqual(12_000);
  });
});
