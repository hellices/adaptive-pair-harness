import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isMainModule } from "../mainModule.mjs";
import { releaseVsixFixture } from "./zipFixture.js";

const run = promisify(execFile);
const scriptsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(scriptsDir, "..");

/** No filesystem access: unit cases describe hypothetical checkouts. */
const identity = (path: string): string => path;

const urlOf = (path: string): string => pathToFileURL(path).href;

describe("isMainModule", () => {
  it("recognizes a module invoked by its own absolute path", () => {
    expect(
      isMainModule(urlOf("/repo/scripts/build-extension.mjs"), "/repo/scripts/build-extension.mjs", {
        platform: "linux",
        realpath: identity,
      }),
    ).toBe(true);
  });

  it("recognizes a checkout path containing spaces", () => {
    const path = "/home/dev/my checkout/scripts/verify-vsix.mjs";

    expect(urlOf(path)).toContain("%20");
    expect(isMainModule(urlOf(path), path, { platform: "linux", realpath: identity })).toBe(true);
  });

  it("recognizes a checkout path containing non-ASCII characters", () => {
    const path = "/home/dev/체크아웃 ✨/scripts/verify-vsix.mjs";

    expect(urlOf(path)).toContain("%");
    expect(isMainModule(urlOf(path), path, { platform: "linux", realpath: identity })).toBe(true);
  });

  it("recognizes a relative invocation against the working directory", () => {
    expect(
      isMainModule(
        urlOf("/home/dev/my checkout/scripts/verify-vsix.mjs"),
        "scripts/verify-vsix.mjs",
        { platform: "linux", cwd: "/home/dev/my checkout", realpath: identity },
      ),
    ).toBe(true);
  });

  it("recognizes a file URL passed as the process entry", () => {
    const path = "/home/dev/my checkout/scripts/verify-vsix.mjs";

    expect(
      isMainModule(urlOf(path), urlOf(path), { platform: "linux", realpath: identity }),
    ).toBe(true);
  });

  it("applies Windows path semantics on win32", () => {
    const url = "file:///C:/Users/dev/My%20Checkout/scripts/verify-vsix.mjs";
    const options = { platform: "win32", realpath: identity } as const;

    expect(
      isMainModule(url, "C:\\Users\\dev\\My Checkout\\scripts\\verify-vsix.mjs", options),
    ).toBe(true);
    expect(
      isMainModule(url, "c:\\users\\dev\\my checkout\\scripts\\verify-vsix.mjs", options),
    ).toBe(true);
    expect(isMainModule(url, "C:/Users/dev/My Checkout/scripts/verify-vsix.mjs", options)).toBe(
      true,
    );
    expect(
      isMainModule(url, "scripts\\verify-vsix.mjs", {
        ...options,
        cwd: "C:\\Users\\dev\\My Checkout",
      }),
    ).toBe(true);
    expect(
      isMainModule(url, "C:\\Users\\dev\\My Checkout\\scripts\\build-extension.mjs", options),
    ).toBe(false);
  });

  it("resolves symlinked entry points through the real path", () => {
    const realpath = (path: string): string =>
      path.startsWith("/var/") ? `/private${path}` : path;

    expect(
      isMainModule(urlOf("/private/var/run/scripts/verify-vsix.mjs"), "/var/run/scripts/verify-vsix.mjs", {
        platform: "linux",
        realpath,
      }),
    ).toBe(true);
  });

  it("stays false when another file is the process entry", () => {
    expect(
      isMainModule(urlOf("/repo/scripts/verify-vsix.mjs"), "/repo/node_modules/vitest/dist/cli.js", {
        platform: "linux",
        realpath: identity,
      }),
    ).toBe(false);
  });

  it("stays false when there is no process entry at all", () => {
    const options = { platform: "linux", realpath: identity } as const;

    expect(isMainModule(urlOf("/repo/scripts/verify-vsix.mjs"), undefined, options)).toBe(false);
    expect(isMainModule(urlOf("/repo/scripts/verify-vsix.mjs"), "", options)).toBe(false);
  });

  it("stays false for a module that is not a file URL", () => {
    expect(
      isMainModule("data:text/javascript,export%20default%201", "/repo/scripts/verify-vsix.mjs", {
        platform: "linux",
        realpath: identity,
      }),
    ).toBe(false);
  });
});

describe("release scripts in a checkout whose path needs URL decoding", () => {
  let checkout = "";
  let temp = "";

  const nodeRun = async (
    args: readonly string[],
    cwd: string,
  ): Promise<{ stdout: string; stderr: string; code: number }> => {
    try {
      const result = await run(process.execPath, [...args], { cwd });
      return { stdout: result.stdout, stderr: result.stderr, code: 0 };
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? "",
        code: failure.code ?? 1,
      };
    }
  };

  beforeAll(async () => {
    temp = await mkdtemp(join(tmpdir(), "adaptive-pair-guard-"));
    checkout = join(temp, "release checkout ✨ 체크아웃");

    await mkdir(join(checkout, "scripts"), { recursive: true });
    await mkdir(join(checkout, "docs"), { recursive: true });
    await mkdir(join(checkout, "apps/vscode-extension/src"), { recursive: true });
    await symlink(join(repoRoot, "node_modules"), join(checkout, "node_modules"), "dir");

    for (const name of [
      "mainModule.mjs",
      "json.mjs",
      "build-extension.mjs",
      "assert-package-staging.mjs",
      "verify-vsix.mjs",
    ]) {
      await copyFile(join(scriptsDir, name), join(checkout, "scripts", name));
    }

    await writeFile(join(checkout, "LICENSE"), "Apache-2.0\n", "utf8");
    await writeFile(join(checkout, "README.md"), "# Adaptive Pair\n", "utf8");
    await writeFile(join(checkout, "docs/growth-preview.md"), "# Growth preview\n", "utf8");
    await writeFile(
      join(checkout, "apps/vscode-extension/package.json"),
      `${JSON.stringify(
        {
          name: "adaptive-pair",
          version: "0.2.0-preview.1",
          main: "./dist/extension.cjs",
          files: ["dist/extension.cjs", "LICENSE", "README.md", "docs/growth-preview.md"],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      join(checkout, "apps/vscode-extension/src/extension.ts"),
      "export const activate = (): void => undefined;\n",
      "utf8",
    );
    await writeFile(
      join(checkout, "scripts/import-probe.mjs"),
      [
        'await import("./build-extension.mjs");',
        'await import("./assert-package-staging.mjs");',
        'await import("./verify-vsix.mjs");',
        'console.log("imported with no side effect");',
        "",
      ].join("\n"),
      "utf8",
    );
  }, 60_000);

  afterAll(async () => {
    if (temp !== "") {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("builds the production bundle when invoked by absolute path", async () => {
    const result = await nodeRun([join(checkout, "scripts/build-extension.mjs")], checkout);

    expect(result.stderr + result.stdout).toContain("Built apps/vscode-extension/dist/extension.cjs");
    expect(result.code).toBe(0);
    await expect(
      readFile(join(checkout, "apps/vscode-extension/dist/extension.cjs"), "utf8"),
    ).resolves.toContain("activate");
  }, 60_000);

  it("checks packaging staging when invoked by a relative path", async () => {
    await run(process.execPath, [join(checkout, "scripts/build-extension.mjs")], { cwd: checkout });

    const result = await nodeRun(["scripts/assert-package-staging.mjs"], checkout);

    expect(result.stdout + result.stderr).toContain("[prepackage]");
    expect(result.code).toBe(0);
  }, 60_000);

  it("verifies a VSIX when invoked by absolute path", async () => {
    const vsix = join(checkout, "release.vsix");
    await writeFile(vsix, releaseVsixFixture());

    const result = await nodeRun([join(checkout, "scripts/verify-vsix.mjs"), vsix], checkout);

    expect(result.stdout + result.stderr).toContain("[verify-vsix]");
    expect(result.stdout).toContain("passed with 7 entries");
    expect(result.code).toBe(0);
  }, 60_000);

  it("runs nothing when the scripts are imported instead of executed", async () => {
    const result = await nodeRun([join(checkout, "scripts/import-probe.mjs")], checkout);

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("imported with no side effect");
    expect(result.stdout).not.toContain("[verify-vsix]");
    expect(result.stdout).not.toContain("[prepackage]");
    expect(result.stdout).not.toContain("Built apps/vscode-extension");
  }, 60_000);
});

describe("release script sources", () => {
  it("never compares import.meta.url against a hand-built file URL", async () => {
    const sources = [
      "build-extension.mjs",
      "assert-package-staging.mjs",
      "verify-vsix.mjs",
      "test-extension-host.mjs",
      "host-test-support.mjs",
    ];

    for (const name of sources) {
      const text = await readFile(join(scriptsDir, name), "utf8");
      expect(text, `${name} builds a file URL from process.argv`).not.toContain(
        "file://${process.argv",
      );
    }
  });

  it("guards every executable release script with the shared helper", async () => {
    for (const name of ["build-extension.mjs", "assert-package-staging.mjs", "verify-vsix.mjs"]) {
      const text = await readFile(join(scriptsDir, name), "utf8");
      expect(text, `${name} does not use isMainModule`).toContain("isMainModule(import.meta.url)");
    }
  });
});
