import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceContext, WorkspaceContextChangedError } from "../src/workspaceContext.js";

interface FakeUri {
  readonly fsPath: string;
  readonly path: string;
  toString(): string;
}

interface FakeChange {
  readonly uri: FakeUri;
}

interface FakeRepositoryState {
  HEAD: { name: string | undefined } | undefined;
  workingTreeChanges: FakeChange[];
  indexChanges: FakeChange[];
  untrackedChanges: FakeChange[];
}

interface FakeRepository {
  rootUri: FakeUri;
  state: FakeRepositoryState;
}

const git = vi.hoisted(() => {
  const createUri = (fsPath: string): FakeUri => ({
    fsPath,
    path: fsPath,
    toString: () => `file://${fsPath}`,
  });

  const state = {
    repositories: [] as FakeRepository[],
    onDiagnostics: undefined as (() => void) | undefined,
    workspaceRoot: "/workspace",
    foundPaths: [] as FakeUri[],
    textDocuments: [] as {
      readonly uri: FakeUri;
      readonly isDirty: boolean;
      getText(): string;
    }[],
    relativePathOverride: undefined as
      | ((fsPath: string) => string | undefined)
      | undefined,
  };

  const reset = (): void => {
    state.repositories = [];
    state.onDiagnostics = undefined;
    state.workspaceRoot = "/workspace";
    state.foundPaths = [];
    state.textDocuments = [];
    state.relativePathOverride = undefined;
  };

  return { createUri, state, reset };
});

vi.mock("vscode", () => {
  const asRelativePath = (value: FakeUri | string): string => {
    const text = typeof value === "string" ? value : value.fsPath;
    const overridden = git.state.relativePathOverride?.(text);
    if (overridden !== undefined) {
      return overridden;
    }
    return text.replace(`${git.state.workspaceRoot}/`, "");
  };

  return {
    Uri: {
      file: git.createUri,
    },
    RelativePattern: class {
      public constructor(
        public readonly base: FakeUri,
        public readonly pattern: string,
      ) {}
    },
    workspace: {
      get workspaceFolders() {
        return [{ uri: git.createUri(git.state.workspaceRoot) }];
      },
      get textDocuments() {
        return git.state.textDocuments;
      },
      asRelativePath,
      findFiles: (): Promise<readonly FakeUri[]> =>
        Promise.resolve(git.state.foundPaths),
    },
    languages: {
      getDiagnostics: (): readonly [FakeUri, readonly unknown[]][] => {
        git.state.onDiagnostics?.();
        return [];
      },
    },
    extensions: {
      getExtension: (id: string) => {
        if (id !== "vscode.git") {
          return undefined;
        }
        return {
          isActive: true,
          exports: {
            getAPI: () => ({
              repositories: git.state.repositories,
            }),
          },
        };
      },
    },
  };
});

const { VscodeScopeAccess, VscodeWorkspaceContextAccess } = await import(
  "../src/workspaceContextAccess.js"
);

const clock = { now: () => 1_700_000_000_000 };

afterEach(() => {
  git.reset();
});

describe("VscodeWorkspaceContextAccess — production branch currentness", () => {
  it("marks a regular file below an escaping ancestor symlink outside the root", async () => {
    const root = await mkdtemp(join(tmpdir(), "adaptive-pair-root-"));
    const outside = await mkdtemp(join(tmpdir(), "adaptive-pair-outside-"));
    try {
      await mkdir(join(outside, "nested"));
      await writeFile(join(outside, "nested", "secret.txt"), "secret", "utf8");
      await symlink(join(outside, "nested"), join(root, "linked"), "dir");
      git.state.workspaceRoot = root;

      const inspected = await new VscodeWorkspaceContextAccess(clock).inspectPath(
        "linked/secret.txt",
      );

      expect(inspected).toMatchObject({
        exists: true,
        isFile: true,
        isSymbolicLink: false,
        withinRoot: false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("fails closed when HEAD changes on the workspace repository during capture", async () => {
    git.state.repositories = [
      {
        rootUri: git.createUri("/workspace"),
        state: {
          HEAD: { name: "feature/retry" },
          workingTreeChanges: [],
          indexChanges: [],
          untrackedChanges: [{ uri: git.createUri("/workspace/notes/scratch.md") }],
        },
      },
    ];

    git.state.onDiagnostics = () => {
      const repository = git.state.repositories[0];
      if (repository !== undefined) {
        repository.state.HEAD = { name: "main" };
      }
    };

    const access = new VscodeWorkspaceContextAccess(clock);

    await expect(new WorkspaceContext(access).capture()).rejects.toBeInstanceOf(
      WorkspaceContextChangedError,
    );
  });

  it("reads git metadata from the repository matching the workspace root", async () => {
    git.state.repositories = [
      {
        rootUri: git.createUri("/other/project"),
        state: {
          HEAD: { name: "unrelated" },
          workingTreeChanges: [],
          indexChanges: [],
          untrackedChanges: [],
        },
      },
      {
        rootUri: git.createUri("/workspace"),
        state: {
          HEAD: { name: "main" },
          workingTreeChanges: [{ uri: git.createUri("/workspace/src/a.ts") }],
          indexChanges: [],
          untrackedChanges: [],
        },
      },
    ];

    const access = new VscodeWorkspaceContextAccess(clock);
    const snapshot = await new WorkspaceContext(access).capture();

    expect(snapshot.branch).toBe("main");
  });
});

describe("VscodeScopeAccess", () => {
  it("reads dirty buffers, discovers files, and rejects unsafe paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "adaptive-pair-scope-"));
    const outside = await mkdtemp(join(tmpdir(), "adaptive-pair-scope-outside-"));
    try {
      await mkdir(join(root, "src"));
      await writeFile(join(root, "src", "retry.ts"), "disk text", "utf8");
      await writeFile(join(root, ".env"), "API_KEY=secret", "utf8");
      await writeFile(join(outside, "secret.ts"), "secret", "utf8");
      await symlink(outside, join(root, "linked"), "dir");
      await symlink(join(root, ".env"), join(root, "src", "notes.ts"));
      git.state.workspaceRoot = root;
      git.state.foundPaths = [
        git.createUri(join(root, "src", "retry.ts")),
        git.createUri(join(root, ".env")),
      ];
      git.state.textDocuments = [
        {
          uri: git.createUri(join(root, "src", "retry.ts")),
          isDirty: true,
          getText: () => "dirty buffer text",
        },
      ];

      const access = new VscodeScopeAccess(root);

      await expect(
        access.readText("src/retry.ts", new AbortController().signal),
      ).resolves.toEqual({
        status: "ok",
        path: "src/retry.ts",
        text: "dirty buffer text",
      });
      await expect(
        access.readText("linked/secret.ts", new AbortController().signal),
      ).resolves.toEqual({ status: "unsafe-path" });
      await expect(
        access.readText("src/notes.ts", new AbortController().signal),
      ).resolves.toEqual({ status: "unsafe-path" });
      await expect(
        access.readText(".env", new AbortController().signal),
      ).resolves.toEqual({ status: "unsafe-path" });
      await expect(
        access.listPaths(
          "**/*.ts",
          ["src"],
          new AbortController().signal,
        ),
      ).resolves.toEqual({
        paths: ["src/retry.ts"],
        truncated: false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("does not return a dirty buffer from another workspace root", async () => {
    const root = await mkdtemp(join(tmpdir(), "adaptive-pair-scope-root-"));
    const other = await mkdtemp(join(tmpdir(), "adaptive-pair-scope-other-"));
    try {
      await mkdir(join(root, "src"));
      await mkdir(join(other, "src"));
      await writeFile(join(root, "src", "index.ts"), "root disk text", "utf8");
      git.state.workspaceRoot = root;
      git.state.relativePathOverride = fsPath =>
        fsPath.endsWith("/src/index.ts") ? "src/index.ts" : undefined;
      git.state.textDocuments = [
        {
          uri: git.createUri(join(other, "src", "index.ts")),
          isDirty: true,
          getText: () => "other workspace secret",
        },
      ];

      await expect(
        new VscodeScopeAccess(root).readText(
          "src/index.ts",
          new AbortController().signal,
        ),
      ).resolves.toEqual({
        status: "ok",
        path: "src/index.ts",
        text: "root disk text",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(other, { recursive: true, force: true });
    }
  });
});
