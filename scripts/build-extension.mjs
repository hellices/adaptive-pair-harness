// Deterministic production bundle for the Adaptive Pair Stable preview.
//
// Produces a single Node 24 CommonJS bundle with an external source map and
// external legal comments. The bundle is the extension's `main` entry; the
// VSIX ships only this bundle plus the manifest, license, README, and Growth
// preview documentation. Source paths in the map are made relative to the
// output directory so no local absolute path is revealed.
import { build } from "esbuild";
import { rm, mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = resolve(repoRoot, "apps/vscode-extension");
const outfile = resolve(extensionRoot, "dist/extension.cjs");

const cleanPreviousBundle = async () => {
  for (const name of [
    "dist/extension.cjs",
    "dist/extension.cjs.map",
    "dist/extension.cjs.LEGAL.txt",
  ]) {
    await rm(resolve(extensionRoot, name), { force: true });
  }
};

const bundle = async () => {
  await build({
    absWorkingDir: repoRoot,
    entryPoints: ["apps/vscode-extension/src/extension.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    external: ["vscode"],
    outfile: "apps/vscode-extension/dist/extension.cjs",
    sourcemap: true,
    sourcesContent: false,
    legalComments: "external",
    logLevel: "info",
  });
};

// Rewrite any absolute source paths to be relative to the map file so the
// published artifact never leaks a local checkout path.
const normalizeSourceMap = async () => {
  const mapPath = `${outfile}.map`;
  const raw = await readFile(mapPath, "utf8");
  const map = JSON.parse(raw);
  const mapDir = dirname(mapPath);
  map.sources = (map.sources ?? []).map((source) => {
    if (source.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(source)) {
      return relative(mapDir, source).split("\\").join("/");
    }
    return source;
  });
  map.sourceRoot = "";
  await writeFile(mapPath, `${JSON.stringify(map)}\n`, "utf8");

  for (const source of map.sources) {
    if (source.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(source)) {
      throw new Error(`Source map still contains an absolute path: ${source}`);
    }
  }
};

// Copy the license, README, and Growth preview docs into the extension package
// so the VSIX is self-contained. These copies are build artifacts and are not
// committed (see apps/vscode-extension/.gitignore).
const stageDocs = async () => {
  await mkdir(resolve(extensionRoot, "docs"), { recursive: true });
  await copyFile(resolve(repoRoot, "LICENSE"), resolve(extensionRoot, "LICENSE"));
  await copyFile(resolve(repoRoot, "README.md"), resolve(extensionRoot, "README.md"));
  await copyFile(
    resolve(repoRoot, "docs/growth-preview.md"),
    resolve(extensionRoot, "docs/growth-preview.md"),
  );
};

const main = async () => {
  await cleanPreviousBundle();
  await bundle();
  await normalizeSourceMap();
  await stageDocs();
  console.log("Built apps/vscode-extension/dist/extension.cjs");
};

await main();
