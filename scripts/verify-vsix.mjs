import { readZipEntries,VsixArchiveError } from "./vsixArchive.mjs";
import { inspectEntryContent,inspectEntryNames,inspectManifest,sanitizeForMessage,TEXT_ENTRY } from "./vsixPolicy.mjs";
export { readZipEntries,VsixArchiveError } from "./vsixArchive.mjs";
export { inspectEntryContent,inspectEntryNames,inspectManifest,REQUIRED_VSIX_ENTRIES,sanitizeForMessage } from "./vsixPolicy.mjs";
// Automated VSIX release verification.
//
// Inspects the generated archive itself (not the working tree) and fails unless
// it contains exactly the required release entries and nothing that must never
// ship: source maps, sources, tests, host-test code, proposed APIs, chat
// session contributions, or a local absolute path.
import { readFile } from "node:fs/promises";
import { dirname,resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonObject } from "./json.mjs";
import { isMainModule } from "./mainModule.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The Stable release artifact name, shared with the packaging orchestrator. */
export const RELEASE_VSIX_NAME = "adaptive-pair-0.2.0-preview.1-stable.vsix";

const DEFAULT_VSIX = resolve(repoRoot, RELEASE_VSIX_NAME);

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
