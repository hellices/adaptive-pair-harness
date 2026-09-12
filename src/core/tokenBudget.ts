export interface TokenBudgetConfig {
  readonly windowMs: number;
  readonly maxCalls: number;
  readonly maxInputTokens: number;
}

interface Reservation {
  readonly id: number;
  readonly timestamp: number;
  readonly inputTokens: number;
}

export type TokenBudgetReservationId = number;

export type BudgetDecision =
  | {
      readonly allowed: true;
      readonly reservationId: TokenBudgetReservationId;
      readonly remainingCalls: number;
      readonly remainingInputTokens: number;
    }
  | {
      readonly allowed: false;
      readonly reason: "call-limit" | "token-limit";
      readonly retryAfterMs: number;
    };

export interface BudgetSnapshot {
  readonly remainingCalls: number;
  readonly remainingInputTokens: number;
}

export class TokenBudget {
  private reservations: Reservation[] = [];
  private nextReservationId = 1;

  public constructor(private readonly config: TokenBudgetConfig) {}

  public tryReserve(inputTokens: number, now: number): BudgetDecision {
    this.purgeExpired(now);

    const currentTokens = this.currentInputTokens();
    const callLimitExceeded = this.reservations.length >= this.config.maxCalls;
    const tokenLimitExceeded = currentTokens + inputTokens > this.config.maxInputTokens;

    if (!callLimitExceeded && !tokenLimitExceeded) {
      const reservationId = this.nextReservationId++;
      this.reservations.push({
        id: reservationId,
        timestamp: now,
        inputTokens,
      });
      this.reservations.sort((left, right) => left.timestamp - right.timestamp);

      return {
        allowed: true,
        reservationId,
        remainingCalls: this.config.maxCalls - this.reservations.length,
        remainingInputTokens: this.config.maxInputTokens - (currentTokens + inputTokens),
      };
    }

    const callRetryAfter = callLimitExceeded ? this.retryAfterForNextExpiry(now) : 0;
    const tokenRetryAfter = tokenLimitExceeded ? this.retryAfterForTokenCapacity(now, inputTokens) : 0;

    if (callLimitExceeded) {
      return {
        allowed: false,
        reason: "call-limit",
        retryAfterMs: Math.max(callRetryAfter, tokenRetryAfter),
      };
    }

    return {
      allowed: false,
      reason: "token-limit",
      retryAfterMs: tokenRetryAfter,
    };
  }

  public release(reservationId: TokenBudgetReservationId): boolean {
    const index = this.reservations.findIndex(
      (reservation) => reservation.id === reservationId,
    );
    if (index < 0) {
      return false;
    }
    this.reservations.splice(index, 1);
    return true;
  }

  public snapshot(now: number): BudgetSnapshot {
    this.purgeExpired(now);
    return {
      remainingCalls: this.config.maxCalls - this.reservations.length,
      remainingInputTokens:
        this.config.maxInputTokens - this.currentInputTokens(),
    };
  }

  private purgeExpired(now: number): void {
    const expiryThreshold = now - this.config.windowMs;
    this.reservations = this.reservations.filter(
      (reservation) => reservation.timestamp > expiryThreshold,
    );
  }

  private currentInputTokens(): number {
    return this.reservations.reduce((total, reservation) => total + reservation.inputTokens, 0);
  }

  private retryAfterForNextExpiry(now: number): number {
    const oldest = this.reservations[0];
    if (oldest === undefined) {
      return 0;
    }

    return Math.max(0, oldest.timestamp + this.config.windowMs - now);
  }

  private retryAfterForTokenCapacity(now: number, inputTokens: number): number {
    const requiredRelease =
      this.currentInputTokens() + inputTokens - this.config.maxInputTokens;

    let released = 0;
    for (const reservation of this.reservations) {
      released += reservation.inputTokens;
      if (released >= requiredRelease) {
        return Math.max(0, reservation.timestamp + this.config.windowMs - now);
      }
    }

    return this.retryAfterForNextExpiry(now);
  }
}
