import { nativeToolName } from "@adaptive-pair/harness";
import { expect, it } from "vitest";
import {
  FakeModel,
  asModel,
  createGrowthModel,
  growthSnapshot,
  realCoordinator,
} from "./growthTestHarness.js";

it("forwards state metadata without private snapshot fields to the next Growth model request", async () => {
  const coordinator = realCoordinator(growthSnapshot({ session: {
    entrySnapshot: {
      workspaceId: "workspace-1", capturedAt: 1,
      diagnostics: ["private-growth-diagnostic"],
      dirtyPaths: ["private-growth-resource.ts"], openPaths: [], protectedPaths: [],
    },
  } }));
  const signal = new AbortController().signal;
  await coordinator.invokeTool("pair_search_scope", { query: "private-growth-input" }, signal);
  const grantId = await coordinator.grantUserAction("pair_run_verification", signal);
  const before = coordinator.snapshotNow();
  const model = new FakeModel([
    { toolCalls: [{ callId: "state-call", name: nativeToolName("pair_get_state"), input: {} }] },
    { text: JSON.stringify({ level: 1, kind: "question", text: "What have you tried?" }) },
  ]);
  const prepared = await coordinator.prepareTurn({});

  await createGrowthModel(asModel(model), coordinator).request(prepared.instructions, prepared.tools, signal);

  expect(model.sendCount).toBe(2);
  const forwarded = JSON.stringify(model.sentMessages[1]);
  for (const privateValue of ["private-growth-diagnostic", "private-growth-resource", "private-growth-input", grantId]) {
    expect.soft(forwarded.includes(privateValue), privateValue).toBe(false);
    expect(JSON.stringify(before).includes(privateValue), privateValue).toBe(true);
  }
  expect(forwarded).toContain("UNTRUSTED_TOOL_RESULT");
  expect(forwarded).toContain("maximumHintLevel");
  expect(forwarded).toContain("latestStatus");
  expect(coordinator.snapshotNow()).toBe(before);
  expect(before.session?.userActionGrants.at(-1)?.status).toBe("available");
});
