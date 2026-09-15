import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";

export interface JournalEvent {
  readonly type: string;
  readonly capturedAt: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface JournalRecord {
  readonly seq: number;
  readonly prevHash: string;
  readonly hash: string;
  readonly event: JournalEvent;
}

export interface JournalFileSystem {
  ensureDir(dir: string): Promise<void>;
  readFile(path: string): Promise<string | undefined>;
  writeFile(path: string, data: string): Promise<void>;
  fsync(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export type JournalIntegrityReason =
  | "sequence"
  | "hash"
  | "parse"
  | "privacy";

export class JournalIntegrityError extends Error {
  public constructor(
    public readonly reason: JournalIntegrityReason,
    message: string,
  ) {
    super(message);
    this.name = "JournalIntegrityError";
  }
}

const GENESIS_HASH = "";
const MAX_SERIALIZED_STRING = 500;
const POSIX_ABSOLUTE_PATH =
  /(?:^|[^\p{L}\p{N}._~/])\/(?:$|(?!\/)\S+)/u;
const POSIX_NETWORK_PATH =
  /(?:^|[\s"'(<=[{,;])\/{2,}[^\s/]+/u;
const LOCAL_FILE_URI =
  /(?:^|[^\p{L}\p{N}+.-])file:(?=\S)/iu;
const WINDOWS_DRIVE_PATH =
  /(?:^|[^\p{L}\p{N}._~])[A-Za-z]:[\\/]/u;
const WINDOWS_NETWORK_PATH =
  /(?:^|[^\p{L}\p{N}._~\\])\\\\[^\\\s]+\\/u;

const containsAbsolutePath = (value: string): boolean =>
  POSIX_ABSOLUTE_PATH.test(value) ||
  POSIX_NETWORK_PATH.test(value) ||
  LOCAL_FILE_URI.test(value) ||
  WINDOWS_DRIVE_PATH.test(value) ||
  WINDOWS_NETWORK_PATH.test(value);

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, nested]) => [key, canonicalize(nested)] as const);
    return Object.fromEntries(entries);
  }

  return value;
};

const canonicalJson = (event: JournalEvent): string =>
  JSON.stringify(canonicalize(event));

const chainHash = (prevHash: string, seq: number, event: JournalEvent): string =>
  createHash("sha256")
    .update(`${prevHash}\n${seq}\n${canonicalJson(event)}`)
    .digest("hex");

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isJournalEvent = (value: unknown): value is JournalEvent =>
  isJsonObject(value) &&
  typeof value.type === "string" &&
  typeof value.capturedAt === "number" &&
  Number.isFinite(value.capturedAt) &&
  isJsonObject(value.payload);

const assertSerializable = (value: unknown): void => {
  if (typeof value === "string") {
    if (value.length > MAX_SERIALIZED_STRING) {
      throw new JournalIntegrityError(
        "privacy",
        "Refusing to serialize text longer than 500 characters.",
      );
    }
    if (/[\n\r\0]/u.test(value)) {
      throw new JournalIntegrityError(
        "privacy",
        "Refusing to serialize multi-line or binary content.",
      );
    }
    if (containsAbsolutePath(value)) {
      throw new JournalIntegrityError(
        "privacy",
        "Refusing to serialize an absolute path.",
      );
    }
    return;
  }

  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new JournalIntegrityError(
          "privacy",
          "Refusing to serialize a sparse array.",
        );
      }
      assertSerializable(value[index]);
    }
    return;
  }

  if (value !== null && typeof value === "object") {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new JournalIntegrityError(
        "privacy",
        "Refusing to serialize a non-plain object.",
      );
    }

    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      assertSerializable(key);
      assertSerializable(nested);
    }
    return;
  }

  throw new JournalIntegrityError(
    "privacy",
    "Refusing to serialize non-JSON data.",
  );
};

export class LocalJournal {
  private readonly journalPath: string;
  private readonly tempPath: string;
  private tail: Promise<unknown> = Promise.resolve();

  public constructor(
    private readonly fs: JournalFileSystem,
    private readonly directory: string,
  ) {
    this.journalPath = `${directory}/journal.jsonl`;
    this.tempPath = `${this.journalPath}.tmp`;
  }

  public append(event: JournalEvent): Promise<void> {
    return this.enqueue(async () => {
      assertSerializable(event);
      const normalizedEvent = canonicalize(event) as JournalEvent;

      const records = await this.readRecords();
      const previous = records.at(-1);
      const seq = (previous?.seq ?? 0) + 1;
      const prevHash = previous?.hash ?? GENESIS_HASH;
      const record: JournalRecord = {
        seq,
        prevHash,
        hash: chainHash(prevHash, seq, normalizedEvent),
        event: normalizedEvent,
      };

      const serialized = [...records, record]
        .map(entry => JSON.stringify(entry))
        .join("\n");

      await this.fs.ensureDir(this.directory);
      await this.fs.writeFile(this.tempPath, `${serialized}\n`);
      await this.fs.fsync(this.tempPath);
      await this.fs.rename(this.tempPath, this.journalPath);
    });
  }

  public replay(): Promise<readonly JournalEvent[]> {
    return this.enqueue(async () =>
      (await this.readRecords()).map(record => record.event),
    );
  }

  public load(): Promise<readonly JournalRecord[]> {
    return this.enqueue(() => this.readRecords());
  }

  /**
   * Delete the persisted journal (and any temp file) so disabling Pair
   * Presence clears local continuity. A missing file is not an error.
   */
  public clear(): Promise<void> {
    return this.enqueue(async () => {
      await this.fs.remove(this.tempPath);
      await this.fs.remove(this.journalPath);
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.tail.then(operation, operation);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async readRecords(): Promise<readonly JournalRecord[]> {
    const raw = await this.fs.readFile(this.journalPath);
    if (raw === undefined || raw.trim().length === 0) {
      return [];
    }

    const records: JournalRecord[] = [];
    let prevHash = GENESIS_HASH;
    let expectedSeq = 1;

    for (const line of raw.split("\n")) {
      if (line.trim().length === 0) {
        continue;
      }

      const record = this.parse(line);

      if (record.seq !== expectedSeq) {
        throw new JournalIntegrityError(
          "sequence",
          `Journal sequence mismatch: expected ${expectedSeq}, found ${record.seq}.`,
        );
      }

      if (record.prevHash !== prevHash) {
        throw new JournalIntegrityError(
          "hash",
          "Journal chain broken: previous hash does not match.",
        );
      }

      if (record.hash !== chainHash(prevHash, record.seq, record.event)) {
        throw new JournalIntegrityError(
          "hash",
          "Journal chain broken: event hash does not verify.",
        );
      }

      records.push(record);
      prevHash = record.hash;
      expectedSeq += 1;
    }

    return records;
  }

  private parse(line: string): JournalRecord {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new JournalIntegrityError("parse", "Journal line is not valid JSON.");
    }

    if (
      value === null ||
      typeof value !== "object" ||
      typeof (value as JournalRecord).seq !== "number" ||
      typeof (value as JournalRecord).prevHash !== "string" ||
      typeof (value as JournalRecord).hash !== "string" ||
      !isJournalEvent((value as JournalRecord).event)
    ) {
      throw new JournalIntegrityError("parse", "Journal record is malformed.");
    }

    assertSerializable((value as JournalRecord).event);
    return value as JournalRecord;
  }
}

export class NodeJournalFileSystem implements JournalFileSystem {
  public async ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  public async readFile(path: string): Promise<string | undefined> {
    try {
      return await readFile(path, "utf8");
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return undefined;
      }
      throw error;
    }
  }

  public async writeFile(path: string, data: string): Promise<void> {
    await writeFile(path, data, "utf8");
  }

  public async fsync(path: string): Promise<void> {
    const handle = await open(path, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  public async rename(from: string, to: string): Promise<void> {
    await rename(from, to);
  }

  public async remove(path: string): Promise<void> {
    await rm(path, { force: true });
  }
}
