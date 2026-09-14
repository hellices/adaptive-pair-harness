import { describe, expect, it, vi } from "vitest";
import { PROJECT_CONTEXT_LIMITS } from "../src/core/projectContext";
import { readProjectContext } from "../src/vscode/projectContextReader";
import type { ProjectContextAccess } from "../src/vscode/projectContextReader";

const root = "file:///workspace/shop";
const readme = `${root}/README.md`;
const content = "## Goal\nPrevent duplicate charges.\n## Acceptance criteria\n- Retries charge once.";
const access = (): ProjectContextAccess => ({
  isTrusted: () => true,
  stat: vi.fn(async (uri: string) => ({ size: 100, isFile: uri.endsWith(".md"), isSymbolicLink: false })),
  readFile: vi.fn(async () => new TextEncoder().encode(content)),
  openText: () => undefined,
});

describe("bounded project reader", () => {
  it("reads document contents and extracts context", async () => {
    const port = access();
    const project = await readProjectContext(port, root, [readme], () => true);
    expect(port.readFile).toHaveBeenCalledWith(readme);
    expect(project?.suggestedGoal).toBe("Prevent duplicate charges.");
    expect(project?.documents).toHaveLength(1);
  });

  it("does no filesystem work in an untrusted workspace", async () => {
    const port = { ...access(), isTrusted: () => false };
    const project = await readProjectContext(port, root, [readme], () => true);
    expect(port.stat).not.toHaveBeenCalled();
    expect(port.readFile).not.toHaveBeenCalled();
    expect(project?.notices.join(" ")).toContain("trust");
  });

  it("does not inspect other roots, hidden files, or unrelated source files", async () => {
    const port = access();
    const project = await readProjectContext(port, root, [
      "file:///workspace/private/README.md", `${root}/.env`, `${root}/src/app.ts`, readme,
    ], () => true);
    expect(port.readFile).toHaveBeenCalledTimes(1);
    expect(project?.documents[0]?.uri).toBe(readme);
  });

  it("rejects symlink ancestors before reading a document", async () => {
    const port = access();
    port.stat = vi.fn(async (uri: string) => ({ size: 100, isFile: uri.endsWith(".md"), isSymbolicLink: uri === `${root}/docs` }));
    const project = await readProjectContext(port, root, [`${root}/docs/plan.md`], () => true);
    expect(port.readFile).not.toHaveBeenCalled();
    expect(project?.documents).toHaveLength(0);
  });

  it("rejects oversized files before reading", async () => {
    const port = { ...access(), stat: vi.fn(async () => ({ size: 1_000_000, isFile: true, isSymbolicLink: false })) };
    const project = await readProjectContext(port, root, [readme], () => true);
    expect(port.readFile).not.toHaveBeenCalled();
    expect(project?.documents).toHaveLength(0);
  });

  it("checks byte size again when content grows after stat", async () => {
    const port = { ...access(), readFile: vi.fn(async () => new Uint8Array(100_000)) };
    const project = await readProjectContext(port, root, [readme], () => true);
    expect(project?.documents).toHaveLength(0);
  });

  it("uses the current unsaved document instead of stale disk text", async () => {
    const port = { ...access(), openText: () => "## Goal\nShip the changed requirement." };
    const project = await readProjectContext(port, root, [readme], () => true);
    expect(project?.suggestedGoal).toBe("Ship the changed requirement.");
    expect(port.readFile).not.toHaveBeenCalled();
  });

  it.each(["saved file", "unsaved buffer"])("detects sensitive suffixes before truncating the %s", async (source) => {
    const sensitiveText = "api_key=reader-suffix-credential";
    const text = `${content}\n\n## Notes\n`.padEnd(PROJECT_CONTEXT_LIMITS.documentBytes - sensitiveText.length, " ") + sensitiveText;
    const diskText = source === "saved file" ? text : content;
    const diskBytes = new TextEncoder().encode(diskText);
    const port = {
      ...access(),
      stat: vi.fn(async () => ({ size: diskBytes.byteLength, isFile: true, isSymbolicLink: false })),
      readFile: vi.fn(async () => diskBytes),
      openText: () => source === "unsaved buffer" ? text : undefined,
    };
    const project = await readProjectContext(port, root, [readme], () => true);

    expect(new TextEncoder().encode(text).byteLength).toBe(PROJECT_CONTEXT_LIMITS.documentBytes);
    expect(project?.documents[0]).toMatchObject({ sensitiveDataDetected: true, truncated: true });
    expect(project?.documents[0]?.text).not.toContain(sensitiveText);
    expect(project?.documents[0]?.text.length).toBeLessThanOrEqual(PROJECT_CONTEXT_LIMITS.documentCharacters);
    expect(port.readFile).toHaveBeenCalledTimes(source === "saved file" ? 1 : 0);
  });

  it.each([
    `api_key=rejected-buffer-credential\n${"ordinary content ".repeat(5_000)}`,
    "api_key=rejected-buffer-credential\0",
  ])("does not inherit sensitivity from rejected buffer content (%#)", async (rejectedText) => {
    const rejectedUri = `${root}/docs/rejected.md`;
    const port = { ...access(), openText: (uri: string) => uri === rejectedUri ? rejectedText : undefined };
    const project = await readProjectContext(port, root, [readme, rejectedUri], () => true);

    expect(project?.documents).toHaveLength(1);
    expect(project?.documents[0]?.uri).toBe(readme);
    expect(project?.documents[0]).not.toMatchObject({ sensitiveDataDetected: true });
  });

  it("does not load or inherit sensitivity from candidates beyond the read bound", async () => {
    const omittedUri = `${root}/docs/omitted.md`;
    const candidates = Array.from({ length: PROJECT_CONTEXT_LIMITS.documents }, (_value, index) =>
      `${root}/docs/plans/plan-${index}.md`);
    const port = {
      ...access(),
      openText: vi.fn((uri: string) => uri === omittedUri ? "api_key=unloaded-credential" : content),
    };
    const project = await readProjectContext(port, root, [...candidates, omittedUri], () => true);

    expect(port.openText).not.toHaveBeenCalledWith(omittedUri);
    expect(project?.documents).toHaveLength(PROJECT_CONTEXT_LIMITS.documents);
    for (const retained of project!.documents) {
      expect(retained).not.toMatchObject({ sensitiveDataDetected: true });
    }
  });

  it("cancels between stat and read instead of returning stale context", async () => {
    let current = true;
    const port = { ...access(), stat: vi.fn(async () => {
      current = false;
      return { size: 100, isFile: true, isSymbolicLink: false };
    }) };
    const project = await readProjectContext(port, root, [readme], () => current);
    expect(project).toBeUndefined();
    expect(port.readFile).not.toHaveBeenCalled();
  });

  it("does not retain a read that finishes after stop", async () => {
    let current = true;
    const port = { ...access(), readFile: vi.fn(async () => {
      current = false;
      return new TextEncoder().encode(content);
    }) };
    expect(await readProjectContext(port, root, [readme], () => current)).toBeUndefined();
  });

  it("isolates unreadable documents and limits read attempts", async () => {
    const port = { ...access(), readFile: vi.fn(async () => { throw new Error("permission denied"); }) };
    const uris = Array.from({ length: 50 }, (_, index) => `${root}/docs/plan-${index}.md`);
    const project = await readProjectContext(port, root, uris, () => true);
    expect(port.readFile.mock.calls.length).toBeLessThanOrEqual(5);
    expect(project?.documents).toHaveLength(0);
    expect(project?.notices.length).toBeGreaterThan(0);
  });
});
