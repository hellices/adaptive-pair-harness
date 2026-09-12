export interface TokenBudgetConfig {
  readonly windowMs: number;
  readonly maxCalls: number;
  readonly maxInputTokens: number;
}

interface Reservation {
  readonly timestamp: number;
  readonly inputTokens: number;
}

export type BudgetDecision =
  | {
      readonly allowed: true;
      readonly remainingCalls: number;
      readonly remainingInputTokens: number;
    }
  | {
      readonly allowed: false;
      readonly reason: "call-limit" | "token-limit";
      readonly retryAfterMs: number;
    };

export class TokenBudget {
  private reservations: Reservation[] = [];

  public constructor(private readonly config: TokenBudgetConfig) {}

  public tryReserve(inputTokens: number, now: number): BudgetDecision {
    this.purgeExpired(now);

    if (this.reservations.length >= this.config.maxCalls) {
      return {
        allowed: false,
        reason: "call-limit",
        retryAfterMs: this.retryAfterForNextExpiry(now),
      };
    }

    const currentTokens = this.currentInputTokens();
    if (currentTokens + inputTokens > this.config.maxInputTokens) {
      return {
        allowed: false,
        reason: "token-limit",
        retryAfterMs: this.retryAfterForTokenCapacity(now, inputTokens),
      };
    }

    this.reservations.push({ timestamp: now, inputTokens });
    this.reservations.sort((left, right) => left.timestamp - right.timestamp);

    return {
      allowed: true,
      remainingCalls: this.config.maxCalls - this.reservations.length,
      remainingInputTokens: this.config.maxInputTokens - (currentTokens + inputTokens),
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
