import { realpathSync } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import * as vscode from "vscode";
import type { ActivityLedger } from "./activityLedger.js";
import type {
  DiagnosticInfo,
  GitMetadata,
  OpenDocumentInfo,
  PathInspection,
  WorkspaceContextAccess,
  WorkspaceFolderIdentity,
} from "./workspaceContext.js";
import { withinRoot } from "./workspacePaths.js";
export { VscodeScopeAccess } from "./scopeAccess.js";

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
    private readonly filesystemIdentity: (path: string) => string =
      realpathSync.native,
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

  public readGitMetadata(folder: WorkspaceFolderIdentity, signal?: AbortSignal): Promise<GitMetadata> {
    signal?.throwIfAborted();
    this.ledger?.recordWorkspaceRead();
    const repository = this.gitRepositoryForRoot(folder.rootPath);
    if (repository === undefined) {
      return Promise.resolve({
        branch: undefined,
        dirtyPaths: this.dirtyOpenDocuments(folder),
        stagedPaths: [],
        untrackedPaths: [],
      });
    }

    const toRelative = (
      changes: readonly { readonly uri: vscode.Uri }[],
    ): readonly string[] =>
      changes.flatMap(change => {
        const relativePath = this.relativePathWithinRoot(
          folder.rootPath,
          change.uri,
        );
        return relativePath === undefined ? [] : [relativePath];
      });

    return Promise.resolve({
      branch: repository.state.HEAD?.name,
      dirtyPaths: toRelative(repository.state.workingTreeChanges ?? []),
      stagedPaths: toRelative(repository.state.indexChanges ?? []),
      untrackedPaths: toRelative(repository.state.untrackedChanges ?? []),
    });
  }

  public openDocuments(): readonly OpenDocumentInfo[] {
    this.ledger?.recordWorkspaceRead();
    const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (rootPath === undefined) {
      return [];
    }

    return vscode.workspace.textDocuments.flatMap(document => {
      const relativePath = this.relativePathWithinRoot(rootPath, document.uri);
      return relativePath === undefined
        ? []
        : [{
            relativePath,
            version: typeof document.version === "number" ? document.version : 0,
            isDirty: document.isDirty === true,
            byteLength: documentByteLength(document),
          }];
    });
  }

  public diagnostics(): readonly DiagnosticInfo[] {
    this.ledger?.recordWorkspaceRead();
    const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (rootPath === undefined) {
      return [];
    }

    let rootIdentity: string;
    try {
      rootIdentity = this.filesystemIdentity(rootPath);
    } catch {
      return [];
    }

    const collected: DiagnosticInfo[] = [];
    for (const [uri, entries] of vscode.languages.getDiagnostics()) {
      const relativePath = this.relativePathWithinRoot(rootPath, uri);
      if (relativePath === undefined) {
        continue;
      }
      let targetIdentity: string;
      try {
        targetIdentity = this.filesystemIdentity(uri.fsPath);
      } catch {
        continue;
      }
      if (!withinRoot(rootIdentity, targetIdentity)) {
        continue;
      }
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

  public async inspectPath(relativePath: string, signal?: AbortSignal): Promise<PathInspection> {
    signal?.throwIfAborted();
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
      signal?.throwIfAborted();
      const isSymbolicLink = link.isSymbolicLink();
      const withinRoot = await this.targetWithinRoot(absolute, root, signal);
      signal?.throwIfAborted();
      const target = await stat(absolute);
      signal?.throwIfAborted();

      return {
        exists: true,
        isFile: target.isFile(),
        isSymbolicLink,
        withinRoot,
        byteLength: target.size,
      };
    } catch {
      signal?.throwIfAborted();
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
    signal?: AbortSignal,
  ): Promise<boolean> {
    try {
      const [canonicalRoot, canonicalTarget] = await Promise.all([
        realpath(root),
        realpath(absolute),
      ]);
      signal?.throwIfAborted();
      return withinRoot(canonicalRoot, canonicalTarget);
    } catch {
      signal?.throwIfAborted();
      return false;
    }
  }

  private dirtyOpenDocuments(
    folder: WorkspaceFolderIdentity,
  ): readonly string[] {
    return vscode.workspace.textDocuments.flatMap(document => {
      if (document.isDirty !== true) {
        return [];
      }
      const relativePath = this.relativePathWithinRoot(
        folder.rootPath,
        document.uri,
      );
      return relativePath === undefined ? [] : [relativePath];
    });
  }

  private relativePathWithinRoot(
    rootPath: string,
    uri: vscode.Uri,
  ): string | undefined {
    const root = resolve(rootPath);
    const target = resolve(uri.fsPath);
    if (!withinRoot(root, target)) {
      return undefined;
    }
    return relative(root, target).replace(/\\/gu, "/");
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
