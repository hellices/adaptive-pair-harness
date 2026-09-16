import { describe, expect, it, vi } from "vitest";
import { nativeToolName } from "@adaptive-pair/harness";
import {
  FakeCoordinator,
  FakeModel,
  GrowthEvaluationLog,
  GrowthModelFailure,
  GrowthParticipant,
  ModelConsentRegistry,
  asModel,
  createContext,
  createGrowthModel,
  createRequest,
  createResponseStream,
  createToken,
  growthSnapshot,
  realCoordinator,
  toGrowthChatTools,
  viewWith,
} from "./growthTestHarness.js";

const briefingSnapshot = () => growthSnapshot({
  runtimeRevision: 4,
  session: { status: "briefing", mode: undefined, workUnit: undefined, assistance: undefined },
});

describe("Growth host-facing mode selection", () => {
  it("advertises only Growth as a supported mode", async () => {
    const coordinator = realCoordinator(briefingSnapshot());
    const prepared = await coordinator.prepareTurn({});
    const descriptor = toGrowthChatTools(prepared.tools).find(tool => tool.name === nativeToolName("pair_select_mode"));

    expect(descriptor?.inputSchema).toMatchObject({
      properties: { mode: { enum: ["growth"] } },
      required: ["mode"],
    });
  });

  it.each(["pair", "delivery", undefined, 42])(
    "rejects unsupported mode %s before asking for authority",
    async mode => {
      const before = briefingSnapshot();
      const coordinator = realCoordinator(before);
      const grant = vi.spyOn(coordinator, "grantUserAction");
      const invoke = vi.spyOn(coordinator, "invokeTool");
      const confirmToolAction = vi.fn(() => Promise.resolve(true));
      const model = new FakeModel([
        { toolCalls: [{ callId: "unsupported-mode", name: nativeToolName("pair_select_mode"), input: { mode } }] },
        { text: JSON.stringify({ level: 1, kind: "question", text: "Unsupported mode selected." }) },
      ]);
      const prepared = await coordinator.prepareTurn({});
      const adapter = createGrowthModel(asModel(model), coordinator, { confirmToolAction });

      await expect(adapter.request(prepared.instructions, prepared.tools, new AbortController().signal))
        .rejects.toMatchObject({ code: "GROWTH_UNSUPPORTED_MODE" });
      expect(confirmToolAction).not.toHaveBeenCalled();
      expect(grant).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
      expect(coordinator.snapshotNow()).toEqual(before);
      expect(model.sendCount).toBe(1);
    },
  );
});

describe("Growth immutable model tool boundary", () => {
  it.each(["same response", "follow-up request"])(
    "ends an accepted contract turn before using old tools in a %s",
    async timing => {
      const before = briefingSnapshot();
      const coordinator = realCoordinator(before);
      const invoke = vi.spyOn(coordinator, "invokeTool");
      const select = { callId: "select-growth", name: nativeToolName("pair_select_mode"), input: { mode: "growth" } };
      const propose = {
        callId: "propose-unit",
        name: nativeToolName("pair_propose_work_unit"),
        input: { workUnit: { ...growthSnapshot().session!.workUnit!, status: "proposed" } },
      };
      const model = new FakeModel([
        { toolCalls: timing === "same response" ? [select, propose] : [select] },
        timing === "same response"
          ? { text: JSON.stringify({ level: 1, kind: "question", text: "Outdated context." }) }
          : { toolCalls: [propose] },
        { text: JSON.stringify({ level: 1, kind: "question", text: "Outdated context." }) },
      ]);
      const prepared = await coordinator.prepareTurn({});
      const adapter = createGrowthModel(asModel(model), coordinator, {
        confirmToolAction: () => Promise.resolve(true),
      });

      await expect(adapter.request(prepared.instructions, prepared.tools, new AbortController().signal))
        .rejects.toMatchObject({ code: "GROWTH_REPREPARE_REQUIRED" });
      expect(coordinator.snapshotNow().session?.mode).toBe("growth");
      expect(coordinator.snapshotNow().session?.workUnit).toBeUndefined();
      expect(invoke.mock.calls.map(([name]) => name)).toEqual(["pair_select_mode"]);
      expect(model.sendCount).toBe(1);

      const next = await coordinator.prepareTurn({});
      expect(next.tools.runtimeRevision).toBeGreaterThan(prepared.tools.runtimeRevision);
      expect(toGrowthChatTools(next.tools).map(tool => tool.name)).toContain(nativeToolName("pair_propose_work_unit"));
    },
  );

  it("rejects calls absent from the model's advertised immutable tool view", async () => {
    const before = growthSnapshot({ runtimeRevision: 4 });
    const coordinator = new FakeCoordinator(before);
    const model = new FakeModel([
      { toolCalls: [{ callId: "hidden-read", name: nativeToolName("pair_read_scope"), input: { path: "src/retry.ts" } }] },
      { text: JSON.stringify({ level: 1, kind: "question", text: "Unadvertised tool ran." }) },
    ]);
    const prepared = await coordinator.prepareTurn({});
    const adapter = createGrowthModel(asModel(model), coordinator);

    await expect(adapter.request(prepared.instructions, viewWith([], before.revision), new AbortController().signal))
      .rejects.toMatchObject({ code: "GROWTH_TOOL_TRANSLATION_FAILED" });
    expect(coordinator.invokeCalls).toEqual([]);
    expect(model.sendCount).toBe(1);
  });

  it("requests a fresh turn without reporting a delivered hint or a restraint failure", async () => {
    const coordinator = new FakeCoordinator(growthSnapshot({ runtimeRevision: 4 }));
    const evaluations = new GrowthEvaluationLog();
    const participant = new GrowthParticipant({
      coordinator,
      snapshotNow: () => coordinator.snapshotNow(),
      consent: new ModelConsentRegistry(),
      evaluations,
      createModel: () => ({ request: () => Promise.reject(new GrowthModelFailure("GROWTH_REPREPARE_REQUIRED")) }),
      requestWorkspaceConsent: () => Promise.resolve(true),
      confirmSolutionReveal: () => Promise.resolve(true),
    });
    const { stream, collected } = createResponseStream();

    await participant.handle(createRequest(new FakeModel([])), createContext(), stream, createToken());

    expect(collected.markdown.join("\n")).toContain("fresh context and tools");
    expect(evaluations.records).toEqual([]);
  });
});
