import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";

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
const ABSOLUTE_PATH = /(^|[\s"'(=[])(?:\/(?:[^/\s"')\]]+\/){1,}|[A-Za-z]:[\\/])/u;

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
    if (ABSOLUTE_PATH.test(value)) {
      throw new JournalIntegrityError(
        "privacy",
        "Refusing to serialize an absolute path.",
      );
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const nested of value) {
      assertSerializable(nested);
    }
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      assertSerializable(nested);
    }
  }
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

      const records = await this.readRecords();
      const previous = records.at(-1);
      const seq = (previous?.seq ?? 0) + 1;
      const prevHash = previous?.hash ?? GENESIS_HASH;
      const record: JournalRecord = {
        seq,
        prevHash,
        hash: chainHash(prevHash, seq, event),
        event,
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
      typeof (value as JournalRecord).event !== "object"
    ) {
      throw new JournalIntegrityError("parse", "Journal record is malformed.");
    }

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
}
