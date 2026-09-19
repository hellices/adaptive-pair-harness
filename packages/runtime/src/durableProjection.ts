import {
  durableJournalLimits, parseDurableJournal, type DurableFact, type PairEvent, type PairRuntimeSnapshot,
} from "@adaptive-pair/protocol";
import { reduce } from "@adaptive-pair/session-core";
import {
  candidateSourceIds, DurableProjectionError, failProjection, ProjectionIdentities,
  requireCandidateCommandGroups, requireFrozenSource,
  type CandidateSignature,
} from "./durableProjectionIdentity.js";
import {
  applyBindingChange, bindProjectionBirth, cloneProjectionBindings, projectionFacts, readProjectionView,
  type ProjectionBindingChange, type ProjectionBindings, type ProjectionView,
} from "./durableProjectionView.js";
import type {
  DurableKeyIssuer, DurableProjection, DurableProjectionResolution, DurableProjector,
} from "./durableTypes.js";

type AppendProjection = Extract<DurableProjection, { kind: "append" }>;
interface ProjectionFrame {
  readonly epoch: number;
  readonly sequence: number;
  readonly liveRevision: number;
  readonly workspaceId: string | undefined;
  readonly bindings: ProjectionBindings;
  readonly view: ProjectionView;
}
interface CandidateRecord {
  readonly signature: CandidateSignature;
  readonly projection: AppendProjection;
  readonly baseEpoch: number;
  readonly liveRevision: number;
  readonly workspaceId: string;
  readonly view: ProjectionView;
  readonly changes: readonly ProjectionBindingChange[];
  status: "pending" | "committed" | "not-committed";
}
interface PendingCandidate { readonly record: CandidateRecord; readonly frame: ProjectionFrame }

const omitted = Object.freeze({ kind: "omitted" } as const);
const erased = Object.freeze({ kind: "erase" } as const);
const initialFrame = (): ProjectionFrame => ({
  epoch: 0, sequence: 0, liveRevision: 0, workspaceId: undefined,
  bindings: new Map(), view: Object.freeze({ presence: "off", session: null }),
});

class CandidateProjector implements DurableProjector {
  readonly #issuer: DurableKeyIssuer;
  #frame = initialFrame();
  #pending: PendingCandidate | undefined;
  #identities = new ProjectionIdentities();
  readonly #commands = new Map<string, CandidateRecord>();
  readonly #records = new Map<string, CandidateRecord>();
  readonly #issued = new Set<string>();
  #facts = 0;
  #sourceEvents = 0;
  #retired = false;

  constructor(issuer: DurableKeyIssuer) { this.#issuer = issuer; }

  project(previous: PairRuntimeSnapshot, events: readonly PairEvent[], expectedSequence: number): DurableProjection {
    try {
      return this.#project(previous, events, expectedSequence);
    } catch (error) {
      if (error instanceof DurableProjectionError) throw error;
      return failProjection("INVALID_CANDIDATE");
    }
  }

  #project(previous: PairRuntimeSnapshot, events: readonly PairEvent[], expectedSequence: number): DurableProjection {
    if (!Number.isSafeInteger(expectedSequence) || expectedSequence < 0 || Object.is(expectedSequence, -0)) {
      return failProjection("INVALID_SEQUENCE");
    }
    if (events.length > durableJournalLimits.facts) return failProjection("LIMIT_EXCEEDED");
    const offIndex = events.findIndex(event => event.type === "PresenceChanged" && event.status === "off");
    if (this.#retired && offIndex < 0) return failProjection("PROJECTOR_RETIRED");
    if (events.length === 0) return omitted;
    requireFrozenSource(previous);
    requireFrozenSource(events);
    requireCandidateCommandGroups(events);
    if (events.some(event => event.type === "BriefConfirmed")) return failProjection("UNSUPPORTED_EVENT");
    if (offIndex >= 0 && offIndex !== events.length - 1) return failProjection("MIXED_ERASURE");
    if (!Number.isSafeInteger(previous.revision) || previous.revision < 0 || Object.is(previous.revision, -0)) {
      return failProjection("INVALID_CANDIDATE");
    }
    const validated = reduce(previous, events);
    if (offIndex >= 0) {
      this.#retire();
      return erased;
    }
    const commandIds = [...new Set(events.map(event => event.commandId))];
    const existing = commandIds.map(key => this.#commands.get(key)).find(record => record !== undefined);
    if (existing !== undefined) return this.#retry(existing, previous, events, expectedSequence);
    if (this.#pending !== undefined) return failProjection("CANDIDATE_PENDING");
    if (expectedSequence !== this.#frame.sequence) return failProjection("SEQUENCE_MISMATCH");
    if (previous.revision < this.#frame.liveRevision ||
        (this.#frame.workspaceId !== undefined && this.#frame.workspaceId !== previous.presence.workspaceId)) {
      return failProjection("PREVIOUS_STATE_MISMATCH");
    }
    const previousView = readProjectionView(previous, this.#frame.bindings);
    if (JSON.stringify(previousView) !== JSON.stringify(this.#frame.view)) return failProjection("PREVIOUS_STATE_MISMATCH");
    const sourceIds = candidateSourceIds(previous, events);
    this.#identities.checkStrings(sourceIds);
    return this.#prepare(previous, events, validated, commandIds, sourceIds);
  }

  #issue(staged: Set<string>): string {
    let key: string;
    try { key = this.#issuer.next(); } catch { return failProjection("KEY_ISSUER_FAILED"); }
    if (typeof key !== "string" || !/^[0-9a-f]{32}$/u.test(key)) return failProjection("INVALID_KEY");
    if (this.#issued.has(key) || staged.has(key)) return failProjection("KEY_COLLISION");
    if (this.#issued.size + staged.size >= durableJournalLimits.facts + durableJournalLimits.commits + durableJournalLimits.commandKeys) {
      return failProjection("LIMIT_EXCEEDED");
    }
    staged.add(key);
    return key;
  }

  #prepare(
    previous: PairRuntimeSnapshot, events: readonly PairEvent[], validated: PairRuntimeSnapshot,
    commandIds: readonly string[], sourceIds: readonly string[],
  ): DurableProjection {
    const bindings = cloneProjectionBindings(this.#frame.bindings);
    const stagedKeys = new Set<string>();
    const changes: ProjectionBindingChange[] = [];
    const facts: DurableFact[] = [];
    let live = previous;
    let view = this.#frame.view;
    for (const event of events) {
      const next = reduce(live, [event]);
      const change = bindProjectionBirth(bindings, next, event, () => this.#issue(stagedKeys));
      if (change !== undefined) {
        applyBindingChange(bindings, change);
        changes.push(Object.freeze(change));
      }
      const nextView = readProjectionView(next, bindings);
      facts.push(...projectionFacts(view, nextView));
      live = next;
      view = nextView;
    }
    if (facts.length === 0) return omitted;
    if (this.#facts + facts.length > durableJournalLimits.facts ||
        this.#records.size >= durableJournalLimits.commits ||
        this.#commands.size + commandIds.length > durableJournalLimits.commandKeys ||
        this.#sourceEvents + events.length > durableJournalLimits.facts) return failProjection("LIMIT_EXCEEDED");
    const commit = this.#canonicalCommit(facts, commandIds, stagedKeys);
    const projection: AppendProjection = Object.freeze({ kind: "append", commit });
    const record: CandidateRecord = {
      signature: this.#identities.remember(previous, events, this.#frame.sequence), projection,
      baseEpoch: this.#frame.epoch, liveRevision: validated.revision,
      workspaceId: validated.presence.workspaceId, view, changes: Object.freeze(changes), status: "pending",
    };
    this.#identities.retainStrings(sourceIds);
    for (const key of stagedKeys) this.#issued.add(key);
    for (const sourceId of commandIds) this.#commands.set(sourceId, record);
    this.#records.set(commit.commitKey, record);
    this.#facts += facts.length;
    this.#sourceEvents += events.length;
    this.#pending = { record, frame: this.#nextFrame(record, bindings) };
    return projection;
  }

  #canonicalCommit(facts: readonly DurableFact[], commandIds: readonly string[], staged: Set<string>) {
    const key = "0".repeat(32);
    const commit = {
      commitKey: this.#issue(staged), expectedSequence: this.#frame.sequence,
      commandKeys: commandIds.map(() => this.#issue(staged)), facts,
    };
    const journal = parseDurableJournal(JSON.stringify({
      format: "adaptive-pair-durable", version: 1, namespaceKey: key, generationKey: key,
      createdAt: 0, expiresAt: 1, headSequence: this.#frame.sequence + facts.length, commits: [commit],
    }));
    return journal.commits[0] ?? failProjection("INVALID_CANDIDATE");
  }

  #nextFrame(record: CandidateRecord, bindings: ProjectionBindings): ProjectionFrame {
    return {
      epoch: this.#frame.epoch + 1,
      sequence: record.projection.commit.expectedSequence + record.projection.commit.facts.length,
      liveRevision: record.liveRevision, workspaceId: record.workspaceId, bindings, view: record.view,
    };
  }

  #retry(record: CandidateRecord, previous: PairRuntimeSnapshot, events: readonly PairEvent[], expectedSequence: number): DurableProjection {
    if (!this.#identities.matches(record.signature, previous, events, expectedSequence)) return failProjection("COMMAND_REUSE");
    if (record.status === "committed" || this.#pending?.record === record) return record.projection;
    if (this.#pending !== undefined) return failProjection("CANDIDATE_PENDING");
    if (record.baseEpoch !== this.#frame.epoch) return failProjection("STALE_CANDIDATE");
    const bindings = cloneProjectionBindings(this.#frame.bindings);
    for (const change of record.changes) applyBindingChange(bindings, change);
    record.status = "pending";
    this.#pending = { record, frame: this.#nextFrame(record, bindings) };
    return record.projection;
  }

  resolve(commitKey: string, outcome: DurableProjectionResolution): void {
    if (this.#retired) return failProjection("PROJECTOR_RETIRED");
    if (outcome !== "committed" && outcome !== "not-committed" && outcome !== "indeterminate") {
      return failProjection("RESOLUTION_MISMATCH");
    }
    const record = this.#records.get(commitKey);
    if (record === undefined) return failProjection("RESOLUTION_MISMATCH");
    if (record.status === outcome) return;
    if (this.#pending?.record !== record) return failProjection("RESOLUTION_MISMATCH");
    if (outcome === "indeterminate") return;
    if (outcome === "committed") this.#frame = this.#pending.frame;
    record.status = outcome;
    this.#pending = undefined;
  }

  #retire(): void {
    this.#retired = true;
    this.#pending = undefined;
    this.#frame = initialFrame();
    this.#identities = new ProjectionIdentities();
    this.#commands.clear();
    this.#records.clear();
    this.#issued.clear();
    this.#facts = 0;
    this.#sourceEvents = 0;
  }
}

export const createDurableProjector = (issuer: DurableKeyIssuer): DurableProjector => Object.freeze(new CandidateProjector(issuer));
