import { compileInstructions, toolsFor } from "@adaptive-pair/harness";
import { decide } from "@adaptive-pair/session-core";
import { growthRuntime } from "@adaptive-pair/testkit";
import { describe, expect, it, vi } from "vitest";
import {
  GrowthModelFailure,
  growthFailureReason,
  runGuardedGrowthTurn,
  type GrowthModel,
  type GrowthTurnCoordinator,
} from "../src/index.js";

const privateText = "private repository/provider/tokenizer detail: token-secret-sentinel";
const unknownReason = "GROWTH_UNKNOWN_ERROR";

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
    new Error(`HINT_REQUIRES_ATTEMPT: ${privateText}`),
    privateText,
  ])("never returns an arbitrary error message (%#)", error => {
    expect(growthFailureReason(error)).toBe(unknownReason);
  });

  it("preserves a typed model failure code without inspecting its private message", () => {
    const error = new GrowthModelFailure("GROWTH_MODEL_ERROR", privateText);
    Object.defineProperty(error, "message", { get: () => { throw new Error(privateText); } });
    expect(growthFailureReason(error)).toBe("GROWTH_MODEL_ERROR");
  });

  it.each([privateText, 100])(
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

  it.each(["HINT_REQUIRES_ATTEMPT", "TOOL_HIDDEN"])("retains the recognized core/runtime reason %s", code => {
    expect(growthFailureReason(new Error(code))).toBe(code);
  });

  it("retains the actual core rejection message", () => {
    const before = growthRuntime({ runtimeRevision: 4 });
    const session = before.session!;
    const snapshot = {
      ...before,
      session: {
        ...session,
        learningAgreement: { ...session.learningAgreement!, maximumHintLevel: 5 as const },
        assistance: {
          attempt: { summary: "Attempted the task", bypassed: false, recordedAt: 1 },
          hypothesis: undefined, hint: undefined, solutionReveal: undefined,
        },
      },
    };
    let failure: unknown;
    try {
      decide(snapshot, {
        protocolVersion: 1, commandId: "privacy-core-control", expectedRevision: snapshot.revision,
        actor: "human", observedAt: 100, type: "RequestHint", workUnitId: session.workUnit!.id, level: 5,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(growthFailureReason(failure)).toBe("HINT_REQUIRES_REVEAL");
  });
});

describe("Guarded Growth turn unknown-error boundaries", () => {
  it.each(["snapshot", "request-async", "final-snapshot", "validation"] as const)(
    "returns a stable non-raw failure at %s", async stage => {
      const current = turn();
      const failure = new Error(privateText);
      if (stage === "snapshot") current.coordinator.snapshot.mockRejectedValue(failure);
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
      if (stage === "snapshot") expect(current.request).not.toHaveBeenCalled();
      if (stage !== "validation") expect(validate).not.toHaveBeenCalled();
    },
  );
});
