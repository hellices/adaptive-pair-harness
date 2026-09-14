import { describe, expect, it } from "vitest";
import {
  REQUIRED_VSIX_ENTRIES,
  VsixArchiveError,
  inspectEntryNames,
  inspectManifest,
  inspectEntryContent,
  readZipEntries,
  verifyVsix,
} from "../verify-vsix.mjs";
import { makeZip, releaseVsixFixture, validManifest } from "./zipFixture.js";

const EOCD_SIGNATURE = 0x06054b50;

/** A comment that embeds a decoy end-of-central-directory signature. */
const decoyComment = (padding: number): Buffer => {
  const comment = Buffer.alloc(22 + padding);
  comment.writeUInt32LE(EOCD_SIGNATURE, 0);
  return comment;
};

/** Report text must never echo raw control bytes from a hostile archive. */
const hasControlCharacters = (text: string): boolean =>
  [...text].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (code < 0x20 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f);
  });

const archiveError = (build: () => unknown): VsixArchiveError => {
  try {
    build();
  } catch (error) {
    expect(error, "the verifier leaked a raw runtime error").toBeInstanceOf(VsixArchiveError);
    return error as VsixArchiveError;
  }
  throw new Error("The archive was accepted, but it should have been rejected.");
};

describe("readZipEntries", () => {
  it("reads deflated and stored entries", () => {
    const archive = makeZip([
      { name: "a.txt", content: "deflated content" },
      { name: "b.txt", content: "stored content", deflate: false },
    ]);

    const entries = readZipEntries(archive);

    expect(entries.map((entry) => entry.name)).toEqual(["a.txt", "b.txt"]);
    expect(entries[0]?.text).toBe("deflated content");
    expect(entries[1]?.text).toBe("stored content");
  });

  it("refuses a buffer that is not a zip archive", () => {
    expect(() => readZipEntries(Buffer.from("not a zip"))).toThrow(/central directory/u);
    expect(archiveError(() => readZipEntries(Buffer.from("not a zip"))).code).toBe("eocd-missing");
  });

  it("ignores a decoy end-of-central-directory signature inside the comment", () => {
    const padded = releaseVsixFixture({}, { comment: decoyComment(8) });
    const exact = releaseVsixFixture({}, { comment: decoyComment(0) });

    expect(readZipEntries(padded)).toHaveLength(REQUIRED_VSIX_ENTRIES.length);
    expect(readZipEntries(exact)).toHaveLength(REQUIRED_VSIX_ENTRIES.length);
  });

  it("rejects an archive whose comment length does not reach the end", () => {
    expect(archiveError(() => readZipEntries(releaseVsixFixture({}, { commentLength: 4 }))).code).toBe(
      "eocd-missing",
    );
  });

  it("rejects a central directory that starts or ends outside the archive", () => {
    expect(
      archiveError(() => readZipEntries(releaseVsixFixture({}, { centralOffset: 0xfffffff0 }))).code,
    ).toBe("central-directory-out-of-bounds");
    expect(
      archiveError(() => readZipEntries(releaseVsixFixture({}, { centralSize: 0xfffffff0 }))).code,
    ).toBe("central-directory-out-of-bounds");
  });

  it("rejects a central directory that does not hold the declared entries", () => {
    expect(archiveError(() => readZipEntries(releaseVsixFixture({}, { entryCount: 64 }))).code).toBe(
      "central-directory-truncated",
    );
    expect(archiveError(() => readZipEntries(releaseVsixFixture({}, { entryCount: 2 }))).code).toBe(
      "central-directory-size-mismatch",
    );
  });

  it("rejects an entry whose local header or data runs past the archive", () => {
    expect(
      archiveError(() => readZipEntries(releaseVsixFixture({}, { firstLocalOffset: 0xfffffff0 })))
        .code,
    ).toBe("entry-header-out-of-bounds");
    expect(
      archiveError(() =>
        readZipEntries(releaseVsixFixture({}, { firstCompressedSize: 0xfffffff0 })),
      ).code,
    ).toBe("entry-data-out-of-bounds");
  });

  it("rejects a truncated archive without leaking a RangeError", () => {
    const archive = releaseVsixFixture();

    const error = archiveError(() => readZipEntries(archive.subarray(0, archive.length - 40)));

    expect(error.name).toBe("VsixArchiveError");
    expect(error).not.toBeInstanceOf(RangeError);
  });
});

describe("inspectEntryNames", () => {
  it("accepts exactly the required entry set", () => {
    expect(inspectEntryNames([...REQUIRED_VSIX_ENTRIES])).toEqual([]);
  });

  it("reports every missing required entry", () => {
    const violations = inspectEntryNames([
      "extension.vsixmanifest",
      "extension/package.json",
    ]);

    expect(violations.join("\n")).toContain("extension/dist/extension.cjs");
    expect(violations.join("\n")).toContain("extension/LICENSE.txt");
    expect(violations.join("\n")).toContain("extension/readme.md");
    expect(violations.join("\n")).toContain("extension/docs/growth-preview.md");
    expect(violations.join("\n")).toContain("[Content_Types].xml");
  });

  it("rejects maps, sources, tests, and host-test files", () => {
    const rejected = [
      "extension/dist/extension.cjs.map",
      "extension/src/extension.ts",
      "extension/test/host/smoke.ts",
      "extension/.host-test/extension.cjs",
      "extension/dist/tsconfig.tsbuildinfo",
    ];

    for (const name of rejected) {
      const violations = inspectEntryNames([...REQUIRED_VSIX_ENTRIES, name]);

      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain(name);
    }
  });

  it("rejects an otherwise harmless entry that is not part of the release set", () => {
    const violations = inspectEntryNames([...REQUIRED_VSIX_ENTRIES, "extension/notes.txt"]);

    expect(violations).toEqual(["Unexpected VSIX entry: extension/notes.txt"]);
  });

  it("rejects duplicate entry names", () => {
    const violations = inspectEntryNames([
      ...REQUIRED_VSIX_ENTRIES,
      "extension/package.json",
    ]);

    expect(violations).toEqual(["Duplicate VSIX entry: extension/package.json"]);
  });

  it("sanitizes hostile entry names in its messages", () => {
    const violations = inspectEntryNames([
      ...REQUIRED_VSIX_ENTRIES,
      "extension/\u0000drop\nnotes.txt",
    ]);

    expect(violations.join("\n")).toContain("Unexpected VSIX entry");
    expect(hasControlCharacters(violations.join("\n"))).toBe(false);
  });
});

describe("inspectManifest", () => {
  it("accepts the shipped Stable manifest", () => {
    expect(inspectManifest(validManifest)).toEqual([]);
  });

  it("rejects proposed APIs, chat sessions, and a wrong main", () => {
    expect(
      inspectManifest({ ...validManifest, enabledApiProposals: ["chatProvider"] }).join("\n"),
    ).toContain("enabledApiProposals");
    expect(
      inspectManifest({
        ...validManifest,
        contributes: { chatSessions: [{ type: "adaptivePair" }] },
      }).join("\n"),
    ).toContain("chatSessions");
    expect(inspectManifest({ ...validManifest, main: "./src/extension.ts" }).join("\n")).toContain(
      "main",
    );
  });
});

describe("inspectEntryContent", () => {
  it("rejects host-test strings and local absolute paths", () => {
    expect(
      inspectEntryContent("extension/dist/extension.cjs", "process.env.ADAPTIVE_PAIR_HOST_TEST")
        .join("\n"),
    ).toContain("ADAPTIVE_PAIR_HOST_TEST");
    expect(
      inspectEntryContent("extension/dist/extension.cjs", "api.__pairHostTest = {}").join("\n"),
    ).toContain("__pairHostTest");
    expect(
      inspectEntryContent("extension/dist/extension.cjs", "/Users/someone/workspace/x").join("\n"),
    ).toContain("/Users/");
    expect(
      inspectEntryContent("extension/dist/extension.cjs", "/home/runner/work/x").join("\n"),
    ).toContain("/home/");
    expect(
      inspectEntryContent("extension/dist/extension.cjs", "C:\\Users\\dev\\x").join("\n"),
    ).toContain("C:\\Users");
    expect(
      inspectEntryContent("extension/dist/extension.cjs", "//# sourceMappingURL=extension.cjs.map")
        .join("\n"),
    ).toContain("sourceMappingURL");
  });

  it("accepts clean bundle content", () => {
    expect(
      inspectEntryContent("extension/dist/extension.cjs", "exports.activate = () => {};"),
    ).toEqual([]);
  });
});

describe("verifyVsix", () => {
  it("accepts a well-formed archive", () => {
    expect(verifyVsix(releaseVsixFixture())).toEqual([]);
  });

  it("accepts a well-formed archive that carries an archive comment", () => {
    expect(verifyVsix(releaseVsixFixture({}, { comment: decoyComment(8) }))).toEqual([]);
  });

  it("fails an archive that leaks a source map", () => {
    const violations = verifyVsix(
      releaseVsixFixture({
        extra: [{ name: "extension/dist/extension.cjs.map", content: "{}" }],
      }),
    );

    expect(violations.join("\n")).toContain("extension/dist/extension.cjs.map");
  });

  it("fails an archive that carries any entry beyond the release set", () => {
    const violations = verifyVsix(
      releaseVsixFixture({ extra: [{ name: "extension/CHANGELOG.md", content: "# notes" }] }),
    );

    expect(violations).toEqual(["Unexpected VSIX entry: extension/CHANGELOG.md"]);
  });

  it("fails an archive that ships the manifest twice", () => {
    const violations = verifyVsix(
      releaseVsixFixture({
        extra: [
          {
            name: "extension/package.json",
            content: JSON.stringify({ ...validManifest, enabledApiProposals: ["chatProvider"] }),
          },
        ],
      }),
    );

    expect(violations.join("\n")).toContain("Duplicate VSIX entry: extension/package.json");
    expect(violations.join("\n")).toContain("enabledApiProposals");
  });

  it("fails an archive whose manifest contributes chat sessions", () => {
    const violations = verifyVsix(
      releaseVsixFixture({
        manifest: { ...validManifest, contributes: { chatSessions: [] } },
      }),
    );

    expect(violations.join("\n")).toContain("chatSessions");
  });

  it("reports a corrupt archive as a violation instead of throwing", () => {
    for (const corrupt of [
      releaseVsixFixture({}, { centralOffset: 0xfffffff0 }),
      releaseVsixFixture({}, { firstCompressedSize: 0xfffffff0 }),
      releaseVsixFixture({}, { commentLength: 3 }),
      releaseVsixFixture().subarray(0, 60),
    ]) {
      const violations = verifyVsix(corrupt);

      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatch(/^Unreadable VSIX archive \(/u);
    }
  });
});
