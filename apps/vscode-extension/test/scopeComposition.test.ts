import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MAX_CONTEXT_FILE_BYTES } from "../src/workspaceContext.js";
import {
  filesystem,
  linkDirectory,
  openBuffer,
  scopeRequest,
  workspace,
} from "./scopeCompositionFixtures.js";

const { VscodeScopeAccess } = await import("../src/scopeAccess.js");
const { BoundedScopeEffectRunner } = await import("../src/scopeEffect.js");

const run = (
  toolName: "pair_read_scope" | "pair_search_scope",
  allowedPaths: readonly string[],
  payload: Readonly<Record<string, unknown>>,
  signal = new AbortController().signal,
) => new BoundedScopeEffectRunner(new VscodeScopeAccess(filesystem.root))
  .run(scopeRequest(toolName, allowedPaths, payload), signal);

describe("Scope composition — canonical alias permissions", () => {
  it.each(["linked", "linked/main.ts"])("reads a canonical file allowed through %s", async scope => {
    const result = await run("pair_read_scope", [scope], { path: "linked/main.ts" });

    expect(result).toMatchObject({
      status: "confirmed",
      observation: { path: "src/main.ts", text: "retry on disk\nsecond line" },
      sensitiveData: false,
      partial: false,
    });
  });

  it("accepts the canonical path reported by search under the same alias permission", async () => {
    const search = await run("pair_search_scope", ["linked"], { query: "retry" });
    expect(search.observation?.["matches"]).toEqual([
      { path: "src/main.ts", line: 1, text: "retry on disk" },
    ]);

    const read = await run("pair_read_scope", ["linked"], { path: "src/main.ts" });
    expect(read).toMatchObject({ status: "confirmed", observation: { path: "src/main.ts" } });
  });

  it.each([
    { scope: "linked", pattern: "linked/**/*.ts", scopedPattern: "**/*.ts" },
    { scope: "linked/main.ts", pattern: undefined, scopedPattern: "main.ts" },
  ])("searches an aliased $scope without losing canonical matches", async ({ scope, pattern, scopedPattern }) => {
    const sibling = join(filesystem.source, "sibling.ts");
    await writeFile(sibling, "retry sibling");
    if (scope.endsWith(".ts")) {
      workspace.foundPaths.push(sibling);
    }

    const result = await run("pair_search_scope", [scope], { query: "retry", pattern });

    expect(result).toMatchObject({
      status: "confirmed",
      observation: { matches: [{ path: "src/main.ts", line: 1, text: "retry on disk" }] },
    });
    expect(workspace.searches).toHaveLength(1);
    expect(workspace.searches[0]).toMatchObject({
      baseUri: { fsPath: filesystem.source },
      pattern: scopedPattern,
    });
  });
});

describe("Scope composition — canonical containment", () => {
  it.each(["src", "linked"])("rejects a child alias from %s into an unagreed in-root directory", async scope => {
    const unagreed = join(filesystem.root, "unagreed");
    await mkdir(unagreed);
    await writeFile(join(unagreed, "private.ts"), "private text");
    await linkDirectory(unagreed, join(filesystem.source, "escape"));
    const getText = openBuffer(join(unagreed, "private.ts"), "private dirty text");

    const result = await run("pair_read_scope", [scope], { path: `${scope}/escape/private.ts` });

    expect(result.status).toBe("declined");
    expect(result.observation?.["text"]).toBeUndefined();
    expect(getText).not.toHaveBeenCalled();
  });

  it("filters discovered child aliases that leave the canonical directory permission", async () => {
    const unagreed = join(filesystem.root, "unagreed");
    await mkdir(unagreed);
    await writeFile(join(unagreed, "private.ts"), "retry private text");
    await linkDirectory(unagreed, join(filesystem.source, "escape"));
    workspace.foundPaths.push(join(filesystem.source, "escape", "private.ts"));

    const result = await run("pair_search_scope", ["linked"], { query: "retry" });

    expect(result.observation?.["matches"]).toEqual([
      { path: "src/main.ts", line: 1, text: "retry on disk" },
    ]);
  });

  it("does not broaden an aliased file permission to its sibling", async () => {
    await writeFile(join(filesystem.source, "sibling.ts"), "sibling disk text");
    const getText = openBuffer(join(filesystem.source, "sibling.ts"), "sibling dirty text");

    const result = await run("pair_read_scope", ["linked/main.ts"], { path: "linked/sibling.ts" });

    expect(result.status).toBe("declined");
    expect(getText).not.toHaveBeenCalled();
  });

  it("rechecks canonical containment if an alias is retargeted during text access", async () => {
    const unagreed = join(filesystem.root, "unagreed");
    await mkdir(unagreed);
    await writeFile(join(unagreed, "main.ts"), "retargeted private text");
    const access = new VscodeScopeAccess(filesystem.root);
    const originalRead = access.readText.bind(access);
    vi.spyOn(access, "readText").mockImplementation(async (path, signal) => {
      await rm(join(filesystem.root, "linked"));
      await linkDirectory(unagreed, join(filesystem.root, "linked"));
      return originalRead(path, signal);
    });

    const result = await new BoundedScopeEffectRunner(access).run(
      scopeRequest("pair_read_scope", ["linked"], { path: "linked/main.ts" }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: "declined",
      observation: { reason: "resolved-path-outside-scope" },
    });
    expect(result.observation?.["text"]).toBeUndefined();
  });

  it.each([false, true])("rejects an out-of-root alias with a missing target: %s", async missing => {
    const target = join(filesystem.outside, "private.ts");
    if (!missing) {
      await writeFile(target, "outside text");
    }
    await linkDirectory(filesystem.outside, join(filesystem.root, "external"));
    const getText = openBuffer(target, "outside dirty text");

    const result = await run("pair_read_scope", ["external"], { path: "external/private.ts" });

    expect(result.status).toBe("declined");
    expect(getText).not.toHaveBeenCalled();
  });

  it.each([".env", "image.png"])("rejects canonical secret or binary alias targets: %s", async filename => {
    const target = join(filesystem.root, filename);
    await writeFile(target, "protected text");
    await symlink(target, join(filesystem.source, "alias.ts"));
    const getText = openBuffer(target, "protected dirty text");

    const result = await run("pair_read_scope", ["src"], { path: "src/alias.ts" });

    expect(result.status).toBe("declined");
    expect(getText).not.toHaveBeenCalled();
  });
});

describe("Scope composition — dirty missing files", () => {
  it.each(["src/new.ts", "src/new/nested/file.ts"])("reads a dirty new buffer at %s", async path => {
    openBuffer(join(filesystem.root, path), "unsaved retry text");

    const result = await run("pair_read_scope", ["src"], { path });

    expect(result).toMatchObject({
      status: "confirmed",
      observation: { path, text: "unsaved retry text" },
      partial: false,
    });
  });

  it.each([
    { requested: "linked/new/nested.ts", document: "src/new/nested.ts" },
    { requested: "src/new/nested.ts", document: "linked/new/nested.ts" },
  ])("matches missing aliases for $requested and $document", async ({ requested, document }) => {
    openBuffer(join(filesystem.root, document), "dirty alias text");

    const result = await run("pair_read_scope", ["linked"], { path: requested });

    expect(result).toMatchObject({
      status: "confirmed",
      observation: { path: "src/new/nested.ts", text: "dirty alias text" },
    });
  });

  it("reads a deleted file retained in an aliased dirty buffer", async () => {
    openBuffer(join(filesystem.root, "linked", "main.ts"), "dirty deleted text");
    await rm(join(filesystem.source, "main.ts"));

    const result = await run("pair_read_scope", ["linked/main.ts"], { path: "linked/main.ts" });

    expect(result).toMatchObject({
      status: "confirmed",
      observation: { path: "src/main.ts", text: "dirty deleted text" },
    });
  });

  it("retains not-found when no matching dirty buffer exists", async () => {
    const result = await run("pair_read_scope", ["src"], { path: "src/new.ts" });

    expect(result).toMatchObject({ status: "declined", observation: { reason: "not-found" } });
  });

  it.each([
    { isDirty: false, scheme: "file" },
    { isDirty: true, scheme: "untitled" },
  ])("ignores an ineligible new buffer: %j", async ({ isDirty, scheme }) => {
    const getText = openBuffer(join(filesystem.source, "new.ts"), "ineligible", isDirty, scheme);

    const result = await run("pair_read_scope", ["src"], { path: "src/new.ts" });

    expect(result).toMatchObject({ status: "declined", observation: { reason: "not-found" } });
    expect(getText).not.toHaveBeenCalled();
  });

  it("does not substitute a new buffer owned by another root", async () => {
    const getText = openBuffer(join(filesystem.outside, "src", "new.ts"), "other-root text");

    const result = await run("pair_read_scope", ["src"], { path: "src/new.ts" });

    expect(result).toMatchObject({ status: "declined", observation: { reason: "not-found" } });
    expect(getText).not.toHaveBeenCalled();
  });
});

describe("Scope composition — missing buffer safety and bounds", () => {
  it("rejects a dirty new buffer whose existing ancestor is a file", async () => {
    const getText = openBuffer(join(filesystem.source, "main.ts", "new.ts"), "invalid child text");

    const result = await run("pair_read_scope", ["src/main.ts"], { path: "src/main.ts/new.ts" });

    expect(result.status).toBe("failed");
    expect(getText).not.toHaveBeenCalled();
  });

  it.each([".env", "new.png"])("refuses an unsafe missing buffer named %s", async filename => {
    const getText = openBuffer(join(filesystem.source, filename), "unsafe text");

    const result = await run("pair_read_scope", ["linked"], { path: `linked/${filename}` });

    expect(result.status).toBe("declined");
    expect(getText).not.toHaveBeenCalled();
  });

  it.each([
    { name: "binary", text: "prefix\0suffix", reason: "binary" },
    { name: "oversized UTF-8", text: "é".repeat(MAX_CONTEXT_FILE_BYTES / 2 + 1), reason: "too-large" },
    { name: "oversized binary", text: `\0${"é".repeat(MAX_CONTEXT_FILE_BYTES / 2)}`, reason: "too-large" },
  ])("refuses a $name dirty new buffer", async ({ text, reason }) => {
    openBuffer(join(filesystem.source, "new.ts"), text);

    const result = await run("pair_read_scope", ["src"], { path: "src/new.ts" });

    expect(result).toMatchObject({ status: "declined", observation: { reason } });
  });

  it("retains the exact UTF-8 byte limit and bounded output", async () => {
    openBuffer(join(filesystem.source, "new.ts"), "é".repeat(MAX_CONTEXT_FILE_BYTES / 2));

    const result = await run("pair_read_scope", ["src"], { path: "src/new.ts" });

    expect(result).toMatchObject({ status: "confirmed", partial: true });
    const displayed = String(result.observation?.["text"]);
    expect(displayed.length).toBeGreaterThan(0);
    expect(displayed.length).toBeLessThan(12_000);
    expect(displayed).toBe("é".repeat(displayed.length));
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(12_000);
  });

  it.each(["inside", "outside"])("does not invent an identity through a dangling %s alias", async location => {
    const target = join(location === "inside" ? filesystem.root : filesystem.outside, "missing");
    await linkDirectory(target, join(filesystem.source, "dangling"));
    const getText = openBuffer(join(filesystem.source, "dangling", "new.ts"), "dangling text");

    const result = await run("pair_read_scope", ["src"], { path: "src/dangling/new.ts" });

    expect(result.status).toBe("declined");
    expect(getText).not.toHaveBeenCalled();
  });

  it("fails closed when a filesystem identity is unavailable", async () => {
    const loop = join(filesystem.source, "loop");
    await linkDirectory(loop, loop);
    const getText = openBuffer(join(loop, "new.ts"), "unavailable text");

    const result = await run("pair_read_scope", ["src"], { path: "src/loop/new.ts" });

    expect(result.status).toBe("failed");
    expect(getText).not.toHaveBeenCalled();
  });
});

describe("Scope composition — cancellation", () => {
  it.each(["pair_read_scope", "pair_search_scope"] as const)("keeps an already cancelled %s inactive", async toolName => {
    const controller = new AbortController();
    controller.abort();
    const getText = openBuffer(join(filesystem.source, "main.ts"), "dirty text");

    const result = await run(toolName, ["linked"], { path: "linked/main.ts", query: "dirty" }, controller.signal);

    expect(result.status).toBe("cancelled");
    expect(getText).not.toHaveBeenCalled();
    expect(workspace.searches).toEqual([]);
  });

  it("does not confirm an empty discovery returned after cancellation", async () => {
    const controller = new AbortController();
    const access = new VscodeScopeAccess(filesystem.root);
    const originalList = access.listPaths.bind(access);
    workspace.foundPaths = [];
    vi.spyOn(access, "listPaths").mockImplementation(async (pattern, allowedPaths, signal) => {
      const discovery = await originalList(pattern, allowedPaths, signal);
      controller.abort();
      return discovery;
    });

    const result = await new BoundedScopeEffectRunner(access).run(
      scopeRequest("pair_search_scope", ["src"], { query: "retry" }),
      controller.signal,
    );

    expect(result).toMatchObject({ status: "cancelled", observation: { reason: "scope-read-cancelled" } });
  });

  it("does not publish matches when cancellation arrives with the final file read", async () => {
    const controller = new AbortController();
    const access = new VscodeScopeAccess(filesystem.root);
    const originalRead = access.readText.bind(access);
    vi.spyOn(access, "readText").mockImplementation(async (path, signal) => {
      const read = await originalRead(path, signal);
      controller.abort();
      return read;
    });

    const result = await new BoundedScopeEffectRunner(access).run(
      scopeRequest("pair_search_scope", ["src"], { query: "retry" }),
      controller.signal,
    );

    expect(result).toMatchObject({ status: "cancelled", observation: { reason: "scope-read-cancelled" } });
    expect(result.observation?.["matches"]).toBeUndefined();
  });
});
