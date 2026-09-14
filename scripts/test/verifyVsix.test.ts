import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  REQUIRED_VSIX_ENTRIES,
  inspectEntryNames,
  inspectManifest,
  inspectEntryContent,
  readZipEntries,
  verifyVsix,
} from "../verify-vsix.mjs";

/** Build a minimal but real zip archive so the reader is exercised directly. */
const makeZip = (
  entries: readonly { name: string; content: string; deflate?: boolean }[],
): Buffer => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const raw = Buffer.from(entry.content, "utf8");
    const deflate = entry.deflate ?? true;
    const stored = deflate ? deflateRawSync(raw) : raw;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, stored);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + stored.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuffer, end]);
};

const crc32 = (data: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const validManifest = {
  name: "adaptive-pair",
  publisher: "adaptive-pair",
  version: "0.2.0-preview.1",
  main: "./dist/extension.cjs",
  contributes: { commands: [], chatParticipants: [] },
};

const validArchive = (
  overrides: { manifest?: unknown; extra?: { name: string; content: string }[] } = {},
): Buffer =>
  makeZip([
    { name: "extension.vsixmanifest", content: "<PackageManifest />" },
    { name: "[Content_Types].xml", content: "<Types />" },
    {
      name: "extension/package.json",
      content: JSON.stringify(overrides.manifest ?? validManifest),
    },
    { name: "extension/readme.md", content: "# Adaptive Pair" },
    { name: "extension/LICENSE.txt", content: "Apache-2.0" },
    { name: "extension/docs/growth-preview.md", content: "# Growth preview" },
    { name: "extension/dist/extension.cjs", content: "exports.activate = () => {};" },
    ...(overrides.extra ?? []),
  ]);

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
      expect(violations.join("\n")).toContain(name);
    }
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
    expect(verifyVsix(validArchive())).toEqual([]);
  });

  it("fails an archive that leaks a source map", () => {
    const violations = verifyVsix(
      validArchive({
        extra: [{ name: "extension/dist/extension.cjs.map", content: "{}" }],
      }),
    );

    expect(violations.join("\n")).toContain("extension/dist/extension.cjs.map");
  });

  it("fails an archive whose manifest contributes chat sessions", () => {
    const violations = verifyVsix(
      validArchive({
        manifest: { ...validManifest, contributes: { chatSessions: [] } },
      }),
    );

    expect(violations.join("\n")).toContain("chatSessions");
  });
});
