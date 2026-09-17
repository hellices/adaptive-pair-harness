import { buildEntrySnapshot } from "@adaptive-pair/presence";
import type { EntrySnapshot } from "@adaptive-pair/protocol";

export const MAX_CONTEXT_FILE_BYTES = 128 * 1024;
export const MAX_DIAGNOSTICS = 50;
export const MAX_DIAGNOSTIC_LENGTH = 200;

const GREENFIELD_WORKSPACE_ID = "adaptive-pair:workspace";

const SECRET_DIRECTORIES = new Set([
  ".ssh",
  ".aws",
  ".gnupg",
  ".gpg",
  ".docker",
  ".kube",
  "secrets",
  ".secrets",
]);

const SECRET_FILES = new Set([
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  ".npmrc",
  ".netrc",
  ".pgpass",
  ".htpasswd",
]);

const SECRET_FILE_PATTERN = /^\.env(\..+)?$/u;
const SECRET_EXTENSION = /\.(?:pem|key|p12|pfx|keystore)$/iu;

const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "ico",
  "webp",
  "pdf",
  "zip",
  "gz",
  "tar",
  "tgz",
  "rar",
  "7z",
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
  "class",
  "jar",
  "wasm",
  "node",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "mp3",
  "wav",
  "flac",
  "mp4",
  "mov",
  "avi",
  "mkv",
  "webm",
]);

export interface WorkspaceFolderIdentity {
  readonly workspaceId: string;
  readonly rootPath: string;
}

export interface GitMetadata {
  readonly branch: string | undefined;
  readonly dirtyPaths: readonly string[];
  readonly stagedPaths: readonly string[];
  readonly untrackedPaths: readonly string[];
}

export interface OpenDocumentInfo {
  readonly relativePath: string;
  readonly version: number;
  readonly isDirty: boolean;
  readonly byteLength: number;
}

export interface DiagnosticInfo {
  readonly relativePath: string;
  readonly line: number;
  readonly message: string;
}

export interface PathInspection {
  readonly exists: boolean;
  readonly isFile: boolean;
  readonly isSymbolicLink: boolean;
  readonly withinRoot: boolean;
  readonly byteLength: number;
}

export interface WorkspaceContextAccess {
  workspaceFolder(): WorkspaceFolderIdentity | undefined;
  isCurrent(folder: WorkspaceFolderIdentity, branch: string | undefined): boolean;
  readGitMetadata(folder: WorkspaceFolderIdentity, signal?: AbortSignal): Promise<GitMetadata>;
  openDocuments(): readonly OpenDocumentInfo[];
  diagnostics(): readonly DiagnosticInfo[];
  validationResults(): readonly string[];
  inspectPath(relativePath: string, signal?: AbortSignal): Promise<PathInspection>;
  now(): number;
}

export class WorkspaceContextChangedError extends Error {
  public constructor() {
    super("The workspace folder or branch changed during entry capture.");
    this.name = "WorkspaceContextChangedError";
  }
}

export const canonicalRelative = (raw: string): string | undefined => {
  const normalized = raw.replace(/\\/gu, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/u.test(normalized)) {
    return undefined;
  }

  const segments = normalized.split("/").filter(segment => segment !== "" && segment !== ".");
  if (segments.length === 0 || segments.includes("..")) {
    return undefined;
  }

  return segments.join("/");
};

export const isSecretPath = (canonical: string): boolean => {
  const segments = canonical.split("/");
  if (segments.some(segment => SECRET_DIRECTORIES.has(segment))) {
    return true;
  }

  const filename = segments.at(-1) ?? "";
  return (
    SECRET_FILES.has(filename) ||
    SECRET_FILE_PATTERN.test(filename) ||
    SECRET_EXTENSION.test(filename)
  );
};

export const isBinaryPath = (canonical: string): boolean => {
  const filename = canonical.split("/").at(-1) ?? "";
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) {
    return false;
  }

  return BINARY_EXTENSIONS.has(filename.slice(dot + 1).toLowerCase());
};

const oneLine = (value: string): string =>
  value.replace(/\s+/gu, " ").trim();

export class WorkspaceContext {
  public constructor(private readonly access: WorkspaceContextAccess) {}

  public async capture(signal?: AbortSignal): Promise<EntrySnapshot> {
    signal?.throwIfAborted();
    const folder = this.access.workspaceFolder();
    const capturedAt = this.access.now();

    if (folder === undefined) {
      return buildEntrySnapshot({
        workspaceId: GREENFIELD_WORKSPACE_ID,
        dirtyPaths: [],
        openPaths: [],
        diagnostics: [],
        protectedPaths: [],
        capturedAt,
      });
    }

    const git = await this.access.readGitMetadata(folder, signal);
    this.ensureCurrent(folder, git.branch, signal);

    const openDirtyByPath = new Map<string, OpenDocumentInfo>();
    const openPaths: string[] = [];
    for (const document of this.access.openDocuments()) {
      const canonical = canonicalRelative(document.relativePath);
      if (canonical === undefined || isSecretPath(canonical)) {
        continue;
      }
      openPaths.push(canonical);
      if (document.isDirty) {
        openDirtyByPath.set(canonical, document);
      }
    }

    const dirtyPaths = await this.acceptPaths(
      [...git.dirtyPaths, ...git.stagedPaths, ...openDirtyByPath.keys()],
      folder,
      git.branch,
      openDirtyByPath,
      signal,
    );
    const untrackedPaths = await this.acceptPaths(
      git.untrackedPaths,
      folder,
      git.branch,
      openDirtyByPath,
      signal,
    );

    signal?.throwIfAborted();
    const diagnostics = this.collectDiagnostics();

    this.ensureCurrent(folder, git.branch, signal);

    return buildEntrySnapshot({
      workspaceId: folder.workspaceId,
      ...(git.branch === undefined ? {} : { branch: git.branch }),
      dirtyPaths,
      openPaths,
      diagnostics,
      protectedPaths: [...dirtyPaths, ...untrackedPaths],
      capturedAt,
    });
  }

  private async acceptPaths(
    candidates: readonly string[],
    folder: WorkspaceFolderIdentity,
    branch: string | undefined,
    openDirtyByPath: ReadonlyMap<string, OpenDocumentInfo>,
    signal?: AbortSignal,
  ): Promise<string[]> {
    signal?.throwIfAborted();
    const accepted: string[] = [];
    const seen = new Set<string>();

    for (const candidate of candidates) {
      const canonical = canonicalRelative(candidate);
      if (canonical === undefined || seen.has(canonical)) {
        continue;
      }
      seen.add(canonical);

      if (isSecretPath(canonical) || isBinaryPath(canonical)) {
        continue;
      }

      const open = openDirtyByPath.get(canonical);
      if (open !== undefined) {
        if (open.byteLength <= MAX_CONTEXT_FILE_BYTES) {
          accepted.push(canonical);
        }
        continue;
      }

      const inspection = await this.access.inspectPath(canonical, signal);
      this.ensureCurrent(folder, branch, signal);

      if (
        inspection.exists &&
        inspection.isFile &&
        inspection.withinRoot &&
        inspection.byteLength <= MAX_CONTEXT_FILE_BYTES
      ) {
        accepted.push(canonical);
      }
    }

    return accepted;
  }

  private collectDiagnostics(): string[] {
    const summaries: string[] = [];

    for (const diagnostic of this.access.diagnostics()) {
      const canonical = canonicalRelative(diagnostic.relativePath);
      if (canonical === undefined || isSecretPath(canonical)) {
        continue;
      }
      const summary = oneLine(
        `${canonical}:${diagnostic.line} ${diagnostic.message}`,
      ).slice(0, MAX_DIAGNOSTIC_LENGTH);
      summaries.push(summary);
    }

    for (const result of this.access.validationResults()) {
      summaries.push(oneLine(result).slice(0, MAX_DIAGNOSTIC_LENGTH));
    }

    return summaries;
  }

  private ensureCurrent(
    folder: WorkspaceFolderIdentity,
    branch: string | undefined,
    signal?: AbortSignal,
  ): void {
    signal?.throwIfAborted();
    if (
      this.access.workspaceFolder()?.workspaceId !== folder.workspaceId ||
      !this.access.isCurrent(folder, branch)
    ) {
      throw new WorkspaceContextChangedError();
    }
  }
}
