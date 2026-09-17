import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TargetBufferIdentityUnavailableError } from "../src/verificationContracts.js";
import { codedError, vscode } from "./verificationPortFixtures.js";

const { defaultFilesystemIdentity, VscodeBufferInspectionPort } = await import(
  "../src/verificationBuffers.js"
);

const linkDirectory = (target: string, alias: string): void => {
  symlinkSync(target, alias, process.platform === "win32" ? "junction" : "dir");
};

const openDirty = (...paths: string[]): void => {
  vscode.state.textDocuments = paths.map(path => ({
    uri: { fsPath: path, scheme: "file" },
    isDirty: true,
  }));
};

let temporaryRoot: string;
let root: string;
let source: string;

beforeEach(() => {
  temporaryRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "pair-buffer-alias-")));
  root = join(temporaryRoot, "repo");
  source = join(root, "src");
  mkdirSync(source, { recursive: true });
  linkDirectory(source, join(root, "alias"));
  vscode.state.workspaceRoots = [root];
});

afterEach(() => {
  rmSync(temporaryRoot, { recursive: true, force: true });
});

describe("VscodeBufferInspectionPort — missing aliased buffers", () => {
  it.each(["deleted", "new"])("finds a %s dirty buffer through its directory alias", state => {
    const physicalPath = join(source, "a.ts");
    if (state === "deleted") {
      writeFileSync(physicalPath, "export const original = true;");
    }
    const documentPath = join(root, "alias", "a.ts");
    openDirty(documentPath);
    if (state === "deleted") {
      unlinkSync(physicalPath);
    }

    expect(() => realpathSync.native(documentPath)).toThrow(
      expect.objectContaining({ code: "ENOENT" }),
    );
    expect(new VscodeBufferInspectionPort(root).dirtyTargets(["src"])).toEqual(["src/a.ts"]);
  });

  it("resolves a new buffer through multiple missing parent directories", () => {
    openDirty(join(root, "alias", "new", "nested", "a.ts"));

    expect(new VscodeBufferInspectionPort(root).dirtyTargets(["src"])).toEqual([
      "src/new/nested/a.ts",
    ]);
  });

  it.each(["alias/new", "alias/new/a.ts"])(
    "matches a missing aliased target %s against its canonical dirty buffer",
    target => {
      openDirty(join(source, "new", "a.ts"));

      expect(new VscodeBufferInspectionPort(root).dirtyTargets([target])).toEqual([
        "src/new/a.ts",
      ]);
    },
  );

  it("deduplicates missing dirty buffers opened by canonical and aliased paths", () => {
    openDirty(join(root, "alias", "a.ts"), join(source, "a.ts"));

    expect(new VscodeBufferInspectionPort(root).dirtyTargets([])).toEqual(["src/a.ts"]);
  });

  it("preserves directly addressed new buffers", () => {
    openDirty(join(source, "a.ts"));

    expect(new VscodeBufferInspectionPort(root).dirtyTargets(["src"])).toEqual(["src/a.ts"]);
  });

  it("finds a missing in-root buffer opened through an external alias", () => {
    const alias = join(temporaryRoot, "external-alias");
    linkDirectory(source, alias);
    openDirty(join(alias, "a.ts"));

    expect(new VscodeBufferInspectionPort(root).dirtyTargets(["src"])).toEqual(["src/a.ts"]);
  });
});

describe("VscodeBufferInspectionPort — missing alias root boundaries", () => {
  const outsideAlias = (): string => {
    const outside = join(temporaryRoot, "outside");
    mkdirSync(outside);
    const alias = join(root, "external");
    linkDirectory(outside, alias);
    return alias;
  };

  it("excludes missing dirty buffers addressed through an out-of-root alias", () => {
    openDirty(join(outsideAlias(), "a.ts"));

    expect(new VscodeBufferInspectionPort(root).dirtyTargets([])).toEqual([]);
  });

  it("refuses a missing target addressed through an out-of-root alias", () => {
    outsideAlias();

    expect(() => new VscodeBufferInspectionPort(root).dirtyTargets(["external/a.ts"]))
      .toThrow(TargetBufferIdentityUnavailableError);
  });

  it("excludes missing documents under a sibling whose name shares the root prefix", () => {
    const sibling = join(temporaryRoot, "repo-other");
    mkdirSync(sibling);
    openDirty(join(sibling, "a.ts"));

    expect(new VscodeBufferInspectionPort(root).dirtyTargets([])).toEqual([]);
  });

  it.each(["inside", "outside"])(
    "refuses a dirty buffer beneath a dangling alias to a missing %s directory",
    location => {
      const target = join(location === "inside" ? root : temporaryRoot, "removed");
      const alias = join(root, "dangling");
      linkDirectory(target, alias);
      openDirty(join(alias, "a.ts"));

      expect(() => new VscodeBufferInspectionPort(root).dirtyTargets(["src"]))
        .toThrow(TargetBufferIdentityUnavailableError);
    },
  );

  it("refuses an agreed target beneath a dangling directory alias", () => {
    linkDirectory(join(root, "removed"), join(root, "dangling"));

    expect(() => new VscodeBufferInspectionPort(root).dirtyTargets(["dangling/a.ts"]))
      .toThrow(TargetBufferIdentityUnavailableError);
  });
});

describe("VscodeBufferInspectionPort — missing alias identity failures", () => {
  it.each([
    { name: "is unavailable", unresolved: () => undefined },
    {
      name: "denies access",
      unresolved: () => {
        throw codedError("EACCES");
      },
    },
  ])("refuses a missing dirty buffer when its ancestor $name", ({ unresolved }) => {
    const alias = join(root, "alias");
    openDirty(join(alias, "a.ts"));
    const identity = (path: string): string | undefined =>
      path === alias ? unresolved() : defaultFilesystemIdentity(path);

    expect(() => new VscodeBufferInspectionPort(root, identity).dirtyTargets(["src"]))
      .toThrow(TargetBufferIdentityUnavailableError);
  });

  it("does not invent an identity for a removed workspace root", () => {
    rmSync(root, { recursive: true, force: true });

    expect(() => new VscodeBufferInspectionPort(root).dirtyTargets([]))
      .toThrow(TargetBufferIdentityUnavailableError);
  });

  it("does not read filesystem identities before inspection is requested", () => {
    const identity = vi.fn(defaultFilesystemIdentity);
    const port = new VscodeBufferInspectionPort(root, identity);

    expect(identity).not.toHaveBeenCalled();
    expect(port.dirtyTargets([])).toEqual([]);
    expect(identity).toHaveBeenCalled();
  });
});
