import { parseDurableJournal, type DurableCommit, type DurableJournal } from "@adaptive-pair/protocol";
import { replayDurableJournal } from "../src/durableReplay.js";
import type {
  DurableEraseResult, DurableReadResult, DurableReceipt, DurableStore, DurableStoreFailure, DurableWriteResult,
} from "../src/durableStore.js";
import type { DurableStoreFault, DurableStoreHarness, DurableStoreOpenOptions } from "./durableStoreConformance.js";

/** Minimal in-memory DurableStore: a content-free control record, one authoritative head, and (via damage only) an orphaned copy. */
interface Medium { control: unknown; payload: string | null; staged: string | null }
interface Control {
  readonly namespaceKey: string;
  readonly state: "present" | "erasing" | "erased";
  readonly generationKey: string;
  readonly retiredGenerationKeys: readonly string[];
  readonly headSequence?: number;
}
type Prepared = DurableReceipt | { readonly journal: DurableJournal; readonly retired: readonly string[]; readonly receipt: DurableReceipt };

class StoreFailure extends Error {
  public constructor(readonly code: DurableStoreFailure) { super(code); }
}
const fail = (code: DurableStoreFailure): never => { throw new StoreFailure(code); };
const failure = (error: unknown): DurableStoreFailure => error instanceof StoreFailure ? error.code
  : error instanceof Error && /LIMIT/u.test(error.message) ? "LIMIT_EXCEEDED" : "INVALID_REQUEST";
const parse = (text: unknown): DurableJournal => {
  const journal = parseDurableJournal(text);
  replayDurableJournal(journal);
  return journal;
};
const receipt = (journal: DurableJournal, commit?: DurableCommit): DurableReceipt => Object.freeze({
  namespaceKey: journal.namespaceKey, generationKey: journal.generationKey, commitKey: commit?.commitKey ?? null,
  headSequence: commit === undefined ? 0 : commit.expectedSequence + commit.facts.length,
});
const frozen = <T>(value: T): Promise<T> => Promise.resolve(Object.freeze(value));

class ReferenceDurableStore implements DurableStore {
  private fault: DurableStoreFault | undefined;
  private readonly namespaceKey: string;

  public constructor(private readonly medium: Medium, namespaceKey: string, private readonly options: DurableStoreOpenOptions) {
    this.namespaceKey = options.namespaceKey ?? namespaceKey;
    this.fault = options.fault;
  }

  public load(): Promise<DurableReadResult> {
    try {
      const control = this.control();
      if (control === null) return frozen({ status: "empty" });
      return frozen(control.state === "erased" ? { status: "erased", generationKey: control.generationKey }
        : { status: "present", text: JSON.stringify(this.head(control)) });
    } catch {
      return frozen({ status: "blocked" });
    }
  }

  public create(text: string, expectedGenerationKey: string | null): Promise<DurableWriteResult> {
    return this.write("create", () => {
      const control = this.control();
      if (control?.state === "present") return fail("HEAD_CONFLICT");
      if (expectedGenerationKey !== (control?.generationKey ?? null)) return fail("GENERATION_CONFLICT");
      const journal = parse(text);
      if (journal.namespaceKey !== this.namespaceKey) return fail("BINDING_MISMATCH");
      if (journal.commits.length !== 0) return fail("INVALID_REQUEST");
      const retired = control === null ? [] : [...control.retiredGenerationKeys, control.generationKey];
      return retired.includes(journal.generationKey) ? fail("GENERATION_CONFLICT") : { journal, retired, receipt: receipt(journal) };
    });
  }

  public append(generationKey: string, commit: DurableCommit): Promise<DurableWriteResult> {
    let request: DurableCommit;
    try {
      const envelope = { format: "adaptive-pair-durable", version: 1, namespaceKey: this.namespaceKey, generationKey,
        createdAt: 0, expiresAt: 1, headSequence: 0, commits: [commit] };
      request = parseDurableJournal(JSON.stringify(envelope)).commits[0] ?? fail("INVALID_REQUEST");
    } catch (error) {
      return frozen({ status: "not-committed", code: failure(error) });
    }
    return this.write("append", () => {
      const control = this.control();
      if (control?.state !== "present" || control.generationKey !== generationKey) return fail("GENERATION_CONFLICT");
      const journal = this.head(control);
      const previous = journal.commits.find(candidate => candidate.commitKey === request.commitKey);
      if (previous !== undefined) {
        return JSON.stringify(previous) === JSON.stringify(request) ? receipt(journal, previous) : fail("IDENTITY_CONFLICT");
      }
      if (journal.commits.some(prior => prior.commandKeys.some(key => request.commandKeys.includes(key)))) {
        return fail("IDENTITY_CONFLICT");
      }
      if (request.expectedSequence !== journal.headSequence) return fail("HEAD_CONFLICT");
      const next = parse(JSON.stringify({
        ...journal, headSequence: journal.headSequence + request.facts.length, commits: [...journal.commits, request],
      }));
      return { journal: next, retired: control.retiredGenerationKeys, receipt: receipt(next, request) };
    });
  }

  public async erase(generationKey: string): Promise<DurableEraseResult> {
    try {
      await this.options.pause?.("erase");
      const control = this.control(true);
      if (control?.generationKey !== generationKey) return fail("GENERATION_CONFLICT");
      const fence = { namespaceKey: this.namespaceKey, generationKey, retiredGenerationKeys: control.retiredGenerationKeys };
      this.medium.control = Object.freeze({ ...fence, state: "erasing" });
      if (this.take("after-publication")) return frozen({ status: "indeterminate" });
      if (this.take("during-cleanup")) return frozen({ status: "cleanup-pending" });
      this.medium.payload = this.medium.staged = null;
      this.medium.control = Object.freeze({ ...fence, state: "erased" });
      return frozen({ status: this.take("after-erased-publication") ? "indeterminate" : "erased" });
    } catch (error) {
      return frozen({ status: "not-erased", code: failure(error) });
    }
  }

  private async write(operation: "create" | "append", prepare: () => Prepared): Promise<DurableWriteResult> {
    try {
      await this.options.pause?.(operation);
      const prepared = prepare();
      if (!("journal" in prepared)) return await frozen({ status: "committed", receipt: prepared });
      if (this.take("before-head-publication")) return await frozen({ status: "indeterminate" });
      const text = JSON.stringify(prepared.journal);
      this.medium.control = Object.freeze({
        namespaceKey: this.namespaceKey, state: "present", generationKey: prepared.journal.generationKey,
        retiredGenerationKeys: Object.freeze([...prepared.retired]), headSequence: prepared.journal.headSequence,
      });
      this.medium.payload = text;
      return await frozen(this.take("after-publication") ? { status: "indeterminate" } : { status: "committed", receipt: prepared.receipt });
    } catch (error) {
      return frozen({ status: "not-committed", code: failure(error) });
    }
  }

  /** Reads the closed control record; unless erasing, an unresolved fence or orphaned copy blocks. */
  private control(erasing = false): Control | null {
    const raw = this.medium.control as Partial<Control> | null;
    const orphaned = this.medium.payload !== null || this.medium.staged !== null;
    if (raw === null) return orphaned && !erasing ? fail("HEAD_CONFLICT") : null;
    if (typeof raw !== "object" || Object.keys(raw).length !== (raw.state === "present" ? 5 : 4) ||
        !["present", "erasing", "erased"].includes(raw.state ?? "") || !Array.isArray(raw.retiredGenerationKeys)) {
      return fail("HEAD_CONFLICT");
    }
    if (raw.namespaceKey !== this.namespaceKey) return fail("BINDING_MISMATCH");
    if (!erasing && (raw.state === "erasing" || (raw.state === "erased" && orphaned))) return fail("ERASURE_PENDING");
    return raw as Control;
  }

  /** Never falls back: the published head must replay completely and match the control record. */
  private head(control: Control): DurableJournal {
    let journal: DurableJournal;
    try {
      journal = parse(this.medium.payload);
    } catch {
      return fail("HEAD_CONFLICT");
    }
    if (journal.namespaceKey !== this.namespaceKey) return fail("BINDING_MISMATCH");
    return journal.generationKey === control.generationKey && journal.headSequence === control.headSequence
      ? journal : fail("HEAD_CONFLICT");
  }

  private take(point: DurableStoreFault): boolean {
    const hit = this.fault === point;
    if (hit) this.fault = undefined;
    return hit;
  }
}

export const referenceDurableStoreHarness = (namespaceKey: string): DurableStoreHarness => {
  const medium: Medium = { control: null, payload: null, staged: null };
  return {
    open: (options = {}) => new ReferenceDurableStore(medium, namespaceKey, options),
    persisted: () => JSON.stringify(medium),
    damage: damage => {
      if (damage.kind === "missing control") medium.control = null;
      else if (damage.kind === "corrupt control") medium.control = "corrupt";
      else if (damage.kind === "control field") medium.control = { ...medium.control as object, extra: damage.text };
      else if (damage.kind === "head text") medium.payload = damage.text;
      else medium.staged = damage.text;
    },
  };
};
