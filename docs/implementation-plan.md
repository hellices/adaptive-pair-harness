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
- [ ] Probe and address operation admission, immutable request payload, and
  queued grant-cancellation boundaries in the authoritative runtime, including
  concurrent recovery rather than only reconciliation after invocation settles.
- [x] Check the archive end-record scan's short-buffer and maximum-comment
  boundaries. These probes pass without changing the parser; request a concrete
  counterexample if a different archive concern remains.
- [ ] Reject NUL-containing dirty scope buffers consistently with disk reads,
  and retain deleted dirty verification buffers addressed through safe aliases.
- [ ] Complete independent follow-up reviews, full local/host/package gates,
  original-thread replies/resolution, and a fresh normal repository review.

The follow-up local checkpoint passes forced typecheck, enforced lint, 972
workspace tests, both Stable hosts' 17 scenarios, Stable packaging, the separate
POC's 8 unit tests/package/1 Insiders host case, and all four dependency audits.
This is not a substitute for the remaining independent and repository review.

Merge is permitted only after those gates and the final revision's checks pass.
Their live status belongs to the PR/check history, not a prospective approval
in this document.
