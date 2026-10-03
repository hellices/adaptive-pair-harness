import { describe, expect, it, vi } from "vitest";
import { compileInstructions, toolsFor } from "@adaptive-pair/harness";
import type { HintLevel, PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import type { GrowthResponse } from "@adaptive-pair/restraint";
import { growthRuntime } from "@adaptive-pair/testkit";
import {
  GrowthModelFailure,
  requestGuardedGrowthTurn,
  finishGuardedGrowthTurn,
  runGuardedGrowthTurn,
  type GrowthModel,
  type GrowthRuntimeBoundary,
  type GrowthTurnCoordinator,
  type PreparedTurn,
} from "../src/index.js";

const question: GrowthResponse = {
  level: 1,
  kind: "question",
  text: "What have you tried so far?",
};

const runtimeBoundary = (snapshot: PairRuntimeSnapshot): GrowthRuntimeBoundary => ({
  runtimeRevision: snapshot.revision,
  authorityEpoch: snapshot.session?.authorityEpoch,
  mode: snapshot.session?.mode,
});

const authorizedRuntime = (
  level: HintLevel,
  maximumHintLevel: HintLevel = 4,
  revealAuthorized = false,
): PairRuntimeSnapshot => growthRuntime({
  runtimeRevision: 4,
  session: {
    authorityEpoch: 2,
    learningAgreement: {
      learningGoals: ["Implement and debug retry state"],
      familiarAreas: [],
      humanOwnedCapabilities: ["implementation", "diagnosis", "repair"],
      delegatableWork: [],
      maximumHintLevel,
      independentCheck: "Implement a varied timeout retry",
    },
    assistance: {
      attempt: { summary: "Tried the transition", bypassed: false, recordedAt: 0 },
      hypothesis: undefined,
      hint: { level, recordedAt: 0 },
      solutionReveal: revealAuthorized
        ? { previewOnly: true, recordedAt: 0 }
        : undefined,
    },
  },
});

const createTurn = (
  before = growthRuntime({ runtimeRevision: 4, session: { authorityEpoch: 2 } }),
) => {
  const prepared: PreparedTurn = {
    instructions: compileInstructions({ snapshot: before }),
    tools: toolsFor(before),
  };
  const coordinator = {
    snapshot: vi.fn<GrowthTurnCoordinator["snapshot"]>().mockResolvedValue(before),
    prepareTurn: vi.fn<GrowthTurnCoordinator["prepareTurn"]>().mockResolvedValue(prepared),
  };
  const model = {
    request: vi.fn<GrowthModel["request"]>().mockResolvedValue(question),
  };
  const createModel = vi.fn((): GrowthModel => model);
  const signal = new AbortController().signal;
  return {
    before,
    prepared,
    coordinator,
    model,
    createModel,
    signal,
    input: { coordinator, createModel, signal },
  };
};

describe("Growth turn request preparation", () => {
  it("preserves the need to reprepare after a committed model tool contract", async () => {
    const turn = createTurn();
    turn.model.request.mockRejectedValue(new GrowthModelFailure("GROWTH_REPREPARE_REQUIRED"));

    await expect(runGuardedGrowthTurn(turn.input)).resolves.toEqual({ status: "reprepare" });
  });

  it("prepares plain request data and dispatches one model request with the same ports", async () => {
    const turn = createTurn();

    await expect(runGuardedGrowthTurn({
      ...turn.input,
      userRequest: "Ask a smaller question",
      repositoryContext: "Consented task context",
    })).resolves.toEqual({ status: "delivered", response: question, runtime: runtimeBoundary(turn.before) });

    expect(turn.coordinator.prepareTurn).toHaveBeenCalledExactlyOnceWith({
      userRequest: "Ask a smaller question",
      repositoryContext: "Consented task context",
    });
    expect(turn.createModel).toHaveBeenCalledExactlyOnceWith();
    expect(turn.model.request).toHaveBeenCalledExactlyOnceWith(
      turn.prepared.instructions,
      turn.prepared.tools,
      turn.signal,
    );
    expect(turn.coordinator.snapshot).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, ""])("omits an absent or empty user request (%s)", async userRequest => {
    const turn = createTurn();

    await runGuardedGrowthTurn({
      ...turn.input,
      ...(userRequest === undefined ? {} : { userRequest }),
    });

    expect(turn.coordinator.prepareTurn).toHaveBeenCalledExactlyOnceWith({});
  });

  it("uses a model-reported runtime boundary and its current hint authority", async () => {
    const turn = createTurn();
    const after = { ...authorizedRuntime(2), revision: 7 };
    const response: GrowthResponse = { level: 2, kind: "hint", text: "Compare the transition order." };
    turn.coordinator.snapshot.mockResolvedValueOnce(turn.before).mockResolvedValueOnce(after);
    turn.model.request.mockResolvedValue({ response, runtime: runtimeBoundary(after) });

    await expect(runGuardedGrowthTurn(turn.input)).resolves.toEqual({
      status: "delivered",
      response,
      runtime: runtimeBoundary(after),
    });
  });

});

describe("Growth turn runtime boundaries", () => {
  it.each([
    { boundary: "instruction/tool revision", instructionRevision: 5, toolRevision: 4, instructionEpoch: 2, toolEpoch: 2 },
    { boundary: "instruction/tool epoch", instructionRevision: 4, toolRevision: 4, instructionEpoch: 2, toolEpoch: 3 },
    { boundary: "before/prepared revision", instructionRevision: 5, toolRevision: 5, instructionEpoch: 2, toolEpoch: 2 },
    { boundary: "before/prepared epoch", instructionRevision: 4, toolRevision: 4, instructionEpoch: 3, toolEpoch: 3 },
  ])("rejects a mismatched $boundary before creating a model", async mismatch => {
    const turn = createTurn();
    turn.coordinator.prepareTurn.mockResolvedValue({
      instructions: {
        ...turn.prepared.instructions,
        runtimeRevision: mismatch.instructionRevision,
        authorityEpoch: mismatch.instructionEpoch,
      },
      tools: {
        ...turn.prepared.tools,
        runtimeRevision: mismatch.toolRevision,
        authorityEpoch: mismatch.toolEpoch,
      },
    });

    await expect(runGuardedGrowthTurn(turn.input)).resolves.toEqual({ status: "stale" });
    expect(turn.createModel).not.toHaveBeenCalled();
    expect(turn.model.request).not.toHaveBeenCalled();
    expect(turn.coordinator.snapshot).toHaveBeenCalledTimes(1);
  });

  it.each([
    { boundary: "revision", after: growthRuntime({ runtimeRevision: 5, session: { authorityEpoch: 2 } }) },
    { boundary: "authority epoch", after: growthRuntime({ runtimeRevision: 4, session: { authorityEpoch: 3 } }) },
    { boundary: "mode", after: growthRuntime({ runtimeRevision: 4, session: { authorityEpoch: 2, mode: "pair" } }) },
    { boundary: "removed session", after: { ...growthRuntime({ runtimeRevision: 4 }), session: undefined } },
  ])("rejects a changed $boundary before validation", async ({ after }) => {
    const turn = createTurn();
    const validate = vi.fn(() => "TRANSFER_NOT_DISTINCT");
    turn.coordinator.snapshot.mockResolvedValueOnce(turn.before).mockResolvedValueOnce(after);

    await expect(runGuardedGrowthTurn({ ...turn.input, validate })).resolves.toEqual({ status: "stale" });
    expect(validate).not.toHaveBeenCalled();
  });
});

describe("Growth turn failure classification", () => {
  it("maps a typed stale model failure to stale, not a generic model failure", async () => {
    const turn = createTurn();
    turn.model.request.mockRejectedValue(new GrowthModelFailure("GROWTH_STALE_TURN"));

    await expect(runGuardedGrowthTurn(turn.input)).resolves.toEqual({ status: "stale" });
    expect(turn.coordinator.snapshot).toHaveBeenCalledTimes(1);
  });

  it("preserves a typed model failure reason without response text", async () => {
    const turn = createTurn();
    turn.model.request.mockRejectedValue(new GrowthModelFailure("GROWTH_MODEL_ERROR", "Private model detail"));

    await expect(runGuardedGrowthTurn(turn.input)).resolves.toEqual({ status: "failed", reason: "GROWTH_MODEL_ERROR" });
    expect(turn.coordinator.snapshot).toHaveBeenCalledTimes(1);
  });

  it("keeps a pre-model create-model failure distinct from an invalid boundary", async () => {
    const turn = createTurn();
    turn.createModel.mockImplementation(() => { throw new GrowthModelFailure("GROWTH_STALE_TURN"); });

    await expect(runGuardedGrowthTurn(turn.input)).resolves.toEqual({
      status: "failed",
      reason: "GROWTH_STALE_TURN",
    });
    expect(turn.model.request).not.toHaveBeenCalled();
  });

});

describe("Growth turn hint and reveal restraint", () => {
  it.each([
    { boundary: "current hint", snapshot: authorizedRuntime(2), response: { level: 3, kind: "hint", text: "A larger hint" }, reason: "HINT_LEVEL_EXCEEDED" },
    { boundary: "explicit reveal", snapshot: authorizedRuntime(5, 5), response: { level: 5, kind: "solution-preview", text: "A solution" }, reason: "TARGET_SOLUTION_WITHHELD" },
  ] satisfies readonly { boundary: string; snapshot: PairRuntimeSnapshot; response: GrowthResponse; reason: string }[])(
    "withholds a response beyond the $boundary boundary before optional validation",
    async ({ snapshot, response, reason }) => {
      const turn = createTurn(snapshot);
      const validate = vi.fn(() => "TRANSFER_NOT_DISTINCT");
      turn.model.request.mockResolvedValue(response);

      await expect(runGuardedGrowthTurn({ ...turn.input, validate })).resolves.toEqual({
        status: "withheld",
        source: "restraint",
        response,
        reason,
        runtime: runtimeBoundary(snapshot),
      });
      expect(validate).not.toHaveBeenCalled();
    },
  );

  it("delivers a level-5 solution only within recorded hint, agreement, and reveal authority", async () => {
    const turn = createTurn(authorizedRuntime(5, 5, true));
    const response: GrowthResponse = {
      level: 5,
      kind: "solution-preview",
      text: "export function retry() { return 1; }",
    };
    turn.model.request.mockResolvedValue(response);

    await expect(runGuardedGrowthTurn(turn.input)).resolves.toEqual({ status: "delivered", response, runtime: runtimeBoundary(turn.before) });
  });

  it.each([
    { target: "allowed path", allowedPaths: ["src/retry.ts"], baseline: {}, text: "export function retry() { return 1; }" },
    { target: "Windows path", allowedPaths: ["src\\retry.ts"], baseline: {}, text: "export function retry() { return 1; }" },
    { target: "baseline path", allowedPaths: [], baseline: { "src/counter.ts": "before" }, text: "export function counter() { return 1; }" },
  ] satisfies readonly { target: string; allowedPaths: readonly string[]; baseline: Readonly<Record<string, string>>; text: string }[])(
    "withholds target implementations derived from a $target",
    async ({ allowedPaths, baseline, text }) => {
      const snapshot = authorizedRuntime(4);
      const workUnit = snapshot.session?.workUnit;
      if (workUnit === undefined) {
        throw new Error("Expected a Growth work unit");
      }
      const turn = createTurn(growthRuntime({
        runtimeRevision: snapshot.revision,
        session: { ...snapshot.session, workUnit: { ...workUnit, allowedPaths, baseline } },
      }));
      const response: GrowthResponse = { level: 4, kind: "pseudocode", text };
      turn.model.request.mockResolvedValue(response);

      await expect(runGuardedGrowthTurn(turn.input)).resolves.toEqual({
        status: "withheld",
        source: "restraint",
        response,
        reason: "TARGET_SOLUTION_WITHHELD",
        runtime: runtimeBoundary(turn.before),
      });
    },
  );

  it("delivers an in-boundary analogy unrelated to target identifiers", async () => {
    const turn = createTurn(authorizedRuntime(4));
    const response: GrowthResponse = {
      level: 4,
      kind: "analogy",
      text: "function exampleTransition() { return 1; }",
    };
    turn.model.request.mockResolvedValue(response);

    await expect(runGuardedGrowthTurn(turn.input)).resolves.toEqual({ status: "delivered", response, runtime: runtimeBoundary(turn.before) });
  });
});

describe("Growth turn optional validation", () => {
  it.each(["TRANSFER_NOT_DISTINCT", ""])("distinguishes optional validation withholding (%s)", async reason => {
    const turn = createTurn();
    const validate = vi.fn(() => reason);

    await expect(runGuardedGrowthTurn({ ...turn.input, validate })).resolves.toEqual({
      status: "withheld",
      source: "validation",
      response: question,
      reason,
      runtime: runtimeBoundary(turn.before),
    });
    expect(validate).toHaveBeenCalledExactlyOnceWith(question);
  });

  it("validates the immutable guarded response before returning it for delivery", async () => {
    const turn = createTurn();
    const validate = vi.fn((response: GrowthResponse): string | undefined => {
      expect(Object.isFrozen(response)).toBe(true);
      return undefined;
    });

    const result = await runGuardedGrowthTurn({ ...turn.input, validate });

    expect(result).toEqual({ status: "delivered", response: question, runtime: runtimeBoundary(turn.before) });
    expect(validate).toHaveBeenCalledExactlyOnceWith(question);
    if (result.status === "delivered") {
      expect(result.response).toBe(validate.mock.calls[0]?.[0]);
      expect(Object.isFrozen(result.runtime)).toBe(true);
    }
  });
});

describe("synchronous Growth turn finalization", () => {
  it("requests the model separately from the final snapshot and synchronous guard", async () => {
    const turn = createTurn();
    const validate = vi.fn(() => undefined);
    const requested = await requestGuardedGrowthTurn({ ...turn.input, validate });

    expect(requested).toEqual({ status: "ready", response: question, runtime: runtimeBoundary(turn.before) });
    expect(turn.coordinator.snapshot).toHaveBeenCalledTimes(1);
    expect(validate).not.toHaveBeenCalled();
    if (requested.status !== "ready") throw new Error("Expected a prepared response");

    const outcome = finishGuardedGrowthTurn(requested, turn.before, validate);

    expect(outcome).not.toBeInstanceOf(Promise);
    expect(outcome).toEqual({ status: "delivered", response: question, runtime: runtimeBoundary(turn.before) });
    expect(validate).toHaveBeenCalledExactlyOnceWith(question);
    expect(turn.coordinator.snapshot).toHaveBeenCalledTimes(1);
  });
});

describe("host-independent Growth model contracts", () => {
  it("retains the typed failure's name, code, and optional message", () => {
    const failure = new GrowthModelFailure("GROWTH_MODEL_ERROR");

    expect(failure).toBeInstanceOf(Error);
    expect(failure.name).toBe("GrowthModelFailure");
    expect(failure.code).toBe("GROWTH_MODEL_ERROR");
    expect(failure.message).toBe("GROWTH_MODEL_ERROR");
    expect(new GrowthModelFailure("GROWTH_MODEL_ERROR", "detail").message).toBe("detail");
  });
});
