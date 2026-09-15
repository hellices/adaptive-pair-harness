import { describe, expect, it, vi } from "vitest";
import {
  REQUIRED_VSIX_ENTRIES,
  VsixArchiveError,
  inspectEntryNames,
  inspectManifest,
  inspectEntryContent,
  readZipEntries,
  verifyVsix,
} from "../verify-vsix.mjs";
import {
  makeZip,
  releaseEntries,
  releaseVsixFixture,
  validManifest,
  withRepeatedEocdCandidates,
  withRepeatedLateFailingEocdCandidates,
} from "./zipFixture.js";

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_LENGTH = 22;
const MAX_ARCHIVE_COMMENT = 0xffff;

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
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
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

  it("reads a genuinely empty archive with a comment", () => {
    expect(readZipEntries(makeZip([], { comment: Buffer.from("release comment") }))).toEqual([]);
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

  it("rejects ambiguous nonempty end records before inflating content", () => {
    const archive = withRepeatedEocdCandidates(
      makeZip(
        [{ name: "extension/dist/extension.cjs", content: "x".repeat(1024 * 1024) }],
        { firstUncompressedSize: 1 },
      ),
      3,
    );
    const centralNameReads = vi.spyOn(archive, "toString");

    expect(archiveError(() => readZipEntries(archive)).code).toBe(
      "eocd-nonempty-ambiguous",
    );
    expect(centralNameReads).toHaveBeenCalledTimes(2);
  });

  it("bounds metadata inspection across repeated late-failing end records", () => {
    const release = releaseVsixFixture();
    const centralSize = release.readUInt32LE(
      release.length - EOCD_LENGTH + 12,
    );
    const archive = withRepeatedLateFailingEocdCandidates(
      release,
      256,
    );
    const centralNameReads = vi.spyOn(archive, "toString");

    expect(archiveError(() => readZipEntries(archive)).code).toBe(
      "eocd-metadata-budget-exceeded",
    );
    expect(centralNameReads.mock.calls.length).toBeLessThanOrEqual(
      (REQUIRED_VSIX_ENTRIES.length - 1) *
        Math.floor(MAX_ARCHIVE_COMMENT / centralSize),
    );
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

  it("rejects multi-disk archive records", () => {
    expect(
      archiveError(() =>
        readZipEntries(
          releaseVsixFixture(
            {},
            { diskNumber: 1, centralDirectoryDisk: 1, entriesOnDisk: 1 },
          ),
        ),
      ).code,
    ).toBe("multi-disk-unsupported");
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

  it("rejects encrypted entries before treating ciphertext as inspected content", () => {
    const entries = releaseEntries().map((entry) =>
      entry.name === "extension/dist/extension.cjs"
        ? { ...entry, deflate: false, flags: 0x0001 }
        : entry,
    );

    expect(archiveError(() => readZipEntries(makeZip(entries))).code).toBe(
      "entry-encrypted",
    );
  });

  it("rejects encryption declared only by the local header", () => {
    const archive = releaseVsixFixture();
    archive.writeUInt16LE(0x0040, 6);

    expect(archiveError(() => readZipEntries(archive)).code).toBe("entry-encrypted");
  });

  it("rejects a compressed entry that expands beyond the release bound", () => {
    const oversized = "x".repeat(16 * 1024 * 1024 + 1);

    expect(
      archiveError(() =>
        readZipEntries(
          makeZip([{ name: "extension/dist/extension.cjs", content: oversized }]),
        ),
      ).code,
    ).toBe("entry-too-large");
  });

  it("bounds inflation even when the central directory lies about output size", () => {
    const oversized = "x".repeat(16 * 1024 * 1024 + 1);

    expect(
      archiveError(() =>
        readZipEntries(
          makeZip(
            [{ name: "extension/dist/extension.cjs", content: oversized }],
            { firstUncompressedSize: 1 },
          ),
        ),
      ).code,
    ).toBe("entry-inflate-failed");
  });

  it("rejects a deflated entry whose inflated size differs from its declaration", () => {
    const archive = makeZip(
      [{ name: "extension/dist/extension.cjs", content: "inflated content" }],
      { firstUncompressedSize: 1 },
    );

    expect(archiveError(() => readZipEntries(archive)).code).toBe(
      "entry-size-mismatch",
    );
  });

  it("rejects an oversized stored entry that lies about its uncompressed size", () => {
    const oversized = "x".repeat(16 * 1024 * 1024 + 1);

    expect(
      archiveError(() =>
        readZipEntries(
          makeZip(
            [
              {
                name: "extension/dist/extension.cjs",
                content: oversized,
                deflate: false,
              },
            ],
            { firstUncompressedSize: 1 },
          ),
        ),
      ).code,
    ).toBe("entry-size-mismatch");
  });

  it("rejects duplicate entries sharing a local offset before inflating them", () => {
    const oversized = "x".repeat(16 * 1024 * 1024 + 1);
    const archive = makeZip(
      [
        { name: "extension/package.json", content: oversized },
        { name: "extension/package.json", content: "{}" },
      ],
      { firstUncompressedSize: 1, lastLocalOffset: 0 },
    );

    expect(archiveError(() => readZipEntries(archive)).code).toBe(
      "entry-offset-duplicate",
    );
  });

  it("rejects excessive aggregate declared output before inflating any entry", () => {
    const archive = makeZip(
      Array.from({ length: REQUIRED_VSIX_ENTRIES.length + 1 }, (_, index) => ({
        name: `extension/entry-${index}.txt`,
        content: "small",
        centralUncompressedSize: 16 * 1024 * 1024,
      })),
    );

    expect(archiveError(() => readZipEntries(archive)).code).toBe(
      "archive-too-large",
    );
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
      "extension/\x00drop\nnotes.txt",
    ]);

    expect(violations).toEqual([
      "Unexpected VSIX entry: extension/\\x00drop\\x0anotes.txt",
    ]);
    expect(hasControlCharacters(violations[0] ?? "")).toBe(false);
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

  it.each([
    [
      "wildcard activation",
      { ...validManifest, activationEvents: ["*"] },
      "activation event",
    ],
    [
      "foreign command",
      {
        ...validManifest,
        contributes: {
          ...validManifest.contributes,
          commands: [{ command: "github.copilot.override" }],
        },
      },
      "command identifier",
    ],
    [
      "foreign language-model tool",
      {
        ...validManifest,
        contributes: {
          ...validManifest.contributes,
          languageModelTools: [{ name: "getState" }],
        },
      },
      "language-model tool identifier",
    ],
    [
      "foreign tool reference",
      {
        ...validManifest,
        contributes: {
          ...validManifest.contributes,
          languageModelTools: [
            {
              name: "adaptive_pair_get_state",
              toolReferenceName: "pairState",
            },
          ],
        },
      },
      "tool reference identifier",
    ],
    [
      "foreign chat participant",
      {
        ...validManifest,
        contributes: {
          ...validManifest.contributes,
          chatParticipants: [{ id: "pair.chat", name: "pair" }],
        },
      },
      "chat participant identifier",
    ],
    [
      "configuration defaults",
      {
        ...validManifest,
        contributes: {
          ...validManifest.contributes,
          configurationDefaults: { "chat.detectParticipant.enabled": false },
        },
      },
      "configurationDefaults",
    ],
  ])("rejects %s", (_label, manifest, expected) => {
    expect(inspectManifest(manifest).join("\n")).toContain(expected);
  });
});

describe("inspectEntryContent", () => {
  it("sanitizes hostile entry names in content violations", () => {
    expect(
      inspectEntryContent(
        "extension/evil\n[verify-vsix] forged.md",
        "api.__pairHostTest = {}",
      ),
    ).toEqual([
      "Forbidden content in extension/evil\\x0a[verify-vsix] forged.md: __pairHostTest",
    ]);
  });

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
