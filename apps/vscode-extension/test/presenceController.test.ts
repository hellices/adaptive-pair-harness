import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Scheduler } from "@adaptive-pair/evidence";
import type { JournalFileSystem } from "../src/storageAdapter.js";

interface FakeUri {
  readonly fsPath: string;
  readonly path: string;
  toString(): string;
}

interface FakeDisposable {
  dispose(): void;
}

interface DocumentChangeEvent {
  readonly document: {
    readonly isDirty: boolean;
    readonly uri: FakeUri;
    readonly version: number;
    readonly languageId: string;
  };
  readonly contentChanges: readonly {
    readonly range: {
      readonly start: { readonly line: number };
      readonly end: { readonly line: number };
    };
  }[];
}

type DocumentListener = (event: DocumentChangeEvent) => void;

const harness = vi.hoisted(() => {
  const createUri = (fsPath: string): FakeUri => ({
    fsPath,
    path: fsPath,
    toString: () => `file://${fsPath}`,
  });

  const state = {
    commandHandlers: new Map<string, (...args: unknown[]) => unknown>(),
    documentListeners: new Set<DocumentListener>(),
    contextKeys: new Map<string, unknown>(),
    warnings: [] as string[],
    warningResponses: [] as string[],
    infoMessages: [] as string[],
    statusText: "",
    workspaceTrusted: true,
    workspaceFolders: [{ uri: createUri("/workspace") }],
    textDocuments: [] as unknown[],
  };

  const reset = (): void => {
    state.commandHandlers.clear();
    state.documentListeners.clear();
    state.contextKeys.clear();
    state.warnings.length = 0;
    state.warningResponses.length = 0;
    state.infoMessages.length = 0;
    state.statusText = "";
    state.workspaceTrusted = true;
    state.workspaceFolders = [{ uri: createUri("/workspace") }];
    state.textDocuments = [];
  };

  const emitChange = (
    fsPath: string,
    options: {
      readonly isDirty?: boolean;
      readonly version?: number;
      readonly languageId?: string;
      readonly startLine?: number;
      readonly endLine?: number;
      readonly contentChanges?: boolean;
    } = {},
  ): void => {
    const event: DocumentChangeEvent = {
      document: {
        isDirty: options.isDirty ?? true,
        uri: createUri(fsPath),
        version: options.version ?? 2,
        languageId: options.languageId ?? "typescript",
      },
      contentChanges:
        options.contentChanges === false
          ? []
          : [
              {
                range: {
                  start: { line: options.startLine ?? 0 },
                  end: { line: options.endLine ?? 0 },
                },
              },
            ],
    };
    for (const listener of state.documentListeners) {
      listener(event);
    }
  };

  return { createUri, state, reset, emitChange };
});

vi.mock("vscode", () => {
  const createDisposable = (dispose: () => void): FakeDisposable => ({ dispose });

  return {
    StatusBarAlignment: { Left: 1, Right: 2 },
    commands: {
      registerCommand: (
        name: string,
        handler: (...args: unknown[]) => unknown,
      ): FakeDisposable => {
        harness.state.commandHandlers.set(name, handler);
        return createDisposable(() => harness.state.commandHandlers.delete(name));
      },
      executeCommand: async (name: string, ...args: unknown[]): Promise<unknown> => {
        if (name === "setContext") {
          harness.state.contextKeys.set(String(args[0]), args[1]);
          return undefined;
        }
        const handler = harness.state.commandHandlers.get(name);
        if (handler === undefined) {
          throw new Error(`Unknown command: ${name}`);
        }
        return await handler(...args);
      },
    },
    window: {
      createStatusBarItem: () => ({
        text: "",
        tooltip: undefined,
        command: undefined,
        show: () => undefined,
        hide: () => undefined,
        dispose: () => undefined,
      }),
      showWarningMessage: (message: string): Promise<string | undefined> => {
        harness.state.warnings.push(message);
        return Promise.resolve(harness.state.warningResponses.shift());
      },
      showInformationMessage: (message: string): Promise<string | undefined> => {
        harness.state.infoMessages.push(message);
        return Promise.resolve(undefined);
      },
    },
    workspace: {
      get isTrusted() {
        return harness.state.workspaceTrusted;
      },
      get workspaceFolders() {
        return harness.state.workspaceFolders;
      },
      get textDocuments() {
        return harness.state.textDocuments;
      },
      asRelativePath: (value: FakeUri | string): string => {
        const text = typeof value === "string" ? value : value.fsPath;
        return text.replace(/^\/workspace\//u, "");
      },
      getWorkspaceFolder: (uri: FakeUri): unknown => {
        return uri.fsPath.startsWith("/workspace")
          ? harness.state.workspaceFolders[0]
          : undefined;
      },
      onDidChangeTextDocument: (listener: DocumentListener): FakeDisposable => {
        harness.state.documentListeners.add(listener);
        return createDisposable(() => harness.state.documentListeners.delete(listener));
      },
      getConfiguration: () => ({
        update: (): Promise<void> => Promise.resolve(),
        inspect: () => undefined,
      }),
    },
    languages: {
      getDiagnostics: (): readonly unknown[] => [],
    },
    extensions: {
      getExtension: (): undefined => undefined,
    },
  };
});

const vscode = await import("vscode");
const { PresenceController } = await import("../src/presenceController.js");
const { SessionController } = await import("../src/sessionController.js");
const { StatusView } = await import("../src/statusView.js");
const { PairToolContext } = await import("../src/tools/pairToolContext.js");
const { NodeJournalFileSystem } = await import("../src/storageAdapter.js");

class FakeScheduler implements Scheduler {
  private nextHandleId = 1;
  private now = 0;
  private readonly tasks = new Map<
    number,
    { readonly runAt: number; readonly callback: () => void }
  >();

  public schedule(delayMs: number, callback: () => void): number {
    const handle = this.nextHandleId++;
    this.tasks.set(handle, { runAt: this.now + delayMs, callback });
    return handle;
  }

  public cancel(handle: unknown): void {
    if (typeof handle === "number") {
      this.tasks.delete(handle);
    }
  }

  public pendingCount(): number {
    return this.tasks.size;
  }

  public advanceBy(milliseconds: number): void {
    this.now += milliseconds;
    let due = [...this.tasks.entries()].find(([, task]) => task.runAt <= this.now);
    while (due !== undefined) {
      const [handle, task] = due;
      this.tasks.delete(handle);
      task.callback();
      due = [...this.tasks.entries()].find(([, task]) => task.runAt <= this.now);
    }
  }
}

class MemoryFs implements JournalFileSystem {
  public writes = 0;
  public readonly files = new Map<string, string>();
  public writeError: Error | undefined;

  public ensureDir(): Promise<void> {
    return Promise.resolve();
  }

  public readFile(path: string): Promise<string | undefined> {
    return Promise.resolve(this.files.get(path));
  }

  public writeFile(path: string, data: string): Promise<void> {
    if (this.writeError !== undefined) {
      return Promise.reject(this.writeError);
    }
    this.writes += 1;
    this.files.set(path, data);
    return Promise.resolve();
  }

  public fsync(): Promise<void> {
    return Promise.resolve();
  }

  public rename(from: string, to: string): Promise<void> {
    const data = this.files.get(from);
    if (data !== undefined) {
      this.files.set(to, data);
      this.files.delete(from);
    }
    return Promise.resolve();
  }

  public removes = 0;

  public remove(path: string): Promise<void> {
    this.removes += 1;
    this.files.delete(path);
    return Promise.resolve();
  }
}

class DelayedReadMemoryFs extends MemoryFs {
  private nextRead:
    | {
        readonly started: () => void;
        readonly released: Promise<void>;
      }
    | undefined;

  public delayNextRead(): {
    readonly started: Promise<void>;
    readonly release: () => void;
  } {
    let markStarted: () => void = () => undefined;
    let release: () => void = () => undefined;
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    const released = new Promise<void>(resolve => {
      release = resolve;
    });
    this.nextRead = { started: markStarted, released };
    return { started, release };
  }

  public override async readFile(path: string): Promise<string | undefined> {
    const delayed = this.nextRead;
    if (delayed !== undefined) {
      this.nextRead = undefined;
      delayed.started();
      await delayed.released;
    }
    return await super.readFile(path);
  }
}

interface FakeContext {
  readonly subscriptions: FakeDisposable[];
  readonly globalStorageUri: { readonly fsPath: string };
}

const createContext = (): FakeContext => ({
  subscriptions: [],
  globalStorageUri: { fsPath: "/journal-storage" },
});

const buildController = (
  scheduler: Scheduler,
  fs: JournalFileSystem,
): {
  readonly controller: InstanceType<typeof PresenceController>;
  readonly context: FakeContext;
} => {
  const controller = new PresenceController(
    new SessionController(),
    new StatusView(),
    new PairToolContext(),
    { scheduler, journalFileSystem: fs },
  );
  const context = createContext();
  controller.register(context as unknown as Parameters<typeof controller.register>[0]);
  return { controller, context };
};

const run = async (name: string): Promise<unknown> =>
  await vscode.commands.executeCommand(name);

const flush = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
};

afterEach(() => {
  harness.reset();
});

describe("PresenceController — command test harness", () => {
  it("rejects an unregistered command instead of silently succeeding", async () => {
    await expect(run("adaptivePair.missing")).rejects.toThrow(
      "Unknown command: adaptivePair.missing",
    );
  });
});

describe("PresenceController — pending edit timers", () => {
  it("observes an undo that returns a document to its saved state", async () => {
    const scheduler = new FakeScheduler();
    const fs = new MemoryFs();
    const { controller } = buildController(scheduler, fs);

    await run("adaptivePair.enablePresence");
    harness.emitChange("/workspace/src/pair.ts", { isDirty: false });
    scheduler.advanceBy(1_000);
    await flush();

    expect(controller.getState().observationCount).toBe(1);
    expect(fs.writes).toBeGreaterThan(0);
  });

  it("ignores document-change events without text changes", async () => {
    const scheduler = new FakeScheduler();
    const fs = new MemoryFs();
    const { controller } = buildController(scheduler, fs);

    await run("adaptivePair.enablePresence");
    harness.emitChange("/workspace/src/pair.ts", { contentChanges: false });
    scheduler.advanceBy(1_000);
    await flush();

    expect(controller.getState().observationCount).toBe(0);
    expect(fs.writes).toBe(0);
  });

  it("cancels a pending edit episode when presence pauses", async () => {
    const scheduler = new FakeScheduler();
    const fs = new MemoryFs();
    const { controller } = buildController(scheduler, fs);

    await run("adaptivePair.enablePresence");
    harness.emitChange("/workspace/src/pair.ts");
    expect(scheduler.pendingCount()).toBe(1);

    await run("adaptivePair.pausePresence");
    expect(scheduler.pendingCount()).toBe(0);

    scheduler.advanceBy(1_000);
    await flush();

    expect(fs.writes).toBe(0);
    expect(controller.getState().presenceStatus).toBe("paused");
  });

  it("cancels a pending edit episode when presence is disabled", async () => {
    const scheduler = new FakeScheduler();
    const fs = new MemoryFs();
    const { controller } = buildController(scheduler, fs);

    await run("adaptivePair.enablePresence");
    harness.emitChange("/workspace/src/pair.ts");
    expect(scheduler.pendingCount()).toBe(1);

    harness.state.warningResponses.push("Disable and clear");
    await run("adaptivePair.disablePresence");
    expect(scheduler.pendingCount()).toBe(0);

    scheduler.advanceBy(1_000);
    await flush();

    expect(fs.writes).toBe(0);
    expect(controller.getState().presenceStatus).toBe("off");
  });
});

describe("PresenceController — out-of-workspace changes", () => {
  it("ignores document changes outside the active workspace", async () => {
    const scheduler = new FakeScheduler();
    const fs = new MemoryFs();
    const { controller } = buildController(scheduler, fs);

    await run("adaptivePair.enablePresence");
    harness.emitChange("/elsewhere/secret.ts");

    expect(scheduler.pendingCount()).toBe(0);
    expect(controller.getState().observationCount).toBe(0);

    scheduler.advanceBy(1_000);
    await flush();

    expect(fs.writes).toBe(0);
    expect(controller.getState().presenceStatus).toBe("observing");
    expect(harness.state.warnings).toEqual([]);
  });
});

describe("PresenceController — journal reconciliation across restart", () => {
  it("reconciles persisted edit episodes into the observation window on a fresh activation", async () => {
    const scheduler = new FakeScheduler();
    const fs = new MemoryFs();

    // First activation: enable Presence, observe one local edit, and let the
    // aggregator flush it to the persisted journal.
    const first = buildController(scheduler, fs);
    await run("adaptivePair.enablePresence");
    harness.emitChange("/workspace/src/pair.ts");
    scheduler.advanceBy(1_000);
    await flush();
    expect(fs.writes).toBeGreaterThan(0);
    expect(first.controller.getState().observationCount).toBe(1);
    first.controller.dispose();

    // Restart: a brand-new activation pointed at the SAME persisted journal must
    // reconcile the durable episode back into its observation window.
    harness.reset();
    const second = buildController(new FakeScheduler(), fs);
    await flush();

    expect(second.controller.getState().observationCount).toBe(1);
  });
});

describe("PresenceController — continuity clearing on disable", () => {
  it("removes the persisted journal so disable clears Pair continuity", async () => {
    const scheduler = new FakeScheduler();
    const fs = new MemoryFs();
    const { controller } = buildController(scheduler, fs);

    await run("adaptivePair.enablePresence");
    harness.emitChange("/workspace/src/pair.ts");
    scheduler.advanceBy(1_000);
    await flush();
    expect(fs.files.has("/journal-storage/journal.jsonl")).toBe(true);

    harness.state.warningResponses.push("Disable and clear");
    await run("adaptivePair.disablePresence");
    await flush();

    expect(fs.removes).toBeGreaterThan(0);
    expect(fs.files.has("/journal-storage/journal.jsonl")).toBe(false);
    expect(controller.getState().presenceStatus).toBe("off");

    // A subsequent restart finds no continuity to reconcile.
    harness.reset();
    const restarted = buildController(new FakeScheduler(), fs);
    await flush();
    expect(restarted.controller.getState().observationCount).toBe(0);
  });

  it("does not restore delayed journal replay after disable clears continuity", async () => {
    const scheduler = new FakeScheduler();
    const fs = new DelayedReadMemoryFs();
    const first = buildController(scheduler, fs);

    await run("adaptivePair.enablePresence");
    harness.emitChange("/workspace/src/pair.ts");
    scheduler.advanceBy(1_000);
    await flush();
    first.controller.dispose();

    harness.reset();
    const delayedRead = fs.delayNextRead();
    const second = buildController(new FakeScheduler(), fs);
    await delayedRead.started;

    const disable = second.controller.performDisable();
    delayedRead.release();
    await disable;

    expect(second.controller.getState().observationCount).toBe(0);
  });
});

describe("PresenceController — untrusted workspace gate", () => {
  it("refuses to enable, observe, or join until the workspace is trusted", async () => {
    const scheduler = new FakeScheduler();
    const fs = new MemoryFs();
    const { controller } = buildController(scheduler, fs);
    harness.state.workspaceTrusted = false;

    await run("adaptivePair.enablePresence");
    await flush();

    expect(controller.getState().presenceStatus).toBe("off");
    expect(controller.getState().documentListenerActive).toBe(false);
    expect(controller.getState().contextKeys["adaptivePair.presenceEnabled"]).toBe(false);
    expect(harness.state.warnings.join("\n")).toContain("trusted workspace");

    // An edit in an untrusted workspace is never observed.
    harness.emitChange("/workspace/src/pair.ts");
    scheduler.advanceBy(1_000);
    await flush();
    expect(controller.getState().observationCount).toBe(0);
    expect(fs.writes).toBe(0);

    await run("adaptivePair.joinInProgress");
    await flush();
    expect(controller.getState().sessionStatus).toBe("inactive");

    // Once the developer trusts the workspace, the same command succeeds.
    harness.state.workspaceTrusted = true;
    await run("adaptivePair.enablePresence");
    await flush();
    expect(controller.getState().presenceStatus).toBe("observing");
  });
});

describe("PresenceController — journal I/O failures", () => {
  it("fails closed with a sanitized warning when a journal write throws", async () => {
    const scheduler = new FakeScheduler();
    const fs = new MemoryFs();
    fs.writeError = Object.assign(new Error("EIO /Users/alice/secret disk failure"), {
      code: "EIO",
    });
    const { controller } = buildController(scheduler, fs);

    await run("adaptivePair.enablePresence");
    harness.emitChange("/workspace/src/pair.ts");
    scheduler.advanceBy(1_000);
    await flush();

    expect(controller.getState().presenceStatus).toBe("paused");
    expect(harness.state.warnings).toHaveLength(1);
    expect(harness.state.warnings[0]).not.toContain("/Users/alice/secret");
    expect(harness.state.warnings[0]).not.toContain("disk failure");
  });
});

describe("NodeJournalFileSystem.readFile", () => {
  let directory: string;

  afterEach(async () => {
    if (directory !== undefined) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns undefined for a missing file but rethrows other errors", async () => {
    directory = await mkdtemp(join(process.cwd(), "journal-io-test-"));
    const fs = new NodeJournalFileSystem();

    await expect(fs.readFile(join(directory, "missing.jsonl"))).resolves.toBeUndefined();

    const nested = join(directory, "as-directory");
    await mkdir(nested);
    await expect(fs.readFile(nested)).rejects.toThrow();
  });
});
