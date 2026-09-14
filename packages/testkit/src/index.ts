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

export * from "./fakes.js";
