// Automated VSIX release verification.
//
// Inspects the generated archive itself (not the working tree) and fails unless
// it contains exactly the required release entries and nothing that must never
// ship: source maps, sources, tests, host-test code, proposed APIs, chat
// session contributions, or a local absolute path.
import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./mainModule.mjs";
import { parseJsonObject } from "./json.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The Stable release artifact name, shared with the packaging orchestrator. */
export const RELEASE_VSIX_NAME = "adaptive-pair-0.2.0-preview.1-stable.vsix";

const DEFAULT_VSIX = resolve(repoRoot, RELEASE_VSIX_NAME);

/** Every entry the Stable release VSIX must contain, and nothing else. */
export const REQUIRED_VSIX_ENTRIES = Object.freeze([
  "extension.vsixmanifest",
  "[Content_Types].xml",
  "extension/package.json",
  "extension/dist/extension.cjs",
  "extension/LICENSE.txt",
  "extension/readme.md",
  "extension/docs/growth-preview.md",
]);

/** Entry-name patterns that must never appear in a release archive. */
const FORBIDDEN_ENTRY_PATTERNS = Object.freeze([
  { pattern: /\.map$/u, reason: "source map" },
  { pattern: /\.tsbuildinfo$/u, reason: "TypeScript build info" },
  { pattern: /(^|\/)src\//u, reason: "source directory" },
  { pattern: /\.tsx?$/u, reason: "TypeScript source" },
  { pattern: /(^|\/)test(s)?\//u, reason: "test directory" },
  { pattern: /(^|\/)\.host-test\//u, reason: "host-test staging directory" },
  { pattern: /(^|\/)node_modules\//u, reason: "bundled dependencies" },
  { pattern: /(^|\/)\.git(\/|$)/u, reason: "repository metadata" },
  { pattern: /(^|\/)coverage\//u, reason: "coverage output" },
]);

/** Content patterns that must never appear in any shipped text entry. */
const FORBIDDEN_CONTENT_PATTERNS = Object.freeze([
  { pattern: /ADAPTIVE_PAIR_HOST_TEST/u, label: "ADAPTIVE_PAIR_HOST_TEST" },
  { pattern: /__pairHostTest/u, label: "__pairHostTest" },
  { pattern: /HostTestAutoConfirmPort/u, label: "HostTestAutoConfirmPort" },
  { pattern: /createHostTestApi/u, label: "createHostTestApi" },
  { pattern: /sourceMappingURL/u, label: "sourceMappingURL" },
  { pattern: /\/Users\//u, label: "/Users/ local path" },
  { pattern: /\/home\/[A-Za-z0-9._-]+\//u, label: "/home/ local path" },
  { pattern: /[A-Za-z]:\\Users\\/u, label: "C:\\Users local path" },
]);

const TEXT_ENTRY = /\.(?:cjs|js|json|md|xml|txt|vsixmanifest)$/u;

const MAX_REPORTED_LENGTH = 120;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Archive-derived text is untrusted: an entry name can carry control characters
 * or be arbitrarily long. Reports escape it and clamp its length so a hostile
 * archive cannot forge or flood verification output.
 *
 * @param {string} value
 * @returns {string}
 */
export const sanitizeForMessage = (value) => {
  let escaped = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    escaped +=
      code < 0x20 || (code >= 0x7f && code <= 0x9f)
        ? `\\x${code.toString(16).padStart(2, "0")}`
        : character;
  }
  return escaped.length > MAX_REPORTED_LENGTH
    ? `${escaped.slice(0, MAX_REPORTED_LENGTH)}…`
    : escaped;
};

/**
 * @param {readonly string[]} names
 * @returns {string[]} one violation per missing, duplicated, forbidden, or
 *   unexpected entry; a releasable archive holds exactly the required set
 */
export const inspectEntryNames = (names) => {
  const violations = [];
  const required = new Set(REQUIRED_VSIX_ENTRIES);
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Set<string>} */
  const duplicates = new Set();

  for (const name of names) {
    if (seen.has(name)) {
      duplicates.add(name);
    }
    seen.add(name);
  }

  for (const entry of REQUIRED_VSIX_ENTRIES) {
    if (!seen.has(entry)) {
      violations.push(`Missing required VSIX entry: ${entry}`);
    }
  }

  for (const name of duplicates) {
    violations.push(`Duplicate VSIX entry: ${sanitizeForMessage(name)}`);
  }

  for (const name of seen) {
    const rule = FORBIDDEN_ENTRY_PATTERNS.find((candidate) => candidate.pattern.test(name));
    if (rule !== undefined) {
      violations.push(`Forbidden VSIX entry (${rule.reason}): ${sanitizeForMessage(name)}`);
      continue;
    }
    if (!required.has(name)) {
      violations.push(`Unexpected VSIX entry: ${sanitizeForMessage(name)}`);
    }
  }

  return violations;
};

/**
 * @param {unknown} manifest the parsed `extension/package.json`
 * @returns {string[]}
 */
export const inspectManifest = (manifest) => {
  const violations = [];
  if (typeof manifest !== "object" || manifest === null) {
    return ["The packaged manifest is not an object."];
  }

  const record = /** @type {Record<string, unknown>} */ (manifest);
  if (record["enabledApiProposals"] !== undefined) {
    violations.push("The packaged manifest declares enabledApiProposals.");
  }
  if (record["main"] !== "./dist/extension.cjs") {
    violations.push(
      `The packaged manifest main is ${JSON.stringify(record["main"])}, expected "./dist/extension.cjs".`,
    );
  }

  const activationEvents = record["activationEvents"];
  if (activationEvents !== undefined) {
    if (!Array.isArray(activationEvents)) {
      violations.push("The packaged manifest activationEvents field is not an array.");
    } else {
      for (const event of activationEvents) {
        if (
          typeof event !== "string" ||
          !/^(?:onCommand:adaptivePair\.|onChatParticipant:adaptivePair\.)[A-Za-z0-9._-]+$/u.test(
            event,
          )
        ) {
          violations.push(
            `Non-additive activation event: ${sanitizeForMessage(String(event))}`,
          );
        }
      }
    }
  }

  const contributes = record["contributes"];
  if (typeof contributes === "object" && contributes !== null) {
    const contributions = /** @type {Record<string, unknown>} */ (contributes);
    const allowedContributionPoints = new Set([
      "commands",
      "languageModelTools",
      "chatParticipants",
    ]);
    for (const key of Object.keys(contributions)) {
      if (!allowedContributionPoints.has(key)) {
        violations.push(
          `Unsupported Stable contribution point: ${sanitizeForMessage(key)}`,
        );
      }
    }

    if (contributions["chatSessions"] !== undefined) {
      violations.push("The packaged manifest contributes chatSessions.");
    }

    const commands = contributions["commands"];
    if (commands !== undefined) {
      if (!Array.isArray(commands)) {
        violations.push("The packaged manifest commands contribution is not an array.");
      } else {
        for (const entry of commands) {
          const identifier = isRecord(entry) ? entry["command"] : undefined;
          if (typeof identifier !== "string" || !identifier.startsWith("adaptivePair.")) {
            violations.push(
              `Non-additive command identifier: ${
                typeof identifier === "string"
                  ? sanitizeForMessage(identifier)
                  : "<non-string>"
              }`,
            );
          }
        }
      }
    }

    const tools = contributions["languageModelTools"];
    if (tools !== undefined) {
      if (!Array.isArray(tools)) {
        violations.push(
          "The packaged manifest languageModelTools contribution is not an array.",
        );
      } else {
        for (const entry of tools) {
          const tool = isRecord(entry) ? entry : undefined;
          const identifier = tool?.["name"];
          if (
            typeof identifier !== "string" ||
            !identifier.startsWith("adaptive_pair_")
          ) {
            violations.push(
              `Non-additive language-model tool identifier: ${
                typeof identifier === "string"
                  ? sanitizeForMessage(identifier)
                  : "<non-string>"
              }`,
            );
          }
          const reference = tool?.["toolReferenceName"];
          if (
            reference !== undefined &&
            (typeof reference !== "string" ||
              !reference.startsWith("adaptivePair"))
          ) {
            violations.push(
              `Non-additive tool reference identifier: ${
                typeof reference === "string"
                  ? sanitizeForMessage(reference)
                  : "<non-string>"
              }`,
            );
          }
        }
      }
    }

    const participants = contributions["chatParticipants"];
    if (participants !== undefined) {
      if (!Array.isArray(participants)) {
        violations.push(
          "The packaged manifest chatParticipants contribution is not an array.",
        );
      } else {
        for (const entry of participants) {
          const identifier = isRecord(entry) ? entry["id"] : undefined;
          if (typeof identifier !== "string" || !identifier.startsWith("adaptivePair.")) {
            violations.push(
              `Non-additive chat participant identifier: ${
                typeof identifier === "string"
                  ? sanitizeForMessage(identifier)
                  : "<non-string>"
              }`,
            );
          }
        }
      }
    }
  }

  return violations;
};

/**
 * @param {string} name
 * @param {string} text
 * @returns {string[]}
 */
export const inspectEntryContent = (name, text) => {
  const violations = [];
  for (const rule of FORBIDDEN_CONTENT_PATTERNS) {
    if (rule.pattern.test(text)) {
      violations.push(`Forbidden content in ${name}: ${rule.label}`);
    }
  }
  return violations;
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_LENGTH = 22;
const CENTRAL_HEADER_LENGTH = 46;
const LOCAL_HEADER_LENGTH = 30;
const MAX_ARCHIVE_COMMENT = 0xffff;
const ZIP64_SENTINEL = 0xffffffff;
const DEFLATED = 8;
const STORED = 0;
const ENCRYPTION_FLAGS = 0x0001 | 0x0040;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;

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
 * @returns {{ name: string, data: Buffer, text: string }[]}
 */
const readCentralDirectory = (buffer, eocd) => {
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

  const end = start + size;
  const entries = [];
  let position = start;

  for (let index = 0; index < count; index += 1) {
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
    } else if (method === STORED) {
      data = Buffer.from(stored);
    } else {
      throw new VsixArchiveError(
        "entry-method-unsupported",
        `Entry ${label} uses unsupported compression method ${method}.`,
      );
    }

    entries.push({ name, data, text: data.toString("utf8") });
    position = headerEnd;
  }

  if (position !== end) {
    throw new VsixArchiveError(
      "central-directory-size-mismatch",
      `The central directory declares ${size} bytes but its ${count} entries occupy ${position - start}.`,
    );
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
  /** @type {{ name: string, data: Buffer, text: string }[] | undefined} */
  let emptyDirectory;
  for (const eocd of candidates) {
    try {
      const entries = readCentralDirectory(buffer, eocd);
      if (entries.length > 0) {
        return entries;
      }
      // A decoy end record planted in the comment parses as an empty archive.
      // Keep scanning for a real central directory and only fall back to the
      // empty reading when the file genuinely contains no entries.
      emptyDirectory ??= entries;
    } catch (error) {
      failure = error;
    }
  }
  if (emptyDirectory !== undefined) {
    return emptyDirectory;
  }
  throw failure;
};

/**
 * @param {unknown} error
 * @returns {string}
 */
const describeArchiveFailure = (error) => {
  if (error instanceof VsixArchiveError) {
    return `Unreadable VSIX archive (${error.code}): ${sanitizeForMessage(error.message)}`;
  }
  const message = error instanceof Error ? error.message : String(error);
  return `Unreadable VSIX archive (unexpected-failure): ${sanitizeForMessage(message)}`;
};

/**
 * @param {Buffer} buffer the VSIX archive
 * @returns {string[]} every violation found, empty when the archive is releasable
 */
export const verifyVsix = (buffer) => {
  /** @type {{ name: string, data: Buffer, text: string }[]} */
  let entries;
  try {
    entries = readZipEntries(buffer);
  } catch (error) {
    return [describeArchiveFailure(error)];
  }

  const violations = inspectEntryNames(entries.map((entry) => entry.name));

  // Every manifest entry is inspected, not just the first: a second
  // `extension/package.json` must not be able to smuggle contributions past a
  // check that stopped at the clean copy.
  const manifests = entries.filter((entry) => entry.name === "extension/package.json");
  if (manifests.length === 0) {
    violations.push("The archive contains no extension/package.json manifest.");
  }
  for (const manifestEntry of manifests) {
    try {
      violations.push(
        ...inspectManifest(parseJsonObject(manifestEntry.text, "The packaged manifest")),
      );
    } catch (error) {
      violations.push(
        `The packaged manifest could not be read: ${sanitizeForMessage(
          error instanceof Error ? error.message : String(error),
        )}`,
      );
    }
  }

  for (const entry of entries) {
    if (!TEXT_ENTRY.test(entry.name)) {
      continue;
    }
    violations.push(...inspectEntryContent(entry.name, entry.text));
  }

  return violations;
};

const main = async () => {
  const target = process.argv[2] === undefined ? DEFAULT_VSIX : resolve(process.argv[2]);
  const buffer = await readFile(target);
  const violations = verifyVsix(buffer);

  if (violations.length > 0) {
    console.error(`[verify-vsix] ${target} failed release verification:`);
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    process.exitCode = 1;
    return;
  }

  const names = readZipEntries(buffer).map((entry) => sanitizeForMessage(entry.name));
  console.log(
    `[verify-vsix] ${target} passed with ${names.length} entries: ${names.join(", ")}`,
  );
};

if (isMainModule(import.meta.url)) {
  await main();
}
