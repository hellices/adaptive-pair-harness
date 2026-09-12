import type * as vscode from "vscode";
import type { Evidence } from "../core/types";

export const buildInlineCommentMarkdown = (
  question: string,
  evidence: Evidence,
): string => {
  const confidence = Math.round(
    Math.min(1, Math.max(0, evidence.confidence)) * 100,
  );
  const references =
    evidence.references.length === 0
      ? "- None"
      : evidence.references
          .map((reference) => `- \`${reference.replaceAll("`", "\\`")}\``)
          .join("\n");

  return [
    question,
    "",
    `**Evidence:** ${evidence.source} · confidence ${confidence}%`,
    "",
    "**References:**",
    references,
    "",
    "_Adaptive Pair has not changed code. Use **Adaptive Pair: Review Current Block** or `@pair` for deeper discussion._",
  ].join("\n");
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
      body: this.options.createMarkdown(
        buildInlineCommentMarkdown(question, evidence),
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

  public dispose(): void {
    for (const thread of this.threadsByUri.values()) {
      thread.dispose();
    }
    this.threadsByUri.clear();
    this.options.controller.dispose();
  }
}
