import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { growthRuntime } from "@adaptive-pair/testkit";
import { ActivityLedger } from "../src/activityLedger.js";

const native = vi.hoisted(() => ({
  trusted: true, root: "", inputs: [] as (string | undefined)[], selection: "",
  input: vi.fn(), open: vi.fn(), warning: vi.fn(), cancelled: false,
}));

vi.mock("vscode", () => ({
  CancellationTokenSource: class {
    private readonly listeners = new Set<() => void>();
    public readonly token = {
      get isCancellationRequested() { return native.cancelled; },
      onCancellationRequested: (listener: () => void) => {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
      },
    };
    public cancel(): void {
      native.cancelled = true;
      for (const listener of this.listeners) { listener(); }
    }
    public dispose(): void { this.listeners.clear(); }
  },
  window: {
    showInputBox: native.input, showOpenDialog: native.open, showWarningMessage: native.warning,
  },
  workspace: {
    get isTrusted() { return native.trusted; },
    get workspaceFolders() {
      return [{ uri: { scheme: "file", fsPath: native.root, toString: () => `file://${native.root}` } }];
    },
  },
}));

const { VscodeGrowthSetupUi } = await import("../src/growthSetupUi.js");
let root: string;
let snapshot: PairRuntimeSnapshot;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pair-setup-ui-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src/retry.mjs"), "export const retry = false;\n");
  await writeFile(join(root, ".env"), "fixture-only\n");
  await symlink("../.env", join(root, "src/disguised.mjs"));
});

afterAll(async () => { await rm(root, { recursive: true, force: true }); });

beforeEach(() => {
  native.trusted = true;
  native.root = root;
  native.cancelled = false;
  native.selection = join(root, "src/retry.mjs");
  native.inputs = ["Fix retry bounds", "Vary the retry limit", "npm test"];
  native.input.mockReset().mockImplementation(() => Promise.resolve(native.inputs.shift()));
  native.open.mockReset().mockImplementation(() => Promise.resolve([
    { scheme: "file", fsPath: native.selection },
  ]));
  native.warning.mockReset().mockResolvedValue("Continue once");
  const initial = growthRuntime();
  snapshot = { ...initial, presence: { ...initial.presence, workspaceId: `file://${root}` } };
});

describe("native Growth setup UI", () => {
  it("collects bounded values and an explicitly chosen regular workspace file", async () => {
    const ui = new VscodeGrowthSetupUi(() => snapshot);
    expect(await ui.collect(new AbortController().signal)).toEqual({
      objective: "Fix retry bounds", independentCheck: "Vary the retry limit",
      allowedPath: "src/retry.mjs", verificationPlan: "npm run test",
    });
    expect(native.open).toHaveBeenCalledWith(expect.objectContaining({ canSelectMany: false, canSelectFolders: false }));
  });

  it.each(["off", "untrusted"])("performs no UI or workspace reads when %s", async unavailable => {
    const ledger = new ActivityLedger();
    if (unavailable === "off") {
      snapshot = { ...snapshot, presence: { ...snapshot.presence, status: "off" } };
    } else {
      native.trusted = false;
    }
    expect(await new VscodeGrowthSetupUi(() => snapshot, ledger).collect(new AbortController().signal)).toBeUndefined();
    expect(native.input).not.toHaveBeenCalled();
    expect(native.open).not.toHaveBeenCalled();
    expect(ledger.snapshot().workspaceReads).toBe(0);
  });

  it.each(["../outside.mjs", ".env", "src/disguised.mjs", "src"])("refuses ineligible selected path %s", async path => {
    native.selection = join(root, path);
    expect(await new VscodeGrowthSetupUi(() => snapshot).collect(new AbortController().signal)).toBeUndefined();
    expect(native.input).toHaveBeenCalledTimes(1);
  });

  it("stops after cancellation during the first input", async () => {
    const controller = new AbortController();
    native.input.mockImplementation(() => {
      controller.abort();
      return Promise.resolve("Fix retry bounds");
    });
    expect(await new VscodeGrowthSetupUi(() => snapshot).collect(controller.signal)).toBeUndefined();
    expect(native.cancelled).toBe(true);
    expect(native.open).not.toHaveBeenCalled();
  });

  it.each([0, 1, 2])("stops when input %s is dismissed", async cancelledInput => {
    native.inputs[cancelledInput] = undefined;
    expect(await new VscodeGrowthSetupUi(() => snapshot).collect(new AbortController().signal)).toBeUndefined();
    expect(native.input).toHaveBeenCalledTimes(cancelledInput + 1);
    expect(native.warning).not.toHaveBeenCalled();
  });

  it("stops when file selection is dismissed", async () => {
    native.open.mockResolvedValue(undefined);
    expect(await new VscodeGrowthSetupUi(() => snapshot).collect(new AbortController().signal)).toBeUndefined();
    expect(native.input).toHaveBeenCalledTimes(1);
  });

  it("stops after a revision changes during file selection", async () => {
    const ledger = new ActivityLedger();
    native.open.mockImplementation(() => {
      snapshot = { ...snapshot, revision: snapshot.revision + 1 };
      return Promise.resolve([{ scheme: "file", fsPath: native.selection }]);
    });
    expect(await new VscodeGrowthSetupUi(() => snapshot, ledger).collect(new AbortController().signal)).toBeUndefined();
    expect(ledger.snapshot().workspaceReads).toBe(0);
    expect(native.input).toHaveBeenCalledTimes(1);
  });

  it("requires the exact positive confirmation and respects cancellation", async () => {
    const ui = new VscodeGrowthSetupUi(() => snapshot);
    const controller = new AbortController();
    native.warning.mockResolvedValue(undefined);
    expect(await ui.confirm("learning", "A learning boundary", controller.signal)).toBe(false);
    native.warning.mockImplementation(() => { controller.abort(); return Promise.resolve("Continue once"); });
    expect(await ui.confirm("work-unit", "A scope", controller.signal)).toBe(false);
  });
});
