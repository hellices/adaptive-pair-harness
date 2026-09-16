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

const search = (
  pattern: string,
  allowedPaths: readonly string[] = ["linked"],
  root = filesystem.root,
) =>
  new BoundedScopeEffectRunner(new VscodeScopeAccess(root)).run(
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

describe.each(["ordinary", "aliased"])(
  "Scope search — qualified patterns across an %s workspace",
  rootKind => {
    let root: string;

    beforeEach(async () => {
      root = filesystem.root;
      if (rootKind === "aliased") {
        root = join(filesystem.temporaryRoot, "workspace-link");
        await linkDirectory(filesystem.root, root);
      }
      for (const prefix of ["src", "linked"]) {
        const directory = join(filesystem.root, "test", prefix);
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "main.ts"), `retry unrelated ${prefix}`);
      }
    });

    it.each([
      { pattern: "src/**/*.ts", allowedPaths: ["src", "test"] },
      { pattern: "src/**/*.ts", allowedPaths: ["test", "src"] },
      { pattern: "linked/**/*.ts", allowedPaths: ["linked", "test"] },
      { pattern: "src/**/*.ts", allowedPaths: ["test", "linked"] },
      { pattern: "src/**/*.ts", allowedPaths: ["test", "src", "linked", "src/main.ts"] },
      { pattern: "src/**/*.ts", allowedPaths: ["test", "linked\\main.ts"] },
      { pattern: "linked/main.ts", allowedPaths: ["test", "linked/main.ts"] },
    ])("limits $pattern to qualifying scopes $allowedPaths", async ({ pattern, allowedPaths }) => {
      const unrelated = ["src", "linked"].map(prefix =>
        openBuffer(join(filesystem.root, "test", prefix, "main.ts"), `retry unrelated ${prefix}`));

      const result = await search(pattern, allowedPaths, root);

      expect(result).toMatchObject({ status: "confirmed", partial: false });
      expect(result.observation?.["matches"]).toEqual([
        { path: "src/main.ts", line: 1, text: "retry on disk" },
      ]);
      expect(workspace.searches.map(search => search.baseUri.fsPath))
        .not.toContain(join(filesystem.root, "test"));
      for (const getText of unrelated) {
        expect(getText).not.toHaveBeenCalled();
      }
    });

    it.each(["src/nested/**/*.ts", "src/nested"])(
      "keeps the longest aliased file prefix for %s across roots",
      async pattern => {
        const nested = join(filesystem.source, "nested");
        await mkdir(nested);
        const target = join(nested, "main.ts");
        await writeFile(target, "retry nested target");
        await symlink(target, join(filesystem.source, "entry.ts"), "file");
        const unrelated = join(filesystem.root, "test", "src", "nested");
        await mkdir(unrelated);
        await writeFile(join(unrelated, "main.ts"), "retry unrelated target");
        const getText = openBuffer(join(unrelated, "main.ts"), "retry unrelated target");

        const result = await search(pattern, ["test", "src/entry.ts"], root);

        expect(result).toMatchObject({ status: "confirmed", partial: false });
        expect(result.observation?.["matches"]).toEqual([
          { path: "src/nested/main.ts", line: 1, text: "retry nested target" },
        ]);
        expect(workspace.searches.map(search => search.baseUri.fsPath)).toEqual([nested]);
        expect(getText).not.toHaveBeenCalled();
      },
    );

    it("does not reinterpret a missing agreed scope as a relative pattern", async () => {
      const unrelated = join(filesystem.root, "test", "missing");
      await mkdir(unrelated);
      await writeFile(join(unrelated, "main.ts"), "retry unrelated target");

      const result = await search("missing/**/*.ts", ["test", "missing"], root);

      expect(result).toMatchObject({ status: "confirmed", partial: false, observation: { matches: [] } });
      expect(workspace.searches).toEqual([]);
    });
  },
);

describe.each(["ordinary", "aliased"])(
  "Scope search — relative patterns across an %s workspace",
  rootKind => {
    it.each([
      { pattern: "*.ts", expectedPaths: ["src/main.ts", "test/main.ts"] },
      {
        pattern: "**/*.ts",
        expectedPaths: [
          "src/main.ts",
          "src/nested/worker.ts",
          "src/src-copy/worker.ts",
          "test/main.ts",
          "test/nested/worker.ts",
          "test/src-copy/worker.ts",
        ],
      },
      { pattern: "nested/*.ts", expectedPaths: ["src/nested/worker.ts", "test/nested/worker.ts"] },
      { pattern: "src-copy/*.ts", expectedPaths: ["src/src-copy/worker.ts", "test/src-copy/worker.ts"] },
    ])("preserves relative $pattern, deduplication, and order", async ({ pattern, expectedPaths }) => {
      for (const scope of ["src", "test"]) {
        for (const directory of ["nested", "src-copy"]) {
          const nested = join(filesystem.root, scope, directory);
          await mkdir(nested, { recursive: true });
          await writeFile(join(nested, "worker.ts"), "retry shared");
        }
      }
      await writeFile(join(filesystem.root, "test", "main.ts"), "retry shared");
      let root = filesystem.root;
      if (rootKind === "aliased") {
        root = join(filesystem.temporaryRoot, "workspace-link");
        await linkDirectory(filesystem.root, root);
      }

      const result = await search(pattern, ["test", "linked", "src", "test"], root);

      expect(result).toMatchObject({ status: "confirmed", partial: false });
      expect(result.observation?.["matches"]).toEqual(expectedPaths.map(path => ({
        path,
        line: 1,
        text: path === "src/main.ts" ? "retry on disk" : "retry shared",
      })));
    });
  },
);

describe.each(["ordinary", "aliased"])(
  "Scope search — relative file parents in an %s workspace",
  rootKind => {
    let root: string;

    beforeEach(async () => {
      root = filesystem.root;
      if (rootKind === "aliased") {
        root = join(filesystem.temporaryRoot, "workspace-link");
        await linkDirectory(filesystem.root, root);
      }
      await writeFile(join(filesystem.root, "root.ts"), "retry root");
    });

    it.each(["*.ts", "**/*.ts", "./*.ts", "./**/*.ts"])(
      "preserves the file and directory permission union for %s",
      async pattern => {
        const result = await search(pattern, ["root.ts", "src"], root);

        expect(result).toMatchObject({ status: "confirmed", partial: false });
        expect(result.observation?.["matches"]).toEqual([
          { path: "root.ts", line: 1, text: "retry root" },
          { path: "src/main.ts", line: 1, text: "retry on disk" },
        ]);
        expect(workspace.searches.map(search => search.baseUri.fsPath))
          .toEqual([filesystem.root, filesystem.source]);
      },
    );

    it.each([
      { allowed: "missing.ts", pattern: "./*.ts" },
      { allowed: "missing.ts", pattern: "./**/*.ts" },
      { allowed: "linked/missing.ts", pattern: "./*.ts" },
      { allowed: "linked/missing.ts", pattern: "./**/*.ts" },
    ])("keeps $pattern relative beside missing file $allowed", async ({ allowed, pattern }) => {
      const getText = openBuffer(join(filesystem.root, "root.ts"), "retry unagreed root");

      const result = await search(pattern, [allowed, "src"], root);

      expect(result).toMatchObject({ status: "confirmed", partial: false });
      expect(result.observation?.["matches"]).toEqual([
        { path: "src/main.ts", line: 1, text: "retry on disk" },
      ]);
      expect(workspace.searches.map(search => search.baseUri.fsPath)).toEqual([filesystem.source]);
      expect(getText).not.toHaveBeenCalled();
    });
  },
);

describe.each(["ordinary", "aliased"])(
  "Scope search — missing file qualifiers in an %s workspace",
  rootKind => {
    it.each([
      { allowed: "src/missing.ts", pattern: "src/**/*.ts", prefix: "src" },
      { allowed: "linked/missing.ts", pattern: "src/**/*.ts", prefix: "src" },
      { allowed: "linked/missing.ts", pattern: "linked/**/*.ts", prefix: "linked" },
    ])("does not reinterpret $pattern for missing $allowed", async ({ allowed, pattern, prefix }) => {
      const unrelated = join(filesystem.root, "test", prefix);
      await mkdir(unrelated, { recursive: true });
      const trap = join(unrelated, "trap.ts");
      await writeFile(trap, "retry wrong disk subtree");
      const getText = openBuffer(trap, "retry wrong dirty subtree");
      openBuffer(join(filesystem.source, "missing.ts"), "retry missing dirty buffer");
      let root = filesystem.root;
      if (rootKind === "aliased") {
        root = join(filesystem.temporaryRoot, "workspace-link");
        await linkDirectory(filesystem.root, root);
      }

      const result = await search(pattern, ["test", allowed], root);

      expect(["confirmed", "declined", "failed"]).toContain(result.status);
      expect(result.observation?.["matches"] ?? []).toEqual([]);
      expect(workspace.searches).toEqual([]);
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
