import { describe, expect, it } from "vitest";
import { TokenBudget } from "../src/core/tokenBudget";

describe("TokenBudget", () => {
  it("rejects calls after either call or token capacity is exhausted", () => {
    const budget = new TokenBudget({
      windowMs: 60_000,
      maxCalls: 2,
      maxInputTokens: 100,
      maxOutputTokens: 100,
      maxOutputTokensPerCall: 25,
    });

    expect(budget.tryReserve(40, 25, 0).allowed).toBe(true);
    expect(budget.tryReserve(40, 25, 1).allowed).toBe(true);
    expect(budget.tryReserve(1, 1, 2)).toMatchObject({
      allowed: false,
      reason: "call-limit",
    });
    expect(budget.tryReserve(90, 10, 60_001).allowed).toBe(true);
  });

  it("rejects reservations that exceed the token limit", () => {
    const budget = new TokenBudget({
      windowMs: 1_000,
      maxCalls: 10,
      maxInputTokens: 50,
      maxOutputTokens: 100,
      maxOutputTokensPerCall: 25,
    });

    expect(budget.tryReserve(30, 10, 0).allowed).toBe(true);
    expect(budget.tryReserve(21, 10, 1)).toMatchObject({
      allowed: false,
      reason: "input-token-limit",
    });
  });

  it.each([
    ["input", 51, 1, "input-request-too-large"],
    ["per-call output", 1, 26, "output-request-too-large"],
    ["window output", 1, 21, "output-request-too-large"],
  ] as const)(
    "rejects impossible %s reservations without a retry delay",
    (_label, inputTokens, outputTokens, reason) => {
      const budget = new TokenBudget({
        windowMs: 1_000,
        maxCalls: 10,
        maxInputTokens: 50,
        maxOutputTokens: 20,
        maxOutputTokensPerCall: 25,
      });

      const decision = budget.tryReserve(inputTokens, outputTokens, 0);

      expect(decision).toEqual({
        allowed: false,
        retryable: false,
        reason,
      });
      expect("retryAfterMs" in decision).toBe(false);
    },
  );

  it("accepts requests exactly at every immutable token boundary", () => {
    const budget = new TokenBudget({
      windowMs: 1_000,
      maxCalls: 1,
      maxInputTokens: 50,
      maxOutputTokens: 25,
      maxOutputTokensPerCall: 25,
    });

    expect(budget.tryReserve(50, 25, 0)).toMatchObject({
      allowed: true,
      remainingInputTokens: 0,
      remainingOutputTokens: 0,
    });
  });

  it("rejects an empty output reservation as non-retryable", () => {
    const budget = new TokenBudget({
      windowMs: 1_000,
      maxCalls: 1,
      maxInputTokens: 50,
      maxOutputTokens: 25,
      maxOutputTokensPerCall: 25,
    });

    const decision = budget.tryReserve(0, 0, 0);

    expect(decision).toEqual({
      allowed: false,
      retryable: false,
      reason: "empty-output-reservation",
    });
    expect("retryAfterMs" in decision).toBe(false);
  });

  it.each([
    ["input", 40, 10, 11, 1, "input-token-limit"],
    ["output", 10, 20, 1, 11, "output-token-limit"],
  ] as const)(
    "keeps a retry delay when occupied %s capacity will expire",
    (
      _label,
      reservedInput,
      reservedOutput,
      requestedInput,
      requestedOutput,
      reason,
    ) => {
      const budget = new TokenBudget({
        windowMs: 1_000,
        maxCalls: 10,
        maxInputTokens: 50,
        maxOutputTokens: 30,
        maxOutputTokensPerCall: 20,
      });
      expect(
        budget.tryReserve(reservedInput, reservedOutput, 100).allowed,
      ).toBe(true);

      expect(
        budget.tryReserve(requestedInput, requestedOutput, 200),
      ).toEqual({
        allowed: false,
        retryable: true,
        reason,
        retryAfterMs: 900,
      });
    },
  );

  it("expires reservations exactly at the window boundary", () => {
    const budget = new TokenBudget({
      windowMs: 10,
      maxCalls: 1,
      maxInputTokens: 5,
      maxOutputTokens: 5,
      maxOutputTokensPerCall: 5,
    });

    expect(budget.tryReserve(5, 5, 0).allowed).toBe(true);
    expect(budget.tryReserve(5, 5, 9)).toMatchObject({
      allowed: false,
      reason: "call-limit",
    });
    expect(budget.tryReserve(5, 5, 10).allowed).toBe(true);
  });

  it("waits for both call and token capacity when both are exhausted", () => {
    const budget = new TokenBudget({
      windowMs: 1_000,
      maxCalls: 2,
      maxInputTokens: 100,
      maxOutputTokens: 100,
      maxOutputTokensPerCall: 50,
    });

    expect(budget.tryReserve(10, 10, 0).allowed).toBe(true);
    expect(budget.tryReserve(90, 40, 900).allowed).toBe(true);
    expect(budget.tryReserve(50, 50, 900)).toMatchObject({
      allowed: false,
      reason: "call-limit",
      retryAfterMs: 1_000,
    });
  });

  it("returns a fresh snapshot after expired reservations are purged", () => {
    const budget = new TokenBudget({
      windowMs: 1_000,
      maxCalls: 2,
      maxInputTokens: 100,
      maxOutputTokens: 100,
      maxOutputTokensPerCall: 50,
    });

    expect(budget.tryReserve(70, 30, 0)).toMatchObject({
      allowed: true,
      remainingCalls: 1,
      remainingInputTokens: 30,
      remainingOutputTokens: 70,
    });
    const snapshot = (
      budget as TokenBudget & {
        snapshot(now: number): {
          readonly remainingCalls: number;
          readonly remainingInputTokens: number;
          readonly remainingOutputTokens: number;
        };
      }
    ).snapshot;
    expect(snapshot).toBeTypeOf("function");
    expect(snapshot.call(budget, 1_000)).toEqual({
      remainingCalls: 2,
      remainingInputTokens: 100,
      remainingOutputTokens: 100,
    });
  });

  it("releases only the exact unused reservation", () => {
    const budget = new TokenBudget({
      windowMs: 1_000,
      maxCalls: 2,
      maxInputTokens: 100,
      maxOutputTokens: 100,
      maxOutputTokensPerCall: 50,
    });
    const first = budget.tryReserve(40, 20, 0);
    const second = budget.tryReserve(40, 20, 0);
    if (!first.allowed || !second.allowed) {
      throw new Error("Expected both reservations to be admitted.");
    }

    expect(budget.release(first.reservationId)).toBe(true);
    expect(budget.release(first.reservationId)).toBe(false);
    expect(budget.snapshot(1)).toEqual({
      remainingCalls: 1,
      remainingInputTokens: 60,
      remainingOutputTokens: 80,
    });
    expect(budget.tryReserve(60, 20, 1).allowed).toBe(true);
    expect(budget.tryReserve(1, 1, 1)).toMatchObject({
      allowed: false,
      reason: "call-limit",
    });
  });

  it("reserves output capacity and settles exact usage once", () => {
    const budget = new TokenBudget({
      windowMs: 1_000,
      maxCalls: 3,
      maxInputTokens: 100,
      maxOutputTokens: 50,
      maxOutputTokensPerCall: 30,
    });
    const reservation = budget.tryReserve(10, 30, 0);
    if (!reservation.allowed) {
      throw new Error("Expected reservation to be admitted.");
    }

    expect(budget.outputTokenLimit(1)).toBe(20);
    expect(
      budget.tryReserve(10, 21, 1),
    ).toMatchObject({
      allowed: false,
      reason: "output-token-limit",
    });
    expect(budget.settle(reservation.reservationId, 10, 5)).toBe(true);
    expect(budget.settle(reservation.reservationId, 10, 1)).toBe(false);
    expect(budget.release(reservation.reservationId)).toBe(false);
    expect(budget.snapshot(1)).toEqual({
      remainingCalls: 2,
      remainingInputTokens: 90,
      remainingOutputTokens: 45,
    });
  });

  it("preserves reservations when limits are reconfigured", () => {
    const budget = new TokenBudget({
      windowMs: 1_000,
      maxCalls: 2,
      maxInputTokens: 100,
      maxOutputTokens: 50,
      maxOutputTokensPerCall: 25,
    });
    expect(budget.tryReserve(40, 20, 0).allowed).toBe(true);

    budget.reconfigure({
      windowMs: 2_000,
      maxCalls: 3,
      maxInputTokens: 120,
      maxOutputTokens: 60,
      maxOutputTokensPerCall: 30,
    });

    expect(budget.snapshot(1)).toEqual({
      remainingCalls: 2,
      remainingInputTokens: 80,
      remainingOutputTokens: 40,
    });
  });
});
