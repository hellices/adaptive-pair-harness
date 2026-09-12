export interface TokenBudgetConfig {
  readonly windowMs: number;
  readonly maxCalls: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxOutputTokensPerCall: number;
}

interface Reservation {
  readonly id: number;
  readonly timestamp: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly state: "pending" | "settled";
}

export type TokenBudgetReservationId = number;

export type BudgetDecision =
  | {
      readonly allowed: true;
      readonly reservationId: TokenBudgetReservationId;
      readonly maxOutputTokens: number;
      readonly remainingCalls: number;
      readonly remainingInputTokens: number;
      readonly remainingOutputTokens: number;
    }
  | {
      readonly allowed: false;
      readonly reason:
        | "call-limit"
        | "input-token-limit"
        | "output-token-limit";
      readonly retryAfterMs: number;
    };

export interface BudgetSnapshot {
  readonly remainingCalls: number;
  readonly remainingInputTokens: number;
  readonly remainingOutputTokens: number;
}

export class TokenBudget {
  private reservations: Reservation[] = [];
  private nextReservationId = 1;

  public constructor(private config: TokenBudgetConfig) {}

  public reconfigure(config: TokenBudgetConfig): void {
    this.config = config;
  }

  public outputTokenLimit(now: number): number {
    this.purgeExpired(now);
    return Math.max(
      0,
      Math.min(
        this.config.maxOutputTokensPerCall,
        this.config.maxOutputTokens - this.currentOutputTokens(),
      ),
    );
  }

  public tryReserve(
    inputTokens: number,
    outputTokens: number,
    now: number,
  ): BudgetDecision {
    this.purgeExpired(now);

    const normalizedInputTokens = normalizeTokenCount(inputTokens);
    const normalizedOutputTokens = normalizeTokenCount(outputTokens);
    const currentInputTokens = this.currentInputTokens();
    const currentOutputTokens = this.currentOutputTokens();
    const callLimitExceeded =
      this.reservations.length >= this.config.maxCalls;
    const inputLimitExceeded =
      currentInputTokens + normalizedInputTokens >
      this.config.maxInputTokens;
    const outputLimitExceeded =
      normalizedOutputTokens === 0 ||
      normalizedOutputTokens > this.config.maxOutputTokensPerCall ||
      currentOutputTokens + normalizedOutputTokens >
        this.config.maxOutputTokens;

    if (
      !callLimitExceeded &&
      !inputLimitExceeded &&
      !outputLimitExceeded
    ) {
      const reservationId = this.nextReservationId++;
      this.reservations.push({
        id: reservationId,
        timestamp: now,
        inputTokens: normalizedInputTokens,
        outputTokens: normalizedOutputTokens,
        state: "pending",
      });
      this.reservations.sort(
        (left, right) => left.timestamp - right.timestamp,
      );

      return {
        allowed: true,
        reservationId,
        maxOutputTokens: normalizedOutputTokens,
        remainingCalls: this.config.maxCalls - this.reservations.length,
        remainingInputTokens:
          this.config.maxInputTokens -
          (currentInputTokens + normalizedInputTokens),
        remainingOutputTokens:
          this.config.maxOutputTokens -
          (currentOutputTokens + normalizedOutputTokens),
      };
    }

    const relevantRetryTimes = [
      callLimitExceeded ? this.retryAfterForNextExpiry(now) : 0,
      inputLimitExceeded
        ? this.retryAfterForTokenCapacity(
            now,
            normalizedInputTokens,
            "inputTokens",
            this.config.maxInputTokens,
          )
        : 0,
      outputLimitExceeded
        ? normalizedOutputTokens === 0
          ? this.retryAfterForNextExpiry(now)
          : this.retryAfterForTokenCapacity(
              now,
              normalizedOutputTokens,
              "outputTokens",
              this.config.maxOutputTokens,
            )
        : 0,
    ];
    const reason = callLimitExceeded
      ? "call-limit"
      : inputLimitExceeded
        ? "input-token-limit"
        : "output-token-limit";

    return {
      allowed: false,
      reason,
      retryAfterMs: Math.max(...relevantRetryTimes),
    };
  }

  public settle(
    reservationId: TokenBudgetReservationId,
    inputTokens: number,
    outputTokens: number,
  ): boolean {
    const index = this.reservations.findIndex(
      (reservation) =>
        reservation.id === reservationId && reservation.state === "pending",
    );
    const reservation = this.reservations[index];
    if (reservation === undefined) {
      return false;
    }

    this.reservations[index] = {
      ...reservation,
      inputTokens: Math.max(
        reservation.inputTokens,
        normalizeTokenCount(inputTokens),
      ),
      outputTokens: normalizeTokenCount(outputTokens),
      state: "settled",
    };
    return true;
  }

  public release(reservationId: TokenBudgetReservationId): boolean {
    const index = this.reservations.findIndex(
      (reservation) =>
        reservation.id === reservationId && reservation.state === "pending",
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
      remainingCalls: Math.max(
        0,
        this.config.maxCalls - this.reservations.length,
      ),
      remainingInputTokens: Math.max(
        0,
        this.config.maxInputTokens - this.currentInputTokens(),
      ),
      remainingOutputTokens: Math.max(
        0,
        this.config.maxOutputTokens - this.currentOutputTokens(),
      ),
    };
  }

  private purgeExpired(now: number): void {
    const expiryThreshold = now - this.config.windowMs;
    this.reservations = this.reservations.filter(
      (reservation) => reservation.timestamp > expiryThreshold,
    );
  }

  private currentInputTokens(): number {
    return this.reservations.reduce(
      (total, reservation) => total + reservation.inputTokens,
      0,
    );
  }

  private currentOutputTokens(): number {
    return this.reservations.reduce(
      (total, reservation) => total + reservation.outputTokens,
      0,
    );
  }

  private retryAfterForNextExpiry(now: number): number {
    const oldest = this.reservations[0];
    if (oldest === undefined) {
      return 0;
    }

    return Math.max(0, oldest.timestamp + this.config.windowMs - now);
  }

  private retryAfterForTokenCapacity(
    now: number,
    requestedTokens: number,
    field: "inputTokens" | "outputTokens",
    maximum: number,
  ): number {
    const currentTokens = this.reservations.reduce(
      (total, reservation) => total + reservation[field],
      0,
    );
    const requiredRelease = currentTokens + requestedTokens - maximum;

    let released = 0;
    for (const reservation of this.reservations) {
      released += reservation[field];
      if (released >= requiredRelease) {
        return Math.max(
          0,
          reservation.timestamp + this.config.windowMs - now,
        );
      }
    }

    return this.retryAfterForNextExpiry(now);
  }
}

const normalizeTokenCount = (tokens: number): number =>
  Number.isFinite(tokens) ? Math.max(0, Math.ceil(tokens)) : Number.MAX_SAFE_INTEGER;
