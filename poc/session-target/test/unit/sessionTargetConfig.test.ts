import { describe, expect, it } from "vitest";
import { SESSION_CAPABILITIES } from "../../src/sessionTargetConfig";

describe("Session Target capabilities", () => {
  it("does not advertise unverified interruption support", () => {
    expect(SESSION_CAPABILITIES).toEqual({
      supportsInterruptions: false,
    });
  });
});
