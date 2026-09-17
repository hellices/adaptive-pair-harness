import { describe, expect, it } from "vitest";
import { nativeToolName } from "@adaptive-pair/harness";
import {
  createGrowthModel,
  GrowthModelFailure,
  GROWTH_TURN_CAPS,
  type ScriptedTurn,
  FakeModel,
  asModel,
  FakeCoordinator,
  growthSnapshot,
} from "./growthTestHarness.js";

describe("GrowthModel turn caps", () => {
  it.each([
    { phase: "stream", reason: "deadline", code: "GROWTH_TIME_CAP" },
    { phase: "stream", reason: "cancellation", code: "GROWTH_CANCELLED" },
    { phase: "accounting", reason: "deadline", code: "GROWTH_TIME_CAP" },
    { phase: "accounting", reason: "cancellation", code: "GROWTH_CANCELLED" },
  ])("rejects a late successful $phase completion after $reason", async ({ phase, reason, code }) => {
    const coordinator = new FakeCoordinator(growthSnapshot({ runtimeRevision: 4 }));
    const controller = new AbortController();
    const responseText = JSON.stringify({ level: 1, kind: "question", text: "bounded hint" });
    let now = 0;
    const expire = (): void => {
      if (reason === "deadline") {
        now = 100;
      } else {
        controller.abort();
      }
    };
    class LateCompletionModel extends FakeModel {
      public override async sendRequest(
        ...args: Parameters<FakeModel["sendRequest"]>
      ): Promise<Awaited<ReturnType<FakeModel["sendRequest"]>>> {
        const response = await super.sendRequest(...args);
        async function* stream(): AsyncIterable<unknown> {
          yield* response.stream;
          if (phase === "stream") {
            expire();
          }
        }
        return { ...response, stream: stream() };
      }
    }
    const model = new LateCompletionModel([{ text: responseText }], {
      countText: text => {
        if (phase === "accounting" && text === responseText) {
          expire();
        }
        return text.length;
      },
    });
    const prepared = await coordinator.prepareTurn({});
    const growthModel = createGrowthModel(asModel(model), coordinator, {
      caps: { ...GROWTH_TURN_CAPS, deadlineMs: 100 },
      now: () => now,
    });

    await expect(growthModel.request(
      prepared.instructions,
      prepared.tools,
      controller.signal,
    )).rejects.toMatchObject({ code });
    expect(model.sendCount).toBe(1);
    expect(coordinator.invokeCalls).toEqual([]);
  });

  it("does not execute a confirmed tool after the turn deadline", async () => {
    const snapshot = growthSnapshot({
      runtimeRevision: 4,
      session: {
        status: "briefing",
        mode: undefined,
        workUnit: undefined,
        assistance: undefined,
      },
    });
    const coordinator = new FakeCoordinator(snapshot);
    const model = new FakeModel([
      {
        toolCalls: [
          {
            callId: "call-mode",
            name: nativeToolName("pair_select_mode"),
            input: { mode: "growth" },
          },
        ],
      },
    ]);
    const prepared = await coordinator.prepareTurn({});
    let now = 0;
    const growthModel = createGrowthModel(asModel(model), coordinator, {
      caps: { ...GROWTH_TURN_CAPS, deadlineMs: 100 },
      now: () => now,
      confirmToolAction: () => {
        now = 101;
        return Promise.resolve(true);
      },
    });

    await expect(
      growthModel.request(
        prepared.instructions,
        prepared.tools,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "GROWTH_TIME_CAP" });
    expect(coordinator.grantCalls).toEqual([]);
    expect(coordinator.invokeCalls).toEqual([]);
  });

  it("enforces the input token cap before dispatch", async () => {
    const snapshot = growthSnapshot({ runtimeRevision: 4 });
    const coordinator = new FakeCoordinator(snapshot);
    const model = new FakeModel(
      [{ text: JSON.stringify({ level: 1, kind: "question", text: "ok" }) }],
      { countText: () => GROWTH_TURN_CAPS.maxInputTokens + 1 },
    );
    const prepared = await coordinator.prepareTurn({});
    const growthModel = createGrowthModel(asModel(model), coordinator);

    await expect(
      growthModel.request(
        prepared.instructions,
        prepared.tools,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "GROWTH_INPUT_TOKEN_CAP" });
    expect(model.sendCount).toBe(0);
  });

  it("enforces the output token cap", async () => {
    const snapshot = growthSnapshot({ runtimeRevision: 4 });
    const coordinator = new FakeCoordinator(snapshot);
    const big = JSON.stringify({ level: 1, kind: "question", text: "ok" });
    const model = new FakeModel([{ text: big }], {
      countText: text =>
        text === big ? GROWTH_TURN_CAPS.maxOutputTokens + 1 : text.length,
    });
    const prepared = await coordinator.prepareTurn({});
    const growthModel = createGrowthModel(asModel(model), coordinator);

    await expect(
      growthModel.request(
        prepared.instructions,
        prepared.tools,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "GROWTH_OUTPUT_TOKEN_CAP" });
  });

  it("caps the number of model calls per turn", async () => {
    const snapshot = growthSnapshot({ runtimeRevision: 4 });
    const coordinator = new FakeCoordinator(snapshot);
    const toolTurn: ScriptedTurn = {
      toolCalls: [
        {
          callId: "call-1",
          name: nativeToolName("pair_read_scope"),
          input: {},
        },
      ],
    };
    const model = new FakeModel([toolTurn, toolTurn, toolTurn, toolTurn, toolTurn]);
    const prepared = await coordinator.prepareTurn({});
    const growthModel = createGrowthModel(asModel(model), coordinator);

    await expect(
      growthModel.request(
        prepared.instructions,
        prepared.tools,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "GROWTH_MODEL_CALL_CAP" });
    expect(model.sendCount).toBe(GROWTH_TURN_CAPS.maxModelCalls);
  });

  it("counts serialized tool-call output against the output token cap and skips the tool", async () => {
    const snapshot = growthSnapshot({ runtimeRevision: 4 });
    const coordinator = new FakeCoordinator(snapshot);
    const model = new FakeModel(
      [
        {
          toolCalls: [
            {
              callId: "call-1",
              name: nativeToolName("pair_read_scope"),
              input: { path: "src/retry.ts" },
            },
          ],
        },
        { text: JSON.stringify({ level: 1, kind: "question", text: "ok" }) },
      ],
      {
        countText: text =>
          text.includes("pair") ? GROWTH_TURN_CAPS.maxOutputTokens + 1 : text.length,
      },
    );
    const prepared = await coordinator.prepareTurn({});
    const growthModel = createGrowthModel(asModel(model), coordinator);

    await expect(
      growthModel.request(
        prepared.instructions,
        prepared.tools,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "GROWTH_OUTPUT_TOKEN_CAP" });
    // Over-budget tool call must be rejected without invoking the tool and
    // without a further model dispatch.
    expect(coordinator.invokeCalls).toHaveLength(0);
    expect(model.sendCount).toBe(1);
  });
});

describe("GrowthModel transport failures", () => {
  it("rejects markdown outside the JSON envelope", async () => {
    const snapshot = growthSnapshot({ runtimeRevision: 4 });
    const coordinator = new FakeCoordinator(snapshot);
    const model = new FakeModel([
      { text: "Here is a hint:\n```json\n{\"level\":1,\"kind\":\"hint\",\"text\":\"x\"}\n```" },
    ]);
    const prepared = await coordinator.prepareTurn({});
    const growthModel = createGrowthModel(asModel(model), coordinator);

    await expect(
      growthModel.request(
        prepared.instructions,
        prepared.tools,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "GROWTH_NON_JSON_RESPONSE" });
  });

  it("propagates cancellation without substituting an answer", async () => {
    const snapshot = growthSnapshot({ runtimeRevision: 4 });
    const coordinator = new FakeCoordinator(snapshot);
    const model = new FakeModel([
      { text: JSON.stringify({ level: 1, kind: "question", text: "ok" }) },
    ]);
    const controller = new AbortController();
    controller.abort();
    const prepared = await coordinator.prepareTurn({});
    const growthModel = createGrowthModel(asModel(model), coordinator);

    await expect(
      growthModel.request(prepared.instructions, prepared.tools, controller.signal),
    ).rejects.toBeInstanceOf(GrowthModelFailure);
    expect(model.sendCount).toBe(0);
  });
});
