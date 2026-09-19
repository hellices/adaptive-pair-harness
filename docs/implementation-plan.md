# P2b Minimized Persistence and Restart Contract Implementation Plan

> **Status: pure implementation locally verified; final PR delivery pending.**
> On September 19, 2026, the owner selected the minimized durable-state design,
> reviewed its written boundaries, and then explicitly requested implementation
> and continued progress toward a usable product. This is no longer a
> documentation-only deliverable. The first executable scope is the pure P2b
> contract below; a disk adapter, live admission, and editing are not smuggled
> into it. Product development continues through reviewed increments, with
> merge decisions still belonging to the owner.
>
> **For contributors and agents:** execute one checklist task at a time after
> independent contract review. Observe RED, implement that task, observe GREEN,
> and commit the verified result. Use `superpowers:executing-plans` or an
> equivalent tool-independent test/review loop; optional subagent tooling is
> not a repository dependency. Stop if the design cannot be met, not after
> quietly weakening it. Keep progress here and in Git, not in parallel plans.

**Goal:** Define, construct, replay, and inspect a bounded privacy-minimized
durable history, and specify/test atomic storage and erasure behavior without
persisting data or restoring live authority.

**Architecture:** `protocol` owns a separate closed wire format. `runtime`
constructs allowlisted facts from validated live candidates and privately
replays them into a distinct minimized state. A separate storage port and a
test-only fault model describe publication/deletion semantics. Public inspection
always denies authority and automatic replay; nothing wires these contracts
into the current store, coordinator, or host.

**Tech stack:** Existing TypeScript, Vitest, fast-check, ESLint, and the two
maintained npm graphs. No new package, dependency edge, host API, or external
storage dependency is required.

## Authorization and baseline

- Start from `main` at `133c7a8`, the September 18 merge of P2a PR #11, on the
  dedicated `agents/p2b-persistence-contracts` branch. Its completed plan remains
  at `133c7a8:docs/implementation-plan.md`; this deliberately replaces it.
- The owner chose a dedicated minimized event/snapshot contract instead of
  a warning-only memo, then approved using the written design for a plan/PR.
  A subsequent explicit instruction expanded the work to actual development.
- [Design section 13.2](design.md#132-p2b-persistence-and-restart-contracts)
  is the contract, not the superseded broad persistence paragraph or the v1
  archive. [Planning evidence](research.md#p2b-persistence-contract-planning)
  separates repository findings, official API limits, and unmeasured proposals.
- Post-merge main CI **35358366256** passed all four jobs and all 47 actual
  steps. Revalidate the changed branch; a historical green run is not evidence
  for new code, a future dependency, a disk adapter, or power-loss durability.
- This plan does not authorize merging the new PR, changing Stable's Growth-only
  product surface, or implementing an unreviewed ownership/editing transition.

## Global constraints

- Preserve all current commands, 21 v1 events, reducer behavior, `PairStore`,
  `InMemoryJournal`, `PairCoordinator`, bounded-read recovery, and `LocalJournal`.
- Never serialize the current event log, snapshot, operation inputs, diagnostic
  text, resource paths/hashes, free-form summaries, or arbitrary v1 IDs.
- The new format is `format: "adaptive-pair-durable", version: 1`. It is not
  P2a framing and cannot seed or hydrate a live `PairRuntimeSnapshot`.
- All wire fields are closed and explicit. Keys are trusted-issuer 128-bit
  tokens encoded as 32 lowercase hexadecimal characters; format validation
  cannot establish their entropy, origin, or authenticity.
- Limits per generation: 1,048,576 input UTF-16 code units; 1,048,576 encoded
  UTF-8 bytes; 1,024 commits, facts, and distinct command keys. Every commit has
  at least one fact and one command key. Counters/times are safe nonnegative
  integers; default/max lifetime is seven days, locally shorten-able.
- Require complete revision-zero replay. No checkpoint, compaction, migration,
  import, valid-prefix salvage, or cache-only recovery is supported.
- Recorded pending/unknown operations survive close and remain warnings;
  a second outcome cannot overwrite `unknown` or a terminal outcome.
- Reports contain literal `authorityRestored: false` and
  `automaticReplayAllowed: false`. No tool call, grant, current-workspace check,
  recovered read retry, or successful product-verification claim is produced.
- No Node/VS Code imports in production contracts; no disk, listener, timer,
  workspace/model/network activity, host registration, or new public tool.
- A fake storage model proves only model behavior. Filesystem visibility,
  process-crash/power-loss survival, cross-process locking, and physical erasure
  require later provider-specific evidence.
- Inventory every manifest and both lockfiles, including the isolated POC.
  Check direct registry/upstream metadata, peer compatibility, and both audits;
  retain older releases only with explicit reasons, not a blanket freeze.

## File map

| File | Responsibility |
| --- | --- |
| `packages/protocol/src/durableTypes.ts` | Closed facts/envelope, finite limits, operation and assistance enums |
| `packages/protocol/src/durableValidation.ts` | Fixed-code field/token/enum validation; no source-text filtering |
| `packages/protocol/src/parseDurableJournal.ts` | Primitive-text framing, aggregate budgets, detached/frozen parsing |
| `packages/protocol/src/index.ts` | Additive exports; existing exports unchanged |
| `packages/runtime/src/durableTypes.ts` | Minimized replay state and key-issuer/projection contracts |
| `packages/runtime/src/durableProjection.ts` | Explicit v1-candidate allowlist and lifetime-key mapping |
| `packages/runtime/src/durableProjectionView.ts` | Current allowlisted view, lifetime bindings, and complete retained-field differences |
| `packages/runtime/src/durableProjectionIdentity.ts` | Frozen candidate identities, bounded volatile source IDs, and fixed errors |
| `packages/runtime/src/durableReplay.ts` | Private ordered reduction, identities, pending-operation retention |
| `packages/runtime/src/durableSnapshot.ts` | Private full-replay snapshot derivation and canonical cache comparison |
| `packages/runtime/src/durableRecovery.ts` | Public expected-binding/time checks, derived cache, non-authorizing report |
| `packages/runtime/src/durableRecoveryTypes.ts` | Closed assessment variants with literal-false authority flags |
| `packages/runtime/src/durableStore.ts` | Separate port types, complete/indeterminate outcomes and erasure receipts |
| `packages/runtime/src/index.ts` | Additive public contracts; no live-store wiring |
| `packages/protocol/test/durableJournal.test.ts` | Format/privacy/budget/immutability/error tests |
| `packages/runtime/test/durableFixtures.ts` | Synthetic safe keys, complete histories, trusted candidate builders |
| `packages/runtime/test/durableProjection.test.ts` | All 21 source routes, omitted-field canaries, key provenance/lifetimes |
| `packages/runtime/test/durableReplay.test.ts` | Sequence, identity, lifetime, reference, outcome and cache cases |
| `packages/runtime/test/durableRecovery.test.ts` | Identity/clock/expiry/failure isolation and denied authority |
| `packages/runtime/test/durableStoreModel.ts` | Test-only single-namespace publication/erasure model with injected faults |
| `packages/runtime/test/durableStoreState.ts` | Closed versioned controls, retained-copy bounds, and authoritative reads |
| `packages/runtime/test/durableStorePreparation.ts` | Validated full-head staging, original receipts, and retirement capacity |
| `packages/runtime/test/durableStoreRequest.ts` | Descriptor-safe closed request copying and bounded encoding before serialization |
| `packages/runtime/test/durableStoreFixtures.ts` | Shared-medium schedules and cold reconstruction without filesystem effects |
| `packages/runtime/test/durableStore*.test.ts` | Eight suites covering conformance, concurrency, corruption, deletion, framing, request bounds, and retained capacity |

Split a helper or test by responsibility if needed to retain the existing
400-line source/100-line-function and 600-line-test/200-line-function gates;
do not exempt a file or weaken lint to fit this plan. Existing host, live-store,
coordinator, reducer, command/event schema, and contribution behavior remain
unchanged. Development-runner version maintenance is recorded separately.

## Task 1: Closed minimized wire contract

**Consumes:** existing finite protocol enums, not v1 payload serializers.
**Produces:** `DurableFact`, `DurableCommit`, `DurableJournal`,
`durableJournalLimits`, and `parseDurableJournal(unknown): DurableJournal`.

The envelope and commit declarations are exact proposed interfaces:

```ts
export interface DurableCommit {
  readonly commitKey: string;
  readonly expectedSequence: number;
  readonly commandKeys: readonly string[];
  readonly facts: readonly DurableFact[];
}

export interface DurableJournal {
  readonly format: "adaptive-pair-durable";
  readonly version: 1;
  readonly namespaceKey: string;
  readonly generationKey: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly headSequence: number;
  readonly commits: readonly DurableCommit[];
}

export const durableJournalLimits = Object.freeze({
  textCodeUnits: 1_048_576,
  encodedBytes: 1_048_576,
  commits: 1_024,
  facts: 1_024,
  commandKeys: 1_024,
  lifetimeMs: 7 * 24 * 60 * 60 * 1_000,
});
```

Every fact has exactly `type` and its row's fields, with no event/command ID,
actor, runtime revision, authority epoch, source text, or catch-all property:

| Type | Payload and validation |
| --- | --- |
| `PresenceRecorded` | `status`: observing/engaged/quiet/paused; off requires erasure instead |
| `SessionOpened` | `sessionKey`: fresh token; implicit briefing status |
| `SessionStatusRecorded` | `sessionKey`, `status`: existing session enum except inactive |
| `LearningBoundaryRecorded` | `sessionKey`, `humanOwnedCapabilities`: distinct existing capability enums, `maximumHintLevel`: integer 0–5 |
| `ModeRecorded` | `sessionKey`, `mode`: growth/pair/delivery |
| `WorkUnitOpened` | `sessionKey`, `workUnitKey`, `mode`, `owner`: human/ai, `learningValue`: high/mixed/low, `capability`: existing enum; implicit proposed status |
| `WorkUnitStatusRecorded` | `sessionKey`, `workUnitKey`, `status`: existing work-unit enum |
| `AssistanceRecorded` | `sessionKey`, `workUnitKey`, `attempt` and `hypothesis`: none/recorded/bypassed, `hintLevel`: null or integer 0–5, `solutionRevealed`: boolean |
| `OperationOpened` | `sessionKey`, `workUnitKey`, `operationKey`, `kind`: read/edit/check, `status`: planned/authorized/started |
| `OperationOutcomeRecorded` | `sessionKey`, `operationKey`, `status`: confirmed/failed/declined/cancelled/unknown |

- [x] Add this RED seed before production exports exist:

  ```ts
  import { describe, expect, it } from "vitest";
  import { parseDurableJournal } from "../src/index.js";

  describe("minimized durable journal", () => {
    it("parses a detached empty generation without granting authority", () => {
      const text = JSON.stringify({
        format: "adaptive-pair-durable", version: 1,
        namespaceKey: "1".repeat(32), generationKey: "2".repeat(32),
        createdAt: 100, expiresAt: 200, headSequence: 0, commits: [],
      });
      const journal = parseDurableJournal(text);
      expect(journal.headSequence).toBe(0);
      expect(Object.isFrozen(journal)).toBe(true);
      expect(Object.isFrozen(journal.commits)).toBe(true);
    });
  });
  ```

- [x] Run `npx vitest run packages/protocol/test/durableJournal.test.ts` and
  observe the missing-export failure. Do not count a runner/config error as RED.
- [x] Implement the exact type/field table and primitive-text parser. Bound
  text before JSON parsing; count commits/facts/command keys before per-fact
  work. Validate UTF-8 byte length without Node APIs. Reject unknown versions,
  missing/extra keys, invalid tokens/enums, invalid times/TTL, empty batches,
  and noninteger/unsafe/negative-zero counters. Deep-freeze newly parsed data.
- [x] Use `Invalid Pair durable journal:` with fixed codes `INVALID_TEXT`,
  `TEXT_LIMIT`, `BYTE_LIMIT`, `INVALID_JSON`, `UNSUPPORTED_VERSION`,
  `INVALID_ENVELOPE`, `INVALID_COMMIT`, `INVALID_FACT`, and `LIMIT_EXCEEDED`.
  Catch internal parsing failures without publishing payloads or causes.
- [x] Add table-driven positive cases for every fact and negative mutations of
  every field; exact lower/upper bounds and one-over cases; nulls, boxed strings,
  hostile objects not inspected as text, unsafe keys, nonfinite numbers, negative
  zero rejection, nested freezing, and arbitrary sensitive extra-field canaries.
  Schema-valid framing remains distinct from runtime replay consistency.
- [x] Run the new suite, existing event/journal suites, typecheck, and lint.
  Commit: `feat: define closed minimized durable journal framing`.

## Task 2: Exact minimized replay and cache derivation

**Consumes:** Task 1's parsed complete journal.
**Produces:** private `replayDurableJournal(journal): DurableState` and
`createDurableSnapshot(journal): DurableSnapshot` for Task 4. The helper performs
complete replay internally rather than accepting caller-supplied state.

`DurableState` has `headSequence`, `presence` (initially off), and ordered
`sessions`. A session has its token, opened sequence, recorded status, nullable
mode/learning boundary, and work-unit/operation arrays. A work unit has the
allowlisted immutable classification, recorded status, and nullable assistance
flags. An operation has its own/session/work-unit keys, kind, opening sequence,
and recorded status. No omitted v1 field is synthesized. `DurableSnapshot`
contains format/version, namespace/generation, head, and only that state.

- [x] Add the first RED replay test against an internal source import:

  ```ts
  import { expect, it } from "vitest";
  import { parseDurableJournal } from "@adaptive-pair/protocol";
  import { replayDurableJournal } from "../src/durableReplay.js";

  it("replays only the minimized revision-zero state", () => {
    const journal = parseDurableJournal(JSON.stringify({
      format: "adaptive-pair-durable", version: 1,
      namespaceKey: "1".repeat(32), generationKey: "2".repeat(32),
      createdAt: 100, expiresAt: 200, headSequence: 0, commits: [],
    }));
    expect(replayDurableJournal(journal)).toEqual({
      headSequence: 0, presence: "off", sessions: [],
    });
  });
  ```

- [x] Run `npx vitest run packages/runtime/test/durableReplay.test.ts` and
  observe RED. Build protocol exports first when consuming workspace exports.
- [x] Implement full replay with invocation-local maps/sets. Each commit must
  match the preceding head; commit keys and cross-commit command keys must be
  unique; each fact advances sequence by one; the final declared head must
  match. Never return a valid prefix after a later failure.
- [x] Session opening requires a new lifetime key and no unclosed previous
  session. References must name earlier opened entities in their own session.
  Work-unit/operation keys cannot be reused across lifetimes; an operation
  must attach to an earlier work unit. Reject a status update that reopens a
  closed session and reject a second operation outcome, including after unknown.
  Recorded terminal outcomes never erase another pending operation.
- [x] Construct frozen state explicitly. Recording a closed session leaves its
  operations in the history; no phase becomes cancelled because of closure.
  Recorded modes/owners are facts, not permission checks or new live routes.
- [x] Derive a frozen `DurableSnapshot` solely from validated full replay. Its
  canonical JSON representation is the optional cache encoding. Exact cache
  text mismatch is a discarded cache, not an alternate replay seed; canonical
  encoding avoids accepting extra or reordered cache payloads by accident.
- [x] Cover gaps, reordered commits, duplicate IDs, two-command batches,
  dangling/cross-session references, repeated openings, close and later fresh
  session, all pending and terminal phases, unknown overwrite, invalid suffix,
  immutable detached state, and matching/stale/extra-field cache candidates.
- [x] Run replay + protocol + existing P2a runtime suites, typecheck, lint.
  Commit: `feat: replay minimized durable state without live hydration`.

## Task 3: Trusted candidate projection

**Consumes:** a trusted live snapshot and command-admitted event candidate,
existing live reduction, and injected trusted key issuance.
**Produces:** `createDurableProjector(issuer)` with a `project` method returning
one of append, erase, or omitted. It never calls a store or executes an effect.

```ts
export interface DurableKeyIssuer {
  next(): string;
}

export type DurableProjection =
  | { readonly kind: "append"; readonly commit: DurableCommit }
  | { readonly kind: "erase" }
  | { readonly kind: "omitted" };
```

The projector is instance-local to one host-bound generation. `project` takes
the trusted previous live snapshot, the complete candidate event array, and
the expected durable sequence. It privately reduces the candidate; does not
publish live state; and does not accept a generic parsed P2a history as an
import. The issuer supplies fresh valid keys. Maps use separate namespaces
for source command identity, session-start revision, work-unit lifetime, and
operation lifetime; they are never serialized or logged. Repeating the same
candidate returns the same commit/command keys; changed content under a reused
source command is rejected rather than assigned a second identity.

Implementation review identified that a head/revision pair cannot establish
which candidate committed. Keep the three-argument `project` method and add
`resolve(commitKey, outcome)` with the closed outcomes `committed`,
`not-committed`, and `indeterminate`. Only the trusted caller's explicit
resolution of that exact pending key may promote/discard its staged lifetime
bindings. Indeterminate candidates permit only exact retry or erasure; another
candidate cannot infer success from equal counters. This is a pure handshake,
not a storage call or proof that an effect ran.

Retries retain the same deeply frozen previous snapshot and ordered event
objects supplied by the live decider. Weak object identities establish this
in-process candidate identity without serializing or strongly retaining raw
snapshots/events/inputs. Reparsed copies are not an import or an exact retry.
Lifetime bindings instead use session-start, proposal, and authorization
revisions. Omitted batches acquire no durable command receipt. Bound retained
source-identity text by the existing input-code-unit ceiling, conservatively
counting repeated identifiers in distinct prepared candidates, and retained
candidate events, commands, commits, and facts by their generation ceilings;
fail closed rather than evicting retry evidence. A failed preparation publishes
no binding/receipt/reservation changes. Off retires the projector before retry
lookup and clears its volatile tables.

- [x] Add a RED test for the omitted route without requesting any keys:

  ```ts
  import { expect, it } from "vitest";
  import { createRuntime } from "@adaptive-pair/session-core";
  import { createDurableProjector } from "../src/durableProjection.js";

  it("does not allocate durable identity for an empty candidate", () => {
    const projector = createDurableProjector({
      next: () => { throw new Error("unexpected allocation"); },
    });
    expect(projector.project(createRuntime("private-workspace"), [], 0))
      .toEqual({ kind: "omitted" });
  });
  ```

- [x] Run `npx vitest run packages/runtime/test/durableProjection.test.ts`;
  observe the missing-module failure before implementing the factory.
- [x] Implement the complete 21-event mapping in design section 13.2, building
  each payload from its allowed fields. For assistance/status fields use the
  privately reduced state at that event, not the final unrelated work unit.
  `WorkUnitAgreed` emits work-unit/session status and reset assistance.
  Assistance events also emit any session transition to active; resume emits
  needs-reconcile for a nonterminal work unit; entry capture emits a change to
  engaged presence even though its content is omitted. Compare the complete
  allowlisted before/after state at every event, not only its named payload.
- [x] A candidate containing off is an erasure barrier, not an append with a
  retained prefix. Reject a mixed erase-and-reenable candidate rather than
  silently dropping post-disable activity. Unsupported `BriefConfirmed`,
  invalid reduction, missing lifetime mapping, issuer failure/collision, and
  malformed keys fail with fixed codes and no original cause.
- [x] Keep source identity/record comparisons in volatile state only. Treat
  exact retry and a new command distinctly; never hash user content into a
  persisted key. An omitted batch claims no durable command deduplication.
- [x] Verify every source variant, multicommand batches, all omitted strings
  seeded with source/path/credential canaries, grants omitted, no `undefined`
  wire fields, retry identity, mutated retry refusal, session/operation ID reuse
  under new lifetime keys, and no cross-projector/global state. Compare replay
  after each admitted candidate with the allowlisted live reduction, including
  entry capture from quiet, ready-to-active assistance, and pause/resume.
- [x] Run projection, replay, existing runtime/core, and architecture tests;
  force typecheck and lint. Commit: `feat: project privacy-minimized durable facts`.

## Task 4: Storage port and test-only fault model

**Consumes:** closed parsed commits and validated replay; no live runtime.
**Produces:** exported port/request/result types and a test-only conformance
model, not a filesystem store or an application-wired second journal.

```ts
export interface DurableReceipt {
  readonly namespaceKey: string;
  readonly generationKey: string;
  readonly commitKey: string | null;
  readonly headSequence: number;
}

export type DurableWriteResult =
  | { readonly status: "committed"; readonly receipt: DurableReceipt }
  | { readonly status: "not-committed"; readonly code: DurableStoreFailure }
  | { readonly status: "indeterminate" };

export type DurableStoreFailure =
  | "INVALID_REQUEST" | "BINDING_MISMATCH" | "GENERATION_CONFLICT"
  | "HEAD_CONFLICT" | "IDENTITY_CONFLICT" | "LIMIT_EXCEEDED"
  | "ERASURE_PENDING";

export type DurableReadResult =
  | { readonly status: "empty" }
  | { readonly status: "present"; readonly text: string }
  | { readonly status: "erased"; readonly generationKey: string }
  | { readonly status: "blocked" };

export type DurableEraseResult =
  | { readonly status: "erased" }
  | { readonly status: "cleanup-pending" }
  | { readonly status: "indeterminate" }
  | { readonly status: "not-erased"; readonly code: DurableStoreFailure };

export interface DurableStore {
  load(): Promise<DurableReadResult>;
  create(text: string, expectedGenerationKey: string | null): Promise<DurableWriteResult>;
  append(generationKey: string, commit: DurableCommit): Promise<DurableWriteResult>;
  erase(generationKey: string): Promise<DurableEraseResult>;
}
```

The port instance is bound to one trusted namespace by its future adapter.
Creation accepts only a valid empty generation. Null expected generation means
no preceding owned state; replacing an erased generation requires its matching
completed fence, verified absence of retired owned payload copies, and a fresh
key. Pending cleanup or unresolved deletion publication makes load blocked and
rejects both append and create with `ERASURE_PENDING`. Reconstruct this block
from the persisted erasing fence/copies, not a volatile flag. Existing
present/blocked state cannot be overwritten by create. No generic upsert or
auto-create-on-append is permitted.

Independent storage review additionally requires closed, versioned control
framing and bounded preparation before serialization. The test model retains
one payload, one current cache, and at most one abandoned staged candidate;
each copy has the existing one-MiB code-unit/byte ceilings, independently, so
aggregate copy text is at most 3,145,728 code units and bytes. Its content-free
generation fence retains at most 1,024 retired keys without eviction; a
replacement exceeding that capacity fails unchanged while erase remains
available. Enforce the same bounds on cold reconstruction, and reclaim only
after request/head validation and the final excluded generation/head check.
These refine reference-model safety without prescribing a production layout.

- [x] Write the seed test that creates an empty generation, injects a failure
  after authoritative publication but before acknowledgement, and expects
  indeterminate while `load` exposes the complete committed head. Run
  `npx vitest run packages/runtime/test/durableStore.test.ts` and observe RED.
- [x] Add the port types, then a **test-only** model with one authoritative
  namespace record, derived cache copies, an erasure fence, and deterministic
  fault points before publication, after publication, and during cleanup.
  Do not inject testing faults into production `InMemoryJournal`.
- [x] Append validates/stages the entire next log and deduplication state before
  atomic publication. Check current generation before exact-retry lookup.
  Exact retry compares expected head, command keys, and canonical facts;
  return its original receipt. Changed payload, cross-commit command reuse,
  stale head, invalid replay, and retired generation leave the state unchanged.
- [x] Test concurrent schedules at the compare/publish boundary: two writers
  at one head cannot both succeed, erase cannot be undone by a late append,
  and a lost acknowledgement does not create duplicate application. This is
  a reference schedule model, not evidence of a real process lock.
- [x] Erase publishes a content-free fence before removing modeled payload
  copies. Failed cleanup returns cleanup-pending; lost fence acknowledgement
  returns indeterminate; both block further append. Retrying erase completes
  cleanup without resurrecting data. Persist erasing before cleanup and erased
  only after cleanup verification. Reconstruct the model at each fault boundary
  and prove create cannot bypass unresolved erasure; a verified completed fence
  can resolve a lost acknowledgement. The fence remains writable when the
  payload budget is exhausted. Fresh create cannot inherit old identities.
- [x] Cover before/after-publication failures, exact retry after intervening
  append, malformed retry, immutable receipts, independent namespaces, deleted
  generation replay, orphan/corrupt head refusal, stale cache refusal, and
  cleanup failure/retry. Inspect serialized model state for omitted-field leaks.
- [x] Run port/model, projection/replay, and existing in-memory-store tests;
  force typecheck and lint. Commit: `feat: specify atomic durable storage and erasure port`.

## Task 5: Public restart assessment and regression delivery

**Consumes:** Task 1's raw-text parser and Task 2's private replay/cache helpers.
**Produces:** `inspectDurableJournal(text, expectation, cacheText?)`, returning
only a frozen `DurableRecoveryAssessment` with literal false authority flags.

`expectation` contains trusted `namespaceKey`, `generationKey`, and `now`.
Invalid expectations, identity mismatch, unsupported/corrupt input, unsafe time,
or time before creation return a fixed blocked reason with no raw payload.
`now >= expiresAt` is expired: return no historical payload, request erasure,
and make no claim that effects settled. Valid nonexpired input returns the
minimized snapshot, canonical cache text, cache disposition, and unsettled
operation metadata. It is always review-required, including an empty log.

- [x] Add this RED authority seed (complete fixture helper from Task 2):

  ```ts
  import { expect, it } from "vitest";
  import { inspectDurableJournal } from "../src/index.js";
  import { emptyDurableText, durableExpectation } from "./durableFixtures.js";

  it("never turns successful empty replay into admission", () => {
    const report = inspectDurableJournal(emptyDurableText(), durableExpectation);
    expect(report.authorityRestored).toBe(false);
    expect(report.automaticReplayAllowed).toBe(false);
    expect(report.status).toBe("review-required");
  });
  ```

- [x] Run `npx vitest run packages/runtime/test/durableRecovery.test.ts`;
  observe the missing-export failure, then implement the public wrapper.
- [x] Return fixed blocked codes, not exceptions containing IDs or text; no
  snapshot/cache on a failed or expired result. Validate the full log before
  deriving any cache. An invalid/missing cache never masks an invalid log.
- [x] Test exact expiry, shortened TTL, invalid/backward clock, namespace and
  generation mismatch, all unsettled phases across closed sessions, matching
  versus discarded cache, corrupt suffix, interleaved failing/successful calls,
  deep freezing, and absence of grants/inputs/live snapshot fields.
- [x] Verify type-level literal false flags and all unchanged P2a exports.
  Verify production imports contain no filesystem, VS Code, timers, network,
  model, effect, coordinator, or host registration route. Preserve host tests
  for inactive-zero/coexistence rather than adding a feature command.
- [x] Force typecheck; run lint, root coverage, both audits, POC compile/unit
  tests, build, Stable package/VSIX verification, and isolated host suites.
  Remote Insiders step outcomes remain part of the final PR gate below.
- [x] Update the four canonical documents with measured counts, dependency
  decisions, real limitations, and implemented-versus-deferred boundaries.
  Commit: `feat: expose non-authorizing minimized restart assessment`.
- [ ] Obtain independent full-branch and repository review. Verify each finding,
  fix real issues with regression tests, reply in its original thread, and
  resolve only addressed threads. Recheck the exact final head's required
  checks and follow-up reviews, including every actual Insiders step rather
  than only its allowed-failure job status, then notify the owner that the PR is ready.
  Do not merge or enable auto-merge without explicit direction.

## Acceptance matrix

| Risk | Owning task and required evidence |
| --- | --- |
| Sensitive source survives "metadata" selection | Tasks 1/3: every excluded field has a canary; keys come only from the trusted issuer, never original strings or hashes |
| Minimized snapshot pretends to be the current live runtime | Tasks 2/5: distinct state shape, literal false flags, no live hydration or effect path |
| Invalid partial history produces a valid prefix/cache | Tasks 1/2/5: complete-log failure with no state; cache cannot rescue corrupt history |
| Retried command duplicates or mutates a committed batch | Tasks 3/4: stable retry identity, exact-payload comparison, cross-commit command rejection |
| Lost acknowledgement is treated as failed dispatch | Task 4: indeterminate state retains complete committed metadata; no external effect is executed by any contract |
| Delete/expiry silently clears effect risk or resurrects payload | Tasks 4/5: content-free fence, cleanup-pending/expired dispositions, no retired generation fallback or settled-status fabrication |
| Two windows bypass generation/head fencing | Task 4: competing model schedules; real provider locking remains unproven and separately gated |
| Optional cache or bound becomes a hidden migration | Tasks 1/2: exact version/full origin/budget checks; no checkpoints/imports |
| New contracts change Stable, inactive-zero, or dependency boundaries | Task 5: architecture/coverage/host/packaging evidence and both maintained dependency graphs |

## Explicitly deferred product work

The next product increment must choose and measure a concrete storage provider,
then implement an adapter against the port's fault suite. Local/remote/web and
multiwindow capability support must be explicit; Node flush/rename APIs are
not proof of the required durability guarantees. No backend is selected here.
Actual filesystem and crash evidence must precede durable-save claims.

Live restart then needs an independently reviewed admission transition,
fresh-workspace reconciliation, renewed agreements/scopes/grants, pending-effect
handling, and host integration that never retries a recovered read implicitly.
Pair ownership/handoff and P3 guarded editing remain subsequent roadmap steps.
The owner's continued-development request is not a waiver of these review,
privacy, correctness, coexistence, or explicit-merge gates.

## Progress

- [x] PR #11 merged; post-merge baseline CI verified.
- [x] Owner selected and reviewed the minimized-state design direction.
- [x] Owner explicitly requested actual implementation and continued delivery.
- [x] Independent contract/plan review and necessary corrections (`0e7456a`;
  follow-up review confirms both projection-side-effect and erasure-replacement gates).
- [x] Task 1: closed wire format. Independent spec/quality review passes after
  aggregate-budget and unmasked-counter coverage corrections. The 210 new
  cases pass within 823 protocol tests; 109 existing runtime journal cases,
  forced typecheck, and lint also pass on Node.js 24.21.0.
- [x] Task 2: minimized replay and cache. Independent spec/quality review passes
  with no findings. All 75 new replay cases pass within 1,007 focused tests,
  with forced workspace typecheck and full lint on Node.js 24.21.0.
- [x] Task 3: trusted candidate projection. Independent spec/quality review
  passes after explicit-resolution, retry-ordering, and repeated-source-ID
  budget corrections. The 47 projection cases and 75 replay cases pass within
  388 focused runtime/core/script tests; forced workspace typecheck and full
  lint pass on Node.js 24.21.0.
- [x] Task 4: storage port and fault model (`72fd844`). Independent spec/quality
  re-review closes all three framing, preparation-budget, and retained-capacity
  findings. The 146 model cases pass within 751 focused journal tests; forced
  workspace typecheck and scoped lint pass. Fencing/copy limits remain
  test-only policies, not filesystem or power-loss evidence.
- [ ] Task 5: restart assessment, full regression gates, and reviewed PR.
  The independently reviewed assessment core and public storage-type exports
  pass 50 recovery tests and forced typecheck. Local integration passes 2,725
  root tests, lint, coverage, both audits, both packages, Stable VSIX inspection,
  and the isolated host matrix. Full-branch/PR review and final-head CI remain.
