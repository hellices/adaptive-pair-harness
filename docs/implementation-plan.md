# Runtime Boundary Stabilization Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` or
> `superpowers:subagent-driven-development` with the bounded tasks below.
> Keep progress in this canonical plan and Git history, not parallel plans.

**Goal:** Remove the reproduced state races and strengthen existing application
boundaries before designing Pair P2.

**Architecture:** Preserve the functional core and imperative runtime. The core
decides every authoritative presence/session transition; one runtime command
queue coordinates mutations, and an atomic store commit enforces revision and
idempotency contracts. Extract the guarded Growth response-release use case
without moving VS Code UI or vendor types inward.

**Tech stack:** Existing TypeScript/npm workspaces, Vitest, ESLint, esbuild,
and VS Code host tests. No new third-party library is required.

## Authorization and baseline

- The owner requested an architecture audit, then authorized bounded
  refactoring before further development on September 16, 2026.
- The owner subsequently authorized merging this refactoring PR after review
  and final checks pass, then continuing with the next reviewed development
  increment. This is not blanket merge permission for successor PRs.
- PR #6 is merged at `9eebbf19e201b0ff6642868728ef217738ad31f7`.
  Its completed P1 plan remains in that Git revision; this document
  deliberately replaces it as the single active implementation plan.
- The audit reproduced concurrent accepted commands losing one update,
  Disable being undone by a pending command, and an observation increment
  being overwritten. These defects predate PR #6.
- Baseline typecheck, lint, and 673 workspace tests passed at the identical P1
  implementation tree before this refactoring.
- P2 ownership/handoff persistence, P3 host editing, Delivery, new UI, and
  Session Target integration are not authorized by this plan.

## Global constraints

- Work from current `main` on `refactor/runtime-state-boundaries`. Preserve
  unrelated worktrees; never push directly to `main`.
- Stable remains Growth-only, additive, opt-in, and inactive-zero. Constructors
  add no listeners, timers, workspace reads, model calls, or network access.
- Preserve other extensions, native defaults, explicit confirmations, repeated
  authorization checks, permission contracts, and package boundaries.
- `session-core` depends only on protocol and deterministic local utilities.
  No package under `packages/` imports a host or model-vendor SDK.
- Use functions, readonly data, and small boundary interfaces, not a DI
  container, generic repository framework, or mode inheritance hierarchy.
- Keep manifests, project references, and lockfiles consistent. Existing
  dependency maintenance and both dependency-graph audit gates remain intact.
- Write documentation and review replies in English. Distinguish observed
  behavior, author validation, independent review, and CI evidence.
- Complete commit, push, PR, review replies/fixes/resolution, and final checks.
  Merge this refactoring PR only after those gates pass, as explicitly directed.

## Task 1: Atomic store and command boundary

**Files:** `packages/runtime/src/ports.ts`, `journal.ts`, `coordinator.ts`,
`packages/runtime/test/journal.test.ts`, `coordinator.test.ts`, `fakes.ts`, and
the store fixtures in `apps/vscode-extension/test/growthParticipant.test.ts`
and `pairTools.test.ts`.

**Interface:** Replace split append/save with the runtime-owned contract:

```ts
interface PairStore {
  load(streamId: string): Promise<{
    readonly snapshot: PairRuntimeSnapshot;
    readonly seenCommandIds: ReadonlySet<string>;
  }>;
  commit(
    streamId: string,
    expectedRevision: number,
    events: readonly PairEvent[],
  ): Promise<PairRuntimeSnapshot>;
}
```

- [x] Test concurrent commands at one expected revision, duplicate IDs,
  invalid batches leaving both state and IDs unchanged, nested immutability,
  and failure before effects. Run focused tests and record expected RED.
- [x] Validate the entire event batch before atomically replacing snapshot,
  command IDs, and event history. Multiple events may share one new command
  ID, but previously committed IDs and stale revisions must be rejected.
- [x] Serialize state transitions only. Never hold the queue while a model,
  effect, process, or confirmation UI runs. Rejection cannot poison the queue.
- [x] Replace permissive store fixtures with the shared implementation or
  contract-preserving wrappers retaining fault injection and ordering evidence.
- [x] Run runtime and native-tool/Growth integration regressions to GREEN.

```sh
npx vitest run packages/runtime/test apps/vscode-extension/test/pairTools.test.ts apps/vscode-extension/test/growthParticipant.test.ts
```

## Task 2: One authoritative presence transition path

**Files:** `packages/protocol/src/commands.ts`, `events.ts`, `schemas.ts`,
`packages/session-core/src/decide.ts`, `reduce.ts`, a focused presence policy
module if needed, `packages/runtime/src/ports.ts`, `coordinator.ts`,
`apps/vscode-extension/src/sessionController.ts`, `presenceController.ts`, and
the corresponding protocol/core/runtime/controller/host tests.

**Interfaces:** Implement the already-declared `EnablePresence` and
`SetPresence` command/event paths in the core. Add only the internal
`ObserveWorkspace` command and `WorkspaceObserved` event needed to replace
direct observation revision mutation. This is additive within protocol major
1; no durable session migration or new model-callable tool is introduced.

```ts
interface PairPresencePort {
  setPresence(
    status: "observing" | "quiet" | "paused" | "off",
    workspaceId?: string,
  ): Promise<PairRuntimeSnapshot>;
  observeWorkspace(): Promise<PairRuntimeSnapshot>;
}
```

- [x] Reproduce Disable-vs-dispatch and observation-vs-dispatch in tests of the
  actual production controller. Cover human-only presence actions, host-only
  observations, paused-session preservation, and monotonic revisions.
- [x] Record RED before implementing core presence transitions. Pausing an
  operational session retains existing authority invalidation and operation
  cancellation. Disable clears current session/observation state without
  resetting the runtime revision or accepting a late operation result.
- [x] Construct host presence commands inside the same runtime queue. If
  binding workspace and changing status needs multiple core commands, commit
  their events as one batch with no observable intermediate snapshot.
- [x] Remove the controller's custom store, snapshot replacement, and manual
  freezing. Keep native workspace capture and user-action routing outside.
  Pin asynchronous session commands to their observed snapshot.
- [x] Await disable completion and handle observation promises without
  unhandled rejections. Preserve listener detachment and effect cancellation.
- [x] Run protocol, core, runtime, and presence tests to GREEN.

```sh
npx vitest run packages/protocol/test packages/session-core/test packages/runtime/test apps/vscode-extension/test/presenceController.test.ts
```

Expected: Disable remains off when prior work settles; committed observation
increments survive; no new native contribution or model capability appears.

## Task 3: Host-independent guarded Growth turn

**Files:** Focused new modules/tests in `packages/runtime/src/` and
`packages/runtime/test/`, its `index.ts`, manifest and project references,
`apps/vscode-extension/src/growthParticipant.ts`, and `modelAdapter.ts`.

**Interfaces:** Move existing `GrowthModel`, runtime-boundary result, and typed
failure contracts inward. Extract the guarded-turn sequence into a function
accepting plain request data, `AbortSignal`, a model port, and a narrow
coordinator view. Return data rather than accepting a VS Code response stream.

```ts
type GrowthTurnOutcome =
  | { readonly status: "delivered"; readonly response: GrowthResponse }
  | { readonly status: "stale" }
  | { readonly status: "withheld"; readonly response: GrowthResponse; readonly reason: string }
  | { readonly status: "failed"; readonly reason: string };
```

- [x] Add tests for stale boundaries, model failure, hint/reveal authorization,
  restraint rejection, and optional transfer validation without a VS Code
  mock. Record RED, then extract the existing behavior.
- [x] Keep transport/tool loops, cancellation-token conversion, consent UI,
  and Markdown in the extension. Preserve messages, model limits, consent
  ordering, evaluation outcomes, and existing model-result compatibility.
- [x] Declare new direct workspace imports, including `restraint` if needed,
  without unrelated upgrades. Do not add durable evaluation or P2 provenance.
- [x] Run the isolated use-case and existing full Growth regression tests.

```sh
npx vitest run packages/runtime/test apps/vscode-extension/test/growthParticipant.test.ts apps/vscode-extension/test/modelAccounting.test.ts
```

## Task 4: Executable dependency boundaries

**Files:** A focused checker and fixture tests under `scripts/`, the existing
workspace-reference test if reused, `apps/vscode-extension/package.json`, and
the affected root lockfile.

- [x] Add negative fixtures for forbidden host imports, package cycles,
  undeclared direct imports, and cross-package relative/deep imports. Cover
  type imports, re-exports, and literal dynamic imports.
- [x] Record the real workspace's missing direct protocol declaration as RED.
- [x] Implement a deterministic source/manifest/project-reference check with
  existing TypeScript tooling, included in the normal test/check pipeline.
  Enforce dependency declarations and direction for reference-only edges too.
  Keep the independent Session Target POC outside the Stable graph and
  preserve its separate install/audit/package gates.
- [x] Declare the extension's direct protocol dependency, synchronize the
  lockfile, and verify both real-workspace and negative-fixture tests.

```sh
npx vitest run scripts/test
```

## Task 5: Bounded modules and functions

The owner additionally requested that large code units not be allowed. Typed
ESLint already exists, but the baseline has no file/function size rules.

- [x] Add tested, error-level ESLint limits: 400 effective lines per production
  or release-script file and 100 per function; 600/200 for test files and test
  functions, including fixtures and host smoke tests. Ignore only blank and
  comment-only lines, not source files. Disallow inline rule suppression and
  fail the lint command on warnings.
- [x] Include the isolated POC's authored source/tests in lint while preserving
  its separate dependency graph and existing checks. Vendored upstream VS Code
  declarations are not maintained source and are not lint targets.
  Include standalone configurations and intentional host fixtures with syntactic
  lint; preserve size limits and restrict unused-parameter allowances to fixtures.
- [x] Split oversized modules by responsibility: command/event families,
  runtime operations, host verification backends, workspace access, model
  transport, response presentation, instruction layers, and archive parsing.
  Do not add a generic framework or split into meaningless numbered fragments.
- [x] Split oversized tests by behavior with shared in-package fixtures. Keep
  all existing assertions and add regressions for lifecycle/publication gaps
  discovered during review. Verify the actual size rules with negative tests.
- [x] Rerun focused regressions after each extraction and obtain independent
  review of the complete bounded-code refactor.

## Task 6: Integration, evidence, and review

- [x] Run clean root installation, forced typecheck, lint, and all tests.
- [x] Build/verify the Stable VSIX and rerun isolated Stable host tests,
  including inactive-zero and shared production-wiring assertions.
- [x] Audit both active lockfile graphs. Do not claim untouched POC host tests
  were rerun unless actually executed.
- [x] Update `docs/design.md`, `docs/research.md`, and applicable README
  validation/roadmap text. Keep P2/P3 separately gated.
- [x] Commit, push, open the PR, and obtain independent technical review and
  the normal repository PR review.
- [ ] Verify findings, reply in original threads, resolve only addressed
  concerns, and recheck follow-ups plus final-head CI.
- [ ] Merge this refactoring PR after review and final-head checks pass, then
  update from `main` and scope the next increment on its own PR branch.

```sh
npm ci
npm exec tsc -- -b --force
npm run check
npm run build
npm run package
npm run test:host
npm audit --audit-level=low
npm --prefix poc/session-target audit --audit-level=low
```

## Completion record

Tasks 1–5 were implemented and independently re-reviewed before PR #8. Original reviewers
report no remaining findings in their atomic state/lifecycle, Growth publication,
verification extraction, or dependency/size-guard scopes. Pre-PR local validation
passed: 834 workspace tests, 17 Stable host scenarios on each supported matrix
version, Stable packaging, and the separate POC's 8 unit cases, package, and
1 Insiders host case. Both graphs pass full and production-only audits.

The detailed pre-PR evidence is in `docs/research.md`. Commit `41d9af7` opened
PR #8; all four CI jobs passed on that revision. The first normal repository
review nevertheless requested changes. Its inline finding and five summary-only
findings are all in scope, together with independently verified issues at
additional locations exposed in the completed review's logs. A second repository
review added two dirty-buffer findings, which are also required follow-up gates.

### PR #8 follow-up gates

- [x] Reproduce and fix open-document filesystem-identity escapes, retaining
  safe unsaved buffers and avoiding reads of rejected buffers; independent
  review remains a separate gate.
- [x] Reproduce and fix successful stream/token-accounting completion after
  cancellation or the model deadline, including a latched timer cancellation
  after clock rollback and a liveness gate before model dispatch.
- [x] Reproduce and fix cancelled Growth publication and human-action grants
  detached from the caller's observed revision/authority; obtain independent
  re-review of the transfer continuation as well as initial publication.
- [x] Validate malformed verification script manifests and Windows process-tree
  confirmation lifetime, including PID reuse, with independent re-review.
- [x] Probe and address operation admission, immutable request payload, and
  queued grant-cancellation boundaries in the authoritative runtime, including
  concurrent recovery rather than only reconciliation after invocation settles.
- [x] Check the archive end-record scan's short-buffer and maximum-comment
  boundaries. These probes pass without changing the parser; request a concrete
  counterexample if a different archive concern remains.
- [x] Reject NUL-containing dirty scope buffers consistently with disk reads,
  and retain deleted dirty verification buffers addressed through safe aliases.
- [x] Complete independent follow-up reviews, full local/host/package gates,
  original-thread replies/resolution, and a fresh normal repository review.

The `8fd60be` local checkpoint passes forced typecheck, enforced lint, 972
workspace tests, both Stable hosts' 17 scenarios, Stable packaging, the separate
POC's 8 unit tests/package/1 Insiders host case, and all four dependency audits.
This is not a substitute for the remaining independent and repository review.

### Second repository reassessment

All four CI jobs pass at `8fd60be`, and the original three inline concerns have
evidence replies and are resolved. The fresh repository assessment still reports
five concerns: three published summary-only compositions and two runtime source
locations without their full finding text. Previous scoped passes do not clear
these newly identified compositions.

- [x] Reproduce cancellation after queued local-command admission, preserve
  grants/state when cancellation precedes commit, and retain actions already
  committed before cancellation. Independent re-review passes on the frozen
  cancellation patch, separately from the state-disclosure correction.
- [x] Bind transfer identity and request data across asynchronous consent,
  preparation, and publication without a new publication await.
- [x] Preserve agreed in-root alias scope for read/search and valid unsaved
  buffers while retaining canonical containment, secret/binary filtering, and
  byte limits.
- [x] Reproduce native/Growth state-query disclosure and replace full snapshots
  with bounded allowlisted metadata. Keep grants and raw records behind the
  trusted snapshot port; do not claim an unproven model privilege escalation.
  Request clarification of unpublished finding text rather than inventing it.
- [x] Close the independent transfer review's identical-session recreation
  case using the committed start revision, without changing epoch semantics
  or version-1 command/event payloads. Recheck the original review separately.
- [x] Preserve valid reads/searches when an unrelated stale dirty document has
  a regular-file ancestor; reject an invalid requested path without lexical
  fallback or swallowing unavailable-identity/cancellation errors.
- [x] Recheck independent reviews, full affected validation, final-head CI,
  and a fresh repository assessment after this round's fixes.

The initial second-round source/test checkpoint passes forced typecheck, enforced lint,
1,083 workspace tests across 87 files, Stable build/7-entry packaging, and the
separate POC's 8 unit tests/9-entry package. All 17 isolated host scenarios pass
on each Stable matrix version, the POC's Insiders host case passes, both installed
dependency trees are valid, and all four full/production audits report zero
findings. Transfer, scope, and state-projection independent reviews remain
distinct pending gates; these local results do not describe a future remote
head's CI. Independent review subsequently exposed the recreation and unrelated
dirty-buffer cases above. The lifecycle correction passes its 52 focused cases,
forced typecheck, and full lint. After both corrections, a fresh integrated run
passes 1,105 tests across 89 files, forced typecheck, full lint, Stable build and
7-entry VSIX verification, and all 17 host scenarios on each Stable matrix
version. State-projection, cancellation, scope, and the final Growth lifecycle
independent reviews subsequently pass on their frozen artifacts. All four CI
jobs pass at `d84c4fe`, including the actual Insiders test step. The next repository
assessment still requests changes; successful CI does not clear those findings.

### Third repository reassessment

Review `5227383478` reports two inline threads and nine summary-only locations.
Repeated transfer-cache locations describe one underlying lifetime defect;
each distinct concern must still be verified rather than inferred from the
review job's successful completion.

- [x] Reproduce reused consent and transfer/check summaries after Disable with
  identical session/work-unit IDs; bind caches to workspace and committed
  session start identity. Keep pending consent on its original intent.
- [x] Reject non-Growth guidance before consent, reveal, escalation, or model
  dispatch. Bind all guidance routes through preparation and publication.
- [x] Restrict host-facing mode selection to Growth and end confirmed state
  contract turns before another call uses outdated instructions/tools. Preserve
  the accepted state change and request a fresh turn without a Growth claim.
- [x] Preserve canonical and alias-relative search patterns, choosing the
  longest applicable prefix when they overlap. Reject oversized exact queries
  before discovery and bound complete effect/runtime/native/Growth results,
  including metadata and the model-readable trust prefix.
- [x] Remove Windows termination claims based only on `taskkill` success.
  Preserve escalation, keep unknown tree exit unconfirmed, and distinguish
  mocked Windows evidence from native POSIX checks.
- [x] Reproduce and suppress check publication after a committed result's
  runtime is recreated, paused, or observed before the host continuation.
- [x] Reproduce stale `/session` cache publication and reveal admission with
  ordinary coordinator scheduling. Fence the live publication/modal boundaries
  and suppress declined-modal output after Chat cancellation, retaining neutral
  non-cancelled declines and the existing transfer-intent assertions.
- [x] Rerun integrated validation after the complete-result and overlapping
  prefix corrections, including both Stable hosts and the separate POC.
- [x] Complete independent re-review of the final source patches.
- [x] Reply in both original new inline threads, resolve addressed concerns,
  and obtain a fresh repository assessment plus final-head checks.

The initial third-round integrated checkpoint passes **1,194 tests across 94
files**, forced typecheck, full lint, Stable build and 7-entry VSIX inspection,
and all 17 isolated host scenarios on each Stable matrix version. The unchanged
POC also passes its 8 tests, 9-entry package, and one Insiders host case. Both
installed dependency trees validate and all four audits report zero findings.
Windows independent review passes; the Growth and scope reassessments are still
pending at this checkpoint. These local results do not pre-approve a future
committed head or repository review.

After the overlapping-prefix and complete-result follow-ups, fresh integrated
validation passes **1,216 tests across 97 files**, forced typecheck, full lint,
Stable build and 7-entry VSIX verification, and 17 isolated scenarios on each
Stable host version. The separate POC again passes its 8 unit tests, 9-entry
package, and one Insiders host case. Both installed trees validate and all four
dependency audits again report zero findings. Independent re-review and the
eventual committed head's repository review/checks remain separate gates.

The subsequent route-publication/modal follow-up passes **1,274 tests across
99 files**, forced typecheck, full lint, Stable build/7-entry VSIX verification,
and all 17 isolated cases on each Stable host. The separate POC and both
dependency graphs are unchanged from the immediately preceding successful
checks; their earlier evidence is not relabeled as a new execution.

Independent Windows, model-transition, complete-result/prefix, and
consent/route-boundary reviews now report specification and quality passes in
their respective frozen scopes. The route reviewer replays all 58 original
probes unchanged, all 101 promoted/transfer-intent cases, and 226 additional
focused/prior regressions. The two original threads have evidence replies and
are resolved at `6236a06`; all four CI jobs and their actual steps pass. The next
repository assessment nevertheless requests five additional corrections.

### Fourth repository reassessment

Review `5228345791` reports four inline findings and one summary-only finding.
The two workspace findings describe one missing authoritative lifecycle boundary;
the remaining findings cover multi-root pattern qualification and useful bounded
read/verification results.

- [x] Make workspace rebinding an atomic disable/enable boundary, reject replay
  without a reset, and fence late result admission with its authorization revision.
- [x] Classify qualified patterns across all lexical/canonical agreed scopes;
  skip unmatched roots without changing genuinely relative pattern behavior.
- [x] Reserve complete effect/runtime/Growth overhead before shortening read
  text or verification output. Preserve byte/sensitivity checks, exact identities,
  execution metadata, Unicode boundaries, and explicit truncation flags.
- [x] Rerun full local validation: 1,343 tests across 102 files, forced typecheck,
  full lint, Stable build/7-entry VSIX verification, and both hosts' 17 cases pass.
- [x] Reproduce stale invocation/recovery cleanup deleting a replacement's
  pending entry when operation IDs are reused. Preserve registry ownership,
  later cancellation, and no-duplicate recovery with 48 maintained cases.
- [x] Address independent pattern review's dot-relative regression and missing
  file-scope qualification gap without weakening canonical permission checks.
- [x] Rerun integrated checks after these additional corrections: 1,413 tests
  across 104 files, forced typecheck, lint, Stable build/7-entry VSIX verification,
  and both Stable hosts' 17 cases pass. Fresh POC/graph checks also pass.
- [x] Complete independent reviews, including lifecycle/operation cleanup
  compositions and both result consumers, before publishing the correction.
- [x] Reply to all four inline findings and the summary-only finding, resolve
  addressed concerns, and obtain fresh repository review and final-head checks.

The fourth-round correction is committed as `db98654`. All four original threads
have evidence replies and are resolved; the summary-only finding has a grouped
response. CI `35156743700` passes all four jobs and their actual steps, including
Insiders. The fifth repository review still requests three corrections.

### Fifth repository reassessment

Review `5228948895` requests prompt aborted-child-close settlement and propagation
of the validated `previewOnly` value in both decision and replay paths. The broad
frozen-head integration review additionally reproduces stale `/brief` publication
and raw token-accounting errors retained in evaluation reasons. These last two
patterns predate the final delta but remain current contract gaps in this PR.

- [x] Reproduce unknown-tree close delay with 15 failing cases and 27 controls.
  Distinguish unknown liveness from observed live/stopped, settle unknown close
  promptly without fake confirmation, and retain known-live/no-close escalation.
- [x] Capture `previewOnly` once before validation and carry that value into
  events/state. Preserve the true-only contract with ten characterization cases.
- [x] Fence `/brief` at synchronous live publication, retaining the neutral
  disabled response and the existing `/session` scheduling controls.
- [x] Normalize input/text/tool-call token-accounting failures without raw
  evaluation reasons or loss of cancellation/deadline/core classifications.
- [x] Rerun full integration: 1,448 tests across 108 files, forced typecheck,
  lint, Stable build/7-entry VSIX verification, and both Stable hosts' 17 cases
  pass. The separate POC, installed dependency trees, and all four audits pass.
- [x] Independently re-review process/preview corrections: specification and
  quality pass, 218 additional probes pass, and a native POSIX descendant probe
  confirms retained escalation and cleanup. Windows evidence remains mocked.
- [x] Independently re-review publication/privacy corrections: specification
  and quality pass with the original six probes unchanged, 279 cases across
  17 files, forced root typecheck, and full lint.
- [x] Reply to the three original threads, resolve addressed concerns, and
  obtain another repository assessment and final-head checks.

The fifth-round correction is committed as `e83d872`. CI `35160931543` passes
all four jobs and every actual step, including all 17 Insiders host cases.
Review `5229268443` adds no inline findings but records one summary-only cleanup
and recommends closer final review because of the overall change size. Its job
completion is not treated as approval.

### Sixth repository reassessment

- [x] Simplify the redundant process-signal error conditional to an explicit
  `false` return. Preserve the separate tri-state liveness probe and all
  Windows/no-PID paths. The same 56 process cases pass before and after;
  this is characterization of a cleanup, not RED bug evidence.
- [x] Rerun integration: 1,448 tests across 108 files, forced typecheck, lint,
  Stable build/seven-entry VSIX, 17 cases on each Stable host, separate POC
  check/package/host, installed dependency trees, and all four audits pass.
- [x] Obtain bounded independent review: specification/quality pass, the same
  56 process cases pass before/after, and extension/reference compilation plus
  changed-file lint pass on the exact one-file overlay.
- [ ] Respond to the summary-only finding and obtain a fresh repository
  assessment plus the final committed head's actual check results.

Merge is permitted only after those gates and the final revision's checks pass.
Their live status belongs to the PR/check history, not a prospective approval
in this document.
