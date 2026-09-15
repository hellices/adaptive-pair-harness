import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(path), "utf8")) as Record<string, unknown>;

describe("workspace project references", () => {
  it.each([
    ["packages/harness", "../testkit"],
    ["packages/runtime", "../testkit"],
    ["apps/vscode-extension", "../../packages/testkit"],
  ])("%s declares its testkit build and package dependency", (root, reference) => {
    const tsconfig = readJson(`${root}/tsconfig.json`) as {
      readonly references?: readonly { readonly path?: string }[];
    };
    const manifest = readJson(`${root}/package.json`) as {
      readonly dependencies?: Readonly<Record<string, string>>;
      readonly devDependencies?: Readonly<Record<string, string>>;
    };

    expect(tsconfig.references?.map(item => item.path)).toContain(reference);
    expect({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    }).toHaveProperty("@adaptive-pair/testkit", "0.2.0-preview.1");
  });
});
