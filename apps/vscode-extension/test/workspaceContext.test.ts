import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  WorkspaceContext,
  WorkspaceContextChangedError,
  MAX_CONTEXT_FILE_BYTES,
  type DiagnosticInfo,
  type GitMetadata,
  type OpenDocumentInfo,
  type PathInspection,
  type WorkspaceContextAccess,
  type WorkspaceFolderIdentity,
} from "../src/workspaceContext.js";
import {
  LocalJournal,
  JournalIntegrityError,
  type JournalEvent,
  type JournalFileSystem,
} from "../src/storageAdapter.js";

interface FakeAccessConfig {
  folder?: WorkspaceFolderIdentity | undefined;
  git?: Partial<GitMetadata>;
  open?: readonly OpenDocumentInfo[];
  diagnostics?: readonly DiagnosticInfo[];
  validation?: readonly string[];
  stats?: Readonly<Record<string, Partial<PathInspection>>>;
}

const file = (
  overrides: Partial<PathInspection> = {},
): PathInspection => ({
  exists: true,
  isFile: true,
  isSymbolicLink: false,
  withinRoot: true,
  byteLength: 1_024,
  ...overrides,
});

class FakeWorkspaceAccess implements WorkspaceContextAccess {
  public readonly inspected: string[] = [];
  public modelRequests = 0;
  public current = true;
  private readonly config: FakeAccessConfig;

  public constructor(config: FakeAccessConfig) {
    this.config = config;
  }

  public workspaceFolder(): WorkspaceFolderIdentity | undefined {
    return this.config.folder;
  }

  public isCurrent(folder: WorkspaceFolderIdentity, branch: string | undefined): boolean {
    void folder;
    void branch;
    return this.current;
  }

  public readGitMetadata(): Promise<GitMetadata> {
    return Promise.resolve({
      branch: this.config.git?.branch,
      dirtyPaths: this.config.git?.dirtyPaths ?? [],
      stagedPaths: this.config.git?.stagedPaths ?? [],
      untrackedPaths: this.config.git?.untrackedPaths ?? [],
    });
  }

  public openDocuments(): readonly OpenDocumentInfo[] {
    return this.config.open ?? [];
  }

  public diagnostics(): readonly DiagnosticInfo[] {
    return this.config.diagnostics ?? [];
  }

  public validationResults(): readonly string[] {
    return this.config.validation ?? [];
  }

  public inspectPath(relativePath: string): Promise<PathInspection> {
    this.inspected.push(relativePath);
    const override = this.config.stats?.[relativePath];
    return Promise.resolve(file(override));
  }

  public now(): number {
    return 1_700_000_000_000;
  }
}

const folder: WorkspaceFolderIdentity = {
  workspaceId: "file:///workspace",
  rootPath: "/workspace",
};

describe("WorkspaceContext.capture — join in progress", () => {
  it("captures a bounded snapshot without a model request or a confirmed goal", async () => {
    const access = new FakeWorkspaceAccess({
      folder,
      git: {
        branch: "feature/retry",
        dirtyPaths: ["src/pair.ts"],
        untrackedPaths: ["notes/scratch.md"],
      },
      open: [
        { relativePath: "src/pair.ts", version: 7, isDirty: true, byteLength: 2_048 },
      ],
      diagnostics: [
        { relativePath: "src/pair.ts", line: 12, message: "unused variable" },
        { relativePath: "src/pair.ts", line: 40, message: "missing return" },
      ],
    });

    const snapshot = await new WorkspaceContext(access).capture();

    expect(snapshot.branch).toBe("feature/retry");
    expect(snapshot.dirtyPaths).toContain("src/pair.ts");
    expect(snapshot.protectedPaths).toEqual(
      expect.arrayContaining(["src/pair.ts", "notes/scratch.md"]),
    );
    expect(snapshot.openPaths).toContain("src/pair.ts");
    expect(snapshot.diagnostics).toHaveLength(2);
    expect("goal" in snapshot).toBe(false);
    expect(access.modelRequests).toBe(0);
  });

  it("prefers the open buffer version and never inspects it on disk", async () => {
    const access = new FakeWorkspaceAccess({
      folder,
      git: {
        branch: "feature/retry",
        dirtyPaths: ["src/pair.ts"],
        untrackedPaths: ["notes/scratch.md"],
      },
      open: [
        { relativePath: "src/pair.ts", version: 7, isDirty: true, byteLength: 2_048 },
      ],
    });

    await new WorkspaceContext(access).capture();

    expect(access.inspected).toContain("notes/scratch.md");
    expect(access.inspected).not.toContain("src/pair.ts");
  });

  it("bounds diagnostics to 50 one-line summaries", async () => {
    const diagnostics: DiagnosticInfo[] = Array.from({ length: 60 }, (_value, index) => ({
      relativePath: `src/file-${index}.ts`,
      line: index,
      message: `problem\nnumber ${index}`,
    }));
    const access = new FakeWorkspaceAccess({ folder, diagnostics });

    const snapshot = await new WorkspaceContext(access).capture();

    expect(snapshot.diagnostics).toHaveLength(50);
    expect(snapshot.diagnostics.every(entry => !entry.includes("\n"))).toBe(true);
  });
});

describe("WorkspaceContext.capture — entry paths", () => {
  it("returns an empty snapshot for a greenfield workspace with no folder", async () => {
    const access = new FakeWorkspaceAccess({ folder: undefined });

    const snapshot = await new WorkspaceContext(access).capture();

    expect(snapshot.dirtyPaths).toEqual([]);
    expect(snapshot.openPaths).toEqual([]);
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.protectedPaths).toEqual([]);
    expect(snapshot.branch).toBeUndefined();
  });

  it("returns a clean snapshot for an existing repository with no local work", async () => {
    const access = new FakeWorkspaceAccess({
      folder,
      git: { branch: "main" },
    });

    const snapshot = await new WorkspaceContext(access).capture();

    expect(snapshot.branch).toBe("main");
    expect(snapshot.dirtyPaths).toEqual([]);
    expect(snapshot.protectedPaths).toEqual([]);
  });

  it("protects staged and untracked work in a dirty repository", async () => {
    const access = new FakeWorkspaceAccess({
      folder,
      git: {
        branch: "main",
        dirtyPaths: ["src/a.ts"],
        stagedPaths: ["src/b.ts"],
        untrackedPaths: ["src/c.ts"],
      },
    });

    const snapshot = await new WorkspaceContext(access).capture();

    expect(snapshot.protectedPaths).toEqual(
      expect.arrayContaining(["src/a.ts", "src/b.ts", "src/c.ts"]),
    );
  });

  it("fails closed when the branch changes during capture", async () => {
    const access = new FakeWorkspaceAccess({
      folder,
      git: { branch: "feature/retry", dirtyPaths: ["src/a.ts"] },
    });
    access.current = false;

    await expect(new WorkspaceContext(access).capture()).rejects.toBeInstanceOf(
      WorkspaceContextChangedError,
    );
  });

  it("fails closed when the workspace folder is removed during capture", async () => {
    const access = new FakeWorkspaceAccess({
      folder,
      git: { untrackedPaths: ["src/c.ts"] },
    });
    access.current = false;

    await expect(new WorkspaceContext(access).capture()).rejects.toBeInstanceOf(
      WorkspaceContextChangedError,
    );
  });
});

describe("WorkspaceContext.capture — rejection rules", () => {
  it("rejects symlinks escaping the root, binaries, secret directories, and oversized files", async () => {
    const access = new FakeWorkspaceAccess({
      folder,
      git: {
        untrackedPaths: [
          "linked.ts",
          "logo.png",
          ".ssh/id_rsa",
          "huge.ts",
          "kept.ts",
        ],
      },
      stats: {
        "linked.ts": { isSymbolicLink: true, withinRoot: false },
        "huge.ts": { byteLength: MAX_CONTEXT_FILE_BYTES + 1 },
      },
    });

    const snapshot = await new WorkspaceContext(access).capture();

    expect(snapshot.protectedPaths).toEqual(["kept.ts"]);
    expect(access.inspected).not.toContain("logo.png");
    expect(access.inspected).not.toContain(".ssh/id_rsa");
  });
});

class MemoryJournalFileSystem implements JournalFileSystem {
  public readonly operations: string[] = [];
  public readonly files = new Map<string, string>();

  public ensureDir(dir: string): Promise<void> {
    this.operations.push(`ensureDir:${dir}`);
    return Promise.resolve();
  }

  public readFile(path: string): Promise<string | undefined> {
    return Promise.resolve(this.files.get(path));
  }

  public writeFile(path: string, data: string): Promise<void> {
    this.operations.push(`writeFile:${path}`);
    this.files.set(path, data);
    return Promise.resolve();
  }

  public fsync(path: string): Promise<void> {
    this.operations.push(`fsync:${path}`);
    return Promise.resolve();
  }

  public rename(from: string, to: string): Promise<void> {
    this.operations.push(`rename:${from}->${to}`);
    const data = this.files.get(from);
    if (data !== undefined) {
      this.files.set(to, data);
      this.files.delete(from);
    }
    return Promise.resolve();
  }

  public remove(path: string): Promise<void> {
    this.operations.push(`remove:${path}`);
    this.files.delete(path);
    return Promise.resolve();
  }
}

const event = (type: string, payload: Record<string, unknown>): JournalEvent => ({
  type,
  capturedAt: 1_700_000_000_000,
  payload,
});

class DeferredJournalFileSystem implements JournalFileSystem {
  public readonly files = new Map<string, string>();

  private async tick(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  public async ensureDir(dir: string): Promise<void> {
    void dir;
    await this.tick();
  }

  public async readFile(path: string): Promise<string | undefined> {
    await this.tick();
    return this.files.get(path);
  }

  public async writeFile(path: string, data: string): Promise<void> {
    await this.tick();
    this.files.set(path, data);
  }

  public async fsync(path: string): Promise<void> {
    void path;
    await this.tick();
  }

  public async rename(from: string, to: string): Promise<void> {
    await this.tick();
    const data = this.files.get(from);
    if (data !== undefined) {
      this.files.set(to, data);
      this.files.delete(from);
    }
  }

  public async remove(path: string): Promise<void> {
    await this.tick();
    this.files.delete(path);
  }
}

describe("LocalJournal", () => {
  let fs: MemoryJournalFileSystem;

  beforeEach(() => {
    fs = new MemoryJournalFileSystem();
  });

  it("writes atomically to a temp sibling, fsyncs, then renames", async () => {
    const journal = new LocalJournal(fs, "/storage");

    await journal.append(event("entry-captured", { branch: "main" }));

    const writeIndex = fs.operations.findIndex(op => op.startsWith("writeFile:"));
    const fsyncIndex = fs.operations.findIndex(op => op.startsWith("fsync:"));
    const renameIndex = fs.operations.findIndex(op => op.startsWith("rename:"));
    expect(writeIndex).toBeGreaterThanOrEqual(0);
    expect(fsyncIndex).toBeGreaterThan(writeIndex);
    expect(renameIndex).toBeGreaterThan(fsyncIndex);
    expect(fs.operations[writeIndex]).toContain(".tmp");
  });

  it("replays events across a restart in sequence order", async () => {
    const journal = new LocalJournal(fs, "/storage");
    await journal.append(event("entry-captured", { branch: "main" }));
    await journal.append(event("edit-episode", { uri: "src/a.ts" }));

    const restarted = new LocalJournal(fs, "/storage");
    const replayed = await restarted.replay();

    expect(replayed.map(entry => entry.type)).toEqual([
      "entry-captured",
      "edit-episode",
    ]);
  });

  it("fails closed when the recorded sequence is not contiguous", async () => {
    const journal = new LocalJournal(fs, "/storage");
    await journal.append(event("entry-captured", { branch: "main" }));

    const path = "/storage/journal.jsonl";
    const line = (fs.files.get(path) ?? "").trim();
    const record = JSON.parse(line) as { seq: number };
    const tampered = { ...record, seq: record.seq + 5 };
    fs.files.set(path, `${JSON.stringify(tampered)}\n`);

    await expect(new LocalJournal(fs, "/storage").replay()).rejects.toBeInstanceOf(
      JournalIntegrityError,
    );
  });

  it("fails closed when the event-chain hash is tampered", async () => {
    const journal = new LocalJournal(fs, "/storage");
    await journal.append(event("entry-captured", { branch: "main" }));

    const path = "/storage/journal.jsonl";
    const forgedEvent = event("entry-captured", { branch: "leaked" });
    const forged = {
      seq: 1,
      prevHash: "",
      hash: createHash("sha256").update("wrong").digest("hex"),
      event: forgedEvent,
    };
    fs.files.set(path, `${JSON.stringify(forged)}\n`);

    await expect(new LocalJournal(fs, "/storage").replay()).rejects.toBeInstanceOf(
      JournalIntegrityError,
    );
  });

  it("refuses to serialize an absolute path", async () => {
    const journal = new LocalJournal(fs, "/storage");

    await expect(
      journal.append(event("entry-captured", { path: "/Users/alice/secret.ts" })),
    ).rejects.toBeInstanceOf(JournalIntegrityError);
  });

  it("refuses to serialize diagnostic text longer than 500 characters", async () => {
    const journal = new LocalJournal(fs, "/storage");

    await expect(
      journal.append(event("entry-captured", { note: "x".repeat(501) })),
    ).rejects.toBeInstanceOf(JournalIntegrityError);
  });

  it("refuses to serialize multi-line transcripts or raw source", async () => {
    const journal = new LocalJournal(fs, "/storage");

    await expect(
      journal.append(event("entry-captured", { transcript: "line one\nline two" })),
    ).rejects.toBeInstanceOf(JournalIntegrityError);
  });
});

describe("LocalJournal — concurrent appends", () => {
  it("serializes Promise.all appends into contiguous records with both events", async () => {
    const fs = new DeferredJournalFileSystem();
    const journal = new LocalJournal(fs, "/storage");

    await Promise.all([
      journal.append(event("entry-captured", { branch: "main" })),
      journal.append(event("edit-episode", { uri: "src/a.ts" })),
    ]);

    const records = await journal.load();
    expect(records.map(record => record.seq)).toEqual([1, 2]);
    expect(records.map(record => record.event.type).sort()).toEqual([
      "edit-episode",
      "entry-captured",
    ]);
  });

  it("lets replay observe the committed order without racing an in-flight append", async () => {
    const fs = new DeferredJournalFileSystem();
    const journal = new LocalJournal(fs, "/storage");
    await journal.append(event("entry-captured", { branch: "main" }));

    const [, replayed] = await Promise.all([
      journal.append(event("edit-episode", { uri: "src/a.ts" })),
      journal.replay(),
    ]);

    expect(replayed.map(record => record.type)).toEqual([
      "entry-captured",
      "edit-episode",
    ]);
  });
});
