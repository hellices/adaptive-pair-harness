import { describe, expect, it } from "vitest";
import {
  buildProductionBundle,
  findForbiddenTokens,
  PRODUCTION_FORBIDDEN_TOKENS,
} from "../build-extension.mjs";

describe("production bundle", () => {
  it("contains no host-test entry point, API, or flag", async () => {
    const { code } = await buildProductionBundle({ write: false });

    expect(code.length).toBeGreaterThan(1_000);
    expect(code).toContain("activate");
    expect(findForbiddenTokens(code)).toEqual([]);
    for (const token of PRODUCTION_FORBIDDEN_TOKENS) {
      expect(code).not.toContain(token);
    }
  });

  it("flags any reintroduced host-test token", () => {
    expect(findForbiddenTokens("if (process.env.ADAPTIVE_PAIR_HOST_TEST)")).toEqual([
      "ADAPTIVE_PAIR_HOST_TEST",
    ]);
    expect(findForbiddenTokens("api.__pairHostTest = {}")).toEqual(["__pairHostTest"]);
    expect(findForbiddenTokens("class HostTestAutoConfirmPort {}")).toEqual([
      "HostTestAutoConfirmPort",
    ]);
    expect(findForbiddenTokens("const clean = 1;")).toEqual([]);
  });

  it("emits a bundle with no dangling source map reference", async () => {
    const { code } = await buildProductionBundle({ write: false });

    // `sourcemap: "external"` keeps the map out of the shipped bundle and emits
    // no sourceMappingURL comment that would dangle once the map is excluded.
    expect(code).not.toContain("sourceMappingURL");
  });
});
