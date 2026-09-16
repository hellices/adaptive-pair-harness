import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  filesystem,
  openBuffer,
  scopeRequest,
} from "./scopeCompositionFixtures.js";

const scopeIdentity = await import("../src/scopePathIdentity.js");
const { VscodeScopeAccess } = await import("../src/scopeAccess.js");
const { BoundedScopeEffectRunner } = await import("../src/scopeEffect.js");

const run = (
  toolName: "pair_read_scope" | "pair_search_scope",
  signal = new AbortController().signal,
) => new BoundedScopeEffectRunner(new VscodeScopeAccess(filesystem.root))
  .run(scopeRequest(toolName, ["src"], { path: "src/main.ts", query: "retry" }), signal);

const staleBuffer = async (location: "inside" | "outside") => {
  const ancestor = join(location === "inside" ? filesystem.source : filesystem.outside, "stale");
  const path = join(ancestor, "old.ts");
  await mkdir(ancestor);
  await writeFile(path, "stale disk text");
  const getText = openBuffer(path, "retry stale dirty text");
  await rm(ancestor, { recursive: true });
  await writeFile(ancestor, "replacement regular file");
  return { path, getText };
};

describe.each(["inside", "outside"] as const)("Scope composition — %s-root stale buffers", location => {
  it("reads the valid dirty target after an unrelated non-directory buffer", async () => {
    const stale = await staleBuffer(location);
    const getText = openBuffer(join(filesystem.source, "main.ts"), "retry valid dirty text");

    const result = await run("pair_read_scope");

    expect(result).toMatchObject({
      status: "confirmed",
      observation: { path: "src/main.ts", text: "retry valid dirty text" },
      partial: false,
    });
    expect(getText).toHaveBeenCalledTimes(1);
    expect(stale.getText).not.toHaveBeenCalled();
  });

  it("searches the valid dirty target after an unrelated non-directory buffer", async () => {
    const stale = await staleBuffer(location);
    const getText = openBuffer(join(filesystem.source, "main.ts"), "retry valid dirty text");

    const result = await run("pair_search_scope");

    expect(result).toMatchObject({ status: "confirmed", partial: false });
    expect(result.observation?.["matches"]).toEqual([
      { path: "src/main.ts", line: 1, text: "retry valid dirty text" },
    ]);
    expect(getText).toHaveBeenCalledTimes(1);
    expect(stale.getText).not.toHaveBeenCalled();
  });

  it.each(["pair_read_scope", "pair_search_scope"] as const)(
    "does not skip an EACCES candidate during %s",
    async toolName => {
      const stale = await staleBuffer(location);
      const getText = openBuffer(join(filesystem.source, "main.ts"), "retry valid dirty text");
      const originalIdentity = scopeIdentity.scopePathIdentity;
      vi.spyOn(scopeIdentity, "scopePathIdentity").mockImplementation((absolute, signal) => {
        if (absolute === stale.path) {
          return Promise.reject(Object.assign(new Error("Identity unavailable."), { code: "EACCES" }));
        }
        return originalIdentity(absolute, signal);
      });

      const result = await run(toolName);

      if (location === "inside" && toolName === "pair_search_scope") {
        expect(result).toMatchObject({
          status: "confirmed",
          observation: { matches: [] },
          partial: true,
        });
      } else {
        expect(result).toMatchObject({
          status: "failed",
          observation: { reason: location === "inside" ? "read-failed" : "scope-access-failed" },
        });
      }
      expect(result.observation?.["text"]).toBeUndefined();
      expect(getText).not.toHaveBeenCalled();
      expect(stale.getText).not.toHaveBeenCalled();
    },
  );

  it.each(["pair_read_scope", "pair_search_scope"] as const)(
    "does not skip cancellation with a non-directory identity during %s",
    async toolName => {
      const stale = await staleBuffer(location);
      const getText = openBuffer(join(filesystem.source, "main.ts"), "retry valid dirty text");
      const controller = new AbortController();
      const originalIdentity = scopeIdentity.scopePathIdentity;
      vi.spyOn(scopeIdentity, "scopePathIdentity").mockImplementation(async (absolute, signal) => {
        try {
          return await originalIdentity(absolute, signal);
        } finally {
          if (absolute === stale.path) {
            controller.abort();
          }
        }
      });

      const result = await run(toolName, controller.signal);

      expect(result).toMatchObject({
        status: "cancelled",
        observation: { reason: "scope-read-cancelled" },
        partial: true,
      });
      expect(result.observation?.["text"]).toBeUndefined();
      expect(result.observation?.["matches"]).toBeUndefined();
      expect(getText).not.toHaveBeenCalled();
      expect(stale.getText).not.toHaveBeenCalled();
    },
  );
});
