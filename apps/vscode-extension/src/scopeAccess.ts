import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import * as vscode from "vscode";
import type { ActivityLedger } from "./activityLedger.js";
import type { ScopeAccess, ScopeReadResult } from "./scopeEffect.js";
import { filesystemErrorCode as errorCode, scopePathIdentity } from "./scopePathIdentity.js";
import {
  canonicalRelative,
  isBinaryPath,
  isSecretPath,
  MAX_CONTEXT_FILE_BYTES,
} from "./workspaceContext.js";
import { withinRoot } from "./workspacePaths.js";



const sameFilesystemIdentity = (left: string, right: string): boolean =>
  process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
const scopeSearch = (
  pattern: string | undefined,
  requestedPattern: string,
  scope: string,
  target: string,
  isFile: boolean,
): { readonly base: string; readonly scopedPattern: string } => {
  const base = isFile ? dirname(target) : target;
  const scopePrefix = `${scope}/`;
  const relativePattern =
    requestedPattern === scope
      ? isFile
        ? basename(target)
        : "**/*"
      : requestedPattern.startsWith(scopePrefix)
        ? requestedPattern.slice(scopePrefix.length)
        : requestedPattern;
  const scopedPattern =
    pattern === undefined || pattern.trim().length === 0
      ? isFile
        ? basename(target)
        : "**/*"
      : relativePattern;
  return { base, scopedPattern };
};

export class VscodeScopeAccess implements ScopeAccess {
  public constructor(
    private readonly rootPath: string,
    private readonly ledger?: ActivityLedger,
  ) {}

  public async canonicalPaths(paths: readonly string[], signal: AbortSignal): Promise<readonly string[]> {
    signal.throwIfAborted();
    this.ledger?.recordWorkspaceRead();
    const canonicalRoot = await realpath(this.rootPath);
    signal.throwIfAborted();
    const identities = new Set<string>();
    for (const rawPath of paths) {
      signal.throwIfAborted();
      const path = canonicalRelative(rawPath);
      if (path === undefined || isSecretPath(path) || isBinaryPath(path)) {
        continue;
      }
      let target: string;
      try {
        target = await scopePathIdentity(resolve(this.rootPath, path), signal);
      } catch (error) {
        signal.throwIfAborted();
        if (errorCode(error) === "ENOENT") {
          continue;
        }
        throw error;
      }
      if (!withinRoot(canonicalRoot, target)) {
        continue;
      }
      const resolvedPath = canonicalRelative(relative(canonicalRoot, target).replace(/\\/gu, "/"));
      if (resolvedPath !== undefined && !isSecretPath(resolvedPath) && !isBinaryPath(resolvedPath)) {
        identities.add(resolvedPath);
      }
    }
    return [...identities];
  }

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
        scopePathIdentity(absolute, signal),
      ]);
    } catch (error) {
      signal.throwIfAborted();
      return errorCode(error) === "ENOENT"
        ? { status: "not-found" }
        : { status: "read-failed" };
    }
    signal.throwIfAborted();
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

    const openResult = await this.readOpenBuffer(canonicalTarget, resolvedPath, signal);
    signal.throwIfAborted();
    if (openResult !== undefined) {
      return openResult;
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

  private async readOpenBuffer(
    canonicalTarget: string,
    resolvedPath: string,
    signal: AbortSignal,
  ): Promise<ScopeReadResult | undefined> {
    signal.throwIfAborted();
    let document: vscode.TextDocument | undefined;
    for (const candidate of vscode.workspace.textDocuments) {
      signal.throwIfAborted();
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
        candidateIdentity = await scopePathIdentity(candidatePath, signal);
      } catch (error) {
        signal.throwIfAborted();
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
      signal.throwIfAborted();
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
      if (text.includes("\0")) {
        return { status: "binary" };
      }
      return { status: "ok", path: resolvedPath, text };
    }

    return undefined;
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

      const { base, scopedPattern } = scopeSearch(pattern, requestedPattern, scope, target, targetStat.isFile());
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
        if (
          !withinRoot(canonicalRoot, discoveredTarget) ||
          (targetStat.isFile()
            ? !sameFilesystemIdentity(target, discoveredTarget)
            : !withinRoot(target, discoveredTarget))
        ) {
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
