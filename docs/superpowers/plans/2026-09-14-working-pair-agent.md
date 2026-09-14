# Working pair agent

The previous slice supplied task context to a single text completion while
ignoring the Chat model picker. This change makes interactive pairing a bounded,
tool-using development loop. Background interventions retain their existing
local-first provider and budget.

## Contract

- Interactive Chat uses `ChatRequest.model`, not the background provider.
- The first ordinary request starts a session if needed. Workspace sharing is
  approved for that session, goal/context epoch, and exact selected model.
- The model can discover files, read targeted source/document ranges, and search
  the working root. It must distinguish observed facts from proposals.
- Requested implementation and document work can propose exact file edits.
  Every edit requires a diff and explicit apply-and-save confirmation. Stale
  buffers, out-of-root paths, symlinks, and secret files are rejected.
- Verification can run an existing npm validation script only after confirmation
  showing the actual script. No arbitrary model-generated shell command runs.
- Tool results return to the model in the same turn. Actual edit/check outcomes
  are recorded separately from the generated explanation.
- Calls, input/output, file reads, search results, actions, and run time are
  bounded. Cancellation and session/goal/root replacement stop further actions.
- Missing models, denied access, failed checks, and budget exhaustion are explicit
  states, never successful-looking template answers.

## Tasks

- [x] Parent: write failing tests for the model/tool loop, implement bounded
  orchestration in `src/core/pairAgent.ts`, and connect the selected native model.
- [x] Workspace worker: implement `src/vscode/pairWorkspaceTools.ts` and its tests.
  Own discovery/read/search, approved exact edits, and approved npm checks.
- [x] Host-test worker: add an isolated real Extension Development Host runner
  and filesystem/activation smoke tests, without installing into the user's IDE.
- [x] Parent: wire lifecycle, model-specific consent, focused-file references,
  Chat progress, code presentation, actual outcomes, and local-only opt-out.
- [x] Verify focused red/green cases, the full existing suite, real host behavior,
  and rebuilt VSIX contents. Record exactly which model checks were possible.

## Workspace tool interface

The tool module exports `createPairWorkspaceTools(options): PairAgentToolbox`.
Options include a `rootUri`, an `isCurrent()` lifecycle predicate, optional
approval callbacks for host testing, and optional progress reporting.
The shared core toolbox has `definitions` and `invoke(name, input, signal)`.
Definitions contain `name`, `description`, `inputSchema`, and `kind` (`read`,
`edit`, `check`). Results contain `status` (`ok`, `declined`, `blocked`, `error`),
`text`, `summary`, and optional `sensitiveDataDetected`. Inputs are untrusted.
Tool names are `list_files`, `read_file`, `search_files`, `edit_file`, `run_check`.

No branch, commit, dependency upgrade, credential copying, or production IDE
installation is part of this work. All earlier goal-aware changes are retained.

## Verification record — 2026-09-14

- `npm run check`: TypeScript compilation, ESLint, and 948 tests in 31 files pass.
- `npm run test:host`: 14 native scenarios pass on an isolated official VS Code
  1.137.0 build; extension activation, all 13 contributed commands, disk/open
  buffer reads, discovery/search, reviewed-action callbacks, protected paths,
  stale-buffer rejection, and actual npm exits 0 and 7 are exercised.
- The installed Insiders build was update-locked and installed stable 1.127.0
  was correctly rejected by the extension's engine requirement. Neither IDE,
  updater, user profile nor authentication state was modified. The compatible
  test build and all fixture/user-data directories remain separate.
- Native tests exposed Windows URI drive-casing differences, clean document
  disposal after save, and a first-read native ctime change. These were reproduced
  in unit regressions and fixed without relaxing root/ownership or stale-edit
  checks. Metadata-only first reads allow one budgeted re-read only when file
  identity, size, mtime and bytes remain unchanged. Saved empty files must also
  still exist before reporting success.
- Independent review findings on startup/runtime replacement, failed-read
  inspection gating, and deleted empty targets were reproduced and fixed.
- `/why` includes approved same-root inline evidence and its source range,
  instead of silently explaining a different active editor; regression tests
  cover denied access and cross-root/encoded traversal observations.
- Final native JSON receipt is outside the workspace at
  `C:\Users\inhwanhwang\AppData\Local\Temp\adaptive-pair-host-luZ3be\smoke-result.json`.
  It explicitly records `languageModelExercised: false` and
  `approvalUiExercised: false`. Model routing/tool-loop behavior is covered by
  deterministic adapter/session tests, not a signed-in real-provider call.
  A user's actual model/authentication and manual approval-dialog interaction
  remain an explicit manual acceptance step, not a claimed automated pass.
- `npm run package`: rebuilt `adaptive-pair-harness-0.1.0.vsix` successfully
  (170 archive entries, 4.42 MB). All 30 packaged production JavaScript modules
  match the final compiled files by SHA-256. The new mode, commands and public
  docs are present; source, tests, maps, scripts and internal plans are excluded.
  VSIX SHA-256:
  `6AEDFE7C2A44B2600D5DFDC6660AD74B4709A4108FB53BFDDBFE03F1DFC13120`.
- The packaged file is attached to the session. It was not installed into the
  user's running IDE; replacing an existing installation remains user-owned.
