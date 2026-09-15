// Support for the isolated Extension Host smoke run.
//
// The host test never loads the production bundle: it compiles a separate
// host-test entry point into a throwaway `.host-test` development extension
// whose manifest is derived from the shipped manifest with only `main`
// redirected. `npm run build` and `npm run package` therefore never see any
// host-test code.
import { build } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonObject } from "./json.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = resolve(repoRoot, "apps/vscode-extension");

export const HOST_TEST_MAIN = "./extension.cjs";
/** The throwaway development-extension directory used by the host smoke. */
export const HOST_TEST_STAGING_DIR = resolve(extensionRoot, ".host-test");
export const PRODUCTION_MANIFEST_PATH = resolve(extensionRoot, "package.json");

/**
 * Derive the host-test development manifest from the shipped manifest.
 *
 * Every contribution, activation event, and identity field is preserved so the
 * smoke test exercises the real contribution surface; only `main` is redirected
 * to the host-test bundle.
 *
 * @param {Record<string, unknown>} manifest the production manifest
 * @returns {Record<string, unknown>} a new manifest object
 */
export const deriveHostManifest = (manifest) => {
  if (typeof manifest.main !== "string" || manifest.main.length === 0) {
    throw new Error("The production manifest declares no main entry point.");
  }
  return { ...manifest, main: HOST_TEST_MAIN };
};

/**
 * Choose which previous run directories are safe to prune.
 *
 * Only entries that are directories, are named with the exact `run-` prefix,
 * contain no path separator or traversal segment, and are older than
 * `maxAgeMs` are selected. Everything else is left alone.
 *
 * @param {{ name: string, isDirectory: boolean, mtimeMs: number }[]} entries
 * @param {{ now: number, maxAgeMs: number }} options
 * @returns {string[]}
 */
export const selectStaleRunDirectories = (entries, options) =>
  entries
    .filter((entry) => {
      if (!entry.isDirectory || !entry.name.startsWith("run-")) {
        return false;
      }
      if (entry.name.includes("/") || entry.name.includes("\\") || entry.name.includes("..")) {
        return false;
      }
      return options.now - entry.mtimeMs > options.maxAgeMs;
    })
    .map((entry) => entry.name);

/**
 * Compile the host-test extension and its Mocha suite into the staging
 * directory and write the derived manifest.
 *
 * @returns {Promise<{ stagingDir: string, testsPath: string }>}
 */
export const buildHostTestExtension = async () => {
  await rm(HOST_TEST_STAGING_DIR, { recursive: true, force: true });
  await mkdir(HOST_TEST_STAGING_DIR, { recursive: true });

  const hostTestDir = resolve(extensionRoot, "test/host");
  await build({
    absWorkingDir: repoRoot,
    entryPoints: {
      extension: join(hostTestDir, "extension.host.ts"),
      index: join(hostTestDir, "index.ts"),
      smoke: join(hostTestDir, "smoke.ts"),
    },
    outdir: HOST_TEST_STAGING_DIR,
    outExtension: { ".js": ".cjs" },
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    external: ["vscode", "mocha"],
    sourcemap: false,
    logLevel: "warning",
  });

  const manifest = parseJsonObject(
    await readFile(PRODUCTION_MANIFEST_PATH, "utf8"),
    "The production extension manifest",
  );
  await writeFile(
    join(HOST_TEST_STAGING_DIR, "package.json"),
    `${JSON.stringify(deriveHostManifest(manifest), undefined, 2)}\n`,
    "utf8",
  );

  return {
    stagingDir: HOST_TEST_STAGING_DIR,
    testsPath: join(HOST_TEST_STAGING_DIR, "index.cjs"),
  };
};
