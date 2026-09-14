import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PackagingError,
  packageExtension,
  prepareExtensionPackage,
} from "../package-extension.mjs";
import { STAGED_PACKAGE_FILES } from "../build-extension.mjs";
import { releaseVsixFixture } from "./zipFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const extensionRoot = resolve(repoRoot, "apps/vscode-extension");
const bundlePath = resolve(extensionRoot, "dist/extension.cjs");
let packageTemp = "";

beforeAll(async () => {
  packageTemp = await mkdtemp(join(tmpdir(), "adaptive-pair-package-"));
});

afterAll(async () => {
  if (packageTemp !== "") {
    await rm(packageTemp, { recursive: true, force: true });
  }
});

const hashOf = async (path: string): Promise<string> =>
  createHash("sha256").update(await readFile(path)).digest("hex");

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

const scriptsOf = async (manifestPath: string): Promise<Record<string, string>> => {
  const manifest = await readJson(manifestPath);
  return (manifest["scripts"] ?? {}) as Record<string, string>;
};

describe("prepareExtensionPackage", () => {
  it("rebuilds a stale bundle and restages stale documentation", async () => {
    await rm(bundlePath, { force: true });
    await writeFile(bundlePath, "// stale bundle from an older source tree\n", "utf8");
    await writeFile(resolve(extensionRoot, "README.md"), "stale staged copy\n", "utf8");

    await prepareExtensionPackage();

    const bundle = await readFile(bundlePath, "utf8");
    expect(bundle).not.toContain("stale bundle from an older source tree");
    expect(bundle).toContain("activate");
    for (const entry of STAGED_PACKAGE_FILES) {
      expect(await hashOf(resolve(extensionRoot, entry.target))).toBe(
        await hashOf(resolve(repoRoot, entry.source)),
      );
    }
  }, 120_000);

  it("rebuilds a missing bundle before packaging", async () => {
    await rm(bundlePath, { force: true });

    await prepareExtensionPackage();

    expect(existsSync(bundlePath)).toBe(true);
  }, 120_000);

  it("builds before it inspects staging", async () => {
    const order: string[] = [];

    await prepareExtensionPackage({
      build: () => {
        order.push("build");
        return Promise.resolve();
      },
      inspect: () => {
        order.push("inspect");
        return Promise.resolve([]);
      },
    });

    expect(order).toEqual(["build", "inspect"]);
  });

  it("refuses to package when the staged tree is still incomplete", async () => {
    const attempt = prepareExtensionPackage({
      build: () => Promise.resolve(),
      inspect: () =>
        Promise.resolve(["The production bundle dist/extension.cjs is missing."]),
    });

    await expect(attempt).rejects.toBeInstanceOf(PackagingError);
    await expect(attempt).rejects.toThrow(/dist\/extension\.cjs is missing/u);
  });
});

describe("packageExtension", () => {
  const prepared = {
    build: () => Promise.resolve(),
    inspect: () => Promise.resolve([]),
  };

  it("verifies the archive that the packaging tool produced", async () => {
    const produced: string[] = [];
    const vsixPath = join(packageTemp, "verified.vsix");

    const result = await packageExtension({
      ...prepared,
      vsixPath,
      runVsce: (vsixPath: string) => {
        produced.push(vsixPath);
        return writeFile(vsixPath, releaseVsixFixture());
      },
    });

    expect(produced).toEqual([vsixPath]);
    expect(result.violations).toEqual([]);
  });

  it("fails when the produced archive would ship an unexpected entry", async () => {
    const vsixPath = join(packageTemp, "unexpected-entry.vsix");
    const attempt = packageExtension({
      ...prepared,
      vsixPath,
      runVsce: (vsixPath: string) =>
        writeFile(
          vsixPath,
          releaseVsixFixture({
            extra: [{ name: "extension/dist/extension.cjs.map", content: "{}" }],
          }),
        ),
    });
    await expect(attempt).rejects.toThrow(/extension\.cjs\.map/u);
    await expect(attempt).rejects.toThrow(/extension\.cjs\.map/u);
  });

  it("never runs the packaging tool when preparation fails", async () => {
    let ran = false;

    await expect(
      packageExtension({
        build: () => Promise.resolve(),
        inspect: () => Promise.resolve(["staged README.md is stale"]),
        runVsce: () => {
          ran = true;
          return Promise.resolve();
        },
      }),
    ).rejects.toBeInstanceOf(PackagingError);
    expect(ran).toBe(false);
  });

  it("removes a stale target and fails if the packaging tool produces nothing", async () => {
    const vsixPath = join(packageTemp, "missing-output.vsix");
    await writeFile(vsixPath, releaseVsixFixture());
    let verified = false;

    await expect(
      packageExtension({
        ...prepared,
        vsixPath,
        runVsce: () => Promise.resolve(),
        verify: () => {
          verified = true;
          return Promise.resolve([]);
        },
      }),
    ).rejects.toThrow(/did not produce/u);
    expect(existsSync(vsixPath)).toBe(false);
    expect(verified).toBe(false);
  });
});

describe("packaging scripts", () => {
  it("routes both the root and the workspace package script through one orchestrator", async () => {
    const root = await scriptsOf(join(repoRoot, "package.json"));
    const workspace = await scriptsOf(join(extensionRoot, "package.json"));

    expect(root["package"]).toBe("node scripts/package-extension.mjs");
    expect(workspace["package"]).toBe("node ../../scripts/package-extension.mjs");
  });

  it("never lets a bare packaging tool run as a package script", async () => {
    const root = await scriptsOf(join(repoRoot, "package.json"));
    const workspace = await scriptsOf(join(extensionRoot, "package.json"));

    for (const command of [...Object.values(root), ...Object.values(workspace)]) {
      expect(command).not.toContain("vsce");
    }
  });

  it("keeps the workspace package lifecycle free of a pre-build staging gate", async () => {
    const workspace = await scriptsOf(join(extensionRoot, "package.json"));

    // `prepackage` ran before any build, so a direct workspace package call
    // failed on a clean tree and passed on a stale one. The orchestrator owns
    // the order instead.
    expect(workspace["prepackage"]).toBeUndefined();
    expect(workspace["postpackage"]).toBeUndefined();
  });

  it("does not recurse between the root and workspace package scripts", async () => {
    const root = await scriptsOf(join(repoRoot, "package.json"));
    const workspace = await scriptsOf(join(extensionRoot, "package.json"));

    expect(root["package"]).not.toContain("npm");
    expect(workspace["package"]).not.toContain("npm");
  });
});
