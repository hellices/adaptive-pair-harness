import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({ workspace: {}, window: {} }));

const { openEvaluationPreview } = await import("../src/evaluationPreview.js");
import type { PreviewDocument, PreviewEditorPort } from "../src/evaluationPreview.js";

describe("openEvaluationPreview", () => {
  it("opens the export JSON in an untitled editor and shows that same document", async () => {
    const json = JSON.stringify({ schema: "adaptive-pair/evaluation-export", records: [] }, null, 2);
    const untitled: PreviewDocument = { isUntitled: true, isDirty: true, getText: () => json };
    const port = {
      openUntitled: vi.fn<PreviewEditorPort["openUntitled"]>(() => Promise.resolve(untitled)),
      show: vi.fn<PreviewEditorPort["show"]>(() => Promise.resolve()),
    };

    const document = await openEvaluationPreview(json, port);

    // The port has no save operation, so opening and showing the untitled
    // document is the preview's whole effect.
    expect(port.openUntitled).toHaveBeenCalledExactlyOnceWith(json, "json");
    expect(port.show).toHaveBeenCalledExactlyOnceWith(untitled);
    expect(document).toBe(untitled);
  });
});
