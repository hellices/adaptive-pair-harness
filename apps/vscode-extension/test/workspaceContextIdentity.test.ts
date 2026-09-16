import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceContext } from "../src/workspaceContext.js";
import { VscodeWorkspaceContextAccess } from "../src/workspaceContextAccess.js";

const workspace = vi.hoisted(() => ({
  root: "",
  documents: [] as {
    readonly uri: { readonly fsPath: string };
    readonly isDirty: boolean;
    readonly version: number;
    readonly getText: () => string;
  }[],
}));

vi.mock("vscode", () => ({
  workspace: {
    get workspaceFolders() {
      return [{ uri: { fsPath: workspace.root, toString: () => `file://${workspace.root}` } }];
    },
    get textDocuments() {
      return workspace.documents;
    },
  },
  languages: { getDiagnostics: () => [] },
}));

let root: string;
let outside: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pair-open-root-"));
  outside = await mkdtemp(join(tmpdir(), "pair-open-outside-"));
  workspace.root = root;
  workspace.documents = [];
});

afterEach(async () => {
  workspace.documents = [];
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

const openDocument = (absolutePath: string, isDirty = true) => {
  const getText = vi.fn(() => "unsaved buffer text");
  workspace.documents.push({
    uri: { fsPath: absolutePath },
    isDirty,
    version: 3,
    getText,
  });
  return getText;
};

const capture = () => new WorkspaceContext(
  new VscodeWorkspaceContextAccess({ now: () => 100 }),
).capture();

describe("open document filesystem identity", () => {
  it.each([
    { exists: true, isDirty: true },
    { exists: false, isDirty: true },
    { exists: true, isDirty: false },
  ])("rejects an escaping ancestor symlink (%j)", async ({ exists, isDirty }) => {
    if (exists) {
      await writeFile(join(outside, "main.ts"), "saved outside text");
    }
    await symlink(outside, join(root, "linked"), "dir");
    const getText = openDocument(join(root, "linked", "main.ts"), isDirty);

    const snapshot = await capture();

    expect(snapshot.openPaths).toEqual([]);
    expect(snapshot.dirtyPaths).toEqual([]);
    expect(snapshot.protectedPaths).toEqual([]);
    expect(getText).not.toHaveBeenCalled();
  });

  it.each([true, false])("rejects an escaping leaf symlink (target exists: %s)", async exists => {
    const target = join(outside, "main.ts");
    if (exists) {
      await writeFile(target, "saved outside text");
    }
    await symlink(target, join(root, "alias.ts"));
    const getText = openDocument(join(root, "alias.ts"));

    const snapshot = await capture();

    expect(snapshot.openPaths).toEqual([]);
    expect(snapshot.dirtyPaths).toEqual([]);
    expect(snapshot.protectedPaths).toEqual([]);
    expect(getText).not.toHaveBeenCalled();
  });

  it("rejects a new file below a dangling ancestor symlink", async () => {
    await symlink(join(outside, "missing"), join(root, "linked"), "dir");
    const getText = openDocument(join(root, "linked", "new.ts"));

    const snapshot = await capture();

    expect(snapshot.openPaths).toEqual([]);
    expect(snapshot.protectedPaths).toEqual([]);
    expect(getText).not.toHaveBeenCalled();
  });

  it.each([".env", "src/notes.ts"])("rejects a secret buffer identity (%s)", async selected => {
    await mkdir(join(root, "src"));
    await writeFile(join(root, ".env"), "private text");
    await symlink(join(root, ".env"), join(root, "src", "notes.ts"));
    const getText = openDocument(join(root, selected));

    const snapshot = await capture();

    expect(snapshot.openPaths).toEqual([]);
    expect(snapshot.protectedPaths).toEqual([]);
    expect(getText).not.toHaveBeenCalled();
  });

  it("preserves a dirty new file under verified in-root ancestors", async () => {
    const getText = openDocument(join(root, "new", "nested", "main.ts"));

    const snapshot = await capture();

    expect(snapshot.openPaths).toEqual(["new/nested/main.ts"]);
    expect(snapshot.dirtyPaths).toEqual(["new/nested/main.ts"]);
    expect(snapshot.protectedPaths).toEqual(["new/nested/main.ts"]);
    expect(getText).toHaveBeenCalledOnce();
  });

  it("preserves an in-root symlink and the unsaved buffer size", async () => {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "main.ts"), "large saved contents".repeat(20_000));
    await symlink(join(root, "src"), join(root, "linked"), "dir");
    openDocument(join(root, "linked", "main.ts"));

    const snapshot = await capture();

    expect(snapshot.dirtyPaths).toEqual(["linked/main.ts"]);
    expect(snapshot.protectedPaths).toEqual(["linked/main.ts"]);
  });

  it.each(["root", "document"])("fails closed when %s identity is unavailable", failed => {
    const target = join(root, "main.ts");
    const getText = openDocument(target);
    const access = new VscodeWorkspaceContextAccess({ now: () => 100 }, undefined, path => {
      if (path === (failed === "root" ? root : target)) {
        throw Object.assign(new Error("identity unavailable"), { code: "EACCES" });
      }
      return path;
    });

    expect(access.openDocuments()).toEqual([]);
    expect(getText).not.toHaveBeenCalled();
  });
});
