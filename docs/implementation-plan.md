# Native Growth Hands-on Implementation Plan

> **For agentic workers:** use `superpowers:executing-plans` task by task in the
> current dedicated branch. Observe RED before implementation, GREEN before
> committing, and review each deliverable against the approved contract.
> Subagent tooling is optional, not a product dependency.

**Status:** owner approved the written contract on September 22, 2026;
implementation and task-scoped review are complete. The final setup and
checkpoint publication-boundary corrections passed independent re-review;
whole-branch findings I1–I5 and M1 are closed at reviewed source `d9f222e`.
The full root check passes 3,040 cases in 142 files on Vitest 5.0.1; both
refreshed dependency graphs pass their audits. Real-host restart validation
passes on both Stable hosts and Insiders on macOS and Linux. Stable packaging
and seven-entry archive inspection also pass. PR #14 records original review
thread dispositions and the latest revision's delivery checks; readiness is
reported only after those current checks and follow-up feedback are verified.
Authenticated owner-model guidance remains a manual trial, not fixture proof.
This deliberately replaces the completed P2b
plan, retained at `ba20468:docs/implementation-plan.md` in Git. PR #13's
unmerged feasibility work is evidence, not an implicit merge or product
dependency.

**Goal:** deliver a Stable VSIX with reachable Growth setup, explicitly saved
native historical checkpoints, and a reproducible local exercise.

**Architecture:** native input and confirmation ports drive the existing
coordinator from briefing into an agreed human-owned Growth work unit. A
separate, pure allowlist projects tiny historical records into public chat
metadata; reading them never touches the live runtime. Existing model,
restraint, effect, verification, and ownership boundaries remain intact.

**Tech stack:** TypeScript, public VS Code APIs, existing Vitest/fast-check and
Extension Host infrastructure, and a dependency-free Node exercise. No SDK,
new credential store, proposed production API, or durable-storage adapter.

## Global constraints

- Implement [design section 13.3](design.md#133-native-growth-hands-on-milestone).
- Work from `ba20468` on `agents/native-growth-trial`; do not merge PR #13 or
  modify unrelated worktrees.
- Preserve inactive-zero, additive integration, all effect-side authorization,
  Growth restraints, and separate product/learning outcomes.
- Keep the live runtime workspace-window scoped; checkpoints do not identify
  native chats, restore authority, or implement P2b storage.
- Checkpoint schema version is `1`, maximum encoded size is 512 UTF-8 bytes,
  and history examination is limited to the latest 32 total turns.
- Use English repository documentation and the canonical documentation files.
- Check every active manifest/lockfile and relevant current release metadata;
  retain older versions only with a documented compatibility reason.
- Continue through commit, push, PR, review, and final-revision checks. Merging
  still requires separate owner direction.

## Task 1: Pure non-authorizing checkpoint contract

**Files:** create `apps/vscode-extension/src/nativeCheckpoint.ts` and
`apps/vscode-extension/test/nativeCheckpoint.test.ts`.

**Interfaces:**

```ts
type NativeHistoryInspection =
  | { readonly status: "missing" }
  | { readonly status: "invalid" }
  | { readonly status: "available"; readonly checkpoint: NativeGrowthCheckpoint };

function createNativeCheckpoint(snapshot: PairRuntimeSnapshot): NativeGrowthCheckpoint | undefined;
function inspectNativeHistory(history: readonly unknown[]): NativeHistoryInspection;
function renderNativeHistory(inspection: NativeHistoryInspection): string;
```

`NativeGrowthCheckpoint` has exactly the nine fields in design section 13.3.
The helpers import protocol types only; they do not depend on VS Code, a
coordinator, a disk store, a model, or time. `inspectNativeHistory` accepts only
metadata under `adaptivePairCheckpoint` from `adaptivePair.chat` responses.

- [x] Add tests for the exact allowlist, privacy sentinels, inactive/paused
  snapshots, enum validation, unknown fields/versions, accessor rejection,
  foreign participants, the 32-turn bound, and invalid-newest non-fallback.
  A copied checkpoint may be displayed but cannot mutate its input snapshot.

  ```ts
  expect(inspectNativeHistory([])).toEqual({ status: "missing" });
  expect(renderNativeHistory({ status: "missing" })).toContain("No checkpoint");
  expect(JSON.stringify(checkpoint)).not.toContain("private-source-sentinel");
  expect(Buffer.byteLength(JSON.stringify(checkpoint), "utf8")).toBeLessThanOrEqual(512);
  ```

- [x] Run `npx vitest run apps/vscode-extension/test/nativeCheckpoint.test.ts`;
  observe the missing-export RED before adding the module.
- [x] Project explicit fields, validate closed data descriptors and bounded
  primitives, and produce static historical/non-authorizing presentation.
- [x] Run the focused suite and typecheck; review every field against the
  privacy contract, then commit `feat: define minimized native checkpoints`.

## Task 2: Reachable, explicitly approved Growth setup

**Files:** create `apps/vscode-extension/src/growthSetup.ts`,
`apps/vscode-extension/src/growthSetupUi.ts`, and
`apps/vscode-extension/test/growthSetup.test.ts`; modify
`apps/vscode-extension/src/sessionController.ts` and add controller cancellation
coverage to `apps/vscode-extension/test/sessionController.test.ts`.

**Interfaces:**

```ts
interface GrowthSetupInput {
  readonly objective: string;
  readonly allowedPath: string;
  readonly independentCheck: string;
  readonly verificationPlan: string;
}
type GrowthSetupStage = "learning" | "mode" | "work-unit";
interface GrowthSetupUi {
  collect(signal: AbortSignal): Promise<GrowthSetupInput | undefined>;
  confirm(stage: GrowthSetupStage, description: string, signal: AbortSignal): Promise<boolean>;
}
type GrowthSetupOutcome = "completed" | "cancelled" | "unavailable" | "stale" | "failed";
```

`runGrowthSetup` consumes a coordinator, a synchronous current-snapshot getter,
a cancellable entry-preparation callback, a `GrowthSetupUi`, and an abort signal.
It produces `GrowthSetupOutcome`, never a grant or an authority-bearing restored
snapshot. The native UI validates bounded text and a selected local workspace
file; the coordinator still owns final action admission.

- [x] Reproduce the missing first-use path with a real empty coordinator,
  explicitly enable/start, and assert no work unit or model request exists.
  Add a RED test for a completed setup using three independent confirmations.

  ```ts
  expect(store.snapshotNow().session?.status).toBe("briefing");
  expect(await runGrowthSetup(dependencies, signal)).toBe("completed");
  expect(store.snapshotNow().session?.workUnit).toMatchObject({
    mode: "growth", owner: "human", status: "agreed",
  });
  expect(confirmations).toEqual(["learning", "mode", "work-unit"]);
  ```

- [x] Observe RED with `npx vitest run apps/vscode-extension/test/growthSetup.test.ts`.
- [x] Collect input before mutation, prepare bounded entry, confirm learning,
  select Growth, propose a human-owned scoped unit, and agree it. Use the
  existing coordinator grant/invoke APIs with current revision/epoch checks.
  Never overwrite an operational unit or bypass an explicit confirmation.
- [x] Cover every declined/cancelled dialog, invalid input/scope, cancellation
  during entry capture, disabled/paused/replaced session, stale revision, a
  failed coordinator action, and retry of an incomplete briefing.
- [x] Run the setup/controller suites and typecheck, then commit
  `feat: add explicit native Growth setup`.

## Task 3: Public participant routes and metadata publication

**Files:** modify `apps/vscode-extension/src/growthParticipant.ts`,
`growthIntent.ts`, `growthHostState.ts`, `growthPresentation.ts`,
`extensionCore.ts`, and `presenceController.ts` in the same source directory;
modify `apps/vscode-extension/package.json`; create
`apps/vscode-extension/src/growthCheckpointRoutes.ts` and
`apps/vscode-extension/test/growthNativeRoutes.test.ts`.

**Interfaces:** the participant returns `Promise<vscode.ChatResult | void>`.
Its dependencies gain an optional setup callback and optional checkpoint
confirmation port; production always supplies both. Existing harnesses can
omit them and receive an explicit unavailable response, never automatic
approval. The handler's new local intents are `setup`, `checkpoint`, `history`.

- [x] Add RED public-handler tests for all three slash commands and their
  natural-language equivalents. Check `/setup` does not use the model;
  `/checkpoint` returns the agreed namespace only after confirmation;
  `/history` reads metadata without invoking any coordinator mutation.

  ```ts
  expect(result?.metadata).toEqual({ adaptivePairCheckpoint: expectedCheckpoint });
  expect(modelRequests).toBe(0);
  expect(liveSnapshotAfterHistory).toEqual(liveSnapshotBeforeHistory);
  ```

- [x] Run the new route suite and observe RED, then wire only these routes.
  Keep checkpoint publication behind enabled/active/current-state and abort
  checks. Do not add checkpoint metadata to model context.
- [x] Distinguish selected-chat historical state from the current window's
  live state. Make first-use errors point to `/setup`. Explain native history
  retention in both checkpoint and disable confirmations.
- [x] Cover declined/stale/cancelled publication, empty/malformed/foreign
  history, disabled zero-activity, a freshly started runtime with old metadata,
  and a fork-shaped copy which does not satisfy an attempt/hint gate.
- [x] Run all Growth, extension lifecycle, and presence suites plus typecheck
  and lint; commit `feat: expose native Growth checkpoint and history routes`.

## Task 4: Reproducible exercise and installable trial

**Files:** add `examples/growth-trial/package.json`,
`examples/growth-trial/src/retry.mjs`, and
`examples/growth-trial/test/retry.test.mjs`; update `README.md`,
`docs/growth-preview.md`, `docs/research.md`, root/extension versions and their
lockfile entries. Extend existing manifest/packaging assertions as necessary.

- [x] Add a small deliberate retry-boundary defect and Node built-in tests.
  The exercise's `test` script is `node --test`; it has no dependencies and
  needs no installation. Prove its initial expected failing case, then verify
  the intended human repair only in a disposable copy, not in the shipped task.
- [x] Document the exact enable/start/setup/attempt/hint/check/checkpoint/reopen
  sequence, Copilot/model access prerequisites, native history ownership,
  cancellation/reset, and known preview limits. Do not claim authenticated
  inference based on mocks or fixture models.
- [x] Set the product trial version to `0.2.0-preview.2`, maintain manifests and
  lockfiles consistently, and test the package's public commands/routes.
- [x] Run documentation-link and package checks. Commit
  `docs: ship the native Growth trial walkthrough and exercise`.

## Task 5: Real host validation and reviewed delivery

**Files:** extend `apps/vscode-extension/test/host/` fixtures, public handler
exposure, and Growth smoke coverage; extend `scripts/test-extension-host.mjs`
or add a narrowly scoped native-history smoke runner if separate application
launches are necessary. Any testing-only private diagnostic stays out of the
production bundle and is identified as such in measured evidence.

- [x] Test empty-to-agreed setup through production wiring and real
  coordinator state. Exercise actual callback confirmations, state changes,
  verification, and cancellation rather than pre-seeding an agreed snapshot.
- [x] Exercise checkpoint return and historical inspection after host restart,
  including a fresh live runtime and no recovered authority. Reuse prior
  native-reopening evidence only as explicitly attributed evidence; do not
  mislabel manually supplied history as measured native persistence.
- [x] Inventory all manifests and lockfiles, cross-check registry/upstream
  releases and compatibility constraints, and run each applicable audit.
- [x] Run `npm run check`, affected isolated-prototype checks, Stable host
  smoke, build, and packaging under the Node 24 baseline. Inspect VSIX entries
  for accidental SDK, prototype, test, and private-API inclusion.
- [x] Record exact observed results and remaining user-account checks in the
  canonical docs; commit verified changes, push, and open the PR against main.
- [x] Obtain review, verify and fix actionable findings, and reply in their
  original threads. Prepare the actual local VSIX and a short user trial.

**Final delivery gate:** recheck follow-up review feedback and every required
check on the latest PR SHA before reporting readiness. A prior source approval
or passing run never approves a later revision. Report readiness without
merging or enabling auto-merge; the owner still controls those actions.
