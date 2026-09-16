import { glob, mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EffectRequest } from "@adaptive-pair/runtime";
import { afterEach, beforeEach, vi } from "vitest";

const workspace = vi.hoisted(() => ({
  documents: [] as {
    readonly uri: { readonly fsPath: string; readonly scheme: string };
    readonly isDirty: boolean;
    readonly getText: () => string;
  }[],
  foundPaths: [] as string[],
  filesystemDiscovery: false,
  searches: [] as {
    readonly baseUri: { readonly fsPath: string };
    readonly pattern: string;
    readonly exclude: string;
    readonly maximum: number;
  }[],
}));

vi.mock("vscode", () => ({
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  RelativePattern: class {
    public constructor(
      public readonly baseUri: { readonly fsPath: string },
      public readonly pattern: string,
    ) {}
  },
  workspace: {
    get textDocuments() {
      return workspace.documents;
    },
    findFiles: async (
      include: { readonly baseUri: { readonly fsPath: string }; readonly pattern: string },
      exclude: string,
      maximum: number,
    ) => {
      workspace.searches.push({ ...include, exclude, maximum });
      if (!workspace.filesystemDiscovery) {
        return workspace.foundPaths.slice(0, maximum).map(fsPath => ({ fsPath }));
      }
      const paths: { fsPath: string }[] = [];
      for await (const entry of glob(include.pattern, { cwd: include.baseUri.fsPath, exclude: [exclude] })) {
        const fsPath = join(include.baseUri.fsPath, entry);
        if ((await stat(fsPath)).isFile()) {
          paths.push({ fsPath });
        }
        if (paths.length >= maximum) {
          break;
        }
      }
      return paths;
    },
  },
}));

export const filesystem = { temporaryRoot: "", root: "", source: "", outside: "" };

export const linkDirectory = (target: string, alias: string): Promise<void> =>
  symlink(target, alias, process.platform === "win32" ? "junction" : "dir");

beforeEach(async () => {
  filesystem.temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "pair-scope-composition-")));
  filesystem.root = join(filesystem.temporaryRoot, "repo");
  filesystem.source = join(filesystem.root, "src");
  filesystem.outside = join(filesystem.temporaryRoot, "outside");
  await mkdir(filesystem.source, { recursive: true });
  await mkdir(filesystem.outside);
  await writeFile(join(filesystem.source, "main.ts"), "retry on disk\nsecond line");
  await linkDirectory(filesystem.source, join(filesystem.root, "linked"));
  workspace.documents = [];
  workspace.foundPaths = [join(filesystem.source, "main.ts")];
  workspace.filesystemDiscovery = false;
  workspace.searches = [];
});

afterEach(async () => {
  workspace.documents = [];
  vi.restoreAllMocks();
  await rm(filesystem.temporaryRoot, { recursive: true, force: true });
});

export const openBuffer = (filename: string, text: string, isDirty = true, scheme = "file") => {
  const getText = vi.fn(() => text);
  workspace.documents.push({ uri: { fsPath: filename, scheme }, isDirty, getText });
  return getText;
};

export const scopeRequest = (
  toolName: "pair_read_scope" | "pair_search_scope",
  allowedPaths: readonly string[],
  payload: Readonly<Record<string, unknown>>,
): EffectRequest => ({
  operationId: "scope-composition",
  workspaceId: "scope-workspace",
  workUnitId: "scope-unit",
  allowedPaths,
  toolName,
  kind: "read",
  payload,
  runtimeRevision: 1,
  authorityEpoch: 0,
});

export { workspace };
