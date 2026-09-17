import { inflateRawSync } from "node:zlib";
import { REQUIRED_VSIX_ENTRIES,sanitizeForMessage } from "./vsixPolicy.mjs";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_LENGTH = 22;
const CENTRAL_HEADER_LENGTH = 46;
const LOCAL_HEADER_LENGTH = 30;
const MAX_ARCHIVE_COMMENT = 0xffff;
const MAX_EOCD_METADATA_INSPECTION_BYTES = MAX_ARCHIVE_COMMENT;
const ZIP64_SENTINEL = 0xffffffff;
const DEFLATED = 8;
const STORED = 0;
const ENCRYPTION_FLAGS = 0x0001 | 0x0040;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES =
  REQUIRED_VSIX_ENTRIES.length * MAX_ENTRY_UNCOMPRESSED_BYTES;

/**
 * @typedef {{
 *   name: string,
 *   label: string,
 *   method: number,
 *   compressedSize: number,
 *   uncompressedSize: number,
 *   dataStart: number,
 *   dataEnd: number,
 * }} ZipEntryMetadata
 */

/**
 * A structural problem in the archive itself. Carrying a stable `code` keeps
 * the release report deterministic instead of surfacing whichever incidental
 * `RangeError` a malformed offset happened to trigger.
 */
export class VsixArchiveError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "VsixArchiveError";
    this.code = code;
  }
}

/**
 * Every end-of-central-directory candidate whose declared comment length
 * reaches exactly the end of the buffer. The length check is what stops a
 * decoy `PK\x05\x06` planted inside the archive comment from being mistaken for
 * the real record.
 *
 * @param {Buffer} buffer
 * @returns {number[]} candidate offsets, closest to the end first
 */
const eocdCandidates = (buffer) => {
  const candidates = [];
  const lowest = Math.max(0, buffer.length - EOCD_LENGTH - MAX_ARCHIVE_COMMENT);
  for (let offset = buffer.length - EOCD_LENGTH; offset >= lowest; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== EOCD_SIGNATURE) {
      continue;
    }
    if (offset + EOCD_LENGTH + buffer.readUInt16LE(offset + 20) !== buffer.length) {
      continue;
    }
    candidates.push(offset);
  }
  return candidates;
};

/**
 * @param {Buffer} buffer
 * @param {number} eocd
 * @param {{ inspectedBytes: number }} budget
 * @returns {ZipEntryMetadata[]}
 */
const inspectCentralDirectory = (buffer, eocd, budget) => {
  const disk = buffer.readUInt16LE(eocd + 4);
  const centralDirectoryDisk = buffer.readUInt16LE(eocd + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
  const count = buffer.readUInt16LE(eocd + 10);
  const size = buffer.readUInt32LE(eocd + 12);
  const start = buffer.readUInt32LE(eocd + 16);

  if (disk !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== count) {
    throw new VsixArchiveError(
      "multi-disk-unsupported",
      "The archive declares multiple disks, which this verifier does not read.",
    );
  }
  if (start === ZIP64_SENTINEL || size === ZIP64_SENTINEL || count === 0xffff) {
    throw new VsixArchiveError(
      "zip64-unsupported",
      "The archive declares zip64 records, which this verifier does not read.",
    );
  }
  if (start > eocd || size > eocd || start + size > eocd) {
    throw new VsixArchiveError(
      "central-directory-out-of-bounds",
      `The central directory (offset ${start}, size ${size}) does not fit before the end record at offset ${eocd}.`,
    );
  }
  if (size > MAX_EOCD_METADATA_INSPECTION_BYTES - budget.inspectedBytes) {
    throw new VsixArchiveError(
      "eocd-metadata-budget-exceeded",
      `End-of-central-directory candidates declare more than ${MAX_EOCD_METADATA_INSPECTION_BYTES} cumulative central-directory bytes.`,
    );
  }
  budget.inspectedBytes += size;

  const end = start + size;
  const metadata = [];
  const localOffsets = new Set();
  let totalUncompressedSize = 0;
  let position = start;

  for (let index = 0; index < count; index += 1) {
    const { name, label, method, compressedSize, uncompressedSize, localOffset, headerEnd } =
      inspectCentralEntry(buffer, position, end, index, count);
    totalUncompressedSize += uncompressedSize;
    if (totalUncompressedSize > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
      throw new VsixArchiveError(
        "archive-too-large",
        `The archive declares more than ${MAX_ARCHIVE_UNCOMPRESSED_BYTES} total uncompressed bytes.`,
      );
    }
    if (localOffsets.has(localOffset)) {
      throw new VsixArchiveError(
        "entry-offset-duplicate",
        `Entry ${label} shares local header offset ${localOffset} with another entry.`,
      );
    }
    localOffsets.add(localOffset);

    metadata.push({
      name, label, method, compressedSize, uncompressedSize,
      ...entryDataBounds(buffer, start, { label, localOffset, compressedSize }),
    });
    position = headerEnd;
  }

  if (position !== end) {
    throw new VsixArchiveError(
      "central-directory-size-mismatch",
      `The central directory declares ${size} bytes but its ${count} entries occupy ${position - start}.`,
    );
  }

  return metadata;
};

/**
 * @param {Buffer} buffer
 * @param {readonly ZipEntryMetadata[]} metadata
 * @returns {{ name: string, data: Buffer, text: string }[]}
 */
const materializeCentralDirectory = (buffer, metadata) => {
  const entries = [];
  for (const entry of metadata) {
    const {
      name,
      label,
      method,
      compressedSize,
      uncompressedSize,
      dataStart,
      dataEnd,
    } = entry;
    const stored = buffer.subarray(dataStart, dataEnd);
    let data;
    if (method === DEFLATED) {
      try {
        data = inflateRawSync(stored, {
          maxOutputLength: MAX_ENTRY_UNCOMPRESSED_BYTES,
        });
      } catch {
        throw new VsixArchiveError(
          "entry-inflate-failed",
          `Entry ${label} could not be decompressed.`,
        );
      }
      if (data.length !== uncompressedSize) {
        throw new VsixArchiveError(
          "entry-size-mismatch",
          `Deflated entry ${label} declares ${uncompressedSize} uncompressed bytes but inflates to ${data.length}.`,
        );
      }
    } else if (method === STORED) {
      if (compressedSize !== uncompressedSize) {
        throw new VsixArchiveError(
          "entry-size-mismatch",
          `Stored entry ${label} declares compressed size ${compressedSize} but uncompressed size ${uncompressedSize}.`,
        );
      }
      if (stored.length > MAX_ENTRY_UNCOMPRESSED_BYTES) {
        throw new VsixArchiveError(
          "entry-too-large",
          `Stored entry ${label} exceeds the ${MAX_ENTRY_UNCOMPRESSED_BYTES}-byte release bound.`,
        );
      }
      data = Buffer.from(stored);
    } else {
      throw new VsixArchiveError(
        "entry-method-unsupported",
        `Entry ${label} uses unsupported compression method ${method}.`,
      );
    }

    entries.push({ name, data, text: data.toString("utf8") });
  }

  return entries;
};

/**
 * Read every entry from a zip archive using only the central directory, with
 * every declared offset and length bounds-checked before it is dereferenced.
 *
 * @param {Buffer} buffer
 * @returns {{ name: string, data: Buffer, text: string }[]}
 * @throws {VsixArchiveError} when the archive is not structurally readable
 */
export const readZipEntries = (buffer) => {
  if (!Buffer.isBuffer(buffer)) {
    throw new VsixArchiveError("not-a-buffer", "The archive was not provided as a buffer.");
  }

  const candidates = eocdCandidates(buffer);
  if (candidates.length === 0) {
    throw new VsixArchiveError(
      "eocd-missing",
      "The archive has no zip end-of-central directory record whose comment reaches the end of the file.",
    );
  }

  /** @type {unknown} */
  let failure;
  /** @type {ZipEntryMetadata[] | undefined} */
  let selectedDirectory;
  let hasEmptyDirectory = false;
  let nonemptyDirectories = 0;
  const metadataBudget = { inspectedBytes: 0 };
  for (const eocd of candidates) {
    try {
      const metadata = inspectCentralDirectory(buffer, eocd, metadataBudget);
      if (metadata.length > 0) {
        nonemptyDirectories += 1;
        if (nonemptyDirectories > 1) {
          break;
        }
        selectedDirectory = metadata;
      } else {
        // A decoy end record planted in the comment parses as an empty archive.
        // Keep scanning for a real central directory and only fall back to the
        // empty reading when the file genuinely contains no entries.
        hasEmptyDirectory = true;
      }
    } catch (error) {
      if (
        error instanceof VsixArchiveError &&
        error.code === "eocd-metadata-budget-exceeded"
      ) {
        throw error;
      }
      failure = error;
    }
  }
  if (nonemptyDirectories > 1) {
    throw new VsixArchiveError(
      "eocd-nonempty-ambiguous",
      "The archive has multiple structurally valid nonempty end-of-central-directory records.",
    );
  }
  if (selectedDirectory !== undefined) {
    return materializeCentralDirectory(buffer, selectedDirectory);
  }
  if (hasEmptyDirectory) {
    return [];
  }
  throw failure;
};


/**
 * @param {Buffer} buffer
 * @param {number} position
 * @param {number} end
 * @param {number} index
 * @param {number} count
 */
const inspectCentralEntry = (buffer, position, end, index, count) => {
  if (position + CENTRAL_HEADER_LENGTH > end) {
    throw new VsixArchiveError(
      "central-directory-truncated",
      `The central directory ends before entry ${index + 1} of ${count}.`,
    );
  }
  if (buffer.readUInt32LE(position) !== CENTRAL_SIGNATURE) {
    throw new VsixArchiveError(
      "central-directory-entry-signature",
      `Entry ${index + 1} has no central directory signature at offset ${position}.`,
    );
  }

  const flags = buffer.readUInt16LE(position + 8);
  const method = buffer.readUInt16LE(position + 10);
  const compressedSize = buffer.readUInt32LE(position + 20);
  const uncompressedSize = buffer.readUInt32LE(position + 24);
  const nameLength = buffer.readUInt16LE(position + 28);
  const extraLength = buffer.readUInt16LE(position + 30);
  const commentLength = buffer.readUInt16LE(position + 32);
  const localOffset = buffer.readUInt32LE(position + 42);
  const headerEnd =
    position + CENTRAL_HEADER_LENGTH + nameLength + extraLength + commentLength;
  if (headerEnd > end) {
    throw new VsixArchiveError(
      "central-directory-truncated",
      `Entry ${index + 1} declares ${nameLength + extraLength + commentLength} header bytes that run past the central directory.`,
    );
  }

  const name = buffer.toString(
    "utf8",
    position + CENTRAL_HEADER_LENGTH,
    position + CENTRAL_HEADER_LENGTH + nameLength,
  );
  const label = sanitizeForMessage(name);

  if (method !== DEFLATED && method !== STORED) {
    throw new VsixArchiveError(
      "entry-method-unsupported",
      `Entry ${label} uses unsupported compression method ${method}.`,
    );
  }
  if ((flags & ENCRYPTION_FLAGS) !== 0) {
    throw new VsixArchiveError(
      "entry-encrypted",
      `Entry ${label} is encrypted, so its content cannot be verified.`,
    );
  }
  if (uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
    throw new VsixArchiveError(
      "entry-too-large",
      `Entry ${label} declares ${uncompressedSize} uncompressed bytes, exceeding the ${MAX_ENTRY_UNCOMPRESSED_BYTES}-byte release bound.`,
    );
  }
  return { name, label, method, compressedSize, uncompressedSize, localOffset, headerEnd };
};

/**
 * @param {Buffer} buffer
 * @param {number} start
 * @param {{ label: string, localOffset: number, compressedSize: number }} header
 */
const entryDataBounds = (buffer, start, header) => {
  const { label, localOffset, compressedSize } = header;
  if (localOffset + LOCAL_HEADER_LENGTH > start) {
    throw new VsixArchiveError(
      "entry-header-out-of-bounds",
      `Entry ${label} declares a local header at offset ${localOffset}, outside the archive data.`,
    );
  }
  if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
    throw new VsixArchiveError(
      "entry-header-signature",
      `Entry ${label} has no local header signature at offset ${localOffset}.`,
    );
  }
  const localFlags = buffer.readUInt16LE(localOffset + 6);
  if ((localFlags & ENCRYPTION_FLAGS) !== 0) {
    throw new VsixArchiveError(
      "entry-encrypted",
      `Entry ${label} is encrypted, so its content cannot be verified.`,
    );
  }

  const dataStart =
    localOffset +
    LOCAL_HEADER_LENGTH +
    buffer.readUInt16LE(localOffset + 26) +
    buffer.readUInt16LE(localOffset + 28);
  const dataEnd = dataStart + compressedSize;
  if (dataStart > start || dataEnd > start) {
    throw new VsixArchiveError(
      "entry-data-out-of-bounds",
      `Entry ${label} declares ${compressedSize} bytes at offset ${dataStart}, outside the archive data.`,
    );
  }

  return { dataStart, dataEnd };
};
