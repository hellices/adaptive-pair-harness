import { describe, expect, it, vi } from "vitest";
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

const createTestMarkdown = (value: string): vscode.MarkdownString => {
  const markdown = {
    value,
    appendText(text: string) {
      this.value += text;
      return this;
    },
    appendMarkdown(text: string) {
      this.value += text;
      return this;
    },
  };
  return markdown as unknown as vscode.MarkdownString;
};

describe("inline pair comment", () => {
  it("renders evidence provenance, Markdown references, and navigator-only notice", () => {
    const rendered = buildInlineCommentMarkdown(
      createTestMarkdown,
      "Did you intend this dependency?",
      evidence,
    );

    expect(rendered.value).toContain("Did you intend this dependency?");
    expect(rendered.value).toContain("**Finding:** New dependency introduced");
    expect(rendered.value).toContain(
      "Imported a new module dependency: ./repository.",
    );
    expect(rendered.value).toContain(
      "**Evidence:** typescript-semantic-analyzer · confidence 94%",
    );
    expect(rendered.value).toContain("- ./repository");
    expect(rendered.value).toContain("- dependency policy");
    expect(rendered.value).toContain("Adaptive Pair has not changed code.");
  });

  it("appends every dynamic field as escaped text instead of raw Markdown", () => {
    const appendedText: string[] = [];
    const appendedMarkdown: string[] = [];
    const initialValues: string[] = [];
    const markdown = {
      appendText: vi.fn((value: string) => {
        appendedText.push(value);
        return markdown;
      }),
      appendMarkdown: vi.fn((value: string) => {
        appendedMarkdown.push(value);
        return markdown;
      }),
    } as unknown as vscode.MarkdownString;
    const controller = {
      createCommentThread: (
        _uri: vscode.Uri,
        _range: vscode.Range,
        comments: readonly vscode.Comment[],
      ) => ({
        canReply: false,
        label: undefined,
        comments,
        dispose: () => undefined,
      }),
      dispose: () => undefined,
    } as unknown as vscode.CommentController;
    const inline = new InlinePairController({
      controller,
      createMarkdown: (value) => {
        initialValues.push(value);
        return markdown;
      },
      previewMode: 0 as vscode.CommentMode,
    });
    const maliciousEvidence: Evidence = {
      ...evidence,
      title: "[Spoofed finding](command:workbench.action.closeWindow)",
      detail: "<img src=x onerror=alert(1)>",
      source: "**trusted**",
      references: [
        "[Open command](command:workbench.action.openSettings)",
        "`break-out` **bold**",
      ],
    };

    inline.render(
      { toString: () => "file:///safe.ts" } as vscode.Uri,
      {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      } as vscode.Range,
      "[Question](command:workbench.action.reloadWindow)",
      maliciousEvidence,
    );

    expect(initialValues).toEqual([""]);
    expect(appendedText).toEqual([
      "[Question](command:workbench.action.reloadWindow)",
      maliciousEvidence.title,
      maliciousEvidence.detail,
      maliciousEvidence.source,
      ...maliciousEvidence.references,
    ]);
    expect(appendedMarkdown.join("")).not.toContain(
      "command:workbench.action",
    );
    expect(appendedMarkdown.join("")).not.toContain("<img");
  });

  it("normalizes and bounds every dynamic inline field with an ellipsis", () => {
    const appendedText: string[] = [];
    const markdown = {
      appendText: vi.fn((value: string) => {
        appendedText.push(value);
        return markdown;
      }),
      appendMarkdown: vi.fn(() => markdown),
    } as unknown as vscode.MarkdownString;
    const huge = (prefix: string): string =>
      `${prefix}\n${"payload".repeat(300)}`;

    buildInlineCommentMarkdown(
      () => markdown,
      huge("Question prefix"),
      {
        ...evidence,
        title: huge("Title prefix"),
        detail: huge("Detail prefix"),
        source: huge("Source prefix"),
        references: Array.from({ length: 12 }, (_, index) =>
          huge(`Reference ${index}`),
        ),
      },
    );

    expect(appendedText).toHaveLength(12);
    expect(appendedText[0]?.length).toBeLessThanOrEqual(1_000);
    expect(appendedText[1]?.length).toBeLessThanOrEqual(120);
    expect(appendedText[2]?.length).toBeLessThanOrEqual(500);
    expect(appendedText[3]?.length).toBeLessThanOrEqual(120);
    for (const field of appendedText) {
      expect(field).not.toMatch(/[\r\n]/u);
      expect(field.endsWith("…")).toBe(true);
    }
    for (const reference of appendedText.slice(4)) {
      expect(reference.length).toBeLessThanOrEqual(240);
    }
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
      createMarkdown: createTestMarkdown,
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
    let controllerDisposed = false;
    const disposeController = vi.fn();
    const controller = {
      createCommentThread: (uri: vscode.Uri) => {
        if (controllerDisposed) {
          throw new Error("Cannot create a thread after controller disposal.");
        }
        return {
          canReply: false,
          label: undefined,
          comments: [],
          dispose: () => {
            disposed.push(uri.toString());
          },
        };
      },
      dispose: () => {
        if (controllerDisposed) {
          throw new Error("Comment controller disposed more than once.");
        }
        controllerDisposed = true;
        disposeController();
      },
    } as unknown as vscode.CommentController;
    const inline = new InlinePairController({
      controller,
      createMarkdown: createTestMarkdown,
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
    expect(controllerDisposed).toBe(false);
    expect(disposeController).not.toHaveBeenCalled();
    inline.render(uriA, range, "Question A again?", evidence);

    expect(disposed).toEqual(["file:///a.ts", "file:///b.ts"]);
    inline.dispose();
    expect(controllerDisposed).toBe(true);
    expect(disposeController).toHaveBeenCalledOnce();
    expect(disposed).toEqual([
      "file:///a.ts",
      "file:///b.ts",
      "file:///a.ts",
    ]);
  });

  it("forgets a targeted thread before its disposal failure", () => {
    const disposed: string[] = [];
    const controller = {
      createCommentThread: (uri: vscode.Uri) => ({
        canReply: false,
        label: undefined,
        comments: [],
        dispose: () => {
          disposed.push(uri.toString());
          if (uri.toString() === "file:///a.ts") {
            throw new Error("thread A disposal failed");
          }
        },
      }),
      dispose: () => undefined,
    } as unknown as vscode.CommentController;
    const inline = new InlinePairController({
      controller,
      createMarkdown: createTestMarkdown,
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

    expect(() => inline.clear(uriA)).toThrow(
      "thread A disposal failed",
    );
    expect(() => inline.clear(uriA)).not.toThrow();
    inline.render(uriB, range, "Question B again?", evidence);

    expect(disposed).toEqual(["file:///a.ts", "file:///b.ts"]);
  });

  it("finalizes state and attempts every resource before aggregating disposal failures", () => {
    const attempts: string[] = [];
    let controllerDisposed = false;
    const controller = {
      createCommentThread: (uri: vscode.Uri) => {
        if (controllerDisposed) {
          throw new Error("controller already disposed");
        }
        return {
          canReply: false,
          label: undefined,
          comments: [],
          dispose: () => {
            attempts.push(uri.toString());
            throw new Error(`${uri.toString()} disposal failed`);
          },
        };
      },
      dispose: () => {
        controllerDisposed = true;
        attempts.push("controller");
        throw new Error("controller disposal failed");
      },
    } as unknown as vscode.CommentController;
    const inline = new InlinePairController({
      controller,
      createMarkdown: createTestMarkdown,
      previewMode: 0 as vscode.CommentMode,
    });
    const range = {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    } as vscode.Range;
    inline.render(
      { toString: () => "file:///a.ts" } as vscode.Uri,
      range,
      "Question A?",
      evidence,
    );
    inline.render(
      { toString: () => "file:///b.ts" } as vscode.Uri,
      range,
      "Question B?",
      evidence,
    );

    let failure: unknown;
    try {
      inline.dispose();
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toHaveLength(3);
    expect(attempts).toEqual([
      "file:///a.ts",
      "file:///b.ts",
      "controller",
    ]);
    expect(() => inline.dispose()).not.toThrow();
    expect(() =>
      inline.render(
        { toString: () => "file:///c.ts" } as vscode.Uri,
        range,
        "Question C?",
        evidence,
      ),
    ).toThrow("disposed");
  });
});
