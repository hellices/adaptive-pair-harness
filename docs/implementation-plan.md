# P2a Journal and Recovery Contract Implementation Plan

> **Status: proposed; documentation review only.** The owner selected this
> smaller design/plan PR, not implementation. Do not execute the code tasks
> until the owner explicitly approves the reviewed scope.
>
> **For contributors and agents:** after implementation approval, execute one
> checklist task at a time. First observe its failing test, implement only that
> task, rerun its named checks, and commit the verified result. Stop for a scope
> decision if the design cannot be met. Before delivery, have an independent
> reviewer compare the changes with the design and acceptance matrix. Keep
> progress here and in Git history; do not create competing active plans.
>
> **Optional agent tooling:** [Superpowers](https://github.com/obra/superpowers)
> provides `superpowers:executing-plans` (task execution with review checkpoints)
> and `superpowers:requesting-code-review` (independent review). Agents that
> already have these helpers may use them; they are not repository dependencies
> or a prerequisite for following the tool-independent workflow above.

**Goal:** Inspect a bounded, complete version-1 journal and report recorded
unfinished operations without saving data, restoring authority, or replaying
effects.

**Architecture:** Add a primitive-JSON-text journal parser to `protocol`, then
an internal pure replay helper and a public non-authorizing inspection report
to `runtime`. Use the existing event parser and reducer unchanged. Do not wire
the new APIs into `PairStore`, `PairCoordinator`, or any host surface.

**Tech stack:** Existing TypeScript, Vitest, fast-check, ESLint, and workspace
build/host/packaging gates. No new library, package edge, or host API is needed.

## Authorization and baseline

- PR #9 is merged at `469cb93`; its completed event-validation plan remains at
  `469cb93:docs/implementation-plan.md`. This document deliberately replaces it.
- The owner chose the journal/recovery foundation's design/plan PR instead of
  planning all of P2 together. Only the four canonical documentation files
  change in this PR. Reference code below is proposed text, not installed code.
- The scope and trade-offs are in [design section 13.1](design.md#131-proposed-p2a-journal-inspection).
  Evidence and the unchanged baseline checks are in
  [the planning checkpoint](research.md#journal-and-recovery-planning-checkpoint).
- Execute only after separate owner approval, from a refreshed `main` on a
  dedicated PR branch. Recheck the baseline then; this document cannot preapprove
  a future dependency version or a changed reducer.
- Neither this plan's publication/merge nor P2a completion authorizes a durable
  adapter, persisted-data migration, live restart, P2 ownership/handoff, P3
  editing/UI, or the next PR's merge. Notify the owner when each PR is ready.

## Global constraints

- Preserve the 21 version-1 event variants, command/event behavior, package
  boundaries, Growth-only Stable preview, additive opt-in, and inactive-zero.
- Journal `formatVersion` is 1, independent of event `protocolVersion: 1`.
  Accept only a complete revision-zero history; reject checkpoints, compacted
  tails, legacy formats, unknown versions, and guessed migrations.
- Inclusive limits: 1,048,576 UTF-16 text code units, 1,024 commits, and 1,024
  total events. Every commit is nonempty. Preserve per-event depth 64 (root zero)
  and 10,000 expanded values; do not impose these limits on commands.
- Reject extra/missing own envelope fields, invalid counters, ordering gaps,
  duplicate event IDs, command reuse across commits, invalid reductions, and
  mismatched stream/final workspace/head. Multiple commands and repeated
  command IDs **within one commit** remain allowed.
- Errors contain a fixed `Invalid Pair journal:` code, not payloads or causes.
  Return no valid prefix and keep no global mutable inspection state.
- Reports contain metadata only, `authorityRestored: false`, and
  `automaticReplayAllowed: false`. Never expose a replayed snapshot, grant,
  operation input, source, diagnostics, or executable recovery request.
- Preserve warnings across session close/disable/rebind in the supplied history.
  Key operation lifetime by session-start revision plus operation ID, not ID alone.
- No filesystem/VS Code imports, storage writes, listeners, timers, workspace
  reads, models, network, host registration, live-store hydration, or effects.
- A parsed/reducible history proves neither authentic consent nor product
  correctness. Existing events are not approved as a privacy-safe disk format.
- Keep authored production/config/release files below 400 effective lines and
  functions below 100; tests/fixtures below 600/200. Do not suppress lint rules.
- Inventory all manifests and both active lockfiles; audit development and
  production dependencies, check registry/upstream metadata, explain retention,
  and validate any authorized maintenance change. Keep repository docs English.

## File map

| Proposed file | Responsibility |
| --- | --- |
| `packages/protocol/src/journalTypes.ts` | Framing types and shared finite limits |
| `packages/protocol/src/parseJournal.ts` | Text/envelope/event validation and immutable output |
| `packages/runtime/src/journalRecoveryTypes.ts` | Non-authorizing report and expected-identity contracts |
| `packages/runtime/src/journalReplay.ts` | Internal ordering/reduction and lifetime-aware unfinished-work tracking |
| `packages/runtime/src/journalRecovery.ts` | Public identity check and metadata-only report |
| `packages/protocol/test/journal.test.ts` | Format, exact limits, unsafe/error/privacy cases |
| `packages/runtime/test/journalRecoveryFixtures.ts` | Complete wire histories; no caller-supplied seed snapshot |
| `packages/runtime/test/journalReplay.test.ts` | Transaction, identity, and reducer compatibility cases |
| `packages/runtime/test/journalRecovery.test.ts` | Authority, lifetime, failure isolation, and privacy cases |

Also append the listed exports to the two existing package entry points.
Do not modify `journal.ts`, `ports.ts`, `coordinator.ts`, existing reducers,
manifests, or host adapters to integrate inspection. Necessary dependency
maintenance is a separately evidenced change, not permission to add integration.

## Task 1: Bounded journal framing

**Interface:** `parsePairJournal(value: unknown): PairJournal`. The public input
type permits rejection of non-string values; accepted input is primitive JSON
text only. The parser validates framing and event shapes, not causal admission.

- [ ] Refresh `main`, install both graphs with Node.js 24+, and run the unchanged
  baseline. Recheck the [dependency checkpoint](research.md#planning-dependency-recheck).
  In particular, do not repeat the earlier claim that fast-check 4.10.0 is
  unavailable: its exact registry metadata now resolves. Assess current
  compatibility and update obtainable versions when warranted by the approved
  implementation, preserving manifests/locks and all validation gates.
- [ ] Add the following first failing case to `packages/protocol/test/journal.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parsePairJournal } from "../src/index.js";

const emptyText = JSON.stringify({
  formatVersion: 1,
  streamId: "stream-1",
  initialWorkspaceId: "workspace-1",
  headRevision: 0,
  commits: [],
});

describe("parsePairJournal", () => {
  it("accepts an immutable empty revision-zero journal", () => {
    const journal = parsePairJournal(emptyText);
    expect(journal.headRevision).toBe(0);
    expect(Object.isFrozen(journal)).toBe(true);
    expect(Object.isFrozen(journal.commits)).toBe(true);
  });

  it("rejects objects without invoking their conversion hooks", () => {
    const input = { toString() { throw new Error("must not run"); } };
    expect(() => parsePairJournal(input)).toThrow("Invalid Pair journal: INVALID_TEXT");
  });
});
```

- [ ] Run `npx vitest run packages/protocol/test/journal.test.ts`; confirm RED
  comes from the missing parser/export, not a fixture or toolchain failure.
- [ ] Implement the following proposed files and export them. Object property
  reads occur only after checking all expected **own** keys. Do not replace
  that check with inherited-property validation or expose JSON parser errors.

### `packages/protocol/src/journalTypes.ts`

```ts
import type { PairEvent } from "./events.js";

export const pairJournalLimits = Object.freeze({
  textCodeUnits: 1_048_576,
  commits: 1_024,
  events: 1_024,
});

export interface PairJournalCommit {
  readonly expectedRevision: number;
  readonly events: readonly PairEvent[];
}

export interface PairJournal {
  readonly formatVersion: 1;
  readonly streamId: string;
  readonly initialWorkspaceId: string;
  readonly headRevision: number;
  readonly commits: readonly PairJournalCommit[];
}
```

### `packages/protocol/src/parseJournal.ts`

```ts
import { pairJournalLimits, type PairJournal, type PairJournalCommit } from "./journalTypes.js";
import { parsePairEvent } from "./parseEvent.js";

interface WireCommit {
  readonly expectedRevision: number;
  readonly events: readonly unknown[];
}

const fail = (code: string): never => {
  throw new Error(`Invalid Pair journal: ${code}`);
};

const hasKeys = (
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));

const isCounter = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isIdentifier = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const readText = (value: unknown): unknown => {
  if (typeof value !== "string") return fail("INVALID_TEXT");
  if (value.length > pairJournalLimits.textCodeUnits) return fail("TEXT_LIMIT");
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fail("INVALID_JSON");
  }
};

const readCommit = (value: unknown): WireCommit => {
  if (!hasKeys(value, ["expectedRevision", "events"])) return fail("INVALID_ENVELOPE");
  const { expectedRevision, events } = value;
  if (!isCounter(expectedRevision) || !Array.isArray(events) || events.length === 0) {
    return fail("INVALID_ENVELOPE");
  }
  return { expectedRevision, events };
};

const parseCommit = (commit: WireCommit): PairJournalCommit => {
  try {
    return Object.freeze({
      expectedRevision: commit.expectedRevision,
      events: Object.freeze(commit.events.map(parsePairEvent)),
    });
  } catch {
    return fail("INVALID_EVENT");
  }
};

export const parsePairJournal = (value: unknown): PairJournal => {
  const raw = readText(value);
  if (!hasKeys(raw, ["formatVersion", "streamId", "initialWorkspaceId", "headRevision", "commits"])) {
    return fail("INVALID_ENVELOPE");
  }
  const { formatVersion, streamId, initialWorkspaceId, headRevision, commits } = raw;
  if (formatVersion !== 1) return fail("UNSUPPORTED_JOURNAL_VERSION");
  if (!isIdentifier(streamId) || !isIdentifier(initialWorkspaceId) || !isCounter(headRevision) ||
      !Array.isArray(commits) || commits.length > pairJournalLimits.commits) {
    return fail("INVALID_ENVELOPE");
  }
  if (commits.length === 0 && headRevision !== 0) return fail("INVALID_ENVELOPE");
  const wireCommits = commits.map(readCommit);
  const eventCount = wireCommits.reduce((count, commit) => count + commit.events.length, 0);
  if (eventCount > pairJournalLimits.events) return fail("EVENT_LIMIT");
  return Object.freeze({
    formatVersion,
    streamId,
    initialWorkspaceId,
    headRevision,
    commits: Object.freeze(wireCommits.map(parseCommit)),
  });
};
```

Append to `packages/protocol/src/index.ts`:

```ts
export { pairJournalLimits } from "./journalTypes.js";
export type { PairJournal, PairJournalCommit } from "./journalTypes.js";
export { parsePairJournal } from "./parseJournal.js";
```

- [ ] Extend the RED/GREEN cycle with each format case in the acceptance matrix
  below. Spy on `JSON.parse` to prove over-limit text is rejected before decoding;
  use whitespace padding for the exact inclusive text boundary. Use complete
  repeated observation events for event/commit limits, not an oversized fixture
  that accidentally hits a different bound first. Verify nested event freezing,
  wire omissions, and the existing command/event suites.
- [ ] Run `npx vitest run packages/protocol/test` and
  `npm run typecheck -- --force`; require GREEN before committing
  `feat: define bounded version-1 journal framing`.

## Task 2: Private replay and operation-lifetime inspection

**Consumes:** `PairJournal`, `createRuntime(workspaceId)`, and
`reduce(snapshot, events)` from the existing core.
**Produces:** internal `replayPairJournal(journal)` returning a historical
snapshot and frozen warning metadata. Do not export this helper from the
runtime package entry point or turn it into a store constructor.

- [ ] Add a complete-history fixture builder and failing tests in
  `journalRecoveryFixtures.ts` and `journalReplay.test.ts`. This base fixture
  contains two different commands in one commit; implementations must preserve it:

```ts
export const enabledJournalText = (): string => JSON.stringify({
  formatVersion: 1,
  streamId: "stream-1",
  initialWorkspaceId: "workspace-1",
  headRevision: 2,
  commits: [{
    expectedRevision: 0,
    events: [
      {
        protocolVersion: 1, eventId: "event-enable", commandId: "command-enable",
        actor: "human", revision: 1, recordedAt: 10,
        type: "PresenceEnabled", workspaceId: "workspace-1",
      },
      {
        protocolVersion: 1, eventId: "event-observe", commandId: "command-observe",
        actor: "host", revision: 2, recordedAt: 11, type: "WorkspaceObserved",
      },
    ],
  }],
});
```

First case in `journalReplay.test.ts`:

```ts
import { expect, it } from "vitest";
import { parsePairJournal } from "@adaptive-pair/protocol";
import { replayPairJournal } from "../src/journalReplay.js";
import { enabledJournalText } from "./journalRecoveryFixtures.js";

it("preserves a multi-command atomic commit", () => {
  const replay = replayPairJournal(parsePairJournal(enabledJournalText()));
  expect(replay.snapshot.revision).toBe(2);
  expect(replay.snapshot.presence.observationRevision).toBe(1);
  expect(replay.unsettledOperations).toEqual([]);
});
```

- [ ] Run `npx vitest run packages/runtime/test/journalReplay.test.ts` and
  establish a missing-helper RED after rebuilding Task 1's protocol exports.
- [ ] Implement the types and private replay helper below. Reduce each event
  locally to observe lifetime boundaries; publish nothing until the entire
  journal passes. A later bad event must never leak the earlier valid prefix.

### `packages/runtime/src/journalRecoveryTypes.ts`

```ts
import type { OperationRecord, SessionStatus } from "@adaptive-pair/protocol";

export interface JournalExpectation {
  readonly streamId: string;
  readonly workspaceId: string;
}

export interface UnsettledJournalOperation {
  readonly sessionStartedAtRevision: number;
  readonly workspaceId: string;
  readonly operationId: string;
  readonly kind: OperationRecord["kind"];
  readonly recordedStatus: "planned" | "authorized" | "started" | "unknown";
}

export interface JournalRecoveryReport {
  readonly formatVersion: 1;
  readonly streamId: string;
  readonly workspaceId: string;
  readonly headRevision: number;
  readonly commitCount: number;
  readonly eventCount: number;
  readonly historicalSession: {
    readonly sessionId: string;
    readonly startedAtRevision: number;
    readonly status: SessionStatus;
  } | undefined;
  readonly unsettledOperations: readonly UnsettledJournalOperation[];
  readonly authorityRestored: false;
  readonly automaticReplayAllowed: false;
}
```

### `packages/runtime/src/journalReplay.ts`

```ts
import type { PairEvent, PairJournal, PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { createRuntime, reduce } from "@adaptive-pair/session-core";
import type { UnsettledJournalOperation } from "./journalRecoveryTypes.js";

const fail = (code: string): never => {
  throw new Error(`Invalid Pair journal: ${code}`);
};

const rememberOperation = (
  snapshot: PairRuntimeSnapshot,
  event: PairEvent,
  unsettled: Map<string, UnsettledJournalOperation>,
): void => {
  if (event.type !== "OperationAuthorized" && event.type !== "OperationObserved") return;
  const session = snapshot.session;
  if (session === undefined) return fail("INVALID_EVENT_SEQUENCE");
  const operationId = event.type === "OperationAuthorized" ? event.operation.id : event.operationId;
  const operation = session.operations.find(candidate => candidate.id === operationId);
  if (operation === undefined) return fail("INVALID_EVENT_SEQUENCE");
  const key = JSON.stringify([session.startedAtRevision, operationId]);
  const recordedStatus = operation.status;
  if (recordedStatus === "planned" || recordedStatus === "authorized" ||
      recordedStatus === "started" || recordedStatus === "unknown") {
    unsettled.set(key, Object.freeze({
      sessionStartedAtRevision: session.startedAtRevision,
      workspaceId: snapshot.presence.workspaceId,
      operationId,
      kind: operation.kind,
      recordedStatus,
    }));
  } else {
    unsettled.delete(key);
  }
};

export const replayPairJournal = (journal: PairJournal): {
  readonly snapshot: PairRuntimeSnapshot;
  readonly unsettledOperations: readonly UnsettledJournalOperation[];
} => {
  let snapshot = createRuntime(journal.initialWorkspaceId);
  const eventIds = new Set<string>();
  const commandIds = new Set<string>();
  const unsettled = new Map<string, UnsettledJournalOperation>();
  for (const commit of journal.commits) {
    if (commit.expectedRevision !== snapshot.revision) return fail("NON_CONTIGUOUS_REVISION");
    for (const event of commit.events) {
      if (event.revision !== snapshot.revision + 1) return fail("NON_CONTIGUOUS_REVISION");
      if (eventIds.has(event.eventId)) return fail("DUPLICATE_EVENT_ID");
      if (commandIds.has(event.commandId)) return fail("DUPLICATE_COMMAND_ID");
      if (event.type === "BriefConfirmed") return fail("UNSUPPORTED_REPLAY_EVENT");
      try {
        snapshot = reduce(snapshot, [event]);
      } catch {
        return fail("INVALID_EVENT_SEQUENCE");
      }
      rememberOperation(snapshot, event, unsettled);
      eventIds.add(event.eventId);
    }
    for (const event of commit.events) commandIds.add(event.commandId);
  }
  if (snapshot.revision !== journal.headRevision) return fail("HEAD_REVISION_MISMATCH");
  return Object.freeze({
    snapshot,
    unsettledOperations: Object.freeze([...unsettled.values()]),
  });
};
```

- [ ] Add the ordering/lifetime cases from the matrix. Compare accepted
  generated observation histories against existing `reduce` results with
  fast-check. Separately mutate their revision, event ID, prior command ID,
  commit boundary, and declared head and assert the corresponding rejection.
  Keep fixtures that are intentionally reducible but not command-authorized:
  replay is not a substitute for the decider or consent.
- [ ] Run `npx vitest run packages/runtime/test/journalReplay.test.ts` plus
  existing journal, workspace-boundary, session-identity, and core suites;
  typecheck and lint. Commit GREEN as
  `feat: inspect journal ordering and unsettled operation lifetimes`.

## Task 3: Public non-authorizing restart assessment

**Interface:**
`inspectPairJournal(value: unknown, expectation: JournalExpectation): JournalRecoveryReport`.
The expectation is supplied by trusted adapter code, not a public model input.

- [ ] Write the first failing contract in `journalRecovery.test.ts`:

```ts
import { expect, it } from "vitest";
import { inspectPairJournal } from "../src/index.js";
import { enabledJournalText } from "./journalRecoveryFixtures.js";

it("reports history without granting any restoration or replay authority", () => {
  const report = inspectPairJournal(enabledJournalText(), {
    streamId: "stream-1", workspaceId: "workspace-1",
  });
  expect(report).toMatchObject({
    headRevision: 2, commitCount: 1, eventCount: 2,
    authorityRestored: false, automaticReplayAllowed: false,
  });
  expect(report).not.toHaveProperty("snapshot");
  expect(report).not.toHaveProperty("events");
  expect(report).not.toHaveProperty("userActionGrants");
  expect(Object.isFrozen(report)).toBe(true);
});
```

- [ ] Run `npx vitest run packages/runtime/test/journalRecovery.test.ts` and
  confirm a missing-public-API RED, then add the following implementation.

### `packages/runtime/src/journalRecovery.ts`

```ts
import { parsePairJournal } from "@adaptive-pair/protocol";
import { replayPairJournal } from "./journalReplay.js";
import type { JournalExpectation, JournalRecoveryReport } from "./journalRecoveryTypes.js";

export const inspectPairJournal = (
  value: unknown,
  expectation: JournalExpectation,
): JournalRecoveryReport => {
  const journal = parsePairJournal(value);
  if (journal.streamId !== expectation.streamId) {
    throw new Error("Invalid Pair journal: STREAM_MISMATCH");
  }
  const replay = replayPairJournal(journal);
  const { snapshot } = replay;
  if (snapshot.presence.workspaceId !== expectation.workspaceId) {
    throw new Error("Invalid Pair journal: WORKSPACE_MISMATCH");
  }
  const session = snapshot.session;
  return Object.freeze({
    formatVersion: 1,
    streamId: journal.streamId,
    workspaceId: snapshot.presence.workspaceId,
    headRevision: snapshot.revision,
    commitCount: journal.commits.length,
    eventCount: journal.commits.reduce((count, commit) => count + commit.events.length, 0),
    historicalSession: session === undefined ? undefined : Object.freeze({
      sessionId: session.sessionId,
      startedAtRevision: session.startedAtRevision,
      status: session.status,
    }),
    unsettledOperations: replay.unsettledOperations,
    authorityRestored: false,
    automaticReplayAllowed: false,
  });
};
```

Append to `packages/runtime/src/index.ts`:

```ts
export { inspectPairJournal } from "./journalRecovery.js";
export type {
  JournalExpectation, JournalRecoveryReport, UnsettledJournalOperation,
} from "./journalRecoveryTypes.js";
```

- [ ] Add every authority/privacy/isolation case from the matrix. Place a unique
  sentinel in operation inputs, summaries, diagnostics, and grant IDs; neither
  the report nor failure message/cause may contain it. Enumerate the report's
  exact keys so future fields cannot accidentally publish a snapshot. Verify
  all nested metadata is frozen and calls after a rejected journal stay clean.
- [ ] Run `npx vitest run packages/runtime/test/journalRecovery.test.ts` and
  the runtime/protocol/core/architecture suites; require GREEN typecheck and
  lint. Commit `feat: expose non-authorizing journal recovery assessment`.

## Acceptance matrix

Every row is required; the three seed tests above are not the complete suite.
Expected failures use the fixed prefix and code, never arbitrary input text.

| Area | Required examples and expected result |
| --- | --- |
| Text boundary | Reject object, boxed string, null, number, malformed/deep-invalid JSON without conversion hooks or raw parser diagnostics; accept exact text limit and reject limit + 1 before parsing |
| Closed framing | Reject missing/extra root or commit keys, including prototype-key payloads; inherited required keys cannot supply an omission; reject non-1 format versions, empty identifiers, negative/fractional/unsafe counters, empty commits, and nonzero empty head |
| Aggregate budgets | Accept exactly 1,024 commits/events under the text cap; reject 1,025; total events span all commits; invalid envelope/event totals fail before event parsing |
| Event boundary | Exercise all 21 shape-valid variants in parser fixtures, optional wire omissions, explicit null, wrong event version, nested unknown fields, depth/node limits, nested freezing; retain all existing command/event regressions |
| Atomic framing | Accept two command IDs in one commit and repeated command ID within that commit; reject reuse in a later commit; reject duplicate event IDs within/across commits |
| Replay chain | Require initial expected revision zero, contiguous commit/event revisions, and matching declared head; reject removed/reordered/duplicated batches and `InMemoryJournal.events()` tails after disable; never synthesize a seed |
| Core compatibility | Accept supported transitions unchanged; compare generated histories with the current reducer; reject `BriefConfirmed` explicitly and invalid state/epoch transitions with fixed errors; a reducible actor label is not authenticated consent |
| Identity | Allow different stream and initial workspace IDs; reject expected-stream mismatch and wrong final workspace; accept legal reset/rebind and reject rebind without the core's required reset |
| Recorded work | Preserve warnings for every planned/authorized/started/unknown read/edit/check; remove only on a recorded confirmed/failed/declined/cancelled observation; test close, disable, and rebind without losing unresolved historical warnings |
| Lifetime | Reuse session and operation IDs after disable; keep separate warnings by start revision; settling the newer operation cannot erase the older warning; keep each warning's original workspace |
| No authority | Test empty, briefing, ready, paused, reconciling, closed, grant-bearing, and unsettled histories; both authority/replay flags always false, no full snapshot/grant or action restored, no status rewritten as cancelled |
| Privacy/isolation | Exact report keys, sentinel exclusion, no raw cause, detached/frozen nested data, no partial output or retained state after failure; existing live store/host surfaces remain untouched and architecture guards pass |

## Task 4: Verified, reviewed delivery after implementation approval

- [ ] Update `README.md`, `docs/design.md`, and `docs/research.md` only with
  measured implementation evidence. Separate new test counts from the baseline,
  root tests from the isolated POC, and read-only inspection from actual storage
  or working session recovery. Mark completed tasks here, not in a handoff file.
- [ ] Inventory/audit both installed graphs and locks; compare direct dependencies
  with obtainable registry versions and upstream stable releases. Record access
  restrictions honestly and distinguish registry metadata from installed/tested
  availability. Keep every material update and its compatibility evidence traceable.
- [ ] Build workspace exports before extension tests and run:

```sh
npm ci
npm --prefix poc/session-target ci
npm run typecheck -- --force
npm run lint
npm test
npm --prefix poc/session-target run check
npm run build
npm run package
node scripts/verify-vsix.mjs
npm --prefix poc/session-target run package
npm audit --audit-level=low
npm --prefix poc/session-target audit --audit-level=low
env -u VSCODE_EXECUTABLE_PATH ADAPTIVE_PAIR_HOST_VERSION=1.136.2 npm run test:host
env -u VSCODE_EXECUTABLE_PATH ADAPTIVE_PAIR_HOST_VERSION=1.137.0 npm run test:host
env -u VSCODE_EXECUTABLE_PATH npm --prefix poc/session-target run test:host
```

- [ ] Obtain independent specification/code-quality review, commit and push,
  open the implementation PR against `main`, and request repository review.
  Check each finding against the actual code, add a failing regression for a
  real defect, fix it, and reply in its original thread with verification or
  a reasoned explanation. Resolve only addressed concerns.
- [ ] Recheck follow-up reviews and all final-head CI steps, including actual
  Insiders results despite allowed failure. Report readiness without merging,
  auto-merging, wiring a host route, or starting another milestone.

## This documentation PR's gate

Self-review the spec/plan against current code, validate local links and proposed
reference types, rerun unchanged baseline checks and both audits, and obtain
independent plus repository review. None of that executes Tasks 1–4 or proves
their proposed new tests pass. The owner's review, explicit merge decision, and
later implementation authorization remain distinct decisions.
