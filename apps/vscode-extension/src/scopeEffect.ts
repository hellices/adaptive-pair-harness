import type { EffectRequest, EffectResult } from "@adaptive-pair/runtime";
import { canonicalRelative } from "./workspaceContext.js";

const MAX_READ_LINES = 200;
const MAX_RESULT_CHARACTERS = 12_000;
const MAX_SEARCH_FILES = 200;
const MAX_SEARCH_MATCHES = 50;
const MAX_MATCH_CHARACTERS = 300;

export type ScopeReadResult =
  | {
      readonly status: "ok";
      readonly path?: string;
      readonly text: string;
      readonly partial?: boolean;
    }
  | {
      readonly status:
        | "not-found"
        | "unsafe-path"
        | "binary"
        | "too-large"
        | "read-failed";
    };

export interface ScopeAccess {
  canonicalPaths?(paths: readonly string[], signal: AbortSignal): Promise<readonly string[]>;
  readText(path: string, signal: AbortSignal): Promise<ScopeReadResult>;
  listPaths(
    pattern: string | undefined,
    allowedPaths: readonly string[],
    signal: AbortSignal,
  ): Promise<{
    readonly paths: readonly string[];
    readonly truncated: boolean;
  }>;
}

export interface ScopeEffectRunner {
  run(request: EffectRequest, signal: AbortSignal): Promise<EffectResult>;
}

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
    try {
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
    } catch {
      if (signal.aborted) {
        return result(
          request,
          "cancelled",
          "The bounded scope read was cancelled.",
          { reason: "scope-read-cancelled" },
          true,
        );
      }
      return result(
        request,
        "failed",
        "Adaptive Pair could not access the agreed workspace scope.",
        { reason: "scope-access-failed" },
        true,
      );
    }
  }

  private async read(
    request: EffectRequest,
    signal: AbortSignal,
  ): Promise<EffectResult> {
    const scope = await this.resolveReadScope(request, signal);
    if (scope === undefined) {
      return result(
        request,
        "declined",
        "The requested path is outside the agreed work-unit scope.",
        { reason: "path-outside-scope" },
      );
    }
    const { path, allowedPaths } = scope;

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
    const resolvedPath = canonicalRelative(read.path ?? path);
    if (
      resolvedPath === undefined ||
      !withinAllowedScope(resolvedPath, allowedPaths)
    ) {
      return result(
        request,
        "declined",
        "The resolved file is outside the agreed work-unit scope.",
        { reason: "resolved-path-outside-scope" },
      );
    }

    const lines = read.text.split(/\r?\n/u);
    if (startLine > lines.length) {
      return result(
        request,
        "declined",
        "The requested line range starts after the end of the file.",
        { reason: "line-range-out-of-bounds" },
      );
    }
    const explicitEnd = request.payload["endLine"] !== undefined;
    const maximumEnd = startLine + MAX_READ_LINES - 1;
    const boundedEnd = Math.min(
      requestedEnd,
      maximumEnd,
      lines.length,
    );
    const selected = lines.slice(startLine - 1, boundedEnd).join("\n");
    const text = selected.slice(0, MAX_RESULT_CHARACTERS);
    const partial =
      read.partial === true ||
      (explicitEnd ? requestedEnd > maximumEnd : lines.length > maximumEnd) ||
      text.length < selected.length;

    return result(
      request,
      "confirmed",
      "Read bounded text from the agreed work-unit scope.",
      {
        path: resolvedPath,
        startLine,
        endLine: boundedEnd,
        text,
      },
      partial,
    );
  }

  private async canonicalPaths(paths: readonly string[], signal: AbortSignal): Promise<readonly string[]> {
    const resolved = this.access.canonicalPaths === undefined
      ? paths
      : await this.access.canonicalPaths(paths, signal);
    signal.throwIfAborted();
    return resolved.map(canonicalRelative).filter((path): path is string => path !== undefined);
  }

  private async resolveReadScope(
    request: EffectRequest,
    signal: AbortSignal,
  ): Promise<{ readonly path: string; readonly allowedPaths: readonly string[] } | undefined> {
    const rawPath = request.payload["path"];
    const path = typeof rawPath === "string" ? canonicalRelative(rawPath) : undefined;
    if (path === undefined || request.allowedPaths.length === 0) {
      return undefined;
    }
    const allowedPaths = await this.canonicalPaths(request.allowedPaths, signal);
    if (allowedPaths.length === 0) {
      return undefined;
    }
    const [resolvedPath] = await this.canonicalPaths([path], signal);
    return resolvedPath !== undefined && withinAllowedScope(resolvedPath, allowedPaths)
      ? { path, allowedPaths }
      : undefined;
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
    const allowedPaths = await this.canonicalPaths(request.allowedPaths, signal);
    const discovery = await this.access.listPaths(
      pattern,
      request.allowedPaths,
      signal,
    );
    signal.throwIfAborted();
    const scopedPaths = discovery.paths
      .map(canonicalRelative)
      .filter(
        (path): path is string =>
          path !== undefined &&
          withinAllowedScope(path, allowedPaths),
      );
    const matches: { path: string; line: number; text: string }[] = [];
    let partial =
      discovery.truncated || scopedPaths.length > MAX_SEARCH_FILES;
    const needle = query.toLocaleLowerCase();

    for (const path of scopedPaths.slice(0, MAX_SEARCH_FILES)) {
      signal.throwIfAborted();
      const read = await this.access.readText(path, signal);
      signal.throwIfAborted();
      if (read.status !== "ok") {
        partial = true;
        continue;
      }
      const resolvedPath = canonicalRelative(read.path ?? path);
      if (
        resolvedPath === undefined ||
        !withinAllowedScope(resolvedPath, allowedPaths)
      ) {
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
          path: resolvedPath,
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
