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

interface FakeDiagnostic {
  readonly range: { readonly start: { readonly line: number } };
  readonly message: string;
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
    additionalWorkspaceRoots: [] as string[],
    foundPaths: [] as FakeUri[],
    textDocuments: [] as {
      readonly uri: FakeUri;
      readonly isDirty: boolean;
      readonly version?: number;
      getText(): string;
    }[],
    diagnostics: [] as [FakeUri, readonly FakeDiagnostic[]][],
    relativePathOverride: undefined as
      | ((fsPath: string) => string | undefined)
      | undefined,
    findRequests: [] as { readonly base: FakeUri; readonly pattern: string }[],
  };

  const reset = (): void => {
    state.repositories = [];
    state.onDiagnostics = undefined;
    state.workspaceRoot = "/workspace";
    state.additionalWorkspaceRoots = [];
    state.foundPaths = [];
    state.textDocuments = [];
    state.diagnostics = [];
    state.relativePathOverride = undefined;
    state.findRequests = [];
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
    const root = [
      git.state.workspaceRoot,
      ...git.state.additionalWorkspaceRoots,
    ].find(candidate => text.startsWith(`${candidate}/`));
    return root === undefined ? text : text.slice(root.length + 1);
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
        return [
          git.state.workspaceRoot,
          ...git.state.additionalWorkspaceRoots,
        ].map(root => ({ uri: git.createUri(root) }));
      },
      get textDocuments() {
        return git.state.textDocuments;
      },
      asRelativePath,
      findFiles: (
        include: { readonly base: FakeUri; readonly pattern: string },
      ): Promise<readonly FakeUri[]> => {
        git.state.findRequests.push(include);
        return Promise.resolve(git.state.foundPaths);
      },
    },
    languages: {
      getDiagnostics: (): readonly [FakeUri, readonly FakeDiagnostic[]][] => {
        git.state.onDiagnostics?.();
        return git.state.diagnostics;
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
  it("collects duplicate-path open documents only from the first workspace root", () => {
    git.state.additionalWorkspaceRoots = ["/other-workspace"];
    git.state.textDocuments = [
      {
        uri: git.createUri("/workspace/src/main.ts"),
        version: 3,
        isDirty: false,
        getText: () => "first root",
      },
      {
        uri: git.createUri("/other-workspace/src/main.ts"),
        version: 9,
        isDirty: true,
        getText: () => "second root",
      },
    ];

    const documents = new VscodeWorkspaceContextAccess(clock).openDocuments();

    expect(documents).toEqual([
      {
        relativePath: "src/main.ts",
        version: 3,
        isDirty: false,
        byteLength: 10,
      },
    ]);
  });

  it("collects duplicate-path diagnostics only from the first workspace root", () => {
    git.state.additionalWorkspaceRoots = ["/other-workspace"];
    git.state.diagnostics = [
      [
        git.createUri("/workspace/src/main.ts"),
        [{ range: { start: { line: 4 } }, message: "first-root diagnostic" }],
      ],
      [
        git.createUri("/other-workspace/src/main.ts"),
        [{ range: { start: { line: 8 } }, message: "second-root diagnostic" }],
      ],
    ];

    const diagnostics = new VscodeWorkspaceContextAccess(
      clock,
      undefined,
      path => path,
    ).diagnostics();

    expect(diagnostics).toEqual([
      {
        relativePath: "src/main.ts",
        line: 4,
        message: "first-root diagnostic",
      },
    ]);
  });

  it("excludes diagnostics that escape through an ancestor symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "adaptive-pair-root-"));
    const outside = await mkdtemp(join(tmpdir(), "adaptive-pair-outside-"));
    try {
      await writeFile(join(outside, "secret.ts"), "secret", "utf8");
      await symlink(outside, join(root, "linked"), "dir");
      git.state.workspaceRoot = root;
      git.state.diagnostics = [
        [
          git.createUri(join(root, "linked", "secret.ts")),
          [{ range: { start: { line: 2 } }, message: "escaped diagnostic" }],
        ],
      ];

      const diagnostics = new VscodeWorkspaceContextAccess(clock).diagnostics();

      expect(diagnostics).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it.each([
    "/workspace",
    "/workspace/src/main.ts",
  ])("fails closed when identity cannot be established for %s", failedPath => {
    const targetPath = "/workspace/src/main.ts";
    git.state.diagnostics = [
      [
        git.createUri(targetPath),
        [{ range: { start: { line: 3 } }, message: "unverified diagnostic" }],
      ],
    ];
    const filesystemIdentity = (path: string): string => {
      if (path === failedPath) {
        throw new Error("identity unavailable");
      }
      return path;
    };

    const diagnostics = new VscodeWorkspaceContextAccess(
      clock,
      undefined,
      filesystemIdentity,
    ).diagnostics();

    expect(diagnostics).toEqual([]);
  });

  it("uses dirty open documents only from the selected root without a git repository", async () => {
    git.state.additionalWorkspaceRoots = ["/other-workspace"];
    git.state.textDocuments = [
      {
        uri: git.createUri("/workspace/src/main.ts"),
        isDirty: true,
        getText: () => "first root",
      },
      {
        uri: git.createUri("/other-workspace/src/main.ts"),
        isDirty: true,
        getText: () => "second root",
      },
    ];
    const access = new VscodeWorkspaceContextAccess(clock);
    const folder = access.workspaceFolder();

    expect(folder).toBeDefined();
    await expect(access.readGitMetadata(folder!)).resolves.toMatchObject({
      dirtyPaths: ["src/main.ts"],
    });
  });

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

    const access = new VscodeWorkspaceContextAccess(
      clock,
      undefined,
      path => path,
    );

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

  it("filters ancestor-repository changes to the first workspace root", async () => {
    git.state.workspaceRoot = "/monorepo/first";
    git.state.additionalWorkspaceRoots = ["/monorepo/second"];
    git.state.repositories = [
      {
        rootUri: git.createUri("/monorepo"),
        state: {
          HEAD: { name: "main" },
          workingTreeChanges: [
            { uri: git.createUri("/monorepo/first/src/shared.ts") },
            { uri: git.createUri("/monorepo/second/src/shared.ts") },
          ],
          indexChanges: [
            { uri: git.createUri("/monorepo/first/test/shared.test.ts") },
            { uri: git.createUri("/monorepo/second/test/shared.test.ts") },
          ],
          untrackedChanges: [
            { uri: git.createUri("/monorepo/first/notes/shared.md") },
            { uri: git.createUri("/monorepo/second/notes/shared.md") },
          ],
        },
      },
    ];
    const access = new VscodeWorkspaceContextAccess(clock);
    const folder = access.workspaceFolder();

    expect(folder).toBeDefined();
    await expect(access.readGitMetadata(folder!)).resolves.toEqual({
      branch: "main",
      dirtyPaths: ["src/shared.ts"],
      stagedPaths: ["test/shared.test.ts"],
      untrackedPaths: ["notes/shared.md"],
    });
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
          "src/**/*.ts",
          ["src"],
          new AbortController().signal,
        ),
      ).resolves.toEqual({
        paths: ["src/retry.ts"],
        truncated: false,
      });
      expect(git.state.findRequests).toHaveLength(1);
      expect(git.state.findRequests[0]?.base.fsPath).toMatch(/\/src$/u);
      expect(git.state.findRequests[0]?.pattern).toBe("**/*.ts");
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

  it("prefers a dirty buffer opened through a symlink alias of the target", async () => {
    const root = await mkdtemp(join(tmpdir(), "adaptive-pair-scope-root-"));
    const alias = `${root}-alias`;
    try {
      await mkdir(join(root, "src"));
      await writeFile(join(root, "src", "index.ts"), "root disk text", "utf8");
      await symlink(root, alias, "dir");
      git.state.workspaceRoot = root;
      git.state.textDocuments = [
        {
          uri: git.createUri(join(alias, "src", "index.ts")),
          isDirty: true,
          getText: () => "dirty alias buffer",
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
        text: "dirty alias buffer",
      });
    } finally {
      await rm(alias, { force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores an unrelated dirty new file when reading an existing scoped target", async () => {
    const root = await mkdtemp(join(tmpdir(), "adaptive-pair-scope-root-"));
    try {
      await mkdir(join(root, "src"));
      await writeFile(join(root, "src", "index.ts"), "disk text", "utf8");
      git.state.workspaceRoot = root;
      git.state.textDocuments = [
        {
          uri: git.createUri(join(root, "src", "new.ts")),
          isDirty: true,
          getText: () => "unsaved new file",
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
        text: "disk text",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
