import { spawn, type ChildProcess } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { stripVTControlCharacters } from "node:util";
import * as vscode from "vscode";
import { containsSensitiveModelText } from "../core/modelRouter";
import type { PairAgentToolbox, PairAgentToolDefinition, PairAgentToolResult } from "../core/pairAgent";

export interface PairWorkspaceToolsOptions {
  readonly rootUri: vscode.Uri;
  readonly isCurrent: () => boolean;
  readonly confirmEdit?: (proposal: { path: string; before: string; after: string; dirty: boolean }, signal: AbortSignal) => Promise<boolean>;
  readonly confirmCheck?: (proposal: { script: string; command: string; preCommand?: string; postCommand?: string }, signal: AbortSignal) => Promise<boolean>;
}

export const PAIR_WORKSPACE_TOOL_LIMITS = Object.freeze({
  fileBytes: 128 * 1_024,
  totalReadBytes: 2 * 1_024 * 1_024,
  reads: 64,
  readLines: 200,
  resultCharacters: 16_000,
  candidates: 400,
  listedFiles: 200,
  searchResults: 50,
  searchLineCharacters: 400,
  checkMilliseconds: 120_000,
  checkOutputBytes: 128 * 1_024,
});

const limits = PAIR_WORKSPACE_TOOL_LIMITS;
const scriptPattern = /^(?:test|check|lint|typecheck|build)(?::[A-Za-z0-9][A-Za-z0-9._-]{0,63})?$/u;
const schema = (properties: Record<string, unknown>, required: readonly string[] = []): Readonly<Record<string, unknown>> =>
  ({ type: "object", properties, required, additionalProperties: false });
const pathSchema = { type: "string", minLength: 1, maxLength: 1_024, description: "Selected-workspace-relative path using forward slashes." };
const patternSchema = { type: "string", minLength: 1, maxLength: 256, description: "Relative VS Code glob, for example **/*.ts." };
const definitions: readonly PairAgentToolDefinition[] = [
  { name: "list_files", kind: "read", description: "List bounded, eligible files in the selected root; protected paths and nested workspace roots are excluded.",
    inputSchema: schema({ pattern: patternSchema }) },
  { name: "read_file", kind: "read", description: "Read bounded, one-based lines from current UTF-8 text, preferring the editor buffer. Read this tool before editing; an absent-file result permits proposing creation.",
    inputSchema: schema({ path: pathSchema, startLine: { type: "integer", minimum: 1 }, endLine: { type: "integer", minimum: 1 } }, ["path"]) },
  { name: "search_files", kind: "read", description: "Search eligible current text for a case-sensitive literal query, not a regular expression. Results and total file reads are bounded.",
    inputSchema: schema({ query: { type: "string", minLength: 1, maxLength: 2_000 }, pattern: patternSchema }, ["query"]) },
  { name: "edit_file", kind: "edit", description: "Propose one unique exact replacement in a previously read, unchanged file. Creation requires a prior absent-file read and empty oldText. Every edit shows a diff and requires apply-and-save approval for only the target.",
    inputSchema: schema({ path: pathSchema, oldText: { type: "string", maxLength: limits.fileBytes }, newText: { type: "string", maxLength: limits.fileBytes } }, ["path", "oldText", "newText"]) },
  { name: "run_check", kind: "check", description: "With explicit approval and clean buffers, run one existing npm test/check/lint/typecheck/build script, optionally with one safe suffix. Show its actual pre/post lifecycle scripts; no arguments or raw commands are accepted.",
    inputSchema: schema({ script: { type: "string", pattern: scriptPattern.source } }, ["script"]) },
];

type ProblemKind = "input" | "scope" | "file" | "budget" | "inactive" | "sensitive";
class ToolProblem extends Error {
  public constructor(public readonly kind: ProblemKind, message: string) { super(message); }
}
const fail = (kind: ProblemKind, message: string): never => { throw new ToolProblem(kind, message); };
const outcome = (status: PairAgentToolResult["status"], text: string, summary = text): PairAgentToolResult => ({ status, text, summary });
const problemResult = (error: unknown): PairAgentToolResult => {
  if (!(error instanceof ToolProblem)) {
    return outcome("error", "The workspace operation failed. Private filesystem or process details were not shared.");
  }
  return { ...outcome(error.kind === "input" ? "error" : "blocked", error.message),
    ...(error.kind === "sensitive" ? { sensitiveDataDetected: true } : {}) };
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const inputRecord = (name: string, input: unknown): Record<string, unknown> => {
  const definition = definitions.find((candidate) => candidate.name === name);
  if (definition === undefined || !isRecord(input)) { return fail("input", "Unknown workspace tool or invalid arguments."); }
  const properties = definition.inputSchema.properties as Record<string, unknown>;
  const required = definition.inputSchema.required as readonly string[];
  if (Reflect.ownKeys(input).some((key) => typeof key !== "string" || !Object.hasOwn(properties, key) ||
    Object.getOwnPropertyDescriptor(input, key)?.get !== undefined || Object.getOwnPropertyDescriptor(input, key)?.set !== undefined) ||
    required.some((key) => !Object.hasOwn(input, key)) || Object.values(input).some((value) => value === undefined)) {
    return fail("input", "Only the documented tool arguments are accepted.");
  }
  return input;
};
const stringInput = (value: unknown, maximum: number, empty = false): string => {
  if (typeof value !== "string" || (!empty && value.length === 0) || value.length > maximum) {
    return fail("input", "A required text argument is missing, invalid, or exceeds its limit.");
  }
  return value;
};
const protectedSegment = (segment: string): boolean => {
  const lower = segment.toLowerCase();
  return /^(?:\.git|node_modules|\.ssh|\.aws|\.azure|\.gcloud|\.kube|\.gnupg|\.docker|\.npmrc|\.netrc|\.pypirc|\.git-credentials)$/u.test(lower) ||
    lower.startsWith(".env") || /^(?:secrets?|credentials?|keys)(?:\.|$)/u.test(lower) ||
    /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519|private[-_]?key|service[-_]?account|kubeconfig)(?:\.|$)/u.test(lower) ||
    /\.(?:pem|key|p12|pfx|pkcs12|jks|keystore|kdbx|der|crt|cer)$/u.test(lower) ||
    /\.(?:png|jpe?g|gif|webp|ico|bmp|tiff?|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|7z|rar|tar|xz|bz2|exe|dll|so|dylib|wasm|mp[34]|ogg|avi|mov|class|pyc|sqlite|db|bin|vsix)$/u.test(lower);
};
const relativeInput = (value: unknown, glob = false): string => {
  const path = stringInput(value, glob ? 256 : 1_024);
  const segments = path.split("/");
  if (/[\\:%#\p{Cc}\p{Cf}]/u.test(path) || (!glob && /[?*[\]{}]/u.test(path)) ||
    segments.length > 24 || segments.some((segment) => segment === "" || segment === "." || segment === ".." ||
      /[. ]$/u.test(segment) || segment.startsWith("~") || /~\d/u.test(segment) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment))) {
    return fail("input", "Use an unencoded, unambiguous relative path within the selected workspace.");
  }
  if (segments.some(protectedSegment)) { return fail("scope", "Protected repository, dependency, or secret paths are not available to workspace tools."); }
  if (containsSensitiveModelText(path)) { return fail("sensitive", "A path was withheld because it contains sensitive data."); }
  return path;
};
const lineInput = (value: unknown, fallback: number): number => {
  if (value === undefined) { return fallback; }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    return fail("input", "Line numbers must be positive safe integers.");
  }
  return value;
};
const textInput = (text: string): string => {
  if (Buffer.byteLength(text, "utf8") > limits.fileBytes) { return fail("file", "The file or proposed text exceeds the 128 KiB file limit."); }
  if (/\p{Cc}/u.test(text.replace(/[\t\r\n]/gu, "")) || Buffer.from(text, "utf8").toString("utf8") !== text) {
    return fail("file", "Binary or non-UTF-8 content is not available to workspace tools.");
  }
  if (containsSensitiveModelText(text)) { return fail("sensitive", "Content was withheld because sensitive data was detected in the full input."); }
  return text;
};
const nativeKey = (path: string): string => process.platform === "win32" ? normalize(resolve(path)).toLowerCase() : normalize(resolve(path));
const sameUri = (left: vscode.Uri, right: vscode.Uri): boolean => left.scheme === right.scheme &&
  left.authority === right.authority && left.query === right.query && left.fragment === right.fragment &&
  (left.scheme === "file" ? nativeKey(left.fsPath) === nativeKey(right.fsPath) : left.path === right.path);
const missing = (error: unknown): boolean => typeof error === "object" && error !== null && "code" in error &&
  (error.code === "ENOENT" || error.code === "FileNotFound");
const openDocument = (uri: vscode.Uri): vscode.TextDocument | undefined =>
  vscode.workspace.textDocuments.find((document) => !document.isClosed && sameUri(document.uri, uri));

interface Operation {
  readonly signal: AbortSignal;
  assert(): void;
  active(): boolean;
  wait<Value>(action: () => PromiseLike<Value> | Value): Promise<Value>;
  close(): void;
}
interface Inspection {
  readonly uri: vscode.Uri;
  readonly exists: boolean;
  readonly fingerprint: string;
  readonly readFingerprint: string;
  readonly size: number;
  readonly readonly: boolean;
}
interface Snapshot extends Inspection {
  readonly text: string;
  readonly dirty: boolean;
  readonly document?: vscode.TextDocument;
  readonly version?: number;
}
type EditProposal = Parameters<NonNullable<PairWorkspaceToolsOptions["confirmEdit"]>>[0];
type CheckProposal = Parameters<NonNullable<PairWorkspaceToolsOptions["confirmCheck"]>>[0];
const sameSnapshot = (before: Snapshot, after: Snapshot): boolean => before.exists === after.exists &&
  before.fingerprint === after.fingerprint && before.text === after.text && before.dirty === after.dirty &&
  (before.document === undefined || (before.document === after.document && before.version === after.version));
let previewSequence = 0;

const systemExecutable = (name: string): string => join(process.env.SystemRoot ?? "C:\\Windows", "System32", name);
const terminateTree = async (child: ChildProcess): Promise<boolean> => {
  if (child.pid === undefined || !Number.isSafeInteger(child.pid) || child.pid <= 0) {
    try { child.kill("SIGKILL"); } catch { return false; }
    return false;
  }
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, "SIGKILL"); return true; }
    catch { try { child.kill("SIGKILL"); } catch { return false; } return false; }
  }
  return new Promise<boolean>((resolveStopped) => {
    let killer: ChildProcess;
    try {
      killer = spawn(systemExecutable("taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"],
        { shell: false, windowsHide: true, stdio: "ignore" });
    } catch { try { child.kill("SIGKILL"); } finally { resolveStopped(false); } return; }
    let finished = false;
    const finish = (stopped: boolean): void => {
      if (finished) { return; }
      finished = true;
      clearTimeout(timer);
      if (!stopped) { try { child.kill("SIGKILL"); } catch { resolveStopped(false); return; } }
      resolveStopped(stopped);
    };
    const timer = setTimeout(() => { try { killer.kill(); } catch { finish(false); return; } finish(false); }, 2_000);
    timer.unref?.();
    killer.once("error", () => finish(false));
    killer.once("close", (code: number | null) => finish(code === 0));
  });
};
const normalizeCheckOutput = (text: string, root: vscode.Uri): string => {
  let normalized = stripVTControlCharacters(text).replace(/\p{Cf}/gu, "");
  const variants = [...new Set([root.toString(), root.toString(true), root.fsPath,
    root.fsPath.replaceAll("\\", "/"), root.path])].sort((left, right) => right.length - left.length);
  for (const variant of variants) {
    const prefix = variant.length > 1 ? variant.replace(/[\\/]+$/u, "") : variant;
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const expression = new RegExp(`${escaped}([/\\\\]|(?=$|[\\s"'\\x60():]))`, process.platform === "win32" ? "giu" : "gu");
    normalized = normalized.replace(expression, (match: string, separator: string, offset: number, source: string) => {
      const suffix = source.slice(offset + match.length).split(/[\s"'`<>|]/u, 1)[0] ?? "";
      if (/(?:^|[/\\])\.{1,2}(?:[/\\]|$)/u.test(suffix) || suffix.includes("%")) { return match; }
      return separator === "" ? "." : "";
    });
  }
  return normalized;
};
const runNpmProcess = async (root: vscode.Uri, script: string, current: Operation): Promise<PairAgentToolResult> => {
  current.assert();
  const windows = process.platform === "win32";
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/iu.test(key)));
  Object.assign(env, { npm_config_prefix: root.fsPath, npm_config_workspaces: "false", npm_config_include_workspace_root: "true",
    npm_config_ignore_scripts: "false", npm_config_global: "false", npm_config_if_present: "false", NoDefaultCurrentDirectoryInExePath: "1" });
  let child: ChildProcess;
  try {
    child = spawn(windows ? systemExecutable("cmd.exe") : "npm", windows ? ["/d", "/s", "/c", `npm run ${script}`] : ["run", script], {
      cwd: root.fsPath, shell: false, windowsHide: true, detached: !windows, stdio: ["ignore", "pipe", "pipe"], env,
    });
  } catch { return outcome("error", `Could not start npm run ${script}. No process exit code is available.`); }
  return new Promise<PairAgentToolResult>((resolveResult) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    let processError = false;
    let reason: "cancelled" | "timeout" | "output-limit" | undefined;
    let termination: Promise<boolean> | undefined;
    let terminationTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = async (code: number | null, exitSignal: string | null): Promise<void> => {
      if (settled) { return; }
      settled = true;
      clearTimeout(deadline);
      clearTimeout(terminationTimer);
      current.signal.removeEventListener("abort", cancel);
      const stopped = termination === undefined ? undefined : await termination;
      const exit = `Exit code: ${code === null ? "unavailable" : code}${exitSignal === null ? "" : `; signal: ${exitSignal}`}.`;
      if (reason !== undefined || !current.active()) {
        const sensitive = containsSensitiveModelText(normalizeCheckOutput(Buffer.concat(stdout).toString("utf8"), root) +
          "\n" + normalizeCheckOutput(Buffer.concat(stderr).toString("utf8"), root));
        const interrupted = reason === "timeout" ? "the 120-second duration limit was reached"
          : reason === "output-limit" ? "output exceeded 128 KiB" : "cancellation, trust loss, or session replacement stopped the operation";
        const stopState = stopped === false ? " The full process tree could not be confirmed stopped; inspect running processes." : "";
        resolveResult({ ...outcome(reason === "timeout" || reason === "output-limit" ? "error" : "blocked",
          `npm run ${script} was started, then interrupted: ${interrupted}. All output was withheld. ${exit}${stopState}`),
          ...(sensitive ? { sensitiveDataDetected: true } : {}) });
        return;
      }
      if (processError) {
        resolveResult(outcome("error", `npm run ${script} could not complete because the process failed to start or reported an error. ${exit} Private process details were withheld.`));
        return;
      }
      let output: string;
      try {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        const out = normalizeCheckOutput(decoder.decode(Buffer.concat(stdout)), root);
        const err = normalizeCheckOutput(decoder.decode(Buffer.concat(stderr)), root);
        output = `stdout:\n${out || "(empty)"}\nstderr:\n${err || "(empty)"}`;
      } catch {
        resolveResult(outcome("error", `npm run ${script} finished. ${exit} Non-UTF-8 output was withheld.`)); return;
      }
      if (containsSensitiveModelText(output)) {
        resolveResult({ ...outcome("blocked", `npm run ${script} finished. ${exit} All output was withheld because sensitive data was detected before clipping.`), sensitiveDataDetected: true });
        return;
      }
      if (/\p{Cc}/u.test(output.replace(/[\t\r\n]/gu, ""))) {
        resolveResult(outcome("error", `npm run ${script} finished. ${exit} Non-text output was withheld.`)); return;
      }
      const clipped = output.split(/\r\n|\n|\r/u).slice(0, limits.readLines).join("\n").slice(0, limits.resultCharacters);
      resolveResult(outcome(code === 0 && exitSignal === null ? "ok" : "error",
        `npm run ${script}\n${exit}\n${clipped}${clipped.length < output.length ? "\n[Output display clipped after full sensitivity scan.]" : ""}`,
        `Ran npm run ${script}. ${exit}`));
    };
    const stop = (stopReason: NonNullable<typeof reason>): void => {
      if (settled || reason !== undefined) { return; }
      reason = stopReason;
      terminationTimer = setTimeout(() => { void finish(null, null); }, 2_100);
      terminationTimer.unref?.();
      termination = Promise.resolve().then(() => terminateTree(child)).catch(() => false);
    };
    const cancel = (): void => stop("cancelled");
    const capture = (target: Buffer[], chunk: Buffer | string): void => {
      if (settled || reason !== undefined) { return; }
      if (!current.active()) { cancel(); return; }
      const buffer = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      bytes += buffer.byteLength;
      if (bytes > limits.checkOutputBytes) { stop("output-limit"); return; }
      target.push(Buffer.from(buffer));
    };
    const deadline = setTimeout(() => stop("timeout"), limits.checkMilliseconds);
    deadline.unref?.();
    child.stdout?.on("data", (chunk: Buffer | string) => capture(stdout, chunk));
    child.stderr?.on("data", (chunk: Buffer | string) => capture(stderr, chunk));
    child.once("error", () => { processError = true; void finish(null, null); });
    child.once("close", (code: number | null, exitSignal: string | null) => { void finish(code, exitSignal); });
    current.signal.addEventListener("abort", cancel, { once: true });
    if (!current.active()) { cancel(); }
  });
};

export const createPairWorkspaceTools = (options: PairWorkspaceToolsOptions): PairAgentToolbox => {
  const lifetime = new AbortController();
  const snapshots = new Map<string, Snapshot>();
  const previews = new Map<string, string>();
  const previewScheme = `pair-workspace-preview-${++previewSequence}`;
  let previewProvider: vscode.Disposable | undefined;
  let readCount = 0;
  let readBytes = 0;
  let busy = false;

  const assertRoot = (): void => {
    if (lifetime.signal.aborted || !options.isCurrent()) { fail("inactive", "The operation was cancelled or the pairing session was replaced."); }
    if (!vscode.workspace.isTrusted) { fail("inactive", "Workspace trust is required. The operation was stopped."); }
    if (options.rootUri.scheme !== "file" || options.rootUri.authority !== "" || options.rootUri.query !== "" || options.rootUri.fragment !== "") {
      fail("scope", "Only a local file workspace with verifiable filesystem ownership is supported.");
    }
    if (!vscode.workspace.workspaceFolders?.some((folder) => sameUri(folder.uri, options.rootUri)) ||
      !sameUri(vscode.workspace.getWorkspaceFolder(options.rootUri)?.uri ?? vscode.Uri.parse("unowned:/"), options.rootUri)) {
      fail("inactive", "The selected workspace root is no longer available.");
    }
  };
  const operation = (external: AbortSignal): Operation => {
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    external.addEventListener("abort", abort, { once: true });
    lifetime.signal.addEventListener("abort", abort, { once: true });
    if (external.aborted || lifetime.signal.aborted) { abort(); }
    const assert = (): void => {
      if (controller.signal.aborted) { fail("inactive", "The operation was cancelled or the pairing session was replaced."); }
      assertRoot();
    };
    const active = (): boolean => { try { assert(); return true; } catch { return false; } };
    const timer = setInterval(() => { if (!active()) { abort(); } }, 50);
    timer.unref?.();
    return {
      signal: controller.signal, assert, active,
      wait: async <Value>(action: () => PromiseLike<Value> | Value): Promise<Value> => {
        assert();
        let onAbort = (): void => {};
        try {
          const value = await new Promise<Value>((resolveValue, reject) => {
            onAbort = () => reject(new ToolProblem("inactive", "The operation was cancelled or the pairing session was replaced."));
            controller.signal.addEventListener("abort", onAbort, { once: true });
            Promise.resolve(action()).then(resolveValue, reject);
          });
          assert();
          return value;
        } finally { controller.signal.removeEventListener("abort", onAbort); }
      },
      close: () => {
        clearInterval(timer); external.removeEventListener("abort", abort); lifetime.signal.removeEventListener("abort", abort);
      },
    };
  };
  const ownedUri = (path: string): vscode.Uri => {
    const uri = vscode.Uri.joinPath(options.rootUri, relativeInput(path));
    const owner = vscode.workspace.getWorkspaceFolder(uri);
    if (owner === undefined || !sameUri(owner.uri, options.rootUri)) {
      return fail("scope", "The path is outside the selected root or belongs to a nested workspace root.");
    }
    return uri;
  };
  const inspect = async (path: string | undefined, current: Operation): Promise<Inspection> => {
    current.assert();
    const uri = path === undefined ? options.rootUri : ownedUri(path);
    const chain: string[] = [];
    for (let ancestor = resolve(uri.fsPath);;) {
      chain.unshift(ancestor);
      if (ancestor === dirname(ancestor)) { break; }
      ancestor = dirname(ancestor);
    }
    const fingerprint: string[] = [];
    const readFingerprint: string[] = [];
    let exists = true;
    for (const [index, ancestor] of chain.entries()) {
      const last = index === chain.length - 1;
      let stat;
      try { stat = await current.wait(() => lstat(ancestor)); }
      catch (error) {
        if (missing(error) && last && path !== undefined) { exists = false; break; }
        if (error instanceof ToolProblem) { throw error; }
        return fail("file", "The file or one of its ancestors cannot be inspected safely.");
      }
      if (stat.isSymbolicLink() || (!last || path === undefined ? !stat.isDirectory() : !stat.isFile()) ||
        (last && stat.isFile() && stat.nlink > 1)) {
        return fail("scope", "Symbolic links, reparse redirects, hard-linked files, and unsupported filesystem objects are blocked.");
      }
      const contentIdentity = `${stat.dev}:${stat.ino}${last && path !== undefined ? `:${stat.size}:${stat.mtimeMs}` : ""}`;
      readFingerprint.push(contentIdentity);
      fingerprint.push(`${contentIdentity}${last && path !== undefined ? `:${stat.ctimeMs}` : ""}`);
    }
    const realTarget = exists ? uri.fsPath : dirname(uri.fsPath);
    let resolved: string;
    try { resolved = await current.wait(() => realpath(realTarget)); }
    catch (error) { if (error instanceof ToolProblem) { throw error; } return fail("scope", "The filesystem location cannot be verified safely."); }
    if (nativeKey(resolved) !== nativeKey(realTarget)) { return fail("scope", "Filesystem redirection outside the inspected path is blocked."); }
    let stat: vscode.FileStat;
    try { stat = await current.wait(() => vscode.workspace.fs.stat(uri)); }
    catch (error) {
      if (!exists && missing(error)) {
        current.assert();
        if (path !== undefined) { ownedUri(path); }
        return { uri, exists: false, fingerprint: fingerprint.join("/"), readFingerprint: readFingerprint.join("/"), size: 0, readonly: false };
      }
      if (error instanceof ToolProblem) { throw error; }
      return fail("file", "The file changed or could not be inspected safely.");
    }
    if (!exists || (stat.type & vscode.FileType.SymbolicLink) !== 0 ||
      stat.type !== (path === undefined ? vscode.FileType.Directory : vscode.FileType.File)) {
      return fail("scope", "The target changed or is not a regular, non-symbolic filesystem object.");
    }
    if (!Number.isFinite(stat.size) || stat.size < 0) { return fail("file", "The file size cannot be verified."); }
    current.assert();
    if (path !== undefined) { ownedUri(path); }
    return { uri, exists: true, fingerprint: `${fingerprint.join("/")}:${stat.ctime}:${stat.mtime}:${stat.size}`,
      readFingerprint: `${readFingerprint.join("/")}:${stat.ctime}:${stat.mtime}:${stat.size}`,
      size: stat.size, readonly: ((stat.permissions ?? 0) & vscode.FilePermission.Readonly) !== 0 };
  };
  const consumeRead = (bytes: number): void => {
    if (readCount >= limits.reads || readBytes + bytes > limits.totalReadBytes) { fail("budget", "The workspace tool's total read limit has been reached. Start a new turn to read more."); }
    readCount += 1;
    readBytes += bytes;
  };
  const load = async (path: string, current: Operation, diskOnly = false, retryMetadataDrift = true): Promise<Snapshot> => {
    const before = await inspect(path, current);
    let document = openDocument(before.uri);
    if (!before.exists) {
      if (document !== undefined) { return fail("file", "The absent file has an open buffer. Save or close it before proposing creation."); }
      consumeRead(0);
      return { ...before, text: "", dirty: false };
    }
    if (before.size > limits.fileBytes) { return fail("file", "The file exceeds the 128 KiB file limit."); }
    let text: string;
    if (document !== undefined && !diskOnly) {
      text = document.getText();
      consumeRead(Buffer.byteLength(text, "utf8"));
    } else {
      consumeRead(before.size);
      const bytes = await current.wait(() => vscode.workspace.fs.readFile(before.uri));
      readBytes += Math.max(0, bytes.byteLength - before.size);
      if (bytes.byteLength > limits.fileBytes || readBytes > limits.totalReadBytes) { return fail("budget", "File growth exceeded the bounded read budget; content was withheld."); }
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { return fail("file", "Binary or non-UTF-8 content is not available to workspace tools."); }
      document = openDocument(before.uri);
      if (document !== undefined) {
        if (diskOnly) {
          if (document.isDirty || document.getText() !== text) { return fail("file", "The package buffer differs from disk. Save or reload it before running a check."); }
        } else {
          text = document.getText();
          readBytes += Buffer.byteLength(text, "utf8");
          if (readBytes > limits.totalReadBytes) { return fail("budget", "The workspace tool's total read byte limit has been reached."); }
        }
      }
    }
    const version = document?.version;
    const dirty = document?.isDirty ?? false;
    textInput(text);
    const after = await inspect(path, current);
    if (before.fingerprint !== after.fingerprint || before.exists !== after.exists ||
      openDocument(before.uri) !== document || (document !== undefined && (document.version !== version || document.getText() !== text || document.isDirty !== dirty))) {
      if (retryMetadataDrift && document === undefined && openDocument(before.uri) === undefined &&
        before.exists && after.exists && before.readFingerprint === after.readFingerprint) {
        const repeated = await load(path, current, diskOnly, false);
        if (repeated.exists && repeated.document === undefined && repeated.readFingerprint === after.readFingerprint && repeated.text === text) {
          return repeated;
        }
      }
      return fail("file", "The full file or buffer changed during the read. Read it again before editing.");
    }
    return { ...after, text, dirty, ...(document === undefined ? {} : { document, version: document.version }) };
  };
  const revalidate = async (path: string, before: Snapshot, current: Operation): Promise<Snapshot> => {
    const after = await load(path, current);
    if (!sameSnapshot(before, after)) { return fail("file", "The original full file or buffer version is stale. Read the file again before proposing an edit."); }
    return after;
  };
  const discover = async (pattern: string, current: Operation): Promise<{ paths: string[]; truncated: boolean }> => {
    await inspect(undefined, current);
    const cancellation = new vscode.CancellationTokenSource();
    const cancel = (): void => cancellation.cancel();
    current.signal.addEventListener("abort", cancel, { once: true });
    try {
      const candidates = await current.wait(() => vscode.workspace.findFiles(new vscode.RelativePattern(options.rootUri, pattern),
        "**/{.git,node_modules,.env*,.ssh,.aws,.azure,.gcloud,.kube,.gnupg,.docker,secrets,credentials,keys}/**", limits.candidates, cancellation.token));
      const paths = new Set<string>();
      for (const candidate of candidates.slice(0, limits.candidates)) {
        current.assert();
        if (candidate.scheme !== options.rootUri.scheme || candidate.authority !== options.rootUri.authority ||
          candidate.query !== "" || candidate.fragment !== "") { continue; }
        try {
          const path = relativeInput(relative(options.rootUri.fsPath, candidate.fsPath).split(sep).join("/"));
          const inspected = await inspect(path, current);
          if (inspected.exists && inspected.size <= limits.fileBytes) { paths.add(path); }
        } catch (error) {
          if (!(error instanceof ToolProblem) || error.kind === "inactive") { throw error; }
        }
      }
      return { paths: [...paths].sort(), truncated: candidates.length >= limits.candidates };
    } finally { current.signal.removeEventListener("abort", cancel); cancellation.dispose(); }
  };
  const readFile = async (input: Record<string, unknown>, current: Operation): Promise<PairAgentToolResult> => {
    const path = relativeInput(input.path);
    const start = lineInput(input.startLine, 1);
    const requestedEnd = lineInput(input.endLine, start + limits.readLines - 1);
    if (requestedEnd < start) { return fail("input", "endLine must not precede startLine."); }
    snapshots.delete(path);
    const snapshot = await load(path, current);
    if (!snapshot.exists) {
      snapshots.set(path, snapshot);
      return outcome("ok", `${path} does not exist. Creation requires empty oldText and explicit approval.`, `Observed absence of ${path}.`);
    }
    const lines = snapshot.text.split(/\r\n|\n|\r/u);
    if (start > lines.length) { return fail("input", "startLine is beyond the end of the file."); }
    const end = Math.min(requestedEnd, start + limits.readLines - 1, lines.length);
    const selected = lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join("\n");
    const clipped = end < lines.length || start > 1 || selected.length > limits.resultCharacters;
    snapshots.set(path, snapshot);
    return outcome("ok", `${path}\n${selected.slice(0, limits.resultCharacters)}${clipped ? "\n[Bounded excerpt; additional content is not shown.]" : ""}`,
      `Read ${path}, lines ${start}-${end}${clipped ? " (bounded excerpt)" : ""}.`);
  };
  const searchFiles = async (input: Record<string, unknown>, current: Operation): Promise<PairAgentToolResult> => {
    const query = stringInput(input.query, 2_000);
    if (/\p{Cc}/u.test(query)) { return fail("input", "Search requires a single-line literal query."); }
    textInput(query);
    const found = await discover(input.pattern === undefined ? "**/*" : relativeInput(input.pattern, true), current);
    const matches: string[] = [];
    let scanned = 0;
    let truncated = found.truncated;
    let budgetExhausted = false;
    for (const path of found.paths) {
      let snapshot: Snapshot;
      try { snapshot = await load(path, current); }
      catch (error) {
        if (!(error instanceof ToolProblem) || error.kind === "inactive" || error.kind === "sensitive") { throw error; }
        if (error.kind === "budget") { budgetExhausted = true; truncated = true; break; }
        continue;
      }
      if (!snapshot.exists) { continue; }
      scanned += 1;
      const lines = snapshot.text.split(/\r\n|\n|\r/u);
      for (const [index, line] of lines.entries()) {
        if (!line.includes(query)) { continue; }
        if (matches.length >= limits.searchResults) { truncated = true; continue; }
        matches.push(`${path}:${index + 1}: ${line.slice(0, limits.searchLineCharacters)}${line.length > limits.searchLineCharacters ? " [line clipped]" : ""}`);
      }
    }
    if (scanned === 0 && budgetExhausted) { return fail("budget", "The total file read limit was reached; search could not read more files."); }
    const text = matches.join("\n");
    truncated ||= text.length > limits.resultCharacters;
    return outcome("ok", `${text.slice(0, limits.resultCharacters) || "No literal matches in the eligible files read."}${truncated ? "\n[Search limited by file, result, or read budget.]" : ""}`,
      `Searched ${scanned} eligible files; returned ${matches.length} bounded matches${truncated ? " (limited)" : ""}.`);
  };

  const approveEdit = async (proposal: EditProposal, current: Operation): Promise<boolean> => {
    current.assert();
    previewProvider ??= vscode.workspace.registerTextDocumentContentProvider(previewScheme, {
      provideTextDocumentContent: (uri) => previews.get(uri.toString()) ?? "This edit preview has expired.",
    });
    const previewId = ++previewSequence;
    const beforeUri = vscode.Uri.from({ scheme: previewScheme, path: `/${previewId}/before/${proposal.path}` });
    const afterUri = vscode.Uri.from({ scheme: previewScheme, path: `/${previewId}/after/${proposal.path}` });
    previews.set(beforeUri.toString(), proposal.before);
    previews.set(afterUri.toString(), proposal.after);
    try {
      await current.wait(() => vscode.commands.executeCommand("vscode.diff", beforeUri, afterUri,
        `Pair proposed edit: ${proposal.path}`, { preview: true, preserveFocus: true }));
      if (options.confirmEdit !== undefined) {
        return await current.wait(() => options.confirmEdit!(proposal, current.signal));
      }
      const message = `${proposal.path}: ${proposal.dirty
        ? "This buffer has pre-existing unsaved changes. Applying this proposal will also save ALL of those changes."
        : "This buffer has no pre-existing unsaved changes."} Review the read-only diff. Apply and save ONLY this target file? Other buffers will not be saved.`;
      return await current.wait(() => vscode.window.showWarningMessage(message,
        { modal: false }, "Apply and save", "Skip")) === "Apply and save";
    } finally { previews.delete(beforeUri.toString()); previews.delete(afterUri.toString()); }
  };
  const editFile = async (input: Record<string, unknown>, current: Operation): Promise<PairAgentToolResult> => {
    const path = relativeInput(input.path);
    const oldText = textInput(stringInput(input.oldText, limits.fileBytes, true));
    const newText = textInput(stringInput(input.newText, limits.fileBytes, true));
    const original = snapshots.get(path);
    if (original === undefined) { return fail("file", "Use read_file on the target first, including to confirm a new file is absent."); }
    let before = await revalidate(path, original, current);
    if (before.readonly) { return fail("file", "The target is read-only. No edit was proposed."); }
    if (before.exists && before.document === undefined) {
      await current.wait(() => vscode.workspace.openTextDocument(before.uri));
      before = await revalidate(path, before, current);
      if (before.document === undefined) { return fail("file", "The target buffer could not be opened safely."); }
    }
    let after: string;
    if (!before.exists) {
      if (oldText !== "") { return fail("input", "Creating an observed-absent file requires empty oldText."); }
      after = newText;
    } else if (before.text === "" && oldText === "") {
      after = newText;
    } else {
      const index = before.text.indexOf(oldText);
      if (oldText.length === 0 || index < 0 || before.text.indexOf(oldText, index + 1) >= 0) {
        return fail("file", "oldText must occur exactly once in the previously read, unchanged full buffer.");
      }
      after = before.text.slice(0, index) + newText + before.text.slice(index + oldText.length);
    }
    textInput(after);
    if (before.exists && after === before.text) { return fail("input", "The proposed edit makes no change."); }
    if (!await approveEdit({ path, before: before.text, after, dirty: before.dirty }, current)) {
      return outcome("declined", `Edit to ${path} declined. No edit was applied and nothing was saved.`);
    }
    before = await revalidate(path, before, current);
    if (before.readonly) { return fail("file", "The target became read-only. Nothing was applied."); }
    const workspaceEdit = new vscode.WorkspaceEdit();
    if (!before.exists) {
      workspaceEdit.createFile(before.uri, { overwrite: false, ignoreIfExists: false });
      workspaceEdit.insert(before.uri, new vscode.Position(0, 0), after);
    } else {
      const document = before.document;
      if (document === undefined || document.isClosed || document.version !== before.version || document.getText() !== before.text) {
        return fail("file", "The target buffer changed before applying. Read it again.");
      }
      workspaceEdit.replace(before.uri, new vscode.Range(document.positionAt(0), document.positionAt(before.text.length)), after);
    }
    current.assert();
    ownedUri(path);
    let applied = false;
    let saveAttempted = false;
    try {
      const accepted = await vscode.workspace.applyEdit(workspaceEdit);
      snapshots.delete(path);
      if (!accepted) {
        return outcome("error", `VS Code did not confirm applying the edit to ${path}. ${before.exists ? "The text edit was not applied." : "File creation may have partially occurred; inspect the target."} No save was attempted.`);
      }
      applied = true;
      if (!current.active()) { return outcome("blocked", `Edit applied to ${path}, but not saved: cancellation, trust loss, or session replacement stopped further actions.`); }
      const document = before.document ?? await current.wait(() => vscode.workspace.openTextDocument(before.uri));
      const appliedVersion = document.version;
      await inspect(path, current);
      if (document.isClosed || document.version !== appliedVersion || document.getText() !== after) {
        return outcome("blocked", `Edit applied to ${path}, but not saved: the buffer changed after applying. Inspect and save the target yourself.`);
      }
      current.assert();
      ownedUri(path);
      saveAttempted = true;
      const saved = await document.save();
      if (!saved) { return outcome("error", `Edit applied to ${path}, but not saved: VS Code reported a failed or cancelled save. Inspect the target buffer.`); }
      if (!current.active()) {
        return outcome("blocked", `Edit applied to ${path} and VS Code reported it saved. The operation then stopped because cancellation, trust, or the session changed; no further actions were taken.`);
      }
      const persisted = document.isClosed ? await load(path, current, true) : undefined;
      if (persisted !== undefined && !persisted.exists) {
        return outcome("error", `Edit applied to ${path} and VS Code reported it saved, but the target no longer exists. The approved saved content could not be confirmed.`);
      }
      const savedText = persisted?.text ?? document.getText();
      if (document.isDirty || savedText !== after) {
        return outcome("error", `Edit applied to ${path} and VS Code reported it saved, but save participants or concurrent changes altered the approved buffer. Read the target again; it may have new unsaved changes.`);
      }
      return outcome("ok", `Edit applied and saved to ${path}. Only the target file was saved.`, `Applied and saved ${path}.`);
    } catch (error) {
      const status = error instanceof ToolProblem && error.kind === "inactive" ? "blocked" : "error";
      if (applied) {
        return outcome(status, `Edit applied to ${path}, but ${saveAttempted ? "saving failed or could not be confirmed" : "not saved"}. Inspect the target buffer; no other files were saved.`);
      }
      return outcome("error", `VS Code did not confirm applying the edit to ${path}. Inspect the target for partial changes. No save was attempted.`);
    }
  };
  const cleanBuffers = (): void => {
    if (vscode.workspace.textDocuments.some((document) => !document.isClosed && document.isDirty)) {
      fail("file", "Save or close dirty workspace buffers before running a check. No buffers were saved and no check was started.");
    }
  };
  const checkPackage = async (script: string, current: Operation): Promise<{ snapshot: Snapshot; proposal: CheckProposal }> => {
    const snapshot = await load("package.json", current, true);
    if (!snapshot.exists) { return fail("file", "The selected root has no package.json. No check was run."); }
    let manifest: unknown;
    try { manifest = JSON.parse(snapshot.text); }
    catch { return fail("file", "The selected root's package.json is not valid JSON. No check was run."); }
    if (!isRecord(manifest) || !isRecord(manifest.scripts) || !Object.hasOwn(manifest.scripts, script)) {
      return fail("file", "That exact validation script does not exist in the selected root's package.json.");
    }
    const scripts = manifest.scripts;
    const command = stringInput(scripts[script], 8_192);
    const preCommand = Object.hasOwn(scripts, `pre${script}`) ? stringInput(scripts[`pre${script}`], 8_192, true) : undefined;
    const postCommand = Object.hasOwn(scripts, `post${script}`) ? stringInput(scripts[`post${script}`], 8_192, true) : undefined;
    return { snapshot, proposal: { script, command,
      ...(preCommand === undefined ? {} : { preCommand }), ...(postCommand === undefined ? {} : { postCommand }) } };
  };
  const runCheck = async (input: Record<string, unknown>, current: Operation): Promise<PairAgentToolResult> => {
    const script = stringInput(input.script, 80);
    if (!scriptPattern.test(script)) { return fail("input", "Only an exact test/check/lint/typecheck/build script with an optional safe suffix is allowed. Arguments and raw commands are rejected."); }
    cleanBuffers();
    const before = await checkPackage(script, current);
    cleanBuffers();
    const proposal = before.proposal;
    const approved = options.confirmCheck !== undefined
      ? await current.wait(() => options.confirmCheck!(proposal, current.signal))
      : await current.wait(() => vscode.window.showWarningMessage(`Run npm run ${script}?`, {
        modal: true,
        detail: `Selected workspace root; package.json scripts:\n\npre${script}: ${proposal.preCommand ?? "(not defined)"}\n\n${script}: ${proposal.command}\n\npost${script}: ${proposal.postCommand ?? "(not defined)"}\n\nAll listed lifecycle scripts can execute code, modify files, and access the network. Run for at most 120 seconds? No buffers will be saved automatically.`,
      }, "Run check")) === "Run check";
    if (!approved) { return outcome("declined", `npm run ${script} declined. No check was started.`); }
    cleanBuffers();
    const after = await checkPackage(script, current);
    if (!sameSnapshot(before.snapshot, after.snapshot)) { return fail("file", "package.json changed after approval. Request a new check approval; nothing was run."); }
    cleanBuffers();
    current.assert();
    ownedUri("package.json");
    return runNpmProcess(options.rootUri, script, current);
  };

  return {
    definitions,
    invoke: async (name, value, signal) => {
      if (busy) { return outcome("blocked", "Another workspace tool is still running."); }
      const current = operation(signal);
      busy = true;
      try {
        current.assert();
        const input = inputRecord(name, value);
        if (name === "read_file") { return await readFile(input, current); }
        if (name === "search_files") { return await searchFiles(input, current); }
        if (name === "edit_file") { return await editFile(input, current); }
        if (name === "run_check") { return await runCheck(input, current); }
        if (name === "list_files") {
          const found = await discover(input.pattern === undefined ? "**/*" : relativeInput(input.pattern, true), current);
          const paths: string[] = [];
          let characters = 0;
          for (const path of found.paths) {
            if (paths.length >= limits.listedFiles || characters + path.length + 1 > limits.resultCharacters) { break; }
            paths.push(path);
            characters += path.length + 1;
          }
          return outcome("ok", `${paths.join("\n") || "No eligible files found."}${found.truncated || found.paths.length > paths.length ? "\n[File listing limit reached.]" : ""}`,
            `Listed ${paths.length} eligible workspace-relative files.`);
        }
        return outcome("error", "Unknown workspace tool.");
      } catch (error) { return problemResult(error); }
      finally { busy = false; current.close(); }
    },
    dispose: () => { lifetime.abort(); snapshots.clear(); previews.clear(); previewProvider?.dispose(); },
  };
};
