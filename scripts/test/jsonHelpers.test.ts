import { describe, expect, it } from "vitest";
import { parseJsonObject, stringArrayField, stringField } from "../json.mjs";

describe("parseJsonObject", () => {
  it("returns the parsed object", () => {
    expect(parseJsonObject('{"a":1}', "fixture")).toEqual({ a: 1 });
  });

  it("names the source when the payload is invalid or not an object", () => {
    expect(() => parseJsonObject("{", "the manifest")).toThrow(/the manifest is not valid JSON/u);
    expect(() => parseJsonObject("[]", "the manifest")).toThrow(/the manifest is not a JSON object/u);
    expect(() => parseJsonObject("null", "the manifest")).toThrow(/not a JSON object/u);
  });
});

describe("field readers", () => {
  it("reads only well-typed fields", () => {
    const value = { name: "adaptive-pair", version: 2, sources: ["a", 1, "b"] };

    expect(stringField(value, "name")).toBe("adaptive-pair");
    expect(stringField(value, "version")).toBeUndefined();
    expect(stringField(value, "missing")).toBeUndefined();
    expect(stringArrayField(value, "sources")).toEqual(["a", "b"]);
    expect(stringArrayField(value, "missing")).toEqual([]);
  });
});
