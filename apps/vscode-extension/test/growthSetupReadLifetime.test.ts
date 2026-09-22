import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { InMemoryJournal, PairCoordinator } from "@adaptive-pair/runtime";
import { FakeClock, FakeIdSource, growthRuntime } from "@adaptive-pair/testkit";

const native = vi.hoisted(() => ({
  root: "", inputs: ["Fix retry", "Vary retry", "npm test"],
  reads: [] as { readonly path: string; readonly inactive: boolean }[],
  inactive: (): boolean => false,
  afterRead: (path: string): Promise<void> => { void path; return Promise.resolve(); },
}));

vi.mock("node:fs/promises", async importOriginal => {
  const filesystem = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...filesystem,
    realpath: async (path: string) => {
      native.reads.push({ path, inactive: native.inactive() });
      const resolved = await filesystem.realpath(path);
      await native.afterRead(path);
      return resolved;
    },
    stat: (path: string) => {
      native.reads.push({ path, inactive: native.inactive() });
      return filesystem.stat(path);
    },
  };
});

vi.mock("vscode", () => ({
  CancellationTokenSource: class {
    public token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }) };
    public cancel(): void { this.token.isCancellationRequested = true; }
    public dispose(): void {}
  },
  window: {
    showInputBox: () => Promise.resolve(native.inputs.shift()),
    showOpenDialog: () => Promise.resolve([{ scheme: "file", fsPath: join(native.root, "src/retry.mjs") }]),
  },
  workspace: {
    isTrusted: true,
    get workspaceFolders() {
      return [{ uri: { scheme: "file", fsPath: native.root, toString: () => `file://${native.root}` } }];
    },
  },
}));

const { VscodeGrowthSetupUi } = await import("../src/growthSetupUi.js");

beforeAll(async () => {
  native.root = await mkdtemp(join(tmpdir(), "pair-setup-reads-"));
  await mkdir(join(native.root, "src"));
  await writeFile(join(native.root, "src/retry.mjs"), "export const retry = false;\n");
});
afterAll(async () => { await rm(native.root, { recursive: true, force: true }); });

describe("Growth file selection lifetime", () => {
  it("starts no later filesystem read after Presence is disabled during root realpath", async () => {
    const initial = growthRuntime();
    const store = new InMemoryJournal("workspace-1", {
      ...initial, presence: { ...initial.presence, workspaceId: `file://${native.root}` },
    });
    const coordinator = new PairCoordinator({
      store, ids: new FakeIdSource(), clock: new FakeClock(), streamId: "workspace-1",
      effects: { execute: () => Promise.reject(new Error("Unexpected effect")) },
    });
    native.inactive = () => store.snapshotNow().presence.status === "off";
    native.afterRead = async path => {
      if (path === native.root) { await coordinator.setPresence("off"); }
    };
    const collected = await new VscodeGrowthSetupUi(() => store.snapshotNow()).collect(new AbortController().signal);
    expect(collected).toBeUndefined();
    expect(native.reads).toHaveLength(1);
    expect(native.reads.filter(read => read.inactive)).toHaveLength(0);
  });
});
