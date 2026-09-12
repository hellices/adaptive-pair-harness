# Final Review Fixes Report

- Date: 2026-09-12
- Branch: `feature/realtime-pair-vertical-slice`
- Binding input: `.superpowers/sdd/final-review-findings.md`
- Status: **COMPLETE — no blocked finding**

## Corrections implemented

### Critical: remote endpoint and secret isolation

- Declared provider, base URL, and model settings as application-scoped.
- Runtime reads only global/default values for those settings and warns when a
  workspace, folder, or workspace-language override is present.
- Centralized endpoint validation rejects non-HTTP(S), non-loopback HTTP, URL
  credentials, query strings, fragments, whitespace, and opaque origins.
- API-key secret names are derived from the validated canonical endpoint
  origin. Changing origin requires explicit key setup.
- OpenAI-compatible fetches reject redirects so credentials cannot follow a
  configured endpoint to another location.
- The provider repeats endpoint validation at its own boundary.

### Important findings

- Added one remote-data policy for goal, evidence ID/title/detail/source/
  references, diagnostic metadata, user prompt, and symbol name/kind. It
  redacts URL userinfo and sensitive query values, common credential/token
  formats, and long opaque secret-like values. Credential-bearing automatic
  evidence remains local.
- Semantic analysis now returns explicit `stable`/`unstable` results. Runtime
  suppresses diagnostics/interventions while unstable and retains the last
  stable source for the next comparison.
- Export analysis now covers function-valued variables, local export lists and
  aliases, named/anonymous default exports under external `default` identity,
  CommonJS JavaScript assignments/object exports, optional/async/generator
  syntax, and checker-derived callable signatures.
- Every semantic evidence ID contains hashes of the canonical module URI and
  subject, avoiding cross-file collisions and path disclosure.
- Cooldown starts only after inline rendering succeeds, expires entries, and
  clears on session stop.
- Rolling budget state is hoisted across runtime rebuilds. Reservations own
  input plus output capacity, settle once, and only exact known pre-dispatch
  Copilot selection/consent failures are released. Completion output is capped
  at 180 tokens and accounted.
- Local `/why`, `/explain`, and `/trace` responses are distinct. Local trace
  reports only the VS Code-resolved symbol/range and explicitly says deeper
  control/data-flow analysis requires a model.
- Corrupt memory starts with in-memory defaults, preserves stored corruption,
  warns visibly without delaying startup, and can only be replaced through
  **Adaptive Pair: Reset Local Memory**.

### Required minor corrections and hardening

- Superpowers discovery matches direct `docs/superpowers/plans/*.md` files.
- Repository dismissal identity is selected from the folder owning each
  document in multi-root workspaces.
- Node minimum is consistently `>=22.13.0`; Node 24 remains recommended.
- Toggle shortcut is `Ctrl+Shift+Alt+P` / `Cmd+Shift+Alt+P`.
- OpenAI-compatible calls have a 15-second deadline, 64 KiB response-body
  limit, redirect rejection, and response/output validation.
- README, configuration, architecture, design, and implementation plan now
  describe the corrected behavior.

## Focused RED/GREEN evidence

- Remote configuration: 8 expected failures, then 16 passing tests.
- Central redaction: 2 expected failures, then 5 passing tests.
- Stable baseline: 15 expected failures during API transition, then 31 passing
  semantic/runtime-support tests.
- Export surface/module IDs: 5 expected failures, then 23 passing semantic
  tests.
- Cooldown lifecycle: 4 expected failures, then 8 passing policy tests.
- Output budget: 7 expected failures, then 8 passing budget tests.
- Provider deadline/size/output cap: 4 expected failures, then 24 passing
  provider tests.
- Local Chat semantics: 3 expected failures, then 29 passing router/chat tests.
- Corrupt memory: 2 expected failures, then 9 passing store tests; runtime
  startup recovery also reproduced red then passed.
- Required minor corrections: 3 expected failures, then 27 passing focused
  tests.
- Self-review found a stale-lifecycle pre-dispatch reservation leak; its focused
  regression test failed before the ownership fix and passed afterward.
- Provider-boundary endpoint and redirect defenses were each reproduced with a
  failing focused test before passing.

## Final verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **16 files, 156 tests passed**
- `npm run package`: **PASS**
- VSIX inspection: **155 files**
  - runtime dependency roots: `typescript` only (Apache-2.0)
  - included public docs: `docs/configuration.md` and
    `docs/architecture/vertical-slice.md`
  - excluded source, tests, coverage, workflows, devcontainer/editor files,
    private Superpowers docs, and source maps
- `git diff --check`: **PASS**
- Production secret-pattern scan: **PASS**
- Package fake-URL metadata scan: **PASS**
- Production URL literals: only the documented loopback default
  `http://localhost:11434/v1`
- Full base-to-working-tree self-review: no remaining high-confidence
  correctness, security, or lifecycle finding.

## Residual concerns

- Official Copilot consent UI and a live third-party OpenAI-compatible service
  were not exercised in this non-interactive environment; adapters are covered
  by mocked contract tests.
- TypeScript checker-backed export analysis is intentionally per-document and
  does not resolve cross-file types; this remains within the navigator-only
  vertical-slice boundary.
