import type { EntrySnapshot } from "@adaptive-pair/protocol";
import { cloneFrozen } from "./immutable.js";

const sortUnique = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort();

const limitDiagnostics = (diagnostics: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const diagnostic of diagnostics) {
    if (seen.has(diagnostic)) {
      continue;
    }

    seen.add(diagnostic);
    normalized.push(diagnostic);

    if (normalized.length === 50) {
      break;
    }
  }

  return normalized;
};

export const normalizeEntrySnapshot = (
  entry: EntrySnapshot,
  previous: EntrySnapshot | undefined,
): EntrySnapshot =>
  cloneFrozen({
    workspaceId: entry.workspaceId,
    ...(entry.branch === undefined ? {} : { branch: entry.branch }),
    dirtyPaths: sortUnique(entry.dirtyPaths),
    openPaths: sortUnique(entry.openPaths),
    diagnostics: limitDiagnostics(entry.diagnostics),
    protectedPaths: sortUnique([
      ...entry.protectedPaths,
      ...entry.dirtyPaths,
      ...(previous?.protectedPaths ?? []),
      ...(previous?.dirtyPaths ?? []),
    ]),
    capturedAt: entry.capturedAt,
  });
