import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({ workspace: {}, window: {} }));

const { openEvaluationPreview } = await import("../src/evaluationPreview.js");
import type { PreviewEditorPort } from "../src/evaluationPreview.js";

describe("openEvaluationPreview", () => {
  it("opens the export JSON in an unsaved editor and does not save it", async () => {
    const opened: { content?: string; language?: string; shown?: boolean; saved?: boolean } = {};
    const port: PreviewEditorPort = {
      openUntitled: (content, language) => {
        opened.content = content;
        opened.language = language;
        return Promise.resolve({
          isUntitled: true,
          isDirty: true,
          getText: () => content,
        });
      },
      show: (document) => {
        opened.shown = true;
        opened.saved = document.isUntitled === false;
        return Promise.resolve();
      },
    };

    const json = JSON.stringify({ schema: "adaptive-pair/evaluation-export", records: [] }, null, 2);
    const document = await openEvaluationPreview(json, port);

    expect(opened.language).toBe("json");
    expect(opened.content).toBe(json);
    expect(opened.shown).toBe(true);
    expect(document.isUntitled).toBe(true);
    expect(document.isDirty).toBe(true);
    expect(opened.saved).toBe(false);
  });
});
