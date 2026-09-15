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
import type { ActivityLedger } from "./activityLedger.js";

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
  public constructor(
    private readonly clock: { now(): number },
    private readonly ledger?: ActivityLedger,
  ) {}

  public workspaceFolder(): WorkspaceFolderIdentity | undefined {
    this.ledger?.recordWorkspaceRead();
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder === undefined) {
      return undefined;
    }

    return {
      workspaceId: folder.uri.toString(),
      rootPath: folder.uri.fsPath,
    };
  }

  public isCurrent(
    folder: WorkspaceFolderIdentity,
    branch: string | undefined,
  ): boolean {
    this.ledger?.recordWorkspaceRead();
    if (
      vscode.workspace.workspaceFolders?.[0]?.uri.toString() !== folder.workspaceId
    ) {
      return false;
    }

    const repository = this.gitRepositoryForRoot(folder.rootPath);
    return (repository?.state.HEAD?.name ?? undefined) === branch;
  }

  public readGitMetadata(folder: WorkspaceFolderIdentity): Promise<GitMetadata> {
    this.ledger?.recordWorkspaceRead();
    const repository = this.gitRepositoryForRoot(folder.rootPath);
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
    this.ledger?.recordWorkspaceRead();
    return vscode.workspace.textDocuments.map(document => ({
      relativePath: vscode.workspace.asRelativePath(document.uri, false),
      version: typeof document.version === "number" ? document.version : 0,
      isDirty: document.isDirty === true,
      byteLength: documentByteLength(document),
    }));
  }

  public diagnostics(): readonly DiagnosticInfo[] {
    this.ledger?.recordWorkspaceRead();
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
    this.ledger?.recordWorkspaceRead();
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
      const withinRoot = await this.targetWithinRoot(absolute, root);
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
  ): Promise<boolean> {
    try {
      const [canonicalRoot, canonicalTarget] = await Promise.all([
        realpath(root),
        realpath(absolute),
      ]);
      const relativePath = relative(canonicalRoot, canonicalTarget);
      return (
        relativePath === "" ||
        (
        !relativePath.startsWith(`..${sep}`) &&
        relativePath !== ".." &&
        !isAbsolute(relativePath)
        )
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

  private gitRepositoryForRoot(rootPath: string): GitRepository | undefined {
    const repositories = this.gitRepositories();
    if (repositories.length === 0) {
      return undefined;
    }

    const target = resolve(rootPath);
    const exact = repositories.find(
      repository => resolve(repository.rootUri.fsPath) === target,
    );
    if (exact !== undefined) {
      return exact;
    }

    let ancestor: GitRepository | undefined;
    let ancestorLength = -1;
    for (const repository of repositories) {
      const repositoryRoot = resolve(repository.rootUri.fsPath);
      const relativePath = relative(repositoryRoot, target);
      const withinRepository =
        relativePath !== "" &&
        !relativePath.startsWith(`..${sep}`) &&
        relativePath !== ".." &&
        !isAbsolute(relativePath);
      if (withinRepository && repositoryRoot.length > ancestorLength) {
        ancestor = repository;
        ancestorLength = repositoryRoot.length;
      }
    }

    return ancestor;
  }

  private gitRepositories(): readonly GitRepository[] {
    try {
      const gitExtension = vscode.extensions?.getExtension?.<{
        getAPI(version: number): GitApi;
      }>("vscode.git");
      const exports =
        gitExtension?.isActive === true ? gitExtension.exports : undefined;
      if (exports === undefined) {
        return [];
      }

      return exports.getAPI(1).repositories;
    } catch {
      return [];
    }
  }
}
