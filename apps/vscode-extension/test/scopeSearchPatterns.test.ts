import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  filesystem,
  linkDirectory,
  openBuffer,
  scopeRequest,
  workspace,
} from "./scopeCompositionFixtures.js";

const { VscodeScopeAccess } = await import("../src/scopeAccess.js");
const { BoundedScopeEffectRunner } = await import("../src/scopeEffect.js");

const search = (pattern: string, allowedPaths: readonly string[] = ["linked"]) =>
  new BoundedScopeEffectRunner(new VscodeScopeAccess(filesystem.root)).run(
    scopeRequest("pair_search_scope", allowedPaths, { query: "retry", pattern }),
    new AbortController().signal,
  );

beforeEach(async () => {
  workspace.filesystemDiscovery = true;
  await writeFile(join(filesystem.source, "skip.js"), "retry JavaScript");
});

describe("Scope search — directory pattern coordinates", () => {
  it.each([
    "src/**/*.ts",
    "src/main.ts",
    "linked/**/*.ts",
    "linked/main.ts",
    "**/*.ts",
    "main.ts",
  ])("searches an agreed alias using %s", async pattern => {
    const result = await search(pattern);

    expect(result).toMatchObject({ status: "confirmed", partial: false });
    expect(result.observation?.["matches"]).toEqual([
      { path: "src/main.ts", line: 1, text: "retry on disk" },
    ]);
  });

  it.each(["linked", "src"])("accepts the whole scope identity %s", async pattern => {
    const result = await search(pattern);

    expect(result.observation?.["matches"]).toEqual([
      { path: "src/main.ts", line: 1, text: "retry on disk" },
      { path: "src/skip.js", line: 1, text: "retry JavaScript" },
    ]);
    expect(result.partial).toBe(false);
  });

  it.each(["nested/*.ts", "linked/nested/*.ts", "src/nested/*.ts"])(
    "preserves nested pattern selection for %s",
    async pattern => {
      await mkdir(join(filesystem.source, "nested"));
      await writeFile(join(filesystem.source, "nested", "worker.ts"), "retry worker");

      const result = await search(pattern);

      expect(result.observation?.["matches"]).toEqual([
        { path: "src/nested/worker.ts", line: 1, text: "retry worker" },
      ]);
      expect(result.partial).toBe(false);
    },
  );
});

describe("Scope search — file pattern coordinates", () => {
  it.each([
    "src/main.ts",
    "linked/main.ts",
    "src/**/*.ts",
    "linked/**/*.ts",
    "**/*.ts",
  ])("keeps an aliased file permission narrow with %s", async pattern => {
    await writeFile(join(filesystem.source, "sibling.ts"), "retry sibling");
    const getText = openBuffer(join(filesystem.source, "sibling.ts"), "retry private sibling");

    const result = await search(pattern, ["linked/main.ts"]);

    expect(result).toMatchObject({ status: "confirmed", partial: false });
    expect(result.observation?.["matches"]).toEqual([
      { path: "src/main.ts", line: 1, text: "retry on disk" },
    ]);
    expect(getText).not.toHaveBeenCalled();
  });
});

describe.each(["ordinary", "aliased"])(
  "Scope search — overlapping file prefixes with an %s root",
  rootKind => {
    it.each([
      "src/nested/**/*.ts",
      "src/nested",
      "src/nested/main.ts",
      "**/*.ts",
    ])("keeps the aliased file permission narrow with %s", async pattern => {
      const nested = join(filesystem.source, "nested");
      await mkdir(nested);
      const target = join(nested, "main.ts");
      await writeFile(target, "retry nested target");
      const sibling = join(nested, "sibling.ts");
      await writeFile(sibling, "retry sibling");
      await symlink(target, join(filesystem.source, "entry.ts"), "file");
      const getText = openBuffer(sibling, "retry private sibling");
      let root = filesystem.root;
      if (rootKind === "aliased") {
        root = join(filesystem.temporaryRoot, "workspace-link");
        await linkDirectory(filesystem.root, root);
      }

      const result = await new BoundedScopeEffectRunner(new VscodeScopeAccess(root)).run(
        scopeRequest("pair_search_scope", ["src/entry.ts"], { query: "retry", pattern }),
        new AbortController().signal,
      );

      expect(result).toMatchObject({ status: "confirmed", partial: false });
      expect(result.observation?.["matches"]).toEqual([
        { path: "src/nested/main.ts", line: 1, text: "retry nested target" },
      ]);
      expect(getText).not.toHaveBeenCalled();
    });
  },
);

describe("Scope search — pattern permission controls", () => {
  it.each(["inside", "outside"])("rejects a child alias into an unagreed %s directory", async location => {
    const unagreed = location === "inside" ? join(filesystem.root, "unagreed") : filesystem.outside;
    await mkdir(unagreed, { recursive: true });
    await writeFile(join(unagreed, "private.ts"), "retry private disk");
    await linkDirectory(unagreed, join(filesystem.source, "escape"));
    const getText = openBuffer(join(unagreed, "private.ts"), "retry private dirty");

    const result = await search("linked/escape/*.ts");

    expect(result).toMatchObject({ status: "confirmed", observation: { matches: [] } });
    expect(workspace.searches[0]?.pattern).toBe("escape/*.ts");
    expect(getText).not.toHaveBeenCalled();
  });

  it("retains the canonical permission snapshot if discovery retargets an alias", async () => {
    const unagreed = join(filesystem.root, "unagreed");
    await mkdir(unagreed);
    await writeFile(join(unagreed, "private.ts"), "retry private disk");
    const getText = openBuffer(join(unagreed, "private.ts"), "retry private dirty");
    const access = new VscodeScopeAccess(filesystem.root);
    const originalList = access.listPaths.bind(access);
    vi.spyOn(access, "listPaths").mockImplementation(async (pattern, allowedPaths, signal) => {
      await rm(join(filesystem.root, "linked"));
      await linkDirectory(unagreed, join(filesystem.root, "linked"));
      return originalList(pattern, allowedPaths, signal);
    });

    const result = await new BoundedScopeEffectRunner(access).run(
      scopeRequest("pair_search_scope", ["linked"], { query: "retry", pattern: "linked/**/*.ts" }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ status: "confirmed", observation: { matches: [] } });
    expect(workspace.searches[0]?.baseUri.fsPath).toBe(unagreed);
    expect(getText).not.toHaveBeenCalled();
  });

  it.each(["../src/**/*.ts", "/src/**/*.ts", "C:/src/**/*.ts"])(
    "does not discover files for an unsafe pattern %s",
    async pattern => {
      const result = await search(pattern);

      expect(result).toMatchObject({ status: "confirmed", observation: { matches: [] } });
      expect(workspace.searches).toEqual([]);
    },
  );
});
