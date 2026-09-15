import { realpathSync } from "node:fs";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import * as vscode from "vscode";
import type {
  DiagnosticInfo,
  GitMetadata,
  OpenDocumentInfo,
  PathInspection,
  WorkspaceContextAccess,
  WorkspaceFolderIdentity,
} from "./workspaceContext.js";
import {
  canonicalRelative,
  isBinaryPath,
  isSecretPath,
  MAX_CONTEXT_FILE_BYTES,
} from "./workspaceContext.js";
import type { ActivityLedger } from "./activityLedger.js";
import type { ScopeAccess, ScopeReadResult } from "./scopeEffect.js";

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

const withinRoot = (root: string, target: string): boolean => {
  const relativePath = relative(root, target);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== ".." &&
      !isAbsolute(relativePath))
  );
};

const errorCode = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
};

const sameFilesystemIdentity = (left: string, right: string): boolean =>
  process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;

export class VscodeScopeAccess implements ScopeAccess {
  public constructor(
    private readonly rootPath: string,
    private readonly ledger?: ActivityLedger,
  ) {}

  public async readText(
    rawPath: string,
    signal: AbortSignal,
  ): Promise<ScopeReadResult> {
    signal.throwIfAborted();
    this.ledger?.recordWorkspaceRead();
    const path = canonicalRelative(rawPath);
    if (
      path === undefined ||
      isSecretPath(path) ||
      isBinaryPath(path)
    ) {
      return { status: "unsafe-path" };
    }

    const absolute = resolve(this.rootPath, path);
    let canonicalRoot: string;
    let canonicalTarget: string;
    try {
      [canonicalRoot, canonicalTarget] = await Promise.all([
        realpath(this.rootPath),
        realpath(absolute),
      ]);
    } catch (error) {
      return errorCode(error) === "ENOENT"
        ? { status: "not-found" }
        : { status: "read-failed" };
    }
    if (!withinRoot(canonicalRoot, canonicalTarget)) {
      return { status: "unsafe-path" };
    }
    const resolvedPath = canonicalRelative(
      relative(canonicalRoot, canonicalTarget).replace(/\\/gu, "/"),
    );
    if (
      resolvedPath === undefined ||
      isSecretPath(resolvedPath) ||
      isBinaryPath(resolvedPath)
    ) {
      return { status: "unsafe-path" };
    }

    let document: vscode.TextDocument | undefined;
    for (const candidate of vscode.workspace.textDocuments) {
      if (candidate.isDirty !== true) {
        continue;
      }
      if (
        candidate.uri.scheme !== undefined &&
        candidate.uri.scheme !== "file"
      ) {
        continue;
      }

      const candidatePath = resolve(candidate.uri.fsPath);
      let candidateIdentity: string;
      try {
        candidateIdentity = await realpath(candidatePath);
      } catch (error) {
        if (
          errorCode(error) === "ENOENT" ||
          errorCode(error) === "ENOTDIR"
        ) {
          continue;
        }
        if (withinRoot(resolve(this.rootPath), candidatePath)) {
          return { status: "read-failed" };
        }
        throw error;
      }
      if (sameFilesystemIdentity(candidateIdentity, canonicalTarget)) {
        document = candidate;
        break;
      }
    }
    if (document !== undefined) {
      const text = document.getText();
      if (Buffer.byteLength(text, "utf8") > MAX_CONTEXT_FILE_BYTES) {
        return { status: "too-large" };
      }
      return { status: "ok", path: resolvedPath, text };
    }

    try {
      const target = await stat(canonicalTarget);
      if (!target.isFile()) {
        return { status: "not-found" };
      }
      if (target.size > MAX_CONTEXT_FILE_BYTES) {
        return { status: "too-large" };
      }
      const content = await readFile(canonicalTarget);
      signal.throwIfAborted();
      if (content.includes(0)) {
        return { status: "binary" };
      }
      return {
        status: "ok",
        path: resolvedPath,
        text: content.toString("utf8"),
      };
    } catch (error) {
      return errorCode(error) === "ENOENT"
        ? { status: "not-found" }
        : { status: "read-failed" };
    }
  }

  public async listPaths(
    pattern: string | undefined,
    allowedPaths: readonly string[],
    signal: AbortSignal,
  ): Promise<{
    readonly paths: readonly string[];
    readonly truncated: boolean;
  }> {
    signal.throwIfAborted();
    this.ledger?.recordWorkspaceRead();
    const requestedPattern = pattern?.trim() || "**/*";
    if (
      requestedPattern.startsWith("/") ||
      /^[A-Za-z]:/u.test(requestedPattern) ||
      requestedPattern.split(/[\\/]/u).includes("..")
    ) {
      return { paths: [], truncated: false };
    }

    const canonicalRoot = await realpath(this.rootPath);
    const paths = new Set<string>();
    let truncated = false;
    const scopes = [
      ...new Set(
        allowedPaths
          .map(canonicalRelative)
          .filter(
            (path): path is string =>
              path !== undefined &&
              !isSecretPath(path) &&
              !isBinaryPath(path),
          ),
      ),
    ];

    for (const scope of scopes) {
      signal.throwIfAborted();
      let target: string;
      let targetStat: Awaited<ReturnType<typeof stat>>;
      try {
        target = await realpath(resolve(this.rootPath, scope));
        targetStat = await stat(target);
      } catch (error) {
        if (errorCode(error) === "ENOENT") {
          continue;
        }
        throw error;
      }
      if (!withinRoot(canonicalRoot, target)) {
        continue;
      }

      const base = targetStat.isFile() ? dirname(target) : target;
      const scopePrefix = `${scope}/`;
      const relativePattern =
        requestedPattern === scope
          ? targetStat.isFile()
            ? basename(target)
            : "**/*"
          : requestedPattern.startsWith(scopePrefix)
            ? requestedPattern.slice(scopePrefix.length)
            : requestedPattern;
      const scopedPattern =
        pattern === undefined || pattern.trim().length === 0
          ? targetStat.isFile()
            ? basename(target)
            : "**/*"
          : relativePattern;
      const remaining = 5_000 - paths.size;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const uris = await vscode.workspace.findFiles(
        new vscode.RelativePattern(vscode.Uri.file(base), scopedPattern),
        "**/{.git,node_modules,.ssh,.aws,.gnupg,.gpg,.docker,.kube,secrets,.secrets}/**",
        remaining + 1,
      );
      signal.throwIfAborted();
      if (uris.length > remaining) {
        truncated = true;
      }

      for (const uri of uris.slice(0, remaining)) {
        let discoveredTarget: string;
        try {
          discoveredTarget = await realpath(uri.fsPath);
        } catch {
          continue;
        }
        if (!withinRoot(canonicalRoot, discoveredTarget)) {
          continue;
        }
        const path = canonicalRelative(
          relative(canonicalRoot, discoveredTarget).replace(/\\/gu, "/"),
        );
        if (
          path !== undefined &&
          !isSecretPath(path) &&
          !isBinaryPath(path)
        ) {
          paths.add(path);
        }
      }
    }
    return {
      paths: [...paths].sort(),
      truncated,
    };
  }
}

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

  public readGitMetadata(folder: WorkspaceFolderIdentity): Promise<GitMetadata> {
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
      return withinRoot(canonicalRoot, canonicalTarget);
    } catch {
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
