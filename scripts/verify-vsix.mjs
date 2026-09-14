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
import { parseJsonObject } from "./json.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_VSIX = resolve(repoRoot, "adaptive-pair-0.2.0-preview.1-stable.vsix");

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

/**
 * @param {readonly string[]} names
 * @returns {string[]} one violation per missing required or forbidden entry
 */
export const inspectEntryNames = (names) => {
  const violations = [];
  const present = new Set(names);

  for (const required of REQUIRED_VSIX_ENTRIES) {
    if (!present.has(required)) {
      violations.push(`Missing required VSIX entry: ${required}`);
    }
  }

  for (const name of names) {
    for (const rule of FORBIDDEN_ENTRY_PATTERNS) {
      if (rule.pattern.test(name)) {
        violations.push(`Forbidden VSIX entry (${rule.reason}): ${name}`);
      }
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

  const contributes = record["contributes"];
  if (typeof contributes === "object" && contributes !== null) {
    const contributions = /** @type {Record<string, unknown>} */ (contributes);
    if (contributions["chatSessions"] !== undefined) {
      violations.push("The packaged manifest contributes chatSessions.");
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

/**
 * Read every entry from a zip archive using only the central directory.
 *
 * @param {Buffer} buffer
 * @returns {{ name: string, data: Buffer, text: string }[]}
 */
export const readZipEntries = (buffer) => {
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error("The archive has no zip end-of-central directory record.");
  }

  const count = buffer.readUInt16LE(eocd + 10);
  let position = buffer.readUInt32LE(eocd + 16);
  const entries = [];

  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(position) !== CENTRAL_SIGNATURE) {
      throw new Error(`Corrupt zip central directory entry at offset ${position}.`);
    }
    const method = buffer.readUInt16LE(position + 10);
    const compressedSize = buffer.readUInt32LE(position + 20);
    const nameLength = buffer.readUInt16LE(position + 28);
    const extraLength = buffer.readUInt16LE(position + 30);
    const commentLength = buffer.readUInt16LE(position + 32);
    const localOffset = buffer.readUInt32LE(position + 42);
    const name = buffer.toString("utf8", position + 46, position + 46 + nameLength);

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const stored = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 8 ? inflateRawSync(stored) : Buffer.from(stored);

    entries.push({ name, data, text: data.toString("utf8") });
    position += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
};

/**
 * @param {Buffer} buffer the VSIX archive
 * @returns {string[]} every violation found, empty when the archive is releasable
 */
export const verifyVsix = (buffer) => {
  const entries = readZipEntries(buffer);
  const violations = inspectEntryNames(entries.map((entry) => entry.name));

  const manifestEntry = entries.find((entry) => entry.name === "extension/package.json");
  if (manifestEntry === undefined) {
    violations.push("The archive contains no extension/package.json manifest.");
  } else {
    try {
      violations.push(
        ...inspectManifest(parseJsonObject(manifestEntry.text, "The packaged manifest")),
      );
    } catch (error) {
      violations.push(`The packaged manifest could not be read: ${String(error)}`);
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

  const entries = readZipEntries(buffer);
  console.log(
    `[verify-vsix] ${target} passed with ${entries.length} entries: ${entries
      .map((entry) => entry.name)
      .join(", ")}`,
  );
};

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
