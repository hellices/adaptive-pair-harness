import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VscodeScopeAccess } from "../src/scopeAccess.js";
import { MAX_CONTEXT_FILE_BYTES } from "../src/workspaceContext.js";

const workspace = vi.hoisted(() => ({
  documents: [] as {
    readonly uri: { readonly fsPath: string; readonly scheme: string };
    readonly isDirty: boolean;
    readonly getText: () => string;
  }[],
}));

vi.mock("vscode", () => ({
  workspace: {
    get textDocuments() {
      return workspace.documents;
    },
  },
}));

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pair-scope-binary-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "main.ts"), "saved text");
  workspace.documents = [];
});

afterEach(async () => {
  workspace.documents = [];
  await rm(root, { recursive: true, force: true });
});

const openDocument = (filename: string, text: string, isDirty = true): void => {
  workspace.documents.push({
    uri: { fsPath: filename, scheme: "file" },
    isDirty,
    getText: () => text,
  });
};

const read = () => new VscodeScopeAccess(root).readText(
  "src/main.ts",
  new AbortController().signal,
);

describe.each([false, true])("binary dirty scope buffers (symlink alias: %s)", aliased => {
  it.each(["\0prefix", "prefix\0suffix", "suffix\0"])("rejects NUL content %j", async text => {
    const target = join(root, "src", "main.ts");
    const documentPath = aliased ? join(root, "alias.ts") : target;
    if (aliased) {
      await symlink(target, documentPath);
    }
    openDocument(documentPath, text);

    await expect(read()).resolves.toEqual({ status: "binary" });
  });
});

it.each(["plain text", "literal \\0 escape", "Unicode 한글 🧪"])("retains text buffers %j", async text => {
  openDocument(join(root, "src", "main.ts"), text);

  await expect(read()).resolves.toEqual({ status: "ok", path: "src/main.ts", text });
});

it("keeps the byte limit before binary classification", async () => {
  openDocument(join(root, "src", "main.ts"), `\0${"x".repeat(MAX_CONTEXT_FILE_BYTES)}`);

  await expect(read()).resolves.toEqual({ status: "too-large" });
});

it("retains binary rejection for disk content without a dirty buffer", async () => {
  await writeFile(join(root, "src", "main.ts"), "saved\0binary");
  openDocument(join(root, "src", "main.ts"), "clean cached text", false);

  await expect(read()).resolves.toEqual({ status: "binary" });
});
