// The single packaging pipeline for the Adaptive Pair Stable preview.
//
// `vsce package` only archives what is already staged inside the extension
// folder, so any packaging entry point that does not build first can ship a
// stale bundle or drop the license and documentation. Both the root and the
// workspace `package` scripts therefore run this orchestrator — build, staging
// check, `vsce`, then release verification of the archive that was actually
// produced — instead of chaining npm scripts that could run out of order or
// recurse.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runProductionBuild } from "./build-extension.mjs";
import { collectStagingViolations } from "./assert-package-staging.mjs";
import { isMainModule } from "./mainModule.mjs";
import { parseJsonObject, stringField } from "./json.mjs";
import { RELEASE_VSIX_NAME, verifyVsix } from "./verify-vsix.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = resolve(repoRoot, "apps/vscode-extension");

/** The release artifact this pipeline produces. */
export const RELEASE_VSIX_PATH = resolve(repoRoot, RELEASE_VSIX_NAME);

/** A packaging step refused to continue. */
export class PackagingError extends Error {
  /**
   * @param {string} message
   * @param {readonly string[]} violations
   */
  constructor(message, violations) {
    super(`${message}\n${violations.map((violation) => `  - ${violation}`).join("\n")}`);
    this.name = "PackagingError";
    this.violations = [...violations];
  }
}

/**
 * @typedef {object} PackageExtensionOptions
 * @property {() => Promise<unknown>} [build] defaults to the real production build
 * @property {() => Promise<string[]>} [inspect] defaults to the real staging check
 * @property {(vsixPath: string) => Promise<unknown>} [runVsce] defaults to the real `vsce`
 * @property {(vsixPath: string) => Promise<string[]>} [verify] defaults to the real verifier
 */

/**
 * Resolve the packaging tool's JavaScript entry point and run it through the
 * current Node executable, which keeps the call identical on every platform
 * (no `.cmd` shim, no shell quoting of the output path).
 *
 * @returns {Promise<string>}
 */
const vsceEntryPoint = async () => {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve("@vscode/vsce/package.json");
  const manifest = parseJsonObject(
    await readFile(manifestPath, "utf8"),
    "The @vscode/vsce manifest",
  );
  const bin = manifest["bin"];
  const relative =
    typeof bin === "string"
      ? bin
      : typeof bin === "object" && bin !== null
        ? stringField(/** @type {Record<string, unknown>} */ (bin), "vsce")
        : undefined;
  if (relative === undefined) {
    throw new Error("@vscode/vsce declares no vsce binary.");
  }
  return resolve(dirname(manifestPath), relative);
};

/**
 * @param {string} vsixPath
 * @returns {Promise<void>}
 */
const runVsceDefault = async (vsixPath) => {
  const entryPoint = await vsceEntryPoint();
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [entryPoint, "package", "--no-dependencies", "--out", vsixPath],
      { cwd: extensionRoot, stdio: "inherit" },
    );
    child.on("error", rejectPromise);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise(undefined);
        return;
      }
      rejectPromise(
        new Error(`vsce package failed (exit code ${code ?? "none"}, signal ${signal ?? "none"}).`),
      );
    });
  });
};

/**
 * @param {string} vsixPath
 * @returns {Promise<string[]>}
 */
const verifyDefault = async (vsixPath) => verifyVsix(await readFile(vsixPath));

/**
 * Build the production bundle and prove the extension folder is fully staged.
 * Any packaging entry point must call this before invoking `vsce`.
 *
 * @param {PackageExtensionOptions} [options]
 * @returns {Promise<{ vsixPath: string, extensionRoot: string }>}
 */
export const prepareExtensionPackage = async (options = {}) => {
  const build = options.build ?? runProductionBuild;
  const inspect = options.inspect ?? collectStagingViolations;

  await build();
  const violations = await inspect();
  if (violations.length > 0) {
    throw new PackagingError(
      "The extension folder is not staged for packaging:",
      violations,
    );
  }

  return { vsixPath: RELEASE_VSIX_PATH, extensionRoot };
};

/**
 * Run the complete release packaging pipeline.
 *
 * @param {PackageExtensionOptions} [options]
 * @returns {Promise<{ vsixPath: string, violations: string[] }>}
 */
export const packageExtension = async (options = {}) => {
  const prepared = await prepareExtensionPackage(options);
  const runVsce = options.runVsce ?? runVsceDefault;
  const verify = options.verify ?? verifyDefault;

  await runVsce(prepared.vsixPath);

  const violations = await verify(prepared.vsixPath);
  if (violations.length > 0) {
    throw new PackagingError(
      `${prepared.vsixPath} failed release verification:`,
      violations,
    );
  }

  return { vsixPath: prepared.vsixPath, violations };
};

const main = async () => {
  try {
    const { vsixPath } = await packageExtension();
    console.log(`[package] ${vsixPath} built, staged, packaged, and verified.`);
  } catch (error) {
    console.error(`[package] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
};

if (isMainModule(import.meta.url)) {
  await main();
}
