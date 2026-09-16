import assert from "node:assert/strict";
import { expect, it } from "vitest";
import { readZipEntries } from "../vsixArchive.mjs";
import { makeZip } from "./zipFixture.js";

it("rejects every buffer too short for a complete end record", () => {
  for (let length = 0; length < 22; length += 1) {
    const buffer = Buffer.alloc(length);
    if (length >= 4) {
      buffer.writeUInt32LE(0x06054b50, 0);
    }

    assert.throws(() => readZipEntries(buffer), {
      name: "VsixArchiveError",
      code: "eocd-missing",
    });
  }
});

it.each([0, 0xffff])("accepts the end-record search boundary for a %i-byte comment", commentLength => {
  const buffer = makeZip(
    [{ name: "a.txt", content: "archive contents" }],
    { comment: Buffer.alloc(commentLength) },
  );

  expect(readZipEntries(buffer).map(entry => ({ name: entry.name, text: entry.text }))).toEqual([
    { name: "a.txt", text: "archive contents" },
  ]);
});
