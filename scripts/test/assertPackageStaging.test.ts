import { describe, expect, it } from "vitest";
import { inspectStagedPackageFiles } from "../assert-package-staging.mjs";

describe("inspectStagedPackageFiles", () => {
  const staged = [
    { target: "LICENSE", sourceHash: "a", stagedHash: "a", exists: true },
    { target: "README.md", sourceHash: "b", stagedHash: "b", exists: true },
    {
      target: "docs/growth-preview.md",
      sourceHash: "c",
      stagedHash: "c",
      exists: true,
    },
  ];

  const options = {
    bundleExists: true,
    legalNoticeExists: false,
    allowlist: ["dist/extension.cjs", "LICENSE", "README.md", "docs/growth-preview.md"],
  };

  it("accepts staged copies that match the repository sources", () => {
    expect(inspectStagedPackageFiles(staged, options)).toEqual([]);
  });

  it("refuses to package a generated legal notice that the allowlist would drop", () => {
    const violations = inspectStagedPackageFiles(staged, {
      ...options,
      legalNoticeExists: true,
    });

    expect(violations.join("\n")).toContain("dist/extension.cjs.LEGAL.txt");

    expect(
      inspectStagedPackageFiles(staged, {
        ...options,
        legalNoticeExists: true,
        allowlist: [...options.allowlist, "dist/extension.cjs.LEGAL.txt"],
      }),
    ).toEqual([]);
  });

  it("reports a missing staged copy so packaging cannot silently omit docs", () => {
    const violations = inspectStagedPackageFiles(
      [
        ...staged.slice(0, 2),
        {
          target: "docs/growth-preview.md",
          sourceHash: "c",
          stagedHash: undefined,
          exists: false,
        },
      ],
      options,
    );

    expect(violations.join("\n")).toContain("docs/growth-preview.md");
    expect(violations.join("\n")).toContain("missing");
  });

  it("reports a stale staged copy", () => {
    const violations = inspectStagedPackageFiles(
      [{ target: "README.md", sourceHash: "b", stagedHash: "old", exists: true }],
      options,
    );

    expect(violations.join("\n")).toContain("README.md");
    expect(violations.join("\n")).toContain("stale");
  });

  it("reports a missing production bundle", () => {
    const violations = inspectStagedPackageFiles(staged, {
      ...options,
      bundleExists: false,
    });

    expect(violations.join("\n")).toContain("dist/extension.cjs");
  });
});
