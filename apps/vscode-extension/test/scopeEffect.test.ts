import type { EffectRequest } from "@adaptive-pair/runtime";
import { expect, it } from "vitest";
import { BoundedScopeEffectRunner, type ScopeAccess } from "../src/scopeEffect.js";

const request = (over: Partial<EffectRequest>): EffectRequest => ({
  operationId: "op-1",
  workspaceId: "workspace-1",
  workUnitId: "unit-1",
  allowedPaths: ["src"],
  toolName: "pair_read_scope",
  kind: "read",
  payload: {},
  runtimeRevision: 1,
  authorityEpoch: 0,
  ...over,
});

const fakeAccess = ({
  text = "",
  paths = [],
  truncated = false,
}: {
  readonly text?: string | ((path: string) => string);
  readonly paths?: readonly string[];
  readonly truncated?: boolean;
}) => {
  const reads: string[] = [];
  const listedScopes: (readonly string[])[] = [];
  const access: ScopeAccess = {
    readText: path => {
      reads.push(path);
      return Promise.resolve({
        status: "ok",
        text: typeof text === "string" ? text : text(path),
      });
    },
    listPaths: (_pattern, allowedPaths) => {
      listedScopes.push(allowedPaths);
      return Promise.resolve({ paths, truncated });
    },
  };
  return { access, reads, listedScopes };
};

const run = (access: ScopeAccess, over: Partial<EffectRequest>) =>
  new BoundedScopeEffectRunner(access).run(request(over), new AbortController().signal);

it("rejects a read outside the trusted scope before file access", async () => {
  const { access, reads } = fakeAccess({ text: "secret" });

  const result = await run(access, {
    toolName: "pair_read_scope",
    allowedPaths: ["src"],
    payload: { path: "../secret.txt" },
  });

  expect(result.status).toBe("declined");
  expect(result.observation).toMatchObject({ reason: "path-outside-scope" });
  expect(reads).toEqual([]);
});

it("does not mark a complete short default read partial", async () => {
  const { access } = fakeAccess({ text: "one\ntwo" });

  const result = await run(access, {
    toolName: "pair_read_scope",
    payload: { path: "src/retry.ts" },
  });

  expect(result.status).toBe("confirmed");
  expect(result.partial).toBe(false);
  expect(result.observation?.["endLine"]).toBe(2);
});

it("declines a line range that starts after end of file", async () => {
  const { access } = fakeAccess({ text: "one\ntwo" });

  const result = await run(access, {
    toolName: "pair_read_scope",
    payload: { path: "src/retry.ts", startLine: 10 },
  });

  expect(result.status).toBe("declined");
  expect(result.observation).toMatchObject({
    reason: "line-range-out-of-bounds",
  });
});

it("searches eligible scoped files with bounded structured matches", async () => {
  const { access } = fakeAccess({
    paths: ["src/a.ts", "src/b.ts", "docs/private.md"],
    text: path =>
      path === "src/a.ts" ? "const retry = true;\nretry();" : "nothing here",
  });

  const result = await run(access, {
    toolName: "pair_search_scope",
    allowedPaths: ["src"],
    payload: { query: "retry", pattern: "**/*.ts" },
  });

  expect(result.status).toBe("confirmed");
  expect(result.observation).toEqual({
    query: "retry",
    matches: [
      { path: "src/a.ts", line: 1, text: "const retry = true;" },
      { path: "src/a.ts", line: 2, text: "retry();" },
    ],
  });
});

it("filters to trusted scope before applying the search file cap", async () => {
  const outside = Array.from(
    { length: 200 },
    (_, index) => `docs/generated-${index}.md`,
  );
  const { access, listedScopes } = fakeAccess({
    paths: [...outside, "src/retry.ts"],
    text: "retryUntil",
  });

  const result = await run(access, {
    toolName: "pair_search_scope",
    allowedPaths: ["src"],
    payload: { query: "retryUntil" },
  });

  expect(result.observation?.["matches"]).toEqual([
    { path: "src/retry.ts", line: 1, text: "retryUntil" },
  ]);
  expect(listedScopes).toEqual([["src"]]);
});

it("propagates workspace discovery truncation as a partial search", async () => {
  const { access } = fakeAccess({
    paths: ["src/retry.ts"],
    truncated: true,
    text: "retryUntil",
  });

  const result = await run(access, {
    toolName: "pair_search_scope",
    allowedPaths: ["src"],
    payload: { query: "retryUntil" },
  });

  expect(result.status).toBe("confirmed");
  expect(result.partial).toBe(true);
});
