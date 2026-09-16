import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import * as vscode from "vscode";
import { canonicalRelative } from "./workspaceContext.js";
import { TargetBufferIdentityUnavailableError } from "./verificationContracts.js";
import type { BufferInspectionPort, FilesystemIdentity } from "./verificationContracts.js";

type FilesystemIdentityResolution =
  | { readonly status: "resolved"; readonly identity: string }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

// --- Production port bindings ------------------------------------------------

export const defaultFilesystemIdentity: FilesystemIdentity = path =>
  realpathSync.native(path);

const comparableFilesystemIdentity = (path: string): string =>
  process.platform === "win32" ? path.toLowerCase() : path;

const withinFilesystemRoot = (root: string, target: string): boolean => {
  const relativePath = relative(
    comparableFilesystemIdentity(root),
    comparableFilesystemIdentity(target),
  );
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== ".." &&
      !isAbsolute(relativePath))
  );
};

const withinPathScope = (scope: string, path: string): boolean =>
  path === scope || path.startsWith(`${scope}/`);

export class VscodeBufferInspectionPort implements BufferInspectionPort {
  public constructor(
    private readonly rootPath: string,
    private readonly filesystemIdentity: FilesystemIdentity =
      defaultFilesystemIdentity,
  ) {}

  public dirtyTargets(paths: readonly string[]): readonly string[] {
    const root = resolve(this.rootPath);
    const rootResolution = this.identityFor(root);
    if (rootResolution.status !== "resolved") {
      throw new TargetBufferIdentityUnavailableError(paths);
    }
    const rootIdentity = rootResolution.identity;

    let inspectAll = paths.length === 0;
    const targetPaths: string[] = [];
    const targetIdentities: string[] = [];
    for (const rawTarget of paths) {
      const target = canonicalRelative(rawTarget);
      if (target === undefined) {
        inspectAll = true;
        continue;
      }
      targetPaths.push(target);
      const targetResolution = this.identityFor(resolve(root, target));
      if (targetResolution.status === "unavailable") {
        throw new TargetBufferIdentityUnavailableError([target]);
      }
      if (targetResolution.status === "resolved") {
        if (!withinFilesystemRoot(rootIdentity, targetResolution.identity)) {
          throw new TargetBufferIdentityUnavailableError([target]);
        }
        targetIdentities.push(targetResolution.identity);
      }
    }

    const dirty = new Set<string>();
    for (const document of vscode.workspace.textDocuments) {
      if (document.isDirty !== true) {
        continue;
      }
      if (
        document.uri.scheme !== undefined &&
        document.uri.scheme !== "file"
      ) {
        continue;
      }

      const documentPath = resolve(document.uri.fsPath);
      const lexicalPath = canonicalRelative(
        relative(root, documentPath).replace(/\\/gu, "/"),
      );
      const documentResolution = this.identityFor(documentPath);
      if (documentResolution.status === "missing") {
        if (
          lexicalPath !== undefined &&
          (inspectAll ||
            targetPaths.some(target => withinPathScope(target, lexicalPath)))
        ) {
          dirty.add(lexicalPath);
        }
        continue;
      }
      if (documentResolution.status === "unavailable") {
        if (!withinFilesystemRoot(root, documentPath)) {
          if (this.isWithinAnotherWorkspaceRoot(root, documentPath)) {
            continue;
          }
          throw new TargetBufferIdentityUnavailableError(paths);
        }
        throw new TargetBufferIdentityUnavailableError(paths);
      }
      const documentIdentity = documentResolution.identity;

      if (!withinFilesystemRoot(rootIdentity, documentIdentity)) {
        continue;
      }
      const normalized = canonicalRelative(
        relative(rootIdentity, documentIdentity).replace(/\\/gu, "/"),
      );
      if (normalized === undefined) {
        continue;
      }
      const withinTarget =
        inspectAll ||
        targetIdentities.some(
          targetIdentity =>
            withinFilesystemRoot(targetIdentity, documentIdentity),
        ) ||
        (lexicalPath !== undefined &&
          targetPaths.some(target => withinPathScope(target, lexicalPath)));
      if (withinTarget) {
        dirty.add(normalized);
      }
    }
    return [...dirty];
  }

  private identityFor(path: string): FilesystemIdentityResolution {
    try {
      const identity = this.filesystemIdentity(path);
      return identity === undefined
        ? { status: "unavailable" }
        : { status: "resolved", identity };
    } catch (error) {
      const code =
        typeof error === "object" && error !== null
          ? (error as { readonly code?: unknown }).code
          : undefined;
      if (code === "ENOENT" || code === "ENOTDIR") {
        return { status: "missing" };
      }
      if (typeof code === "string") {
        return { status: "unavailable" };
      }
      throw error;
    }
  }

  private isWithinAnotherWorkspaceRoot(
    root: string,
    target: string,
  ): boolean {
    return (
      vscode.workspace.workspaceFolders?.some(folder => {
        const folderRoot = resolve(folder.uri.fsPath);
        return (
          comparableFilesystemIdentity(folderRoot) !==
            comparableFilesystemIdentity(root) &&
          withinFilesystemRoot(folderRoot, target)
        );
      }) ?? false
    );
  }
}
