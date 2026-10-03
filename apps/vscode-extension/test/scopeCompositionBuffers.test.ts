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

const failIdentityFor = (path: string): void => {
  const originalIdentity = scopeIdentity.scopePathIdentity;
  vi.spyOn(scopeIdentity, "scopePathIdentity").mockImplementation((absolute, signal) => {
    if (absolute === path) {
      return Promise.reject(Object.assign(new Error("Identity unavailable."), { code: "EACCES" }));
    }
    return originalIdentity(absolute, signal);
  });
};

describe("Scope composition — stale non-directory buffers", () => {
  it("reads the valid dirty target after an unrelated non-directory buffer", async () => {
    const stale = await staleBuffer("inside");
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

  it.each([
    { location: "inside", reason: "read-failed" },
    { location: "outside", reason: "scope-access-failed" },
  ] as const)("does not skip an $location-root EACCES candidate during a read", async ({ location, reason }) => {
    const stale = await staleBuffer(location);
    const getText = openBuffer(join(filesystem.source, "main.ts"), "retry valid dirty text");
    failIdentityFor(stale.path);

    const result = await run("pair_read_scope");

    expect(result).toMatchObject({ status: "failed", observation: { reason } });
    expect(result.observation?.["text"]).toBeUndefined();
    expect(getText).not.toHaveBeenCalled();
    expect(stale.getText).not.toHaveBeenCalled();
  });

  it("does not skip an EACCES candidate during a search", async () => {
    const stale = await staleBuffer("inside");
    const getText = openBuffer(join(filesystem.source, "main.ts"), "retry valid dirty text");
    failIdentityFor(stale.path);

    const result = await run("pair_search_scope");

    expect(result).toMatchObject({
      status: "confirmed",
      observation: { matches: [] },
      partial: true,
    });
    expect(getText).not.toHaveBeenCalled();
    expect(stale.getText).not.toHaveBeenCalled();
  });

  it("does not skip cancellation with a non-directory identity", async () => {
    const stale = await staleBuffer("inside");
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

    const result = await run("pair_search_scope", controller.signal);

    expect(result).toMatchObject({
      status: "cancelled",
      observation: { reason: "scope-read-cancelled" },
      partial: true,
    });
    expect(result.observation?.["matches"]).toBeUndefined();
    expect(getText).not.toHaveBeenCalled();
    expect(stale.getText).not.toHaveBeenCalled();
  });
});
