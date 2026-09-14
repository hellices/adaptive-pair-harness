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
  };

  const reset = (): void => {
    state.repositories = [];
    state.onDiagnostics = undefined;
  };

  return { createUri, state, reset };
});

vi.mock("vscode", () => {
  const asRelativePath = (value: FakeUri | string): string => {
    const text = typeof value === "string" ? value : value.fsPath;
    return text.replace(/^\/workspace\//u, "");
  };

  return {
    workspace: {
      get workspaceFolders() {
        return [{ uri: git.createUri("/workspace") }];
      },
      textDocuments: [] as unknown[],
      asRelativePath,
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

const { VscodeWorkspaceContextAccess } = await import("../src/workspaceContextAccess.js");

const clock = { now: () => 1_700_000_000_000 };

afterEach(() => {
  git.reset();
});

describe("VscodeWorkspaceContextAccess — production branch currentness", () => {
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
