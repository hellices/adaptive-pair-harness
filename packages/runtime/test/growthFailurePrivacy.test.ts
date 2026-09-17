import { compileInstructions, toolsFor } from "@adaptive-pair/harness";
import { decide } from "@adaptive-pair/session-core";
import { growthRuntime } from "@adaptive-pair/testkit";
import { describe, expect, it, vi } from "vitest";
import {
  GrowthModelFailure,
  growthFailureReason,
  runGuardedGrowthTurn,
  type GrowthModel,
  type GrowthModelFailureCode,
  type GrowthTurnCoordinator,
} from "../src/index.js";

const privateText = "private repository/provider/tokenizer detail: token-secret-sentinel";
const unknownReason = "GROWTH_UNKNOWN_ERROR";
const modelCodes = [
  "GROWTH_MODEL_CALL_CAP", "GROWTH_INPUT_TOKEN_CAP", "GROWTH_OUTPUT_TOKEN_CAP",
  "GROWTH_TIME_CAP", "GROWTH_NON_JSON_RESPONSE", "GROWTH_INVALID_ENVELOPE",
  "GROWTH_EMPTY_RESPONSE", "GROWTH_MODEL_ERROR", "GROWTH_TOOL_TRANSLATION_FAILED",
  "GROWTH_DIRECT_USER_ACTION_REQUIRED", "GROWTH_UNSUPPORTED_MODE",
  "GROWTH_REPREPARE_REQUIRED", "GROWTH_TOOL_RESULT_TOO_LARGE", "GROWTH_STALE_TURN",
  "GROWTH_CANCELLED",
] as const satisfies readonly GrowthModelFailureCode[];

const turn = () => {
  const before = growthRuntime({ runtimeRevision: 4, session: { authorityEpoch: 2 } });
  const coordinator = {
    snapshot: vi.fn<GrowthTurnCoordinator["snapshot"]>().mockResolvedValue(before),
    prepareTurn: vi.fn<GrowthTurnCoordinator["prepareTurn"]>().mockResolvedValue({
      instructions: compileInstructions({ snapshot: before }),
      tools: toolsFor(before),
    }),
  };
  const request = vi.fn<GrowthModel["request"]>().mockResolvedValue({
    level: 1, kind: "question", text: "What have you tried?",
  });
  const createModel = vi.fn((): GrowthModel => ({ request }));
  return {
    before, coordinator, request, createModel,
    input: { coordinator, createModel, signal: new AbortController().signal },
  };
};

describe("Growth failure reason serialization", () => {
  it.each([
    new Error(privateText),
    new SyntaxError(`Invalid JSON: ${privateText}`),
    new Error(privateText.repeat(100)),
    new Error(`HINT_REQUIRES_ATTEMPT: ${privateText}`),
    new Error("MODEL_UNAVAILABLE"),
  ])("never returns an arbitrary error message (%#)", error => {
    expect(growthFailureReason(error)).toBe(unknownReason);
  });

  it.each([undefined, null, "untyped private detail", new Error("")])(
    "keeps unknown non-coded failures bounded (%#)", error => {
      expect(growthFailureReason(error)).toBe(unknownReason);
    },
  );

  it.each(modelCodes)("preserves typed %s without inspecting its private message", code => {
    const error = new GrowthModelFailure(code, privateText);
    Object.defineProperty(error, "message", { get: () => { throw new Error(privateText); } });
    expect(growthFailureReason(error)).toBe(code);
  });

  it.each([privateText, undefined, null, 100, { privateText }])(
    "does not trust a malformed model failure code (%#)", value => {
      const error = new GrowthModelFailure("GROWTH_MODEL_ERROR", privateText);
      Object.defineProperty(error, "code", { value });
      expect(growthFailureReason(error)).toBe(unknownReason);
    },
  );

  it.each(["message", "code"] as const)("contains failures while reading %s", property => {
    const error = property === "code" ? new GrowthModelFailure("GROWTH_MODEL_ERROR") : new Error();
    Object.defineProperty(error, property, { get: () => { throw new Error(privateText); } });
    expect(growthFailureReason(error)).toBe(unknownReason);
  });

  it("contains failures while inspecting an opaque error prototype", () => {
    const error = new Proxy({}, { getPrototypeOf: () => { throw new Error(privateText); } });
    expect(growthFailureReason(error)).toBe(unknownReason);
  });

  it.each([
    "HINT_REQUIRES_ATTEMPT", "HINT_REQUIRES_REVEAL", "HINT_EXCEEDS_AGREEMENT",
    "WORK_UNIT_NOT_AGREED", "STALE_REVISION", "SESSION_RECONCILING",
    "SOLUTION_REVEAL_PREVIEW_ONLY", "USER_ACTION_REQUIRED",
    "STALE_TOOL_VIEW", "TOOL_HIDDEN", "WRONG_OWNER", "UNSUPPORTED_TOOL_CATALOG_VERSION",
    "INVALID_REQUEST_HINT_INPUT", "NON_CONTIGUOUS_REVISION",
  ])("retains the recognized core/runtime reason %s", code => {
    expect(growthFailureReason(new Error(code))).toBe(code);
  });

  it.each([2, 5] as const)("retains the actual core rejection for hint level %s", level => {
    const before = growthRuntime({ runtimeRevision: 4 });
    const session = before.session!;
    const snapshot = {
      ...before,
      session: {
        ...session,
        learningAgreement: { ...session.learningAgreement!, maximumHintLevel: 5 as const },
        assistance: {
          attempt: level === 2 ? undefined : { summary: "Attempted the task", bypassed: false, recordedAt: 1 },
          hypothesis: undefined, hint: undefined, solutionReveal: undefined,
        },
      },
    };
    let failure: unknown;
    try {
      decide(snapshot, {
        protocolVersion: 1, commandId: "privacy-core-control", expectedRevision: snapshot.revision,
        actor: "human", observedAt: 100, type: "RequestHint", workUnitId: session.workUnit!.id, level,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(growthFailureReason(failure)).toBe(level === 2 ? "HINT_REQUIRES_ATTEMPT" : "HINT_REQUIRES_REVEAL");
  });
});

describe("Guarded Growth turn unknown-error boundaries", () => {
  it.each(["snapshot", "prepare", "factory", "request-sync", "request-async", "final-snapshot", "validation"] as const)(
    "returns a stable non-raw failure at %s", async stage => {
      const current = turn();
      const failure = new Error(privateText);
      if (stage === "snapshot") current.coordinator.snapshot.mockRejectedValue(failure);
      if (stage === "prepare") current.coordinator.prepareTurn.mockRejectedValue(failure);
      if (stage === "factory") current.createModel.mockImplementation(() => { throw failure; });
      if (stage === "request-sync") current.request.mockImplementation(() => { throw failure; });
      if (stage === "request-async") current.request.mockRejectedValue(failure);
      if (stage === "final-snapshot") {
        current.coordinator.snapshot.mockResolvedValueOnce(current.before).mockRejectedValue(failure);
      }
      const validate = vi.fn((): string | undefined => {
        if (stage === "validation") throw failure;
        return undefined;
      });
      const result = await runGuardedGrowthTurn({ ...current.input, validate });
      expect(result).toEqual({ status: "failed", reason: unknownReason });
      expect(JSON.stringify(result)).not.toContain(privateText);
      if (["snapshot", "prepare", "factory"].includes(stage)) expect(current.request).not.toHaveBeenCalled();
      if (stage !== "validation") expect(validate).not.toHaveBeenCalled();
    },
  );
});
