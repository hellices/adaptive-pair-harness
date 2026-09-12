import { describe, expect, it } from "vitest";
import { buildInlineCommentMarkdown } from "../src/vscode/inlinePairController";
import type { Evidence } from "../src/core/types";

const evidence: Evidence = {
  id: "dependency:repository",
  kind: "new-dependency",
  severity: "warning",
  title: "New dependency introduced",
  detail: "Imported a new module dependency: ./repository.",
  source: "typescript-semantic-analyzer",
  confidence: 0.94,
  range: {
    start: { line: 2, character: 18 },
    end: { line: 2, character: 32 },
  },
  references: ["./repository", "dependency policy"],
};

describe("inline pair comment", () => {
  it("renders evidence provenance, Markdown references, and navigator-only notice", () => {
    const markdown = buildInlineCommentMarkdown(
      "Did you intend this dependency?",
      evidence,
    );

    expect(markdown).toContain("Did you intend this dependency?");
    expect(markdown).toContain(
      "**Evidence:** typescript-semantic-analyzer · confidence 94%",
    );
    expect(markdown).toContain("- `./repository`");
    expect(markdown).toContain("- `dependency policy`");
    expect(markdown).toContain("Adaptive Pair has not changed code.");
  });
});
