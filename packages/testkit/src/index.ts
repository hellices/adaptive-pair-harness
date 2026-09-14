export class FakeClock {
  public constructor(private current = 0) {}

  public now(): number {
    return this.current;
  }

  public advanceBy(milliseconds: number): void {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
      throw new Error("FakeClock requires a non-negative safe integer.");
    }
    this.current += milliseconds;
  }
}

export class FakeIdSource {
  private value = 0;

  public next(prefix: string): string {
    this.value += 1;
    return `${prefix}-${this.value}`;
  }
}

export * from "./fakes.js";
