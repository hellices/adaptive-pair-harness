import { readFileSync } from "node:fs";
import { ESLint, Linter } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint();
const standaloneLimits = [
  ["eslint.config.mjs", 400, 100],
  ["vitest.config.ts", 400, 100],
  ["poc/session-target/vitest.config.mts", 400, 100],
  ["apps/vscode-extension/test/host/fixture/src/retry.ts", 600, 200],
  ["apps/vscode-extension/test/host/fixture/src/retry.mjs", 600, 200],
  ["apps/vscode-extension/test/host/fixture/run-check.mjs", 600, 200],
] as const;
const limits = [
  ["packages/runtime/src/coordinator.ts", 400, 100],
  ["apps/vscode-extension/src/presenceController.ts", 400, 100],
  ["scripts/verify-vsix.mjs", 400, 100],
  ["poc/session-target/src/extension.ts", 400, 100],
  ["packages/runtime/test/coordinator.test.ts", 600, 200],
  ["apps/vscode-extension/test/host/smoke.ts", 600, 200],
  ["scripts/test/verifyVsix.test.ts", 600, 200],
  ["poc/session-target/test/suite/sessionTargetHost.test.ts", 600, 200],
  ...standaloneLimits,
] as const;

describe("enforced code size policy", () => {
  it.each(limits)("bounds %s without exemptions", async (filePath, fileLimit, functionLimit) => {
    const config = await eslint.calculateConfigForFile(filePath) as Linter.Config;

    expect(config).toBeDefined();
    expect(config.rules?.["max-lines"]).toEqual([
      2, { max: fileLimit, skipBlankLines: true, skipComments: true },
    ]);
    expect(config.rules?.["max-lines-per-function"]).toEqual([
      2, { max: functionLimit, skipBlankLines: true, skipComments: true, IIFEs: true },
    ]);
    expect(config.linterOptions?.noInlineConfig).toBe(true);
  });

  it.each(standaloneLimits)("rejects oversized maintained fixture/config source at %s", async (filePath, fileLimit) => {
    const results = await eslint.lintText("void 0;\n".repeat(fileLimit + 1), {
      filePath,
      warnIgnored: false,
    });

    expect(results.flatMap(result => result.messages)).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "max-lines", severity: 2 }),
    ]));
  });

  it("rejects oversized files and functions with the actual configured rules", async () => {
    const config = await eslint.calculateConfigForFile(limits[0][0]) as Linter.Config;
    const rules = {
      "max-lines": config.rules?.["max-lines"],
      "max-lines-per-function": config.rules?.["max-lines-per-function"],
    };
    const lint = (code: string) => new Linter().verify(code, { rules });

    expect(lint("work();\n".repeat(401))).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "max-lines", severity: 2 }),
    ]));
    expect(lint(`function large() {\n${"  work();\n".repeat(101)}}`)).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "max-lines-per-function", severity: 2 }),
    ]));
    expect(lint(`(() => {\n${"  work();\n".repeat(101)}})();`)).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "max-lines-per-function", severity: 2 }),
    ]));
    expect(lint("\n// explanation\n".repeat(401))).toEqual([]);
  });

  it("lints all maintained graphs and treats warnings as failures", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      readonly scripts: Readonly<Record<string, string>>;
    };

    expect(manifest.scripts.lint).toBe(
      "eslint packages apps scripts eslint.config.mjs vitest.config.ts poc/session-target/src poc/session-target/test poc/session-target/vitest.config.mts --max-warnings=0",
    );
  });
});
