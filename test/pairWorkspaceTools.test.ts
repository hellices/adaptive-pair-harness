import { EventEmitter } from "node:events";
import { dirname, join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { createPairWorkspaceTools } from "../src/vscode/pairWorkspaceTools";

interface Entry {
  kind: "file" | "directory" | "link";
  bytes: Uint8Array;
  revision: number;
  nativeLink?: boolean;
  realPath?: string;
  size?: number;
  nativeCtime?: number;
}

interface Document {
  uri: vscode.Uri;
  text: string;
  version: number;
  isDirty: boolean;
  isClosed: boolean;
  isUntitled: boolean;
  getText(): string;
  positionAt(offset: number): vscode.Position;
  save: ReturnType<typeof vi.fn>;
}

const host = vi.hoisted(() => ({
  entries: new Map<string, Entry>(),
  documents: [] as Document[],
  roots: [] as vscode.Uri[],
  trusted: true,
  current: true,
  candidates: undefined as vscode.Uri[] | undefined,
  providers: new Map<string, vscode.TextDocumentContentProvider>(),
  spawn: vi.fn(),
  lstat: vi.fn(),
  realpath: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ lstat: host.lstat, realpath: host.realpath }));
vi.mock("node:child_process", () => ({ spawn: host.spawn }));
vi.mock("vscode", async () => {
  const paths = await import("node:path");
  const urls = await import("node:url");
  class Uri {
    public constructor(private readonly url: URL) {}
    public static file(value: string): Uri { return new Uri(urls.pathToFileURL(value)); }
    public static parse(value: string): Uri { return new Uri(new URL(value)); }
    public static from(value: { scheme: string; path: string }): Uri {
      const url = new URL(`${value.scheme}:/`);
      url.pathname = value.path;
      return new Uri(url);
    }
    public static joinPath(base: Uri, ...segments: string[]): Uri {
      return base.with({ path: paths.posix.join(base.path, ...segments) });
    }
    public get scheme(): string { return this.url.protocol.slice(0, -1); }
    public get authority(): string { return this.url.host; }
    public get path(): string { return decodeURIComponent(this.url.pathname); }
    public get fsPath(): string { return urls.fileURLToPath(this.url); }
    public get query(): string { return this.url.search.slice(1); }
    public get fragment(): string { return this.url.hash.slice(1); }
    public toString(skipEncoding?: boolean): string {
      return skipEncoding ? decodeURI(this.url.href) : this.url.href;
    }
    public with(changes: { path?: string; scheme?: string; query?: string; fragment?: string }): Uri {
      const url = new URL(this.url);
      if (changes.path !== undefined) { url.pathname = changes.path; }
      if (changes.scheme !== undefined) { url.protocol = `${changes.scheme}:`; }
      if (changes.query !== undefined) { url.search = changes.query; }
      if (changes.fragment !== undefined) { url.hash = changes.fragment; }
      return new Uri(url);
    }
  }
  class Position {
    public constructor(public line: number, public character: number) {}
  }
  class Range {
    public constructor(public start: Position, public end: Position) {}
  }
  class WorkspaceEdit {
    public readonly operations: { kind: string; uri: Uri; text?: string; options?: object }[] = [];
    public replace(uri: Uri, _range: Range, text: string): void {
      this.operations.push({ kind: "replace", uri, text });
    }
    public insert(uri: Uri, _position: Position, text: string): void {
      this.operations.push({ kind: "insert", uri, text });
    }
    public createFile(uri: Uri, options?: object): void {
      this.operations.push({ kind: "create", uri, ...(options === undefined ? {} : { options }) });
    }
  }
  const notFound = (): Error => Object.assign(new Error("private filesystem detail"), { code: "FileNotFound" });
  return {
    Uri, Position, Range, WorkspaceEdit,
    FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
    FilePermission: { Readonly: 1 },
    RelativePattern: class {
      public constructor(public baseUri: Uri, public pattern: string) {}
    },
    CancellationTokenSource: class {
      public readonly token = { isCancellationRequested: false };
      public cancel(): void { this.token.isCancellationRequested = true; }
      public dispose(): void {}
    },
    workspace: {
      get isTrusted() { return host.trusted; },
      get workspaceFolders() { return host.roots.map((uri, index) => ({ uri, name: `root-${index}`, index })); },
      get textDocuments() { return host.documents; },
      getWorkspaceFolder: (uri: Uri) => host.roots
        .filter((root) => uri.scheme === root.scheme && (uri.path === root.path || uri.path.startsWith(`${root.path}/`)))
        .sort((left, right) => right.path.length - left.path.length)
        .map((root) => ({ uri: root, name: "root", index: 0 }))[0],
      fs: {
        stat: vi.fn(async (uri: Uri) => {
          const entry = host.entries.get(uri.fsPath);
          if (entry === undefined) { throw notFound(); }
          return { type: entry.kind === "link" ? 65 : entry.kind === "directory" ? 2 : 1,
            size: entry.size ?? entry.bytes.byteLength, ctime: entry.revision, mtime: entry.revision };
        }),
        readFile: vi.fn(async (uri: Uri) => {
          const entry = host.entries.get(uri.fsPath);
          if (entry === undefined) { throw notFound(); }
          return entry.bytes;
        }),
      },
      findFiles: vi.fn(async (_include: unknown, _exclude: unknown, maximum: number) =>
        (host.candidates ?? [...host.entries].filter(([, entry]) => entry.kind !== "directory")
          .map(([path]) => Uri.file(path))).slice(0, maximum)),
      openTextDocument: vi.fn(),
      applyEdit: vi.fn(),
      saveAll: vi.fn(),
      registerTextDocumentContentProvider: vi.fn((scheme: string, provider: vscode.TextDocumentContentProvider) => {
        host.providers.set(scheme, provider);
        return { dispose: vi.fn(() => { host.providers.delete(scheme); }) };
      }),
    },
    commands: { executeCommand: vi.fn(async () => undefined) },
    window: { showWarningMessage: vi.fn(async () => undefined) },
  };
});

const rootPath = resolve("/workspace/pair-project");
const rootUri = vscode.Uri.file(rootPath);
const liveToolboxes: ReturnType<typeof createPairWorkspaceTools>[] = [];
const signal = (): AbortSignal => new AbortController().signal;
const deferred = <Value>() => {
  let resolvePromise!: (value: Value) => void;
  const promise = new Promise<Value>((resolveValue) => { resolvePromise = resolveValue; });
  return { promise, resolve: resolvePromise };
};
const put = (path: string, text: string | Uint8Array, extra: Partial<Entry> = {}): void => {
  const absolute = join(rootPath, path);
  host.entries.set(absolute, { kind: "file", bytes: typeof text === "string" ? Buffer.from(text) : text,
    revision: (host.entries.get(absolute)?.revision ?? 0) + 1, ...extra });
  let parent = dirname(absolute);
  for (;;) {
    if (!host.entries.has(parent)) {
      host.entries.set(parent, { kind: "directory", bytes: new Uint8Array(), revision: 1 });
    }
    if (parent === dirname(parent)) { break; }
    parent = dirname(parent);
  }
};
const openBuffer = (path: string, text: string, dirty = false): Document => {
  const document: Document = {
    uri: vscode.Uri.joinPath(rootUri, path), text, version: 1, isDirty: dirty, isClosed: false, isUntitled: false,
    getText: () => document.text,
    positionAt: (offset) => {
      const lines = document.text.slice(0, offset).split("\n");
      return new vscode.Position(lines.length - 1, lines.at(-1)?.length ?? 0);
    },
    save: vi.fn(async () => { put(path, document.text); document.isDirty = false; return true; }),
  };
  host.documents.push(document);
  return document;
};
const toolbox = (overrides: Partial<Parameters<typeof createPairWorkspaceTools>[0]> = {}) => {
  const tools = createPairWorkspaceTools({ rootUri, isCurrent: () => host.current, ...overrides });
  liveToolboxes.push(tools);
  return tools;
};
const read = (tools: ReturnType<typeof toolbox>, path = "src/main.ts") => tools.invoke("read_file", { path }, signal());
const edit = (tools: ReturnType<typeof toolbox>, path = "src/main.ts") =>
  tools.invoke("edit_file", { path, oldText: "before", newText: "after" }, signal());
const packageFile = (scripts: Record<string, string> = { test: "node check.cjs" }) =>
  put("package.json", JSON.stringify({ name: "fixture", scripts }));

class CheckProcess extends EventEmitter {
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly pid = 12345;
  public readonly kill = vi.fn(() => { this.emit("close", null, "SIGKILL"); return true; });
}

const pendingCheck = (): CheckProcess => {
  const child = new CheckProcess();
  host.spawn.mockImplementation((command: string) => {
    if (/taskkill/iu.test(command)) {
      const killer = new CheckProcess();
      queueMicrotask(() => { child.emit("close", null, "SIGKILL"); killer.emit("close", 0, null); });
      return killer;
    }
    return child;
  });
  vi.spyOn(process, "kill").mockImplementation(() => { queueMicrotask(() => child.emit("close", null, "SIGKILL")); return true; });
  return child;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, "kill").mockImplementation(() => true);
  host.entries.clear(); host.documents.length = 0; host.providers.clear();
  host.roots = [rootUri]; host.trusted = true; host.current = true; host.candidates = undefined;
  put("src/main.ts", "before\nsecond line\n");
  host.lstat.mockImplementation(async (path: string) => {
    const entry = host.entries.get(path);
    if (entry === undefined) { throw Object.assign(new Error("private path"), { code: "ENOENT" }); }
    return { isSymbolicLink: () => entry.kind === "link" || entry.nativeLink === true,
      isDirectory: () => entry.kind === "directory", isFile: () => entry.kind === "file",
      size: entry.size ?? entry.bytes.byteLength, mtimeMs: entry.revision, ctimeMs: entry.nativeCtime ?? entry.revision,
      ino: 1, dev: 1, nlink: 1 };
  });
  host.realpath.mockImplementation(async (path: string) => host.entries.get(path)?.realPath ?? path);
  vi.mocked(vscode.workspace.openTextDocument).mockImplementation(async (uri: unknown) => {
    const target = uri as vscode.Uri;
    return (host.documents.find((document) => !document.isClosed && document.uri.toString() === target.toString()) ??
      openBuffer(target.fsPath.slice(rootPath.length + 1).replaceAll("\\", "/"),
        Buffer.from(host.entries.get(target.fsPath)?.bytes ?? []).toString("utf8"))) as unknown as vscode.TextDocument;
  });
  vi.mocked(vscode.workspace.applyEdit).mockImplementation(async (workspaceEdit) => {
    const operations = (workspaceEdit as unknown as { operations: { kind: string; uri: vscode.Uri; text?: string }[] }).operations;
    for (const operation of operations) {
      const relative = operation.uri.fsPath.slice(rootPath.length + 1).replaceAll("\\", "/");
      if (operation.kind === "create") {
        if (host.entries.has(operation.uri.fsPath)) { return false; }
        put(relative, "");
      } else {
        const document = await vscode.workspace.openTextDocument(operation.uri) as unknown as Document;
        document.text = operation.text ?? ""; document.version += 1; document.isDirty = true;
      }
    }
    return true;
  });
  vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);
  vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined);
  host.spawn.mockImplementation(() => {
    const child = new CheckProcess();
    queueMicrotask(() => { child.stdout.write("fixture passed\n"); child.emit("close", 0, null); });
    return child;
  });
});

afterEach(() => {
  for (const tools of liveToolboxes.splice(0)) { tools.dispose?.(); }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("workspace tool reads", () => {
  it("exports only the five bounded, typed tools", () => {
    expect(toolbox().definitions.map(({ name, kind }) => [name, kind])).toEqual([
      ["list_files", "read"], ["read_file", "read"], ["search_files", "read"],
      ["edit_file", "edit"], ["run_check", "check"],
    ]);
  });

  it("reads the current dirty buffer, not the disk, with relative line references", async () => {
    openBuffer("src/main.ts", "unsaved first\nunsaved second\n", true);
    const result = await toolbox().invoke("read_file", { path: "src/main.ts", startLine: 2, endLine: 2 }, signal());
    expect(result.status).toBe("ok");
    expect(result.text).toContain("2: unsaved second");
    expect(result.text).not.toContain("unsaved first");
    expect(result.summary).toContain("src/main.ts");
    expect(JSON.stringify(result)).not.toContain(rootPath);
    expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled();
  });

  it.each(["metadata only", "changed bytes", "repeated changes"])("bounds native ctime drift revalidation: %s", async (change) => {
    const entry = host.entries.get(join(rootPath, "src/main.ts"))!;
    const readFile = vi.mocked(vscode.workspace.fs.readFile);
    const originalRead = readFile.getMockImplementation()!;
    let attempts = 0;
    readFile.mockImplementation(async (uri) => {
      const bytes = await originalRead(uri);
      attempts += 1;
      if (attempts === 1 || change === "repeated changes") {
        entry.nativeCtime = (entry.nativeCtime ?? entry.revision) + 1;
        if (change === "changed bytes") {
          entry.bytes = Buffer.from("mutate\nsecond line\n");
        }
      }
      return bytes;
    });
    try {
      const result = await read(toolbox());
      expect(result.status).toBe(change === "metadata only" ? "ok" : "blocked");
      expect(attempts).toBe(2);
      if (change === "metadata only") {
        expect(result.text).toContain("before");
      }
    } finally {
      readFile.mockImplementation(originalRead);
    }
  });

  it.each(["../outside.ts", "/absolute.ts", "C:/private.ts", "src\\main.ts", "%2e%2e/file", "src/%252eenv",
    ".git/config", "node_modules/code.ts", ".env", ".env.local", "key.pem", "keys/private.json", ".npmrc",
    "src/main.ts:stream", "src/../main.ts", "src//main.ts", "src/main.ts.", "CON.ts", "src\u0000/main.ts"])("rejects protected or ambiguous paths before reading: %s", async (path) => {
    const result = await read(toolbox(), path);
    expect(result.status).not.toBe("ok");
    expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled();
  });

  it.each([null, [], {}, { path: 1 }, { path: "src/main.ts", extra: true }, { path: "src/main.ts", startLine: 0 },
    { path: "src/main.ts", startLine: 3, endLine: 2 }])("rejects invalid read input %#", async (input) => {
    expect((await toolbox().invoke("read_file", input, signal())).status).toBe("error");
  });

  it("rejects unknown tools without dispatching commands", async () => {
    expect((await toolbox().invoke("run_shell", { command: "anything" }, signal())).status).toBe("error");
    expect(host.spawn).not.toHaveBeenCalled();
  });

  it.each(["untrusted", "replaced", "cancelled", "removed root"])("does no file work when %s", async (reason) => {
    const controller = new AbortController();
    if (reason === "untrusted") { host.trusted = false; }
    if (reason === "replaced") { host.current = false; }
    if (reason === "cancelled") { controller.abort(); }
    if (reason === "removed root") { host.roots = []; }
    expect((await toolbox().invoke("read_file", { path: "src/main.ts" }, controller.signal)).status).toBe("blocked");
    expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled();
  });

  it("rejects ownership by a nested workspace folder", async () => {
    host.roots.push(vscode.Uri.joinPath(rootUri, "src"));
    expect((await read(toolbox())).status).toBe("blocked");
    expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled();
  });

  it.each(["src", "src/main.ts", "", ".."])("rejects symbolic/reparse ancestors at %s", async (path) => {
    const entry = host.entries.get(join(rootPath, path));
    if (entry === undefined) { throw new Error("Missing fixture ancestor"); }
    entry.nativeLink = true;
    expect((await read(toolbox())).status).toBe("blocked");
    expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled();
  });

  it.each(["binary", "non-utf8", "large"])("does not return %s data", async (kind) => {
    put("src/main.ts", kind === "binary" ? "before\0private" : kind === "non-utf8" ? Uint8Array.of(0xc3, 0x28) : "x".repeat(300_000));
    expect((await read(toolbox())).status).toBe("blocked");
    if (kind === "large") { expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled(); }
  });

  it.each(["disk", "buffer"])("scans the full %s before clipping lines or bytes", async (source) => {
    const text = `${"ordinary line\n".repeat(2_000)}api_key=fixture-private-credential`;
    if (source === "disk") { put("src/main.ts", text); } else { openBuffer("src/main.ts", text, true); }
    const result = await toolbox().invoke("read_file", { path: "src/main.ts", startLine: 1, endLine: 1 }, signal());
    expect(result).toMatchObject({ status: "blocked", sensitiveDataDetected: true });
    expect(JSON.stringify(result)).not.toContain("fixture-private-credential");
  });

  it("bounds returned lines, characters, and total repeated reads", async () => {
    put("src/main.ts", "ordinary line\n".repeat(3_000));
    const tools = toolbox();
    const first = await read(tools);
    expect(first.status).toBe("ok");
    expect(first.text.length).toBeLessThanOrEqual(16_500);
    expect(first.text.split("\n").length).toBeLessThanOrEqual(205);
    let last = first;
    for (let index = 0; index < 70; index += 1) { last = await read(tools); }
    expect(last.status).toBe("blocked");
    expect(last.text).toMatch(/limit|budget/i);
    expect(vi.mocked(vscode.workspace.fs.readFile).mock.calls.length).toBeLessThanOrEqual(64);
  });
});

describe("discovery and literal search", () => {
  it.runIf(process.platform === "win32")("accepts native discovery with normalized Windows drive casing", async () => {
    host.candidates = [vscode.Uri.file(join(rootPath, "src/main.ts").replace(/^[a-z]:/iu, (drive) => drive.toLowerCase()))];
    const tools = toolbox();
    const listed = await tools.invoke("list_files", { pattern: "**/*.ts" }, signal());
    expect(listed.status).toBe("ok");
    expect(listed.text).toContain("src/main.ts");
    const searched = await tools.invoke("search_files", { query: "before", pattern: "**/*.ts" }, signal());
    expect(searched.status).toBe("ok");
    expect(searched.text).toContain("src/main.ts");
  });

  it("bounds listing characters without cutting a relative path in half", async () => {
    for (let index = 0; index < 200; index += 1) { put(`docs/item-${index}-${"long-name-".repeat(16)}.md`, "content"); }
    const result = await toolbox().invoke("list_files", {}, signal());
    expect(result.status).toBe("ok");
    expect(result.text.length).toBeLessThanOrEqual(16_100);
    expect(result.text).toMatch(/limit/i);
    for (const line of result.text.split("\n").filter((line) => !line.startsWith("["))) {
      expect(host.entries.has(join(rootPath, line))).toBe(true);
    }
  });

  it("blocks a search when the byte budget, rather than read count, is exhausted", async () => {
    put("src/main.ts", "line\n".repeat(26_000));
    const tools = toolbox();
    for (let index = 0; index < 16; index += 1) { expect((await read(tools)).status).toBe("ok"); }
    const result = await tools.invoke("search_files", { query: "line" }, signal());
    expect(result.status).toBe("blocked");
    expect(result.text).toMatch(/limit|budget/i);
  });

  it.each([".envrc", "image.png", "private.crt"])("does not discover protected or binary formats: %s", async (path) => {
    put(path, "otherwise plain text");
    const result = await toolbox().invoke("list_files", {}, signal());
    expect(result.text).not.toContain(path);
  });

  it.each(["list_files", "search_files"])("rejects explicitly undefined arguments to %s", async (name) => {
    const input = name === "list_files" ? { pattern: undefined } : { query: "before", pattern: undefined };
    expect((await toolbox().invoke(name, input, signal())).status).toBe("error");
    expect(vscode.workspace.findFiles).not.toHaveBeenCalled();
  });

  it("lists only eligible, selected-root, workspace-relative files", async () => {
    put(".env", "private"); put(".git/config", "private"); put("node_modules/library.js", "library");
    put("linked/file.ts", "outside");
    const ancestor = host.entries.get(join(rootPath, "linked"));
    if (ancestor !== undefined) { ancestor.nativeLink = true; }
    put("nested/private.ts", "other owner");
    host.roots.push(vscode.Uri.joinPath(rootUri, "nested"));
    const result = await toolbox().invoke("list_files", {}, signal());
    expect(result.status).toBe("ok");
    expect(result.text).toContain("src/main.ts");
    for (const forbidden of [rootPath, ".env", ".git", "node_modules", "linked/", "nested/"]) {
      expect(result.text).not.toContain(forbidden);
    }
    expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled();
  });

  it("uses root-relative glob discovery and searches unsaved literal content", async () => {
    openBuffer("src/main.ts", "match [literal]\nunrelated", true);
    const result = await toolbox().invoke("search_files", { query: "[literal]", pattern: "**/*.ts" }, signal());
    expect(result.status).toBe("ok");
    expect(result.text).toContain("src/main.ts:1:");
    expect(result.text).toContain("[literal]");
    expect(vscode.workspace.findFiles).toHaveBeenCalledWith(
      expect.objectContaining({ baseUri: rootUri, pattern: "**/*.ts" }), expect.anything(), expect.any(Number), expect.anything(),
    );
    expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled();
  });

  it("scans beyond matching lines and the search result limit for sensitive suffixes", async () => {
    put("src/main.ts", `${"match line\n".repeat(500)}authorization: Bearer fixture-search-private`);
    const result = await toolbox().invoke("search_files", { query: "match" }, signal());
    expect(result).toMatchObject({ status: "blocked", sensitiveDataDetected: true });
    expect(JSON.stringify(result)).not.toContain("fixture-search-private");
  });

  it.each(["../**", "/**", "C:/**", "**/%2eenv", "**\\*.ts"])("rejects ambiguous discovery patterns: %s", async (pattern) => {
    expect((await toolbox().invoke("list_files", { pattern }, signal())).status).not.toBe("ok");
    expect(vscode.workspace.findFiles).not.toHaveBeenCalled();
  });
});

describe("approved exact edits", () => {
  it("requires a prior read, not just a proposed substring", async () => {
    const confirmEdit = vi.fn(async () => true);
    expect((await edit(toolbox({ confirmEdit }))).status).toBe("blocked");
    expect(confirmEdit).not.toHaveBeenCalled();
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
  });

  it("shows the complete diff, discloses dirty changes, and saves only the target", async () => {
    const target = openBuffer("src/main.ts", "before\nuser's unsaved addition", true);
    put("other.ts", "other disk");
    const other = openBuffer("other.ts", "other unsaved", true);
    const confirmEdit = vi.fn(async (proposal) => {
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith("vscode.diff", expect.anything(), expect.anything(), expect.any(String), expect.anything());
      const arguments_ = vi.mocked(vscode.commands.executeCommand).mock.calls[0];
      const beforeUri = arguments_?.[1] as vscode.Uri;
      const afterUri = arguments_?.[2] as vscode.Uri;
      expect(host.providers.get(beforeUri.scheme)?.provideTextDocumentContent(beforeUri, {} as vscode.CancellationToken)).toBe(proposal.before);
      expect(host.providers.get(afterUri.scheme)?.provideTextDocumentContent(afterUri, {} as vscode.CancellationToken)).toBe(proposal.after);
      return true;
    });
    const tools = toolbox({ confirmEdit });
    await read(tools);
    const result = await edit(tools);
    expect(result.status).toBe("ok");
    expect(result.text).toMatch(/applied.*saved/is);
    expect(confirmEdit).toHaveBeenCalledWith({ path: "src/main.ts", before: "before\nuser's unsaved addition",
      after: "after\nuser's unsaved addition", dirty: true }, expect.any(AbortSignal));
    expect(target.text).toBe("after\nuser's unsaved addition");
    expect(target.save).toHaveBeenCalledOnce();
    expect(other.save).not.toHaveBeenCalled();
    expect(vscode.workspace.saveAll).not.toHaveBeenCalled();
  });

  it.each([
    ["Apply and save", "ok"],
    ["Skip", "declined"],
    [undefined, "declined"],
  ] as const)("opens the read-only diff before a non-modal native edit notification (%#)", async (selection, status) => {
    const target = openBuffer("src/main.ts", "before", true);
    const diff = deferred<void>();
    const approval = deferred<string | undefined>();
    vi.mocked(vscode.commands.executeCommand).mockReturnValueOnce(diff.promise);
    vi.mocked(vscode.window.showWarningMessage).mockReturnValueOnce(approval.promise as Promise<never>);
    const tools = toolbox(); await read(tools);
    const pending = edit(tools);
    await vi.waitFor(() => expect(vscode.commands.executeCommand).toHaveBeenCalledOnce());
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    const arguments_ = vi.mocked(vscode.commands.executeCommand).mock.calls[0];
    for (const index of [1, 2]) {
      const uri = arguments_?.[index] as vscode.Uri;
      expect(uri.scheme).not.toBe("file");
      expect(host.providers.has(uri.scheme)).toBe(true);
    }
    diff.resolve(undefined);
    await vi.waitFor(() => expect(vscode.window.showWarningMessage).toHaveBeenCalledOnce());
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining("src/main.ts"),
      { modal: false }, "Apply and save", "Skip");
    const message = vi.mocked(vscode.window.showWarningMessage).mock.calls[0]?.[0];
    expect(message).toMatch(/pre-existing unsaved changes.*save ALL of those changes/is);
    expect(message).toContain("Other buffers will not be saved");
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    approval.resolve(selection);
    expect((await pending).status).toBe(status);
    expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(selection === "Apply and save" ? 1 : 0);
    expect(target.save).toHaveBeenCalledTimes(selection === "Apply and save" ? 1 : 0);
  });

  it.each(["cancelled", "stale"])("rejects a pending native edit approval after the operation becomes %s", async (change) => {
    const target = openBuffer("src/main.ts", "before", true);
    const approval = deferred<string>();
    const controller = new AbortController();
    vi.mocked(vscode.window.showWarningMessage).mockReturnValueOnce(approval.promise as Promise<never>);
    const tools = toolbox(); await read(tools);
    const pending = tools.invoke("edit_file", { path: "src/main.ts", oldText: "before", newText: "after" }, controller.signal);
    await vi.waitFor(() => expect(vscode.window.showWarningMessage).toHaveBeenCalledOnce());
    if (change === "cancelled") {
      controller.abort();
      expect((await pending).status).toBe("blocked");
    } else {
      target.text = "before\nnew user changes";
      target.version += 1;
    }
    approval.resolve("Apply and save");
    expect((await pending).status).toBe("blocked");
    await Promise.resolve();
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    expect(target.save).not.toHaveBeenCalled();
  });

  it.each(["whole buffer", "version", "disk"])("rejects a stale %s after the read", async (change) => {
    const target = openBuffer("src/main.ts", "before\nunchanged");
    const confirmEdit = vi.fn(async () => true); const tools = toolbox({ confirmEdit }); await read(tools);
    if (change === "whole buffer") { target.text = "before\nchanged elsewhere"; }
    if (change === "version") { target.version += 1; }
    if (change === "disk") { put("src/main.ts", "before\nexternal change"); }
    expect((await edit(tools)).status).toBe("blocked");
    expect(confirmEdit).not.toHaveBeenCalled();
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
  });

  it("retains the full native timestamp fence between a read and an edit", async () => {
    const confirmEdit = vi.fn(async () => true);
    const tools = toolbox({ confirmEdit });
    await read(tools);
    host.entries.get(join(rootPath, "src/main.ts"))!.nativeCtime = 10;
    expect((await edit(tools)).status).toBe("blocked");
    expect(confirmEdit).not.toHaveBeenCalled();
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
  });

  it.each(["absent", "repeated", "empty"])("rejects an %s/ambiguous original substring", async (kind) => {
    put("src/main.ts", kind === "repeated" ? "before before" : "before");
    const tools = toolbox({ confirmEdit: async () => true }); await read(tools);
    const result = await tools.invoke("edit_file", { path: "src/main.ts", oldText: kind === "absent" ? "missing" : kind === "empty" ? "" : "before", newText: "after" }, signal());
    expect(result.status).not.toBe("ok");
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
  });

  it.each(["buffer", "scope", "trust", "package replacement"])("revalidates %s after edit approval", async (change) => {
    const target = openBuffer("src/main.ts", "before");
    const tools = toolbox({ confirmEdit: async () => {
      if (change === "buffer") { target.text = "changed"; target.version += 1; }
      if (change === "scope") { host.roots.push(vscode.Uri.joinPath(rootUri, "src")); }
      if (change === "trust") { host.trusted = false; }
      if (change === "package replacement") { host.current = false; }
      return true;
    } });
    await read(tools);
    expect((await edit(tools)).status).toBe("blocked");
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
  });

  it("requires an observed absence and empty oldText to create a file", async () => {
    const tools = toolbox({ confirmEdit: async () => true });
    const proposal = { path: "new.md", oldText: "", newText: "# A real goal\n" };
    expect((await tools.invoke("edit_file", proposal, signal())).status).toBe("blocked");
    expect((await read(tools, "new.md")).text).toMatch(/does not exist|not found|absent/i);
    expect((await tools.invoke("edit_file", proposal, signal())).status).toBe("ok");
    expect(Buffer.from(host.entries.get(join(rootPath, "new.md"))?.bytes ?? []).toString()).toBe(proposal.newText);
    expect(vscode.workspace.saveAll).not.toHaveBeenCalled();
  });

  it("does not overwrite a missing file that appears during approval", async () => {
    const tools = toolbox({ confirmEdit: async () => { put("new.md", "someone else's file"); return true; } });
    await read(tools, "new.md");
    expect((await tools.invoke("edit_file", { path: "new.md", oldText: "", newText: "proposal" }, signal())).status).toBe("blocked");
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
  });

  it("does not apply a late approval after cancellation", async () => {
    const approval = deferred<boolean>(); const controller = new AbortController();
    const confirmEdit = vi.fn(() => approval.promise); const tools = toolbox({ confirmEdit }); await read(tools);
    const pending = tools.invoke("edit_file", { path: "src/main.ts", oldText: "before", newText: "after" }, controller.signal);
    await vi.waitFor(() => expect(confirmEdit).toHaveBeenCalledOnce());
    controller.abort();
    expect((await pending).status).toBe("blocked");
    approval.resolve(true); await Promise.resolve();
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
  });

  it("reports an applied but unsaved edit truthfully when save fails", async () => {
    const target = openBuffer("src/main.ts", "before"); target.save.mockResolvedValue(false);
    const tools = toolbox({ confirmEdit: async () => true }); await read(tools);
    const result = await edit(tools);
    expect(result.status).toBe("error");
    expect(result.text).toMatch(/applied.*not saved/is);
    expect(target.text).toBe("after"); expect(target.isDirty).toBe(true);
  });

  it("verifies saved bytes when VS Code disposes a clean document after save", async () => {
    const target = openBuffer("src/main.ts", "before");
    target.save.mockImplementationOnce(async () => {
      put("src/main.ts", target.text);
      target.isDirty = false;
      target.isClosed = true;
      return true;
    });
    const tools = toolbox({ confirmEdit: async () => true });
    await read(tools);
    const result = await edit(tools);
    expect(result.status).toBe("ok");
    expect(result.text).toMatch(/applied.*saved/is);
    expect(Buffer.from(host.entries.get(join(rootPath, "src/main.ts"))!.bytes).toString("utf8")).toBe("after");
  });

  it("does not claim the approved edit was saved when a closed target has different persisted bytes", async () => {
    const target = openBuffer("src/main.ts", "before");
    target.save.mockImplementationOnce(async () => {
      put("src/main.ts", "concurrent change");
      target.isDirty = false;
      target.isClosed = true;
      return true;
    });
    const tools = toolbox({ confirmEdit: async () => true });
    await read(tools);
    const result = await edit(tools);
    expect(result.status).toBe("error");
    expect(result.text).toMatch(/altered|changed|could not be confirmed/is);
  });

  it.each([false, true])("verifies existence as well as empty saved content (target removed: %s)", async (removed) => {
    const target = openBuffer("src/main.ts", "before");
    target.save.mockImplementationOnce(async () => {
      put("src/main.ts", target.text);
      target.isDirty = false;
      target.isClosed = true;
      if (removed) {
        host.entries.delete(join(rootPath, "src/main.ts"));
      }
      return true;
    });
    const tools = toolbox({ confirmEdit: async () => true });
    await read(tools);
    const result = await tools.invoke("edit_file", { path: "src/main.ts", oldText: "before", newText: "" }, signal());
    expect(result.status).toBe(removed ? "error" : "ok");
  });

  it("does not save after cancellation during an in-flight apply", async () => {
    const target = openBuffer("src/main.ts", "before"); const controller = new AbortController();
    const tools = toolbox({ confirmEdit: async () => true }); await read(tools);
    vi.mocked(vscode.workspace.applyEdit).mockImplementationOnce(async () => {
      target.text = "after"; target.isDirty = true; target.version += 1; controller.abort(); return true;
    });
    const result = await tools.invoke("edit_file", { path: "src/main.ts", oldText: "before", newText: "after" }, controller.signal);
    expect(result.status).toBe("blocked");
    expect(result.text).toMatch(/applied.*not saved/is);
    expect(target.save).not.toHaveBeenCalled();
  });
});

describe("approved npm validation", () => {
  it("does not turn an escaping absolute output path into a seemingly relative path", async () => {
    packageFile();
    host.spawn.mockImplementation(() => {
      const child = new CheckProcess();
      queueMicrotask(() => { child.stdout.write(`${rootPath}/../outside/private.ts\n`); child.emit("close", 0, null); });
      return child;
    });
    const result = await toolbox({ confirmCheck: async () => true }).invoke("run_check", { script: "test" }, signal());
    expect(result).toMatchObject({ status: "blocked", sensitiveDataDetected: true });
    expect(result.text).not.toContain("outside/private.ts");
  });

  it("preserves a sensitivity marker when later output exceeds the capture budget", async () => {
    vi.useFakeTimers(); packageFile(); const child = pendingCheck();
    const pending = toolbox({ confirmCheck: async () => true }).invoke("run_check", { script: "test" }, signal());
    await vi.advanceTimersByTimeAsync(0);
    child.stderr.write("api_key=fixture-overflow-private\n");
    child.stdout.write("x".repeat(140_000));
    await vi.advanceTimersByTimeAsync(2_100);
    const result = await pending;
    expect(result.sensitiveDataDetected).toBe(true);
    expect(result.text).not.toContain("fixture-overflow-private");
  });

  it.each(["compile", "install", "test -- --watch", "test&whoami", "test;echo", "test\nother", "../test", "test:unit:other"])("rejects non-validation and shell-like identifiers: %s", async (script) => {
    packageFile({ [script]: "node check.cjs" });
    expect((await toolbox({ confirmCheck: async () => true }).invoke("run_check", { script }, signal())).status).not.toBe("ok");
    expect(host.spawn).not.toHaveBeenCalled();
  });

  it("requires the exact script to exist, not npm's implicit test fallback", async () => {
    packageFile({ lint: "node check.cjs" });
    expect((await toolbox({ confirmCheck: async () => true }).invoke("run_check", { script: "test" }, signal())).status).toBe("blocked");
    expect(host.spawn).not.toHaveBeenCalled();
  });

  it("blocks checks with dirty buffers and never saves them automatically", async () => {
    packageFile(); openBuffer("src/main.ts", "dirty", true);
    const result = await toolbox({ confirmCheck: async () => true }).invoke("run_check", { script: "test" }, signal());
    expect(result.status).toBe("blocked"); expect(result.text).toMatch(/save.*buffer/is);
    expect(host.spawn).not.toHaveBeenCalled(); expect(vscode.workspace.saveAll).not.toHaveBeenCalled();
  });

  it("shows actual package and lifecycle commands in the native per-check modal", async () => {
    packageFile({ "test:unit": "node unit.cjs", "pretest:unit": "node prepare.cjs", "posttest:unit": "node cleanup.cjs" });
    const result = await toolbox().invoke("run_check", { script: "test:unit" }, signal());
    expect(result.status).toBe("declined");
    const detail = vi.mocked(vscode.window.showWarningMessage).mock.calls[0]?.[1];
    expect(detail).toMatchObject({ modal: true });
    for (const text of ["node unit.cjs", "node prepare.cjs", "node cleanup.cjs"]) { expect(JSON.stringify(detail)).toContain(text); }
    expect(host.spawn).not.toHaveBeenCalled();
  });

  it("passes exact approved lifecycle commands and uses a constant root-scoped invocation", async () => {
    packageFile({ test: "node check.cjs", pretest: "node prepare.cjs", posttest: "node cleanup.cjs" });
    const confirmCheck = vi.fn(async () => true);
    const result = await toolbox({ confirmCheck }).invoke("run_check", { script: "test" }, signal());
    expect(confirmCheck).toHaveBeenCalledWith({ script: "test", command: "node check.cjs", preCommand: "node prepare.cjs", postCommand: "node cleanup.cjs" }, expect.any(AbortSignal));
    expect(result.status).toBe("ok"); expect(result.text).toContain("fixture passed"); expect(result.text).toMatch(/exit code: 0/i);
    expect(host.spawn).toHaveBeenCalledOnce();
    const [command, args, options] = host.spawn.mock.calls[0] ?? [];
    expect(options).toMatchObject({ cwd: rootPath, shell: false, windowsHide: true });
    expect(JSON.stringify(args)).not.toContain("node check.cjs");
    if (process.platform === "win32") { expect(command).toMatch(/cmd\.exe$/i); expect(args).toContain("/d"); expect(args).toContain("/c"); }
    else { expect(command).toBe("npm"); expect(args).toContain("test"); expect(options).toMatchObject({ detached: true }); }
    expect(vi.mocked(vscode.workspace.fs.readFile).mock.calls.filter(([uri]) => uri.fsPath.endsWith("package.json")).length).toBeGreaterThanOrEqual(2);
  });

  it.each(["script", "lifecycle", "dirty", "root"])("rechecks %s after approval before spawning", async (change) => {
    packageFile();
    const tools = toolbox({ confirmCheck: async () => {
      if (change === "script") { packageFile({ test: "node changed.cjs" }); }
      if (change === "lifecycle") { packageFile({ test: "node check.cjs", posttest: "node added.cjs" }); }
      if (change === "dirty") { openBuffer("src/main.ts", "unsaved", true); }
      if (change === "root") { host.current = false; }
      return true;
    } });
    expect((await tools.invoke("run_check", { script: "test" }, signal())).status).toBe("blocked");
    expect(host.spawn).not.toHaveBeenCalled();
  });

  it("captures real stderr and nonzero exit status rather than claiming success", async () => {
    packageFile();
    host.spawn.mockImplementation(() => {
      const child = new CheckProcess();
      queueMicrotask(() => { child.stderr.write("assertion failed\n"); child.emit("close", 7, null); }); return child;
    });
    const result = await toolbox({ confirmCheck: async () => true }).invoke("run_check", { script: "test" }, signal());
    expect(result.status).toBe("error"); expect(result.text).toContain("assertion failed"); expect(result.text).toMatch(/exit code: 7/i);
  });

  it("normalizes this root's absolute paths before scanning check output", async () => {
    packageFile();
    host.spawn.mockImplementation(() => {
      const child = new CheckProcess();
      queueMicrotask(() => { child.stdout.write(`${join(rootPath, "src", "main.ts")}:2: passed\n`); child.emit("close", 0, null); }); return child;
    });
    const result = await toolbox({ confirmCheck: async () => true }).invoke("run_check", { script: "test" }, signal());
    expect(result.status).toBe("ok"); expect(result.text.replaceAll("\\", "/")).toContain("src/main.ts:2");
    expect(result.text).not.toContain(rootPath); expect(result.sensitiveDataDetected).not.toBe(true);
  });

  it("scans complete stdout across chunks before returning a clipped prefix", async () => {
    packageFile();
    host.spawn.mockImplementation(() => {
      const child = new CheckProcess();
      queueMicrotask(() => {
        child.stdout.write("ordinary output\n".repeat(2_000)); child.stdout.write("api_"); child.stdout.write("key=fixture-output-private"); child.emit("close", 0, null);
      }); return child;
    });
    const result = await toolbox({ confirmCheck: async () => true }).invoke("run_check", { script: "test" }, signal());
    expect(result).toMatchObject({ status: "blocked", sensitiveDataDetected: true });
    expect(JSON.stringify(result)).not.toContain("fixture-output-private");
  });

  it.each(["cancel", "replace", "timeout", "overflow"])("terminates the check tree on %s and withholds unsafe partial output", async (reason) => {
    vi.useFakeTimers(); packageFile(); const child = pendingCheck(); const controller = new AbortController();
    const resultPromise = toolbox({ confirmCheck: async () => true }).invoke("run_check", { script: "test" }, controller.signal);
    await vi.advanceTimersByTimeAsync(0); expect(host.spawn).toHaveBeenCalledOnce();
    if (reason === "cancel") { controller.abort(); }
    if (reason === "replace") { host.current = false; await vi.advanceTimersByTimeAsync(200); }
    if (reason === "timeout") { await vi.advanceTimersByTimeAsync(120_000); }
    if (reason === "overflow") { child.stdout.write("safe prefix\n"); child.stdout.write("x".repeat(140_000)); }
    await vi.advanceTimersByTimeAsync(2_100);
    const result = await resultPromise; expect(result.status).not.toBe("ok");
    expect(result.text).not.toContain("safe prefix");
    if (process.platform === "win32") {
      expect(host.spawn.mock.calls.some(([command, args]) => /taskkill/i.test(String(command)) && args.includes("/T") && args.includes("/F"))).toBe(true);
    } else { expect(process.kill).toHaveBeenCalledWith(-child.pid, "SIGKILL"); }
  });
});
