import type { EntrySnapshot } from "@adaptive-pair/protocol";

const sortUnique = (values: readonly string[]): readonly string[] =>
  Object.freeze([...new Set(values)].sort());

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

  return Object.freeze(normalized);
};

export const buildEntrySnapshot = (input: EntrySnapshot): EntrySnapshot => {
  const dirtyPaths = sortUnique(input.dirtyPaths);

  return Object.freeze({
    workspaceId: input.workspaceId,
    ...(input.branch === undefined ? {} : { branch: input.branch }),
    dirtyPaths,
    openPaths: sortUnique(input.openPaths),
    diagnostics: limitDiagnostics(input.diagnostics),
    protectedPaths: sortUnique([...input.protectedPaths, ...dirtyPaths]),
    capturedAt: input.capturedAt,
  });
};
