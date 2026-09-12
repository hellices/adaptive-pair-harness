import type * as vscode from "vscode";
import type { Evidence } from "../core/types";

export const buildInlineCommentMarkdown = (
  createMarkdown: (value: string) => vscode.MarkdownString,
  question: string,
  evidence: Evidence,
): vscode.MarkdownString => {
  const confidence = Math.round(
    Math.min(1, Math.max(0, evidence.confidence)) * 100,
  );
  const markdown = createMarkdown("");
  markdown.appendText(question);
  markdown.appendMarkdown("\n\n**Finding:** ");
  markdown.appendText(evidence.title);
  markdown.appendMarkdown("\n\n");
  markdown.appendText(evidence.detail);
  markdown.appendMarkdown("\n\n**Evidence:** ");
  markdown.appendText(evidence.source);
  markdown.appendMarkdown(` · confidence ${confidence}%`);
  markdown.appendMarkdown("\n\n**References:**\n");
  if (evidence.references.length === 0) {
    markdown.appendMarkdown("- None");
  } else {
    for (const [index, reference] of evidence.references.entries()) {
      if (index > 0) {
        markdown.appendMarkdown("\n");
      }
      markdown.appendMarkdown("- ");
      markdown.appendText(reference);
    }
  }
  markdown.appendMarkdown(
    "\n\n_Adaptive Pair has not changed code. Use **Adaptive Pair: Review Current Block** or `@pair` for deeper discussion._",
  );
  return markdown;
};

export interface InlinePairControllerOptions {
  readonly controller: vscode.CommentController;
  readonly createMarkdown: (value: string) => vscode.MarkdownString;
  readonly previewMode: vscode.CommentMode;
}

export class InlinePairController implements vscode.Disposable {
  private readonly threadsByUri = new Map<string, vscode.CommentThread>();

  public constructor(private readonly options: InlinePairControllerOptions) {}

  public render(
    uri: vscode.Uri,
    range: vscode.Range,
    question: string,
    evidence: Evidence,
  ): void {
    const key = uri.toString();
    this.threadsByUri.get(key)?.dispose();

    const comment: vscode.Comment = {
      author: { name: "Adaptive Pair" },
      body: buildInlineCommentMarkdown(
        this.options.createMarkdown,
        question,
        evidence,
      ),
      mode: this.options.previewMode,
    };
    const thread = this.options.controller.createCommentThread(uri, range, [
      comment,
    ]);
    thread.canReply = false;
    thread.label = "Adaptive Pair navigator";
    this.threadsByUri.set(key, thread);
  }

  public disposeUri(uri: vscode.Uri): void {
    const key = uri.toString();
    this.threadsByUri.get(key)?.dispose();
    this.threadsByUri.delete(key);
  }

  public clear(): void {
    for (const thread of this.threadsByUri.values()) {
      thread.dispose();
    }
    this.threadsByUri.clear();
  }

  public dispose(): void {
    this.clear();
    this.options.controller.dispose();
  }
}
