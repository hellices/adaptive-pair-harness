import type * as vscode from "vscode";
import {
  boundEvidenceMessage,
  normalizeEvidenceForUi,
} from "../core/evidencePresentation";
import type { Evidence } from "../core/types";
import { runCleanupSteps } from "./pairRuntimeSupport";
import { neutralizePlainTextAutolinks } from "./plainTextAutolinks";

export const buildInlineCommentMarkdown = (
  createMarkdown: (value: string) => vscode.MarkdownString,
  question: string,
  evidence: Evidence,
): vscode.MarkdownString => {
  const boundedQuestion = boundEvidenceMessage(question);
  const boundedEvidence = normalizeEvidenceForUi(evidence);
  const confidence = Math.round(
    Math.min(1, Math.max(0, boundedEvidence.confidence)) * 100,
  );
  const markdown = createMarkdown("");
  const appendDynamicText = (value: string): void => {
    markdown.appendText(neutralizePlainTextAutolinks(value));
  };
  appendDynamicText(boundedQuestion);
  markdown.appendMarkdown("\n\n**Finding:** ");
  appendDynamicText(boundedEvidence.title);
  markdown.appendMarkdown("\n\n");
  appendDynamicText(boundedEvidence.detail);
  markdown.appendMarkdown("\n\n**Evidence:** ");
  appendDynamicText(boundedEvidence.source);
  markdown.appendMarkdown(" · ");
  appendDynamicText(`confidence ${confidence}%`);
  markdown.appendMarkdown("\n\n**References:**\n");
  if (boundedEvidence.references.length === 0) {
    markdown.appendMarkdown("- None");
  } else {
    for (const [index, reference] of boundedEvidence.references.entries()) {
      if (index > 0) {
        markdown.appendMarkdown("\n");
      }
      markdown.appendMarkdown("- ");
      appendDynamicText(reference);
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
  private controller: vscode.CommentController | undefined;
  private readonly createMarkdown: (
    value: string,
  ) => vscode.MarkdownString;
  private readonly previewMode: vscode.CommentMode;
  private disposed = false;

  public constructor(options: InlinePairControllerOptions) {
    this.controller = options.controller;
    this.createMarkdown = options.createMarkdown;
    this.previewMode = options.previewMode;
  }

  public render(
    uri: vscode.Uri,
    range: vscode.Range,
    question: string,
    evidence: Evidence,
  ): void {
    const controller = this.controller;
    if (this.disposed || controller === undefined) {
      throw new Error("Inline pair controller is disposed.");
    }
    const key = uri.toString();
    this.disposeUri(uri);

    const comment: vscode.Comment = {
      author: { name: "Adaptive Pair" },
      body: buildInlineCommentMarkdown(
        this.createMarkdown,
        question,
        evidence,
      ),
      mode: this.previewMode,
    };
    const thread = controller.createCommentThread(uri, range, [
      comment,
    ]);
    thread.canReply = false;
    thread.label = "Adaptive Pair navigator";
    this.threadsByUri.set(key, thread);
  }

  public disposeUri(uri: vscode.Uri): void {
    const key = uri.toString();
    const thread = this.threadsByUri.get(key);
    this.threadsByUri.delete(key);
    thread?.dispose();
  }

  public clear(): void;
  public clear(uri: vscode.Uri): void;
  public clear(uri?: vscode.Uri): void {
    if (uri !== undefined) {
      this.disposeUri(uri);
      return;
    }

    const threads = [...this.threadsByUri.values()];
    this.threadsByUri.clear();
    runCleanupSteps(
      threads.map((thread) => () => thread.dispose()),
      "Failed to clear all Adaptive Pair comment threads.",
    );
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const threads = [...this.threadsByUri.values()];
    this.threadsByUri.clear();
    const controller = this.controller;
    this.controller = undefined;
    runCleanupSteps(
      [
        ...threads.map((thread) => () => thread.dispose()),
        () => controller?.dispose(),
      ],
      "Failed to dispose the Adaptive Pair inline controller cleanly.",
    );
  }
}
