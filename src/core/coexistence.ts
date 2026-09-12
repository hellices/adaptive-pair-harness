import { posix as pathPosix } from "node:path";

export interface DiscoveryInput {
  readonly extensionIds: readonly string[];
  readonly workspacePaths: readonly string[];
}

export interface HarnessSignal {
  readonly kind:
    | "copilot"
    | "cline"
    | "superpowers-plan"
    | "agents-instructions";
  readonly label: string;
  readonly source: string;
}

interface SignalDefinition {
  readonly kind: HarnessSignal["kind"];
  readonly label: string;
  readonly matchesExtensionId?: readonly string[];
  readonly matchesWorkspacePath?: (path: string) => boolean;
}

const SIGNAL_DEFINITIONS: readonly SignalDefinition[] = [
  {
    kind: "copilot",
    label: "GitHub Copilot extension detected",
    matchesExtensionId: ["github.copilot", "github.copilot-chat"],
  },
  {
    kind: "cline",
    label: "Cline extension detected",
    matchesExtensionId: ["saoudrizwan.claude-dev", "cline.cline"],
  },
  {
    kind: "superpowers-plan",
    label: "Superpowers plan detected",
    matchesWorkspacePath: (workspacePath: string) =>
      /(^|\/)docs\/superpowers\/plans\/[^/]+-plan\.md$/.test(workspacePath),
  },
  {
    kind: "agents-instructions",
    label: "AGENTS.md instructions detected",
    matchesWorkspacePath: (workspacePath: string) =>
      pathPosix.basename(workspacePath).toLowerCase() === "agents.md",
  },
] as const;

function isAbsoluteWorkspacePath(workspacePath: string): boolean {
  return pathPosix.isAbsolute(workspacePath) || /^[a-z]:\//i.test(workspacePath);
}

function normalizeWorkspacePath(workspacePath: string): string | undefined {
  const normalized = pathPosix.normalize(workspacePath.replaceAll("\\", "/"));

  if (normalized === ".") {
    return "";
  }

  if (
    isAbsoluteWorkspacePath(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    return undefined;
  }

  return normalized;
}

function freezeSignal(signal: HarnessSignal): HarnessSignal {
  return Object.freeze(signal);
}

export function discoverHarnessSignals(
  input: DiscoveryInput,
): readonly HarnessSignal[] {
  const signalsByKind = new Map<HarnessSignal["kind"], HarnessSignal>();

  for (const extensionId of input.extensionIds) {
    const normalizedExtensionId = extensionId.toLowerCase();
    const definition = SIGNAL_DEFINITIONS.find(
      (signalDefinition) =>
        signalDefinition.matchesExtensionId?.includes(normalizedExtensionId) === true,
    );

    if (definition === undefined || signalsByKind.has(definition.kind)) {
      continue;
    }

    signalsByKind.set(
      definition.kind,
      freezeSignal({
        kind: definition.kind,
        label: definition.label,
        source: normalizedExtensionId,
      }),
    );
  }

  for (const workspacePath of input.workspacePaths) {
    const normalizedPath = normalizeWorkspacePath(workspacePath);
    if (normalizedPath === undefined) {
      continue;
    }

    const lowerCasePath = normalizedPath.toLowerCase();

    for (const definition of SIGNAL_DEFINITIONS) {
      if (
        definition.matchesWorkspacePath?.(lowerCasePath) !== true ||
        signalsByKind.has(definition.kind)
      ) {
        continue;
      }

      signalsByKind.set(
        definition.kind,
        freezeSignal({
          kind: definition.kind,
          label: definition.label,
          source: normalizedPath,
        }),
      );
    }
  }

  return Object.freeze(Array.from(signalsByKind.values()));
}
