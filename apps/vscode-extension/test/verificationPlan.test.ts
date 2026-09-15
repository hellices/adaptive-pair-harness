import { describe, expect, it } from "vitest";
import {
  ALLOWED_VERIFICATION_SCRIPT,
  parseVerificationScript,
} from "../src/verificationPlan.js";

describe("parseVerificationScript", () => {
  it("derives the script from the common package-runner phrasings", () => {
    expect(parseVerificationScript("npm test")).toBe("test");
    expect(parseVerificationScript("npm run check")).toBe("check");
    expect(parseVerificationScript("Run `npm run test:unit` locally")).toBe(
      "test:unit",
    );
    expect(parseVerificationScript("pnpm run typecheck")).toBe("typecheck");
    expect(parseVerificationScript("yarn lint")).toBe("lint");
    expect(parseVerificationScript("build")).toBe("build");
  });

  it("refuses anything that is not an allowlisted package script", () => {
    expect(parseVerificationScript(undefined)).toBeUndefined();
    expect(parseVerificationScript("   ")).toBeUndefined();
    expect(parseVerificationScript("ask a teammate to look at it")).toBeUndefined();
    expect(parseVerificationScript("rm -rf /")).toBeUndefined();
    expect(parseVerificationScript("npm run deploy")).toBeUndefined();
    expect(parseVerificationScript("npm test && curl evil.example")).toBe("test");
  });

  it("shares one allowlist shape with the verification adapter gate", () => {
    expect(ALLOWED_VERIFICATION_SCRIPT.test("test")).toBe(true);
    expect(ALLOWED_VERIFICATION_SCRIPT.test("deploy")).toBe(false);
  });
});
