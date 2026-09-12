import { describe, expect, it } from "vitest";
import { TokenBudget } from "../src/core/tokenBudget";

describe("TokenBudget", () => {
  it("rejects calls after either call or token capacity is exhausted", () => {
    const budget = new TokenBudget({
      windowMs: 60_000,
      maxCalls: 2,
      maxInputTokens: 100,
    });

    expect(budget.tryReserve(40, 0).allowed).toBe(true);
    expect(budget.tryReserve(40, 1).allowed).toBe(true);
    expect(budget.tryReserve(1, 2)).toMatchObject({
      allowed: false,
      reason: "call-limit",
    });
    expect(budget.tryReserve(90, 60_001).allowed).toBe(true);
  });

  it("rejects reservations that exceed the token limit", () => {
    const budget = new TokenBudget({
      windowMs: 1_000,
      maxCalls: 10,
      maxInputTokens: 50,
    });

    expect(budget.tryReserve(30, 0).allowed).toBe(true);
    expect(budget.tryReserve(21, 1)).toMatchObject({
      allowed: false,
      reason: "token-limit",
    });
  });

  it("expires reservations exactly at the window boundary", () => {
    const budget = new TokenBudget({
      windowMs: 10,
      maxCalls: 1,
      maxInputTokens: 5,
    });

    expect(budget.tryReserve(5, 0).allowed).toBe(true);
    expect(budget.tryReserve(5, 9)).toMatchObject({
      allowed: false,
      reason: "call-limit",
    });
    expect(budget.tryReserve(5, 10).allowed).toBe(true);
  });

  it("waits for both call and token capacity when both are exhausted", () => {
    const budget = new TokenBudget({
      windowMs: 1_000,
      maxCalls: 2,
      maxInputTokens: 100,
    });

    expect(budget.tryReserve(10, 0).allowed).toBe(true);
    expect(budget.tryReserve(90, 900).allowed).toBe(true);
    expect(budget.tryReserve(50, 900)).toMatchObject({
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
    });

    expect(budget.tryReserve(70, 0)).toMatchObject({
      allowed: true,
      remainingCalls: 1,
      remainingInputTokens: 30,
    });
    const snapshot = (
      budget as TokenBudget & {
        snapshot(now: number): {
          readonly remainingCalls: number;
          readonly remainingInputTokens: number;
        };
      }
    ).snapshot;
    expect(snapshot).toBeTypeOf("function");
    expect(snapshot.call(budget, 1_000)).toEqual({
      remainingCalls: 2,
      remainingInputTokens: 100,
    });
  });
});
