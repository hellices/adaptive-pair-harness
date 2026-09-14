// Packaging staging invariant.
//
// `vsce package` only archives what is already staged inside the extension
// folder, so a packaging entry point that skips the build could silently ship
// a VSIX without the license, README, or Growth preview documentation. The
// packaging orchestrator calls this after building; it is also executable
// directly for diagnosis.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { STAGED_PACKAGE_FILES } from "./build-extension.mjs";
import { isMainModule } from "./mainModule.mjs";
import { parseJsonObject, stringArrayField } from "./json.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = resolve(repoRoot, "apps/vscode-extension");
const bundlePath = resolve(extensionRoot, "dist/extension.cjs");
const legalNoticePath = `${bundlePath}.LEGAL.txt`;
export const LEGAL_NOTICE_ENTRY = "dist/extension.cjs.LEGAL.txt";

/**
 * @param {readonly { target: string, sourceHash: string, stagedHash: string | undefined, exists: boolean }[]} staged
 * @param {{ bundleExists: boolean, legalNoticeExists: boolean, allowlist: readonly string[] }} options
 * @returns {string[]}
 */
export const inspectStagedPackageFiles = (staged, options) => {
  const violations = [];

  if (!options.bundleExists) {
    violations.push(
      "The production bundle dist/extension.cjs is missing. Run `npm run build` (or package through the root `npm run package` pipeline).",
    );
  }

  if (options.legalNoticeExists && !options.allowlist.includes(LEGAL_NOTICE_ENTRY)) {
    violations.push(
      `The build generated ${LEGAL_NOTICE_ENTRY}, but the manifest "files" allowlist would drop it. Add it to the allowlist so third-party legal notices ship.`,
    );
  }

  for (const entry of staged) {
    if (!entry.exists || entry.stagedHash === undefined) {
      violations.push(
        `The staged package file ${entry.target} is missing. Run \`npm run build\` before packaging.`,
      );
      continue;
    }
    if (entry.stagedHash !== entry.sourceHash) {
      violations.push(
        `The staged package file ${entry.target} is stale. Run \`npm run build\` to restage it.`,
      );
    }
  }

  return violations;
};

/** @param {string} path */
const hashOf = async (path) =>
  createHash("sha256").update(await readFile(path)).digest("hex");

/**
 * Inspect the real extension folder and report every staging violation.
 *
 * @returns {Promise<string[]>}
 */
export const collectStagingViolations = async () => {
  const staged = [];
  for (const entry of STAGED_PACKAGE_FILES) {
    const sourcePath = resolve(repoRoot, entry.source);
    const stagedPath = resolve(extensionRoot, entry.target);
    const exists = existsSync(stagedPath);
    staged.push({
      target: entry.target,
      sourceHash: await hashOf(sourcePath),
      stagedHash: exists ? await hashOf(stagedPath) : undefined,
      exists,
    });
  }

  const manifest = parseJsonObject(
    await readFile(resolve(extensionRoot, "package.json"), "utf8"),
    "The extension manifest",
  );
  return inspectStagedPackageFiles(staged, {
    bundleExists: existsSync(bundlePath),
    legalNoticeExists: existsSync(legalNoticePath),
    allowlist: stringArrayField(manifest, "files"),
  });
};

const main = async () => {
  const violations = await collectStagingViolations();
  if (violations.length > 0) {
    console.error("[prepackage] The extension folder is not staged for packaging:");
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("[prepackage] Staged bundle, license, README, and Growth preview verified.");
};

if (isMainModule(import.meta.url)) {
  await main();
}
