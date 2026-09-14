import {
  buildProjectContext,
  compareProjectDocuments,
  projectDocumentPath,
  PROJECT_CONTEXT_LIMITS,
} from "../core/projectContext";
import type { ProjectContext, ProjectDocument } from "../core/projectContext";

export interface ProjectFileStat {
  readonly size: number;
  readonly isFile: boolean;
  readonly isSymbolicLink: boolean;
}

export interface ProjectContextAccess {
  isTrusted(): boolean;
  stat(uri: string): Promise<ProjectFileStat>;
  readFile(uri: string): Promise<Uint8Array>;
  openText(uri: string): string | undefined;
}

export const readProjectContext = async (
  access: ProjectContextAccess,
  rootUri: string | undefined,
  candidateUris: readonly string[],
  isCurrent: () => boolean,
): Promise<ProjectContext | undefined> => {
  if (!isCurrent()) {
    return undefined;
  }
  if (!access.isTrusted()) {
    return buildProjectContext(rootUri, [], ["Project documents were not read: workspace trust is required."]);
  }
  if (rootUri === undefined) {
    return buildProjectContext(undefined, [], ["Open a workspace to read project documents, or start by describing your goal in Chat."]);
  }
  const candidates = [...new Set(candidateUris.slice(0, 50))]
    .map((uri) => ({ uri, label: projectDocumentPath(rootUri, uri) }))
    .filter((candidate): candidate is { uri: string; label: string } => candidate.label !== undefined)
    .sort(compareProjectDocuments)
    .slice(0, PROJECT_CONTEXT_LIMITS.documents);
  const documents: ProjectDocument[] = [];
  const notices: string[] = [];
  const current = (): boolean => isCurrent() && access.isTrusted();
  for (const candidate of candidates) {
    if (!current()) {
      return undefined;
    }
    try {
      const safeFile = await inspectDocument(access, rootUri, candidate, current);
      if (!current()) {
        return undefined;
      }
      if (!safeFile) {
        notices.push(`${candidate.label}: skipped an oversized, symbolic-link, or unsupported document.`);
        continue;
      }
      const openText = access.openText(candidate.uri);
      const bytes = openText === undefined
        ? await access.readFile(candidate.uri)
        : new TextEncoder().encode(openText);
      if (!current()) {
        return undefined;
      }
      if (bytes.byteLength > PROJECT_CONTEXT_LIMITS.documentBytes) {
        notices.push(`${candidate.label}: skipped content exceeding the read limit.`);
        continue;
      }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (text.includes("\0")) {
        notices.push(`${candidate.label}: skipped non-text content.`);
        continue;
      }
      documents.push({ ...candidate, text });
    } catch {
      if (!current()) {
        return undefined;
      }
      notices.push(`${candidate.label}: could not read this document safely.`);
    }
  }
  if (documents.length === 0 && notices.length === 0) {
    notices.push("No readable project documents found. Use @pair /plan to clarify the goal or @pair /brief to start an editable working agreement.");
  }
  return buildProjectContext(rootUri, documents, notices);
};

const inspectDocument = async (
  access: ProjectContextAccess,
  rootUri: string,
  document: { readonly uri: string; readonly label: string },
  isCurrent: () => boolean,
): Promise<boolean> => {
  const segments = document.label.split("/");
  if (segments.length > 12) {
    return false;
  }
  for (let depth = 1; depth <= segments.length; depth += 1) {
    if (!isCurrent()) {
      return false;
    }
    const uri = new URL(rootUri);
    uri.pathname = `${uri.pathname.replace(/\/+$/u, "")}/${segments.slice(0, depth).map(encodeURIComponent).join("/")}`;
    const stat = await access.stat(depth === segments.length ? document.uri : uri.toString());
    if (!isCurrent() || stat.isSymbolicLink) {
      return false;
    }
    if (depth === segments.length) {
      return stat.isFile && Number.isFinite(stat.size) && stat.size >= 0 && stat.size <= PROJECT_CONTEXT_LIMITS.documentBytes;
    }
    if (stat.isFile) {
      return false;
    }
  }
  return false;
};
