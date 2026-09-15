import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../src/index.js";

describe("protocol package", () => {
  it("publishes the initial protocol version", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});
