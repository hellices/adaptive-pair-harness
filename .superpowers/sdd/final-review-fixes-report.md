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

---

## Whole-Branch Review Round 2

- Date: 2026-09-12
- Binding input: `.superpowers/sdd/final-review-round-2.md`
- Status: **COMPLETE — no blocked finding**

### Corrections implemented

- Validates the raw endpoint before `URL` normalization. Literal `?`/`#`
  delimiters (including empty trailing delimiters), ASCII whitespace/control
  characters, and URL credentials are rejected. The OpenAI-compatible join
  retains base paths such as `/v1`.
- Central redaction now handles quoted credential assignments containing
  spaces and removes complete Basic authorization payloads. These matches mark
  the projection sensitive, retaining automatic evidence locally.
- Callable identifier chains are resolved with the existing per-document
  TypeScript `Program`/`TypeChecker`. Typed variables and TS/JS aliases are
  compared under their external export names without exposing signature/source
  text in evidence.
- Memory reset captures the owning runtime generation before storage mutation
  and publishes reset state only while that fence remains current.
- Copilot generation now uses `LanguageModelChat.countTokens`, forwards the
  supported `modelOptions.max_tokens` allowance, truncates/cancels displayed
  streams at the model-token boundary, and reports the maximum observed output
  count for settlement.
- Output capacity is reserved before dispatch, including while other calls are
  pending. OpenAI-compatible output rejects blank content and uses the maximum
  of provider-reported completion usage and a conservative UTF-8 byte count;
  an absent usage object, absent completion count, or zero usage cannot make
  non-empty output free.
- Public documentation now distinguishes display/budget enforcement from a
  provider-side generation or billing limit. The stable VS Code API does not
  guarantee the latter.

### Focused RED/GREEN evidence

- Endpoint validation: 7 expected failures, then 35 passing endpoint/router
  tests.
- Credential redaction: 2 expected failures, then 19 passing privacy/router
  tests.
- Callable aliases: 3 expected failures, then 26 passing semantic tests.
- Reset lifecycle fence: 1 expected failure, then 11 passing lifecycle tests
  at that boundary.
- Copilot counting/capping: 2 expected failures, then 16 passing provider
  tests.
- OpenAI output accounting: 4 expected failures, then 16 passing router tests.
- Concurrent reservation/accounting coverage passes in the runtime lifecycle
  suite.
- Self-review found that the first correction still required the enclosing
  OpenAI `usage` object. A focused regression reproduced that rejection before
  the conservative full-usage fallback passed.

### Final verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **16 files, 176 tests passed**
- `npm run package`: **PASS**
- VSIX inspection: **155 files**
  - packaged adapter contains `countTokens` and `max_tokens`
  - source, tests, coverage, private Superpowers material, and source maps are
    excluded
- `git diff --check`: **PASS**
- Production credential-value scan: **PASS**
- Package metadata fake-URL scan: **PASS**
- Production URL literals remain limited to the documented loopback default.

### Residual concerns

- The stable VS Code Language Model API accepts provider-specific
  `modelOptions.max_tokens`, but does not contractually guarantee provider-side
  generation or billing enforcement. Adaptive Pair therefore pre-reserves the
  allowance, caps displayed output with the official tokenizer, cancels at the
  boundary, and conservatively accounts already-observed over-boundary
  fragments.
- Live Copilot consent UI and third-party OpenAI-compatible services were not
  exercised in this non-interactive environment; their adapters are covered by
  contract tests.

---

## Whole-Branch Review Round 3

- Date: 2026-09-12
- Binding input: `.superpowers/sdd/final-review-round-3.md`
- Status: **COMPLETE — no blocked finding**

### Corrections implemented

- Central redaction now recognizes JSON-quoted sensitive keys with quoted
  values containing spaces, strips userinfo from HTTP and non-HTTP DSNs, and
  consumes complete long base64/base64url values including padding. A
  40-character threshold and credential-like character check preserve obvious
  short benign values. Every match sets the sensitive-data signal that keeps
  automatic evidence local.
- Exported callable variables now serialize checker-resolved public call
  signatures before falling back to initializer syntax. Explicit annotation
  changes are therefore visible even when the initializer remains typed with
  `any`.
- The per-source TypeScript `Program` now loads standard library declarations
  from the installed TypeScript package. Its host exposes only the analyzed
  source and those standard-library files, while project resolution remains
  disabled. Array element and async return inference are covered.
- Personal memory now uses `ExtensionContext.globalState`. Repository
  dismissals remain partitioned by repository ID inside the shared global
  record, preserving multi-root behavior.
- README, configuration, and architecture documentation now describe the
  expanded redaction policy and global-memory boundary.

### Focused RED/GREEN evidence

- Privacy regressions reproduced failures for JSON keys and non-HTTP DSNs.
  Stricter full-value assertions then exposed both padded encodings, and
  self-review added a failing 40-character padded boundary case. The privacy
  suite finishes with 13 passing tests.
- Callable annotation, array element, and async return regressions all failed
  before the semantic fixes; the semantic suite finishes with 29 passing
  tests.
- The global-state wiring regression failed while `workspaceState` received
  the write. Lifecycle and memory suites finish with 22 passing tests after the
  backend change.
- Combined focused coverage finishes with 64 passing tests.

### Final verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **16 files, 186 tests passed**
- `npm run package`: **PASS**
- VSIX inspection: **155 files**
  - packaged runtime contains global-state wiring, checker-first callable
    serialization, restricted standard-library loading, and complete padded
    value redaction;
  - installed TypeScript standard libraries and public docs are included;
  - source, tests, coverage, private Superpowers material, and source maps are
    excluded.
- `git diff --check`: **PASS**
- Production credential-value scan: **PASS**
- Package metadata fake-URL scan: **PASS**
- Production URL literals remain limited to the documented loopback default.
- Self-review found and fixed the minimum-length padded-base64 boundary; no
  remaining high-confidence correctness, security, or lifecycle finding was
  identified.

### Residual concerns

- Official Copilot consent UI and a live third-party OpenAI-compatible service
  were not exercised in this non-interactive environment; adapters remain
  covered by mocked contract tests.
- Semantic analysis remains intentionally per-document and does not resolve
  project files or cross-file user-defined types. Loading packaged TypeScript
  standard libraries improves built-in inference without widening that privacy
  boundary.

---

## Remaining Whole-Branch Review Fixes

- Date: 2026-09-12
- Status: **COMPLETE — no blocked finding**

### Corrections implemented

- Replaced the permissive default TypeScript compiler host with an explicit
  restricted host. The analyzed source remains in memory; filesystem reads and
  existence checks are admitted only for `lib*.d.ts` files in the canonical
  installed TypeScript library directory. Directory enumeration is disabled,
  `realpath` is non-probing outside the allowed boundary, and module/type
  resolution hooks return unresolved results without consulting the
  filesystem.
- Added an instrumented semantic regression that wraps every relevant
  `ts.sys` filesystem operation and exercises hostile path/type/import
  references. It rejects any probe outside the TypeScript lib directory while
  simultaneously proving that array and Promise inference still detects a
  public API change.
- Centralized sensitive-key normalization for URL query parameters, quoted
  JSON, and assignment syntax. Separator/case variants and compound keys ending
  in `apiKey`, `privateKey`, `password`, `passwd`, `token`, or `secret` are
  redacted, including OAuth-style `client_secret`, `clientSecret`,
  `client-secret`, and `accessToken`.
- Tightened long base64/base64url detection. A long value now needs valid
  terminal padding or a credible lowercase/uppercase/digit mix with sufficient
  character entropy. Padded 40-character credentials, known token prefixes,
  and mixed unpadded tokens remain protected, while package/path names such as
  `@microsoft/applicationinsights-web-snippet` remain intact.

### Focused RED/GREEN evidence

- The compiler-host regression failed with an observed
  `directoryExists` probe of `/private/project`, then the semantic suite passed
  with **30 tests** after the restricted host was installed.
- Normalized-key regressions first failed for client-secret/private-key forms;
  compound password/passwd/token/secret regressions also failed before suffix
  classification was added.
- Package/path and low-entropy fixtures produced **4 expected failures** before
  the base64 heuristic was refined.
- Combined semantic/privacy verification passed with **68 tests**; the final
  privacy suite passed with **46 tests**.

### Final verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **16 files, 220 tests passed**
- `npm run package`: **PASS**
- VSIX inspection: **155 files**
  - restricted compiler-host resolution and normalized/entropy-aware
    redaction are present in the packaged runtime;
  - TypeScript standard libraries and public docs are included;
  - source, tests, coverage, private Superpowers material, source maps, and
    workspace/CI files are excluded;
  - runtime dependency roots contain only `typescript`.
- `git diff --check`: **PASS**
- Production credential-literal scan: **PASS**
- Package metadata fake-URL scan: **PASS**
- Production URL literals remain limited to the documented loopback default.
- Self-review found no remaining high-confidence correctness, security, or
  lifecycle issue in the changed paths.

### Residual concerns

- Official Copilot consent UI and a live third-party OpenAI-compatible service
  were not exercised in this non-interactive environment; adapters remain
  covered by mocked contract tests.
- Semantic analysis intentionally remains per-document and refuses project or
  cross-file resolution. Only the installed TypeScript standard library is
  available to the checker.
