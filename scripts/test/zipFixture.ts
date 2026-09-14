import { deflateRawSync } from "node:zlib";

/** One archive member for {@link makeZip}. */
export interface ZipEntryInput {
  readonly name: string;
  readonly content: string;
  readonly deflate?: boolean;
  /** General-purpose bit flags written to both local and central headers. */
  readonly flags?: number;
}

/** Deliberate corruptions used to prove the verifier fails safely. */
export interface ZipOverrides {
  /** Raw bytes appended as the archive comment (the comment length is derived). */
  readonly comment?: Buffer;
  /** Replaces the end-of-central-directory comment length field. */
  readonly commentLength?: number;
  /** Replaces the central directory offset field. */
  readonly centralOffset?: number;
  /** Replaces the central directory size field. */
  readonly centralSize?: number;
  /** Replaces the current-disk field in the end record. */
  readonly diskNumber?: number;
  /** Replaces the central-directory-disk field in the end record. */
  readonly centralDirectoryDisk?: number;
  /** Replaces the number of entries on the current disk. */
  readonly entriesOnDisk?: number;
  /** Replaces the entry count fields. */
  readonly entryCount?: number;
  /** Replaces the first entry's local header offset. */
  readonly firstLocalOffset?: number;
  /** Replaces the first entry's compressed size. */
  readonly firstCompressedSize?: number;
  /** Replaces the first entry's declared uncompressed size. */
  readonly firstUncompressedSize?: number;
}

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

/** Build a real zip archive so the verifier's own reader is exercised directly. */
export const makeZip = (
  entries: readonly ZipEntryInput[],
  overrides: ZipOverrides = {},
): Buffer => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  let first = true;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const raw = Buffer.from(entry.content, "utf8");
    const deflate = entry.deflate ?? true;
    const flags = entry.flags ?? 0;
    const stored = deflate ? deflateRawSync(raw) : raw;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
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
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(
      first ? (overrides.firstCompressedSize ?? stored.length) : stored.length,
      20,
    );
    central.writeUInt32LE(
      first ? (overrides.firstUncompressedSize ?? raw.length) : raw.length,
      24,
    );
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(first ? (overrides.firstLocalOffset ?? offset) : offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + stored.length;
    first = false;
  }

  const centralBuffer = Buffer.concat(centrals);
  const comment = overrides.comment ?? Buffer.alloc(0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(overrides.diskNumber ?? 0, 4);
  end.writeUInt16LE(overrides.centralDirectoryDisk ?? 0, 6);
  end.writeUInt16LE(overrides.entriesOnDisk ?? overrides.entryCount ?? entries.length, 8);
  end.writeUInt16LE(overrides.entryCount ?? entries.length, 10);
  end.writeUInt32LE(overrides.centralSize ?? centralBuffer.length, 12);
  end.writeUInt32LE(overrides.centralOffset ?? offset, 16);
  end.writeUInt16LE(overrides.commentLength ?? comment.length, 20);

  return Buffer.concat([...locals, centralBuffer, end, comment]);
};

/** The manifest shape the Stable release actually ships. */
export const validManifest = {
  name: "adaptive-pair",
  publisher: "adaptive-pair",
  version: "0.2.0-preview.1",
  main: "./dist/extension.cjs",
  contributes: { commands: [], chatParticipants: [] },
};

/** Exactly the entries a releasable Stable VSIX contains. */
export const releaseEntries = (
  overrides: { manifest?: unknown } = {},
): ZipEntryInput[] => [
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
];

/** A complete, releasable VSIX archive. */
export const releaseVsixFixture = (
  overrides: { manifest?: unknown; extra?: readonly ZipEntryInput[] } = {},
  zipOverrides: ZipOverrides = {},
): Buffer =>
  makeZip([...releaseEntries(overrides), ...(overrides.extra ?? [])], zipOverrides);
