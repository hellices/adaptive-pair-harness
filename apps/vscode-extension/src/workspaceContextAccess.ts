import { lstat, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import * as vscode from "vscode";
import type {
  DiagnosticInfo,
  GitMetadata,
  OpenDocumentInfo,
  PathInspection,
  WorkspaceContextAccess,
  WorkspaceFolderIdentity,
} from "./workspaceContext.js";

interface GitRepositoryState {
  readonly HEAD?: { readonly name?: string };
  readonly workingTreeChanges?: readonly { readonly uri: vscode.Uri }[];
  readonly indexChanges?: readonly { readonly uri: vscode.Uri }[];
  readonly untrackedChanges?: readonly { readonly uri: vscode.Uri }[];
}

interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: GitRepositoryState;
}

interface GitApi {
  readonly repositories: readonly GitRepository[];
}

const documentByteLength = (document: vscode.TextDocument): number => {
  if (typeof document.getText !== "function") {
    return 0;
  }
  try {
    return Buffer.byteLength(document.getText(), "utf8");
  } catch {
    return 0;
  }
};

export class VscodeWorkspaceContextAccess implements WorkspaceContextAccess {
  public constructor(private readonly clock: { now(): number }) {}

  public workspaceFolder(): WorkspaceFolderIdentity | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder === undefined) {
      return undefined;
    }

    return {
      workspaceId: folder.uri.toString(),
      rootPath: folder.uri.fsPath,
    };
  }

  public isCurrent(folder: WorkspaceFolderIdentity): boolean {
    return (
      vscode.workspace.workspaceFolders?.[0]?.uri.toString() === folder.workspaceId
    );
  }

  public readGitMetadata(): Promise<GitMetadata> {
    const repository = this.gitRepository();
    if (repository === undefined) {
      return Promise.resolve({
        branch: undefined,
        dirtyPaths: this.dirtyOpenDocuments(),
        stagedPaths: [],
        untrackedPaths: [],
      });
    }

    const toRelative = (uri: vscode.Uri): string =>
      vscode.workspace.asRelativePath(uri, false);

    return Promise.resolve({
      branch: repository.state.HEAD?.name,
      dirtyPaths: (repository.state.workingTreeChanges ?? []).map(change =>
        toRelative(change.uri),
      ),
      stagedPaths: (repository.state.indexChanges ?? []).map(change =>
        toRelative(change.uri),
      ),
      untrackedPaths: (repository.state.untrackedChanges ?? []).map(change =>
        toRelative(change.uri),
      ),
    });
  }

  public openDocuments(): readonly OpenDocumentInfo[] {
    return vscode.workspace.textDocuments.map(document => ({
      relativePath: vscode.workspace.asRelativePath(document.uri, false),
      version: typeof document.version === "number" ? document.version : 0,
      isDirty: document.isDirty === true,
      byteLength: documentByteLength(document),
    }));
  }

  public diagnostics(): readonly DiagnosticInfo[] {
    const collected: DiagnosticInfo[] = [];
    for (const [uri, entries] of vscode.languages.getDiagnostics()) {
      const relativePath = vscode.workspace.asRelativePath(uri, false);
      for (const entry of entries) {
        collected.push({
          relativePath,
          line: entry.range?.start?.line ?? 0,
          message: entry.message,
        });
      }
    }
    return collected;
  }

  public validationResults(): readonly string[] {
    return [];
  }

  public async inspectPath(relativePath: string): Promise<PathInspection> {
    const folder = this.workspaceFolder();
    if (folder === undefined) {
      return {
        exists: false,
        isFile: false,
        isSymbolicLink: false,
        withinRoot: false,
        byteLength: 0,
      };
    }

    const root = resolve(folder.rootPath);
    const absolute = join(root, relativePath);

    try {
      const link = await lstat(absolute);
      const isSymbolicLink = link.isSymbolicLink();
      const withinRoot = await this.targetWithinRoot(absolute, root, isSymbolicLink);
      const target = await stat(absolute);

      return {
        exists: true,
        isFile: target.isFile(),
        isSymbolicLink,
        withinRoot,
        byteLength: target.size,
      };
    } catch {
      return {
        exists: false,
        isFile: false,
        isSymbolicLink: false,
        withinRoot: false,
        byteLength: 0,
      };
    }
  }

  public now(): number {
    return this.clock.now();
  }

  private async targetWithinRoot(
    absolute: string,
    root: string,
    isSymbolicLink: boolean,
  ): Promise<boolean> {
    if (!isSymbolicLink) {
      return true;
    }

    try {
      const canonical = await realpath(absolute);
      const relativePath = relative(root, canonical);
      return (
        relativePath !== "" &&
        !relativePath.startsWith(`..${sep}`) &&
        relativePath !== ".." &&
        !isAbsolute(relativePath)
      );
    } catch {
      return false;
    }
  }

  private dirtyOpenDocuments(): readonly string[] {
    return vscode.workspace.textDocuments
      .filter(document => document.isDirty === true)
      .map(document => vscode.workspace.asRelativePath(document.uri, false));
  }

  private gitRepository(): GitRepository | undefined {
    try {
      const gitExtension = vscode.extensions?.getExtension?.<{
        getAPI(version: number): GitApi;
      }>("vscode.git");
      const exports =
        gitExtension?.isActive === true ? gitExtension.exports : undefined;
      if (exports === undefined) {
        return undefined;
      }

      return exports.getAPI(1).repositories[0];
    } catch {
      return undefined;
    }
  }
}
