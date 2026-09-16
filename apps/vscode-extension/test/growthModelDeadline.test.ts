import type { CancellationToken } from "vscode";
import { expect, it } from "vitest";
import {
  asModel,
  createGrowthModel,
  FakeCoordinator,
  FakeModel,
  GROWTH_TURN_CAPS,
  growthSnapshot,
} from "./growthTestHarness.js";

const waitForCancellation = (token: CancellationToken): Promise<void> => {
  if (token.isCancellationRequested) {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const subscription = token.onCancellationRequested(() => {
      subscription.dispose();
      resolve();
    });
  });
};

it.each(["stream", "accounting"])("latches timer cancellation during %s despite clock rollback", async phase => {
  const coordinator = new FakeCoordinator(growthSnapshot({ runtimeRevision: 4 }));
  const controller = new AbortController();
  const responseText = JSON.stringify({ level: 1, kind: "question", text: "bounded hint" });
  let now = 0;
  let modelToken: CancellationToken | undefined;
  class TimerCancelledModel extends FakeModel {
    public override async sendRequest(
      ...args: Parameters<FakeModel["sendRequest"]>
    ): Promise<Awaited<ReturnType<FakeModel["sendRequest"]>>> {
      const response = await super.sendRequest(...args);
      const token = args[2] as CancellationToken;
      modelToken = token;
      now = -1_000;
      async function* stream(): AsyncIterable<unknown> {
        yield* response.stream;
        if (phase === "stream") {
          await waitForCancellation(token);
        }
      }
      return { ...response, stream: stream() };
    }

    public override async countTokens(
      text: Parameters<FakeModel["countTokens"]>[0],
    ): Promise<number> {
      const count = await super.countTokens(text);
      if (phase === "accounting" && text === responseText && modelToken !== undefined) {
        await waitForCancellation(modelToken);
      }
      return count;
    }
  }
  const model = new TimerCancelledModel([{ text: responseText }]);
  const prepared = await coordinator.prepareTurn({});
  const growthModel = createGrowthModel(asModel(model), coordinator, {
    caps: { ...GROWTH_TURN_CAPS, deadlineMs: 20 },
    now: () => now,
  });

  await expect(growthModel.request(
    prepared.instructions,
    prepared.tools,
    controller.signal,
  )).rejects.toMatchObject({ code: "GROWTH_TIME_CAP" });
  expect(controller.signal.aborted).toBe(false);
  expect(modelToken?.isCancellationRequested).toBe(true);
  expect(coordinator.invokeCalls).toEqual([]);
});

it.each([
  { reason: "deadline", code: "GROWTH_TIME_CAP" },
  { reason: "cancellation", code: "GROWTH_CANCELLED" },
])("does not dispatch a model after input accounting crosses $reason", async ({ reason, code }) => {
  const coordinator = new FakeCoordinator(growthSnapshot({ runtimeRevision: 4 }));
  const controller = new AbortController();
  let now = 0;
  const model = new FakeModel([
    { text: JSON.stringify({ level: 1, kind: "question", text: "bounded hint" }) },
  ], {
    countText: text => {
      if (reason === "deadline") {
        now = 100;
      } else {
        controller.abort();
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
  expect(model.sendCount).toBe(0);
  expect(coordinator.invokeCalls).toEqual([]);
});

it.each([
  { phase: "input", reason: "deadline", code: "GROWTH_TIME_CAP" },
  { phase: "input", reason: "cancellation", code: "GROWTH_CANCELLED" },
  { phase: "output", reason: "deadline", code: "GROWTH_TIME_CAP" },
  { phase: "output", reason: "cancellation", code: "GROWTH_CANCELLED" },
])("preserves $reason when $phase accounting rejects cancellation", async ({ phase, reason, code }) => {
  const coordinator = new FakeCoordinator(growthSnapshot({ runtimeRevision: 4 }));
  const controller = new AbortController();
  const responseText = JSON.stringify({ level: 1, kind: "question", text: "bounded hint" });
  let now = 0;
  class RejectingAccountingModel extends FakeModel {
    public override async countTokens(
      text: Parameters<FakeModel["countTokens"]>[0],
      token?: CancellationToken,
    ): Promise<number> {
      if ((phase === "output") === (text === responseText)) {
        if (reason === "deadline") {
          now = -1_000;
          await waitForCancellation(token as CancellationToken);
        } else {
          controller.abort();
        }
        throw new Error("Provider token accounting cancelled");
      }
      return super.countTokens(text);
    }
  }
  const model = new RejectingAccountingModel([{ text: responseText }]);
  const prepared = await coordinator.prepareTurn({});
  const growthModel = createGrowthModel(asModel(model), coordinator, {
    caps: { ...GROWTH_TURN_CAPS, deadlineMs: 20 },
    now: () => now,
  });

  await expect(growthModel.request(
    prepared.instructions,
    prepared.tools,
    controller.signal,
  )).rejects.toMatchObject({ code });
  expect(model.sendCount).toBe(phase === "input" ? 0 : 1);
  expect(coordinator.invokeCalls).toEqual([]);
});
