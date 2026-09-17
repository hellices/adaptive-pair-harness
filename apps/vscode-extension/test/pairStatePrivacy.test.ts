import { nativeToolName } from "@adaptive-pair/harness";
import { growthRuntime } from "@adaptive-pair/testkit";
import { expect, it } from "vitest";
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

it("serializes only bounded state metadata from the registered native tool without consent", async () => {
  const { registerPairTools } = await import("../src/tools/registerPairTools.js");
  const effects = new EffectPortDouble(request => ({
    operationId: request.operationId,
    status: "confirmed",
    summary: "private-native-operation-summary",
    sensitiveData: false,
    partial: false,
  }));
  const { coordinator, store } = createCoordinator(growthRuntime({ session: {
    entrySnapshot: {
      workspaceId: "workspace-1", capturedAt: 1,
      diagnostics: ["private-native-diagnostic"],
      dirtyPaths: ["private-native-resource.ts"], openPaths: [], protectedPaths: [],
    },
  } }), effects);
  const signal = new AbortController().signal;
  await coordinator.invokeTool("pair_search_scope", { query: "private-native-input" }, signal);
  const grantId = await coordinator.grantUserAction("pair_run_verification", signal);
  const before = store.snapshotNow();
  registerPairTools(asExtensionContext(createContext()), coordinator);
  const registered = fakeVscode.state.registeredTools.find(tool => tool.name === nativeToolName("pair_get_state"));
  expect(registered).toBeDefined();
  const tool = registered?.tool as PairLanguageModelTool;

  const preparation = await tool.prepareInvocation({ input: {} }, createToken() as never);
  const result = await tool.invoke({ input: {} } as never, createToken() as never);
  const text = toolResultText(result);

  expect(preparation.confirmationMessages).toBeUndefined();
  expect(fakeVscode.state.warnings).toEqual([]);
  expect(text.length).toBeLessThanOrEqual(8_000);
  for (const privateValue of ["private-native-diagnostic", "private-native-resource", "private-native-input", "private-native-operation-summary", grantId]) {
    expect.soft(text.includes(privateValue), privateValue).toBe(false);
    expect(JSON.stringify(before).includes(privateValue), privateValue).toBe(true);
  }
  expect(parseToolPayload(result)).toMatchObject({
    sensitiveData: false, partial: false,
    observation: { snapshot: { session: {
      mode: "growth", workUnit: { id: "unit-1", owner: "human" },
      assistance: { maximumHintLevel: 1 }, verification: { latestStatus: "not-run" },
    } } },
  });
  expect(store.snapshotNow()).toBe(before);
  expect(before.session?.userActionGrants.at(-1)?.status).toBe("available");
  expect(effects.calls).toHaveLength(1);
});
