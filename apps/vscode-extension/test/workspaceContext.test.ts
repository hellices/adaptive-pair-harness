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
import { MemoryFs } from "./fakeHost.js";

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
  it("captures a bounded snapshot without a confirmed goal", async () => {
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
    // The open buffer supplies the dirty file's state, so only unopened work is inspected on disk.
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

  it("fails closed when the workspace folder or branch changes during capture", async () => {
    const access = new FakeWorkspaceAccess({
      folder,
      git: { branch: "feature/retry", dirtyPaths: ["src/a.ts"] },
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
          "ancestor-linked.ts",
          "logo.png",
          ".ssh/id_rsa",
          "huge.ts",
          "kept.ts",
        ],
      },
      stats: {
        "linked.ts": { isSymbolicLink: true, withinRoot: false },
        "ancestor-linked.ts": { isSymbolicLink: false, withinRoot: false },
        "huge.ts": { byteLength: MAX_CONTEXT_FILE_BYTES + 1 },
      },
    });

    const snapshot = await new WorkspaceContext(access).capture();

    expect(snapshot.protectedPaths).toEqual(["kept.ts"]);
    expect(access.inspected).not.toContain("logo.png");
    expect(access.inspected).not.toContain(".ssh/id_rsa");
  });
});

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
  let fs: MemoryFs;

  beforeEach(() => {
    fs = new MemoryFs();
  });

  it("writes atomically to a temp sibling, fsyncs, then renames", async () => {
    const journal = new LocalJournal(fs, "/storage");

    await journal.append(event("entry-captured", { branch: "main" }));

    expect(fs.operations).toEqual([
      "ensureDir:/storage",
      "writeFile:/storage/journal.jsonl.tmp",
      "fsync:/storage/journal.jsonl.tmp",
      "rename:/storage/journal.jsonl.tmp->/storage/journal.jsonl",
    ]);
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

    await expect(new LocalJournal(fs, "/storage").replay()).rejects.toMatchObject({
      reason: "sequence",
    });
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

    await expect(new LocalJournal(fs, "/storage").replay()).rejects.toMatchObject({
      reason: "hash",
    });
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["a non-string type", { capturedAt: 0, payload: {}, type: 1 }],
    ["a non-number capturedAt", { capturedAt: "0", payload: {}, type: "entry-captured" }],
    ["a null payload", { capturedAt: 0, payload: null, type: "entry-captured" }],
  ])("rejects a hash-consistent event envelope containing %s", async (_case, malformedEvent) => {
    const path = "/storage/journal.jsonl";
    const hash = createHash("sha256")
      .update(`\n1\n${JSON.stringify(malformedEvent)}`)
      .digest("hex");
    fs.files.set(path, `${JSON.stringify({
      seq: 1,
      prevHash: "",
      hash,
      event: malformedEvent,
    })}\n`);

    await expect(new LocalJournal(fs, "/storage").replay()).rejects.toMatchObject({
      reason: "parse",
    });
  });

  it.each([
    ["an absolute path", "/Users/alice/secret.ts", undefined],
    ["a two-slash root-level filename", "//secret.txt", undefined],
    ["a three-slash root-level filename", "///secret.txt", undefined],
    ["a local file URI", "file:///Users/alice/private.ts", undefined],
    ["multi-line text", "line one\nline two", undefined],
    ["a non-finite number", Number.POSITIVE_INFINITY, "1e400"],
  ])("rejects a hash-consistent persisted payload containing %s", async (
    _case,
    rejectedValue,
    serializedValue,
  ) => {
    const path = "/storage/journal.jsonl";
    const persistedEvent = {
      capturedAt: 1_700_000_000_000,
      payload: { nested: { value: rejectedValue } },
      type: "entry-captured",
    };
    const canonicalEvent = JSON.stringify(persistedEvent);
    const hash = createHash("sha256")
      .update(`\n1\n${canonicalEvent}`)
      .digest("hex");
    const rawEvent = serializedValue === undefined
      ? canonicalEvent
      : canonicalEvent.replace("null", serializedValue);
    fs.files.set(
      path,
      `{"seq":1,"prevHash":"","hash":"${hash}","event":${rawEvent}}\n`,
    );

    await expect(new LocalJournal(fs, "/storage").replay()).rejects.toMatchObject({
      reason: "privacy",
    });
  });

  it("refuses an absolute path in an object key", async () => {
    const journal = new LocalJournal(fs, "/storage");

    await expect(
      journal.append(event("entry-captured", { "/home/alice/project": true })),
    ).rejects.toBeInstanceOf(JournalIntegrityError);
  });

  it.each([
    "error-/Users/alice/secret.ts",
    "\\\\server\\share\\secret.ts",
  ])("refuses absolute path form %s", async leaked => {
    const journal = new LocalJournal(fs, "/storage");

    await expect(
      journal.append(event("entry-captured", { detail: leaked })),
    ).rejects.toBeInstanceOf(JournalIntegrityError);
  });

  it.each([
    "http://example.com/docs/path",
    "myfile:value",
    "File: changed",
  ])("preserves non-file URI text %s", async detail => {
    const journal = new LocalJournal(fs, "/storage");

    await expect(
      journal.append(event("entry-captured", { detail })),
    ).resolves.toBeUndefined();
    await expect(journal.replay()).resolves.toMatchObject([
      { payload: { detail } },
    ]);
  });

  it("refuses non-plain payload values before hashing or persistence", async () => {
    const journal = new LocalJournal(fs, "/storage");

    await expect(
      journal.append(
        event("entry-captured", {
          captured: new Date(0),
        }),
      ),
    ).rejects.toBeInstanceOf(JournalIntegrityError);
    expect(fs.files.has("/storage/journal.jsonl")).toBe(false);
  });

  it("refuses to serialize diagnostic text longer than 500 characters", async () => {
    const journal = new LocalJournal(fs, "/storage");

    await expect(
      journal.append(event("entry-captured", { note: "x".repeat(501) })),
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
