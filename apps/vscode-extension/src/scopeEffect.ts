import type { EffectRequest, EffectResult } from "@adaptive-pair/runtime";

const MAX_READ_LINES = 200;
const MAX_RESULT_CHARACTERS = 12_000;
const MAX_SEARCH_FILES = 200;
const MAX_SEARCH_MATCHES = 50;
const MAX_MATCH_CHARACTERS = 300;

export type ScopeReadResult =
  | { readonly status: "ok"; readonly text: string; readonly partial?: boolean }
  | {
      readonly status:
        | "not-found"
        | "unsafe-path"
        | "binary"
        | "too-large"
        | "read-failed";
    };

export interface ScopeAccess {
  readText(path: string, signal: AbortSignal): Promise<ScopeReadResult>;
  listPaths(
    pattern: string | undefined,
    signal: AbortSignal,
  ): Promise<readonly string[]>;
}

export interface ScopeEffectRunner {
  run(request: EffectRequest, signal: AbortSignal): Promise<EffectResult>;
}

const canonicalRelative = (raw: string): string | undefined => {
  const normalized = raw.replace(/\\/gu, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/u.test(normalized)) {
    return undefined;
  }
  const segments = normalized
    .split("/")
    .filter(segment => segment !== "" && segment !== ".");
  if (segments.length === 0 || segments.includes("..")) {
    return undefined;
  }
  return segments.join("/");
};

const withinAllowedScope = (
  path: string,
  allowedPaths: readonly string[],
): boolean =>
  allowedPaths.some(allowed => {
    const scope = canonicalRelative(allowed);
    return scope !== undefined && (path === scope || path.startsWith(`${scope}/`));
  });

const result = (
  request: EffectRequest,
  status: EffectResult["status"],
  summary: string,
  observation: Readonly<Record<string, unknown>>,
  partial = false,
): EffectResult => ({
  operationId: request.operationId,
  status,
  summary,
  observation,
  sensitiveData: false,
  partial,
});

const positiveLine = (value: unknown): number | undefined =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 1
    ? value
    : undefined;

export class BoundedScopeEffectRunner implements ScopeEffectRunner {
  public constructor(private readonly access: ScopeAccess) {}

  public async run(
    request: EffectRequest,
    signal: AbortSignal,
  ): Promise<EffectResult> {
    signal.throwIfAborted();
    return request.toolName === "pair_read_scope"
      ? await this.read(request, signal)
      : request.toolName === "pair_search_scope"
        ? await this.search(request, signal)
        : result(
            request,
            "declined",
            "The requested operation is not a scope read.",
            { reason: "unsupported-scope-tool" },
          );
  }

  private async read(
    request: EffectRequest,
    signal: AbortSignal,
  ): Promise<EffectResult> {
    const rawPath = request.payload["path"];
    const path =
      typeof rawPath === "string" ? canonicalRelative(rawPath) : undefined;
    if (
      path === undefined ||
      !withinAllowedScope(path, request.allowedPaths)
    ) {
      return result(
        request,
        "declined",
        "The requested path is outside the agreed work-unit scope.",
        { reason: "path-outside-scope" },
      );
    }

    const startLine = positiveLine(request.payload["startLine"]) ?? 1;
    const requestedEnd =
      request.payload["endLine"] === undefined
        ? startLine + MAX_READ_LINES - 1
        : positiveLine(request.payload["endLine"]);
    if (requestedEnd === undefined || requestedEnd < startLine) {
      return result(
        request,
        "declined",
        "The requested line range is invalid.",
        { reason: "invalid-line-range" },
      );
    }

    const read = await this.access.readText(path, signal);
    signal.throwIfAborted();
    if (read.status !== "ok") {
      return result(
        request,
        read.status === "read-failed" ? "failed" : "declined",
        "Adaptive Pair could not read the requested scoped file.",
        { reason: read.status },
      );
    }

    const lines = read.text.split(/\r?\n/u);
    const boundedEnd = Math.min(
      requestedEnd,
      startLine + MAX_READ_LINES - 1,
      Math.max(startLine - 1, lines.length),
    );
    const selected =
      startLine > lines.length
        ? ""
        : lines.slice(startLine - 1, boundedEnd).join("\n");
    const text = selected.slice(0, MAX_RESULT_CHARACTERS);
    const partial =
      read.partial === true ||
      boundedEnd < requestedEnd ||
      text.length < selected.length;

    return result(
      request,
      "confirmed",
      "Read bounded text from the agreed work-unit scope.",
      {
        path,
        startLine,
        endLine: boundedEnd,
        text,
      },
      partial,
    );
  }

  private async search(
    request: EffectRequest,
    signal: AbortSignal,
  ): Promise<EffectResult> {
    const query = request.payload["query"];
    if (typeof query !== "string" || query.trim().length === 0) {
      return result(
        request,
        "declined",
        "The requested search query is invalid.",
        { reason: "invalid-search-query" },
      );
    }
    const pattern =
      typeof request.payload["pattern"] === "string"
        ? request.payload["pattern"]
        : undefined;
    const paths = await this.access.listPaths(pattern, signal);
    const matches: { path: string; line: number; text: string }[] = [];
    let partial = paths.length > MAX_SEARCH_FILES;
    const needle = query.toLocaleLowerCase();

    for (const rawPath of paths.slice(0, MAX_SEARCH_FILES)) {
      signal.throwIfAborted();
      const path = canonicalRelative(rawPath);
      if (
        path === undefined ||
        !withinAllowedScope(path, request.allowedPaths)
      ) {
        continue;
      }
      const read = await this.access.readText(path, signal);
      if (read.status !== "ok") {
        continue;
      }
      partial ||= read.partial === true;

      const lines = read.text.split(/\r?\n/u);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        if (!line.toLocaleLowerCase().includes(needle)) {
          continue;
        }
        const match = {
          path,
          line: index + 1,
          text: line.slice(0, MAX_MATCH_CHARACTERS),
        };
        matches.push(match);
        if (
          matches.length >= MAX_SEARCH_MATCHES ||
          JSON.stringify({ query, matches }).length > MAX_RESULT_CHARACTERS
        ) {
          if (
            JSON.stringify({ query, matches }).length >
            MAX_RESULT_CHARACTERS
          ) {
            matches.pop();
          }
          partial = true;
          return result(
            request,
            "confirmed",
            "Searched bounded text inside the agreed work-unit scope.",
            { query, matches },
            partial,
          );
        }
      }
    }

    return result(
      request,
      "confirmed",
      "Searched bounded text inside the agreed work-unit scope.",
      { query, matches },
      partial,
    );
  }
}
