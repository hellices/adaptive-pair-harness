// Deterministic production bundle for the Adaptive Pair Stable preview.
//
// Produces a single Node 24 CommonJS bundle with an external source map and
// external legal comments. The bundle is the extension's `main` entry; the
// VSIX ships only this bundle plus the manifest, license, README, and Growth
// preview documentation. Source paths in the map are made relative to the
// output directory so no local absolute path is revealed.
//
// The host-test entry point is deliberately not reachable from this graph:
// `PRODUCTION_FORBIDDEN_TOKENS` is enforced against the generated code here and
// in `scripts/test/productionBundle.test.ts`.
import { build } from "esbuild";
import { rm, mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonObject, stringArrayField } from "./json.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = resolve(repoRoot, "apps/vscode-extension");
const outfile = resolve(extensionRoot, "dist/extension.cjs");

/**
 * Tokens that must never appear in the shipped bundle. They name the host-test
 * entry point, its namespaced API, its auto-confirmation port, and its staging
 * directory.
 */
export const PRODUCTION_FORBIDDEN_TOKENS = Object.freeze([
  "ADAPTIVE_PAIR_HOST_TEST",
  "__pairHostTest",
  "HostTestAutoConfirmPort",
  "createHostTestApi",
  ".host-test",
]);

/**
 * @param {string} text
 * @returns {string[]} every forbidden token present in `text`, in declaration order
 */
export const findForbiddenTokens = (text) =>
  PRODUCTION_FORBIDDEN_TOKENS.filter((token) => text.includes(token));

/**
 * Bundle the production entry point.
 *
 * @param {{ write?: boolean }} [options] when `write` is false the bundle is
 *   produced in memory only, which lets tests inspect the exact shipped code
 *   without touching the working tree.
 * @returns {Promise<{ code: string, map: string | undefined, outfile: string }>}
 */
export const buildProductionBundle = async (options = {}) => {
  const write = options.write ?? true;
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints: ["apps/vscode-extension/src/extension.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    external: ["vscode"],
    outfile: "apps/vscode-extension/dist/extension.cjs",
    // "external" emits the map as a separate file with no sourceMappingURL
    // comment in the bundle, so the shipped artifact has no dangling reference
    // once maps are excluded from the VSIX.
    sourcemap: "external",
    sourcesContent: false,
    legalComments: "external",
    logLevel: write ? "info" : "silent",
    write,
  });

  const files = result.outputFiles ?? [];
  const code = write
    ? await readFile(outfile, "utf8")
    : (files.find((file) => file.path.endsWith(".cjs"))?.text ?? "");
  const map = write
    ? undefined
    : files.find((file) => file.path.endsWith(".map"))?.text;

  return { code, map, outfile };
};

const cleanPreviousBundle = async () => {
  for (const name of [
    "dist/extension.cjs",
    "dist/extension.cjs.map",
    "dist/extension.cjs.LEGAL.txt",
  ]) {
    await rm(resolve(extensionRoot, name), { force: true });
  }
};

// Rewrite any absolute source paths to be relative to the map file so the
// published artifact never leaks a local checkout path.
const normalizeSourceMap = async () => {
  const mapPath = `${outfile}.map`;
  const raw = await readFile(mapPath, "utf8");
  const map = parseJsonObject(raw, "The generated source map");
  const mapDir = dirname(mapPath);
  const sources = stringArrayField(map, "sources").map((source) => {
    if (source.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(source)) {
      return relative(mapDir, source).split("\\").join("/");
    }
    return source;
  });
  map.sources = sources;
  map.sourceRoot = "";
  await writeFile(mapPath, `${JSON.stringify(map)}\n`, "utf8");

  for (const source of sources) {
    if (source.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(source)) {
      throw new Error(`Source map still contains an absolute path: ${source}`);
    }
  }
};

/**
 * The repository-root files copied into the extension folder so the VSIX is
 * self-contained. These copies are build artifacts and are not committed
 * (see apps/vscode-extension/.gitignore).
 */
export const STAGED_PACKAGE_FILES = Object.freeze([
  { source: "LICENSE", target: "LICENSE" },
  { source: "README.md", target: "README.md" },
  { source: "docs/growth-preview.md", target: "docs/growth-preview.md" },
]);

const stageDocs = async () => {
  for (const entry of STAGED_PACKAGE_FILES) {
    await mkdir(dirname(resolve(extensionRoot, entry.target)), { recursive: true });
    await copyFile(resolve(repoRoot, entry.source), resolve(extensionRoot, entry.target));
  }
};

const assertNoHostTestCode = async () => {
  const code = await readFile(outfile, "utf8");
  const found = findForbiddenTokens(code);
  if (found.length > 0) {
    throw new Error(
      `The production bundle contains host-test code: ${found.join(", ")}. ` +
        "Keep the host-test entry point out of src/extension.ts's module graph.",
    );
  }
};

const main = async () => {
  await cleanPreviousBundle();
  await buildProductionBundle({ write: true });
  await normalizeSourceMap();
  await assertNoHostTestCode();
  await stageDocs();
  console.log("Built apps/vscode-extension/dist/extension.cjs");
};

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
