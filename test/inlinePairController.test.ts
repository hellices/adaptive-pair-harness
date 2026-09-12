import { describe, expect, it } from "vitest";
import {
  InlinePairController,
  buildInlineCommentMarkdown,
} from "../src/vscode/inlinePairController";
import type { Evidence } from "../src/core/types";
import type * as vscode from "vscode";

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

  it("disposes only the closed URI's active Comment Thread", () => {
    const disposed: string[] = [];
    const controller = {
      createCommentThread: (uri: vscode.Uri) => ({
        canReply: false,
        label: undefined,
        comments: [],
        dispose: () => {
          disposed.push(uri.toString());
        },
      }),
      dispose: () => undefined,
    } as unknown as vscode.CommentController;
    const inline = new InlinePairController({
      controller,
      createMarkdown: (value) => value as unknown as vscode.MarkdownString,
      previewMode: 0 as vscode.CommentMode,
    });
    const range = {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    } as vscode.Range;
    const uriA = { toString: () => "file:///a.ts" } as vscode.Uri;
    const uriB = { toString: () => "file:///b.ts" } as vscode.Uri;

    inline.render(uriA, range, "Question A?", evidence);
    inline.render(uriB, range, "Question B?", evidence);
    const disposeUri = (
      inline as InlinePairController & { disposeUri(uri: vscode.Uri): void }
    ).disposeUri;
    expect(disposeUri).toBeTypeOf("function");
    disposeUri.call(inline, uriA);

    expect(disposed).toEqual(["file:///a.ts"]);
    inline.dispose();
    expect(disposed).toEqual(["file:///a.ts", "file:///b.ts"]);
  });

  it("clears all session threads and remains reusable", () => {
    const disposed: string[] = [];
    const controller = {
      createCommentThread: (uri: vscode.Uri) => ({
        canReply: false,
        label: undefined,
        comments: [],
        dispose: () => {
          disposed.push(uri.toString());
        },
      }),
      dispose: () => undefined,
    } as unknown as vscode.CommentController;
    const inline = new InlinePairController({
      controller,
      createMarkdown: (value) => value as unknown as vscode.MarkdownString,
      previewMode: 0 as vscode.CommentMode,
    });
    const range = {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    } as vscode.Range;
    const uriA = { toString: () => "file:///a.ts" } as vscode.Uri;
    const uriB = { toString: () => "file:///b.ts" } as vscode.Uri;

    inline.render(uriA, range, "Question A?", evidence);
    inline.render(uriB, range, "Question B?", evidence);
    inline.clear();
    inline.render(uriA, range, "Question A again?", evidence);

    expect(disposed).toEqual(["file:///a.ts", "file:///b.ts"]);
    inline.dispose();
    expect(disposed).toEqual([
      "file:///a.ts",
      "file:///b.ts",
      "file:///a.ts",
    ]);
  });
});
