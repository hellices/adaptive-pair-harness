import { describe, expect, it } from "vitest";
import { ObservationWindow, buildEntrySnapshot } from "../src/index.js";

describe("Pair Presence", () => {
  it("bounds local observations without retaining raw keystrokes", () => {
    const window = new ObservationWindow(2);

    window.record({
      kind: "edit-episode",
      range: {
        start: { line: 4, character: 0 },
        end: { line: 8, character: 12 },
      },
      summary: "changed retry branch",
      observedAt: 1,
      rawBuffer: "const leaked = true;",
    } as Parameters<ObservationWindow["record"]>[0] & { rawBuffer: string });
    window.record({ kind: "diagnostic", summary: "one type error", observedAt: 2 });
    window.record({ kind: "navigation", summary: "opened payment test", observedAt: 3 });

    const snapshot = window.snapshot();

    expect(snapshot.map(item => item.observedAt)).toEqual([2, 3]);
    expect(snapshot[0]).not.toHaveProperty("rawBuffer");
  });

  it("keeps retained edit episodes free of raw buffers and unknown fields", () => {
    const window = new ObservationWindow(3);

    window.record({
      kind: "edit-episode",
      range: {
        start: { line: 4, character: 0 },
        end: { line: 8, character: 12 },
      },
      summary: "changed retry branch",
      observedAt: 1,
      rawBuffer: "const leaked = true;",
      scratch: "debug-only",
    } as Parameters<ObservationWindow["record"]>[0] & {
      rawBuffer: string;
      scratch: string;
    });
    window.record({ kind: "diagnostic", summary: "one type error", observedAt: 2 });
    window.record({ kind: "navigation", summary: "opened payment test", observedAt: 3 });

    const snapshot = window.snapshot();

    expect(snapshot.map(item => item.observedAt)).toEqual([1, 2, 3]);
    expect(snapshot[0]).toEqual({
      kind: "edit-episode",
      range: {
        start: { line: 4, character: 0 },
        end: { line: 8, character: 12 },
      },
      summary: "changed retry branch",
      observedAt: 1,
    });
    expect(snapshot[0]).not.toHaveProperty("rawBuffer");
    expect(snapshot[0]).not.toHaveProperty("scratch");
  });

  it("clones and freezes recorded range summaries", () => {
    const window = new ObservationWindow(1);
    const episode = {
      kind: "edit-episode" as const,
      range: {
        start: { line: 1, character: 2 },
        end: { line: 3, character: 4 },
      },
      summary: "updated retry helper",
      observedAt: 4,
    };

    window.record(episode);
    const snapshot = window.snapshot();

    episode.range.start.line = 99;

    expect(snapshot).toEqual([
      {
        kind: "edit-episode",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 3, character: 4 },
        },
        summary: "updated retry helper",
        observedAt: 4,
      },
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot[0])).toBe(true);
    expect(Object.isFrozen(snapshot[0]?.range)).toBe(true);
  });

  it("marks all dirty entry paths as developer-owned", () => {
    const entry = buildEntrySnapshot({
      workspaceId: "w",
      branch: "feature/retry",
      dirtyPaths: ["src/pay.ts", "src/pay.ts"],
      openPaths: ["src/pay.ts", "src/flow.ts"],
      diagnostics: ["a", "a", "b"],
      protectedPaths: ["README.md", "README.md"],
      capturedAt: 10,
    });

    expect(entry).toEqual({
      workspaceId: "w",
      branch: "feature/retry",
      dirtyPaths: ["src/pay.ts"],
      openPaths: ["src/flow.ts", "src/pay.ts"],
      diagnostics: ["a", "b"],
      protectedPaths: ["README.md", "src/pay.ts"],
      capturedAt: 10,
    });
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.dirtyPaths)).toBe(true);
    expect(Object.isFrozen(entry.protectedPaths)).toBe(true);
  });

  it("preserves an omitted branch while bounding diagnostics", () => {
    const entry = buildEntrySnapshot({
      workspaceId: "w",
      dirtyPaths: [],
      openPaths: [],
      diagnostics: Array.from({ length: 55 }, (_, index) => `diag-${index}`),
      protectedPaths: [],
      capturedAt: 11,
    });

    expect(entry).not.toHaveProperty("branch");
    expect(entry.diagnostics).toHaveLength(50);
    expect(entry.diagnostics.at(0)).toBe("diag-0");
    expect(entry.diagnostics.at(-1)).toBe("diag-49");
  });
});
