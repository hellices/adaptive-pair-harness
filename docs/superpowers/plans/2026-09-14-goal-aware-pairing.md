# Goal-aware Pairing Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans, inline in this workspace. Do not create branches or commits.

**Goal:** Read project documents, agree on a real goal, and support continuous planning and review without requiring a static warning.

**Architecture:** Preserve the evidence sensor and lifecycle/budget/privacy gates. Add bounded local project context, a transient working agreement, scoped conversation history, and explicit sharing consent. Open document drafts unsaved; never automatically edit project files or run commands.

**Tech Stack:** TypeScript, VS Code workspace/Chat APIs, existing providers, Vitest; no new dependencies.

## Global Constraints

- VS Code 1.136.0 and Node.js 22.13.0 minimums remain unchanged.
- Start remains explicit. Respect Workspace Trust, selected-root ownership, symlinks, read bounds, and cancellation.
- Workspace contents remain local until session-scoped consent. Credentials and absolute local resources still force local fallback.
- Stop/rebuild/root replacement clear goal, context, consent, and conversation scope.
- Repository text and model output are untrusted data, not permission to act.
- Preserve existing static-analysis, memory, privacy, and budget contracts except explicitly extended behavior.

## Task 1: Project context

**Files:** `src/core/projectContext.ts`, `src/vscode/projectContextReader.ts`, corresponding `test/*.test.ts`.

**Interfaces:** `ProjectDocument` contains URI, relative label, and bounded text. `ProjectContext` contains root, documents, candidate goal, criteria, constraints, and notices. `WorkingAgreement` contains confirmed goal, phase, consent, and conversation scope.

- [x] Test English/Korean headings, missing docs, limits, drafts, root isolation, symlinks, oversized files, and cancellation.
- [x] Run `npm test -- test/projectContext.test.ts test/projectContextReader.test.ts` and observe missing behavior.
- [x] Implement pure extraction and an injected reader; do not invent missing requirements.
- [x] Re-run focused tests and compile.

## Task 2: Goal-aware models

**Files:** `src/core/modelRouter.ts`, `src/vscode/vsCodeLanguageModelProvider.ts`, model/privacy tests.

**Interfaces:** Optional `ModelRequest.evidence`; `plan`/`checkpoint` purposes; working-goal, conversation, and consent-labelled workspace context.

- [x] Test evidence-free planning, goal-aware fallback, purpose instructions, consent omission, pre-truncation credential detection, bounded history, and distinct code prompts.
- [x] Run focused tests to establish red, then implement context projection and local planning.
- [x] Preserve automatic evidence whitelisting. Quote retrieved text as data and never claim unperformed tests or analysis.
- [x] Re-run model and privacy tests.

## Task 3: Chat continuity

**Files:** `src/vscode/pairChatParticipant.ts`, `src/vscode/pairConversation.ts`, corresponding tests.

**Interfaces:** Optional working snapshot; `/goal`, `/context`, `/brief` controls; evidence-free `/plan` and `/checkpoint`; history scoped to participant/session/goal/consent.

- [x] Test pre-edit planning, goal confirmation/display, same-scope follow-ups, and exclusion of old or unconsented turns.
- [x] Observe failing tests, implement controls/history, and re-run.
- [x] Preserve evidence requirements for `/why` and `/trace`; invalidate stale requests.

## Task 4: Runtime and UI

**Files:** `src/vscode/pairRuntime.ts`, `src/extension.ts`, `package.json`, runtime tests.

- [x] Test actual document reads, goals reaching providers, selected code, consent revocation, and lifecycle changes during asynchronous operations.
- [x] Observe failures, then integrate start/refresh, goal confirmation, modal sharing disclosure, and unsaved drafts.
- [x] Keep roots isolated and use existing generation/revision fences.
- [x] Allow longer requested planning responses inside the visible budget while retaining concise automatic output.
- [x] Re-run runtime, Chat, configuration, and budget tests.

## Task 5: Verification and docs

**Files:** `README.md`, `docs/configuration.md`, `docs/architecture/vertical-slice.md`.

- [x] Document start, document clarification, goal confirmation, planning, coding, and checkpoints with actual developer-supplied test results.
- [x] Explain local-template limitations, partial reads, sharing, and unsaved drafts.
- [x] Run `npm run check` and `npm run package`; inspect outputs.
- [x] Review for unintended source transfer, unbounded reads, stale actions, and unsupported claims. Leave changes uncommitted.

## Review follow-ups

- [x] Scope evidence and successful response metadata to the host-resolved owning root; prevent cross-root fallback history transfer.
- [x] Revoke sharing before document refresh, retain a separate read/lifecycle fence, and block reapproval during the read.
- [x] Commit developer dialogue and phase only after successful, still-current generation.
- [x] Preserve approved-only sensitivity metadata before local document truncation and through runtime/model projection.
- [x] Use the active selection for root-scoped planning; never apply another source's evidence range or substitute an unrelated open buffer.
- [x] Scan complete eligible current/previous code regions before local excerpt limits; preserve approved-only sensitivity through model projection.
- [x] Scan complete explicit goal input before parsing or list limits; retain task sensitivity independently of workspace consent and clear it on clean replacement.

Verification on September 14, 2026: `npm run check` passes compilation, lint,
and 778 tests in 26 files. `npm run package` succeeds; the VSIX contains 166
entries. All 26 compiled extension modules, the manifest, and four documentation
files match the checked workspace; sources, tests, maps, and internal plans are excluded.
The targeted independent recheck confirms the final code/goal truncation fixes
with 26 core/Chat cases and 12 runtime scenarios; no remaining must-fix finding
was reported within that scope.
Live VS Code GUI/provider consent and model interaction remain unverified.

## Acceptance

1. Documents provide proposed goals/criteria before edits; missing docs still allow planning and an editable brief.
2. Explicit goal changes affect requests, and scoped follow-ups retain the developer's answers.
3. Only approved workspace context reaches models; credentials, other roots, and old sessions do not.
4. Stop, rebuild, root/goal/context changes, and consent revocation invalidate pending work.
5. Checkpoints ask for observed verification without pretending to execute tests.
