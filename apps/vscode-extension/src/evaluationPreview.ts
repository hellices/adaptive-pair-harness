import * as vscode from "vscode";

export interface PreviewDocument {
  readonly isUntitled: boolean;
  readonly isDirty: boolean;
  getText(): string;
}

export interface PreviewEditorPort {
  openUntitled(content: string, language: string): Promise<PreviewDocument>;
  show(document: PreviewDocument): Promise<void>;
}

/**
 * Render the evaluation export JSON in an unsaved (untitled) editor. The
 * developer reviews it before choosing any destination; nothing is written to
 * disk here.
 */
export const openEvaluationPreview = async (
  json: string,
  port: PreviewEditorPort,
): Promise<PreviewDocument> => {
  const document = await port.openUntitled(json, "json");
  await port.show(document);
  return document;
};

export class VscodePreviewEditorPort implements PreviewEditorPort {
  public async openUntitled(
    content: string,
    language: string,
  ): Promise<PreviewDocument> {
    return await vscode.workspace.openTextDocument({ content, language });
  }

  public async show(document: PreviewDocument): Promise<void> {
    await vscode.window.showTextDocument(document as vscode.TextDocument, {
      preview: false,
    });
  }
}
