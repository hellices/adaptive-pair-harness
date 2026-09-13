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

---

## Whole-Branch Review Round 4

- Date: 2026-09-12
- Binding input: `.superpowers/sdd/final-review-round-4.md`
- Status: **COMPLETE — no blocked finding**

### Corrections implemented

- TypeScript library access now uses an injectable, narrow filesystem adapter.
  The installed library directory and every allowed-looking `lib*.d.ts`
  candidate are resolved to real paths before a read. Candidates outside the
  canonical root—including direct symlink files and symlinked path
  components—are rejected without probing or returning their target.
- Sensitive-key classification now uses one normalized root list across URL
  query parameters, quoted keys, assignments, and header-shaped text.
  Dotted, dashed, underscored, camel-case, and quoted forms now cover
  credential, signature, client-secret, API-key, access-key, token, password,
  private-key, and secret roots. Keyed lowercase hexadecimal signatures are
  redacted while unrelated commit hashes remain intact.
- Model providers now expose a prepared-dispatch contract carrying the
  provider-specific input count. Copilot selects one model and uses that
  model's official `countTokens` result before atomic budget reservation and
  before sending. OpenAI-compatible admission uses the UTF-8 byte length of
  the exact serialized body, which cannot undercount the previous
  character-length/4 heuristic.
- Budget denial disposes the prepared request and falls back locally without
  dispatch. Existing atomic input/output reservation, conservative settlement,
  unavailable-provider fallback, and exact-release rules remain intact.
- Cancellation is rechecked after asynchronous Copilot counting and after
  provider preparation so a stale request cannot reserve capacity or dispatch.
- README, configuration, and architecture documentation now describe the
  provider-aware pre-reservation counts and estimates.

### Focused RED/GREEN evidence

- The injected standard-library symlink regression failed because the analyzer
  ignored the adapter, then passed after canonical containment was added; the
  semantic suite finishes with **31 passing tests**.
- New normalized-key cases produced **13 expected failures** before
  centralization. The privacy suite finishes with **61 passing tests**, including
  presigned lowercase hexadecimal signatures and benign commit hashes.
- CJK/code-dense Copilot admission and OpenAI UTF-8 estimate cases produced
  **4 expected failures** before provider-aware preparation. Cancellation
  regressions independently reproduced reservation leaks during Copilot
  counting and after OpenAI preparation before passing.
- Combined focused verification finishes with **151 passing tests**.

### Final verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **16 files, 242 tests passed**
- `npm run package`: **PASS**
- VSIX inspection: **155 files**
  - canonical containment, centralized key handling, UTF-8 estimation, and
    provider-aware prepared dispatch are present in compiled runtime output;
  - updated public budget documentation and TypeScript runtime libraries are
    included;
  - source, tests, coverage, private Superpowers material, source maps, and
    workspace/CI files are excluded.
- `git diff --check`: **PASS**
- Production credential-value scan: **PASS**
- Package metadata fake-URL scan: **PASS**
- Production URL literals remain limited to the documented loopback default
  `http://localhost:11434/v1`.
- Full changed-file self-review found and fixed two stale-cancellation
  reservation windows; no remaining high-confidence correctness, security, or
  lifecycle finding was identified.

### Residual concerns

- Official Copilot consent/UI behavior and a live third-party
  OpenAI-compatible service were not exercised in this non-interactive
  environment; narrow injected adapters cover model selection, exact token
  counting, cancellation, dispatch, and fallback behavior.
- The OpenAI-compatible input estimate intentionally treats each UTF-8 byte as
  a token. This is conservative and may reduce remote-call throughput for
  multibyte or code-dense prompts, but prevents admission underestimation.

---

## Whole-Branch Important Findings — Final Follow-up

- Date: 2026-09-12
- Status: **COMPLETE — both remaining Important findings fixed**

### Corrections implemented

- Sensitive quoted keys are now parsed independently from value quoting.
  Matching quotes, opposite quotes (including the exact
  `"api.key": 'mixed quoted value'` regression), and unquoted values are all
  fully replaced with `[REDACTED]` and mark the request as sensitive.
- Sensitive header keys are located before consuming their values, so
  `Authorization:` and normalized variants redact through end-of-line,
  including embedded spaces, without being skipped by an earlier benign
  `key:` on the same line.
- Sensitive-key normalization now includes `accessKeyId`/AWS-prefixed forms
  while retaining `secretAccessKey`, credential, signature, and client-secret
  variants. Keyed lowercase hexadecimal values are redacted; unrelated commit
  hashes and benign package names remain unflagged.
- OpenAI-compatible over-limit responses now throw a typed
  `ModelOutputLimitError` carrying observed input/output usage and confirmed
  dispatch state.
- Runtime failure handling settles the exact reservation by ID with the
  conservative observed usage before rethrowing and republishes the resulting
  budget. Dispatched calls are never refunded; concurrent reservations retain
  their ownership.

### TDD evidence

- Privacy RED: **10 expected failures** exposed mixed/no-quote key parsing,
  incomplete header values, and missing `accessKeyId` normalization.
- Self-review RED: **1 expected failure** showed a benign earlier colon could
  hide a later sensitive header on the same line.
- Provider/runtime RED: **2 expected failures** showed the untyped limit error;
  after adding the typed provider error, the runtime regression still failed
  with **360 remaining instead of 40**, proving only the two 180-token
  reservations were accounted. A separate RED then showed the published
  session still reported 360.
- GREEN: focused privacy/model/runtime verification completed with **5 files,
  145 tests passed**. The 500-token over-limit response settles alongside the
  concurrent reservation (40 remaining), then owns exactly 500 tokens after
  the concurrent 4-token response settles (504 total observed usage).

### Final verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **16 files, 267 tests passed**
- `npm run package`: **PASS**
- VSIX inspection: **155 files**
  - compiled `ModelOutputLimitError`, `accesskeyid`, header scanning, and
    runtime settlement markers are present;
  - source, tests, coverage, private Superpowers material, source maps, and
    workspace/CI files are excluded.
- `git diff --check`: **PASS**
- Production secret-value scan: **PASS**
- Package metadata fake-URL scan: **PASS**
- Production URL literals remain limited to the documented loopback default
  `http://localhost:11434/v1`.
- Changed-file self-review found and fixed the benign-colon header scanning
  gap; no remaining high-confidence correctness, privacy, accounting, or
  concurrency concern was identified.

### Residual concerns

- Official Copilot consent/UI behavior and a live third-party
  OpenAI-compatible endpoint were not exercised in this non-interactive
  environment; provider and runtime boundaries are covered by injected
  contract tests.
- Over-limit provider usage can intentionally exceed the configured rolling
  cap in accounting. Remaining budget clamps to zero rather than hiding usage
  that the already-dispatched request actually consumed.

---

## GitHub Copilot Review Findings Follow-up

- Date: 2026-09-12
- Binding input: `.superpowers/sdd/copilot-review-findings.md`
- Status: **COMPLETE — all binding and suppressed findings addressed**

### Corrections implemented

- Document eligibility now accepts TypeScript/JavaScript documents using
  either `file:` or `vscode-remote:` and continues to reject unrelated schemes
  and languages.
- Added Command Palette actions to dismiss current evidence, approve its
  privacy-safe summary, and select/persist `eco`, `balanced`, or `active`
  intervention style. Persisted styles are applied to policy thresholds and
  managed budgets on later session starts. Dismissals are written under the
  workspace root that owns the evidence, including remote and multi-root
  workspaces, and are honored by manual review.
- The complete local intervention question is normalized and capped at 1,000
  characters after title, detail, and prompt text are concatenated.
- Runtime rebuild now rechecks extension disposal immediately after
  asynchronous secret retrieval and creates no replacement runtime or VS Code
  resources when disposal won the race.
- Shared Chat state now carries an opaque monotonic revision advanced by
  runtime replacement and evidence changes. Symbol-resolution, model-success,
  and model-error post-await paths fence against that revision instead of
  sanitized evidence IDs.
- Memory reset stops active or pending session work before resetting storage,
  preventing deferred preparation from republishing stale state.
- Rejected preparation from a stopped or replaced generation resolves with the
  stopped result; current-generation preparation failures continue to reject.
- README, configuration reference, architecture, activation events, and
  command contributions now describe the implemented behavior.

### Focused RED/GREEN evidence

- Remote URI eligibility: 1 expected failure, then pass.
- Complete local-question bound: 1 expected failure, then pass.
- Stale preparation rejection: 1 expected failure, then both stale and current
  preparation-failure tests passed.
- Secret lookup/disposal: 1 expected failure, then pass.
- Opaque Chat revision: 3 expected failures covering redaction-changing IDs,
  stale model output, and stale symbol resolution; all passed after the
  revision fence.
- Reset during deferred preparation: 1 expected failure, then pass.
- Memory/UI wiring: 5 expected failures for missing runtime actions, loaded
  style behavior, and manifest contributions; all passed after wiring.
- Manual dismissal: 1 expected failure showing dismissed diagnostics could be
  selected again, then pass after filtering all manual evidence sources.
- Focused final run: **7 files, 124 tests passed**.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **16 files, 281 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 88.38%, branches 79.00%, functions 91.48%, lines 88.55%
- `npm run package`: **PASS**
- `npm audit`: **PASS — 0 vulnerabilities**
- VSIX inspection: **155 files**
  - new commands and public documentation are present;
  - source, tests, coverage, private review material, source maps, and
    workspace/CI files are excluded;
  - production dependency root remains `typescript@5.9.3`.
- `git diff --check`: **PASS**
- Production secret-pattern scan: **PASS**
- Packaged metadata fake-URL scan: **PASS**
- Changed-file self-review found no remaining high-confidence correctness,
  privacy, lifecycle, or concurrency issue.

### Residual concerns

- Official Copilot consent/UI behavior, Command Palette interaction, and a live
  third-party OpenAI-compatible service were not exercised in this
  non-interactive environment. Their boundaries are covered by unit and
  contract tests.

---

## Copilot Feedback Fix Review

- Date: 2026-09-13
- Binding input: `.superpowers/sdd/copilot-fix-review-findings.md`
- Status: **COMPLETE — all binding findings addressed**

### Corrections implemented

- Version-1 Pair memory now records whether intervention style is an explicit
  user selection. Dismiss/approve writes preserve default intent, configuration
  remains authoritative without a selection, and reset returns immediately to
  the configured style. Unmarked legacy `balanced` records remain defaults;
  unmarked legacy `eco`/`active` records retain selected behavior.
- Memory mutations use an adapter-scoped revision and serialization queue.
  Session preparation reloads a memory snapshot when a concurrent action
  changes that revision.
- Activation owns one Pair memory adapter/store and passes it through every
  runtime rebuild, so mutations before and after replacement share one queue.
- Shared evidence tracks per-URI revisions. A dismissal can clean its target
  after unrelated URI activity without removing newer evidence for that same
  URI.
- Persisted evidence identities are stable SHA-256 hashes. Legacy raw version-1
  identities normalize on read and are rewritten as hashes on the next
  mutation. Approved titles use the existing credential sanitizer, remove URI
  and path tokens, and are bounded to 120 characters; diagnostic titles are
  fixed metadata.
- README, configuration reference, manifest setting description, and
  architecture documentation describe explicit preference intent,
  serialization/fencing, URI-local cleanup, and persistence privacy.

### TDD evidence

- Explicit preference intent: four regressions failed first for missing intent
  metadata and dismiss/approve overriding configured `eco`, then passed.
- Deferred preparation: the moderate-confidence diagnostic stayed quiet after
  an `active` update made during deferred discovery; it rendered after revision
  fencing reloaded memory.
- Runtime rebuild serialization: two adapters read stale state concurrently
  before the extension-scoped store was wired; the regression then observed
  one pre-write read and preserved both mutations.
- URI-local dismissal: unrelated evidence advanced the global revision and
  left the target thread visible before per-URI revisions; target-only cleanup
  then passed.
- Persistence privacy: raw URI identity, credential-bearing title, and
  unbounded title assertions failed before hashing/sanitization. A second RED
  exposed runtime raw-ID matching, and self-review added a failing relative-path
  title case before the final sanitizer correction.
- Reset/config authority: reset produced the materialized `balanced` budget
  before returning to the configured style.
- Focused final run: **5 files, 170 tests passed**.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **16 files, 291 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 88.48%, branches 79.28%, functions 91.68%, lines 88.64%
- `npm run package`: **PASS**
- `npm audit`: **PASS — 0 vulnerabilities**
- VSIX inspection: **155 files**
  - packaged runtime contains hashed identity, explicit-intent, and per-URI
    revision logic;
  - source, tests, coverage, private review material, source maps, and
    workspace/CI files are excluded;
  - production dependency root remains `typescript@5.9.3`.
- `git diff --check`: **PASS**
- Production secret-value scan: **PASS**
- Packaged metadata fake-URL scan: **PASS**

### Residual concerns

- Official Copilot consent/UI behavior, Command Palette interaction, and a live
  third-party OpenAI-compatible service were not exercised in this
  non-interactive environment. Existing mocked adapter and lifecycle tests
  cover the changed boundaries.

---

## GitHub Copilot Re-review Findings Follow-up

- Date: 2026-09-13
- Binding input: `.superpowers/sdd/copilot-rereview-findings.md`
- Status: **COMPLETE — all published and suppressed findings addressed**

### Corrections implemented

- Inline comments now construct a VS Code `MarkdownString` incrementally.
  Dynamic question, title, detail, source, and reference values pass only
  through `appendText`; Markdown formatting is limited to fixed extension copy.
- Diagnostic evidence IDs no longer include list indexes or raw URIs. They use
  a URI hash, complete range, source/code hash, and bounded message digest, so
  reordering unrelated diagnostics preserves dismissal and cooldown identity.
- Central remote projection replaces local `file:`/`vscode-remote:` URIs and
  absolute POSIX, Windows, UNC, and quoted import paths—including paths with
  spaces—with deterministic hashed labels in every request text field.
- OpenAI-compatible non-success, oversized `Content-Length`, and streamed
  overflow paths cancel the response body before rejection. If cancellation
  fails, the original status/size error remains primary and carries the cleanup
  failure as its `cause`.
- Complexity identity recognizes wrapped arrow initializers and starts parent
  scope discovery above the current variable declaration, keeping same-named
  nested arrows distinct.
- Symbol resolution now selects the smallest containing range across nested
  `DocumentSymbol` and flat `SymbolInformation` results without relying on
  provider ordering.
- When a document has no retained stable snapshot, the first stable episode is
  compared with `episode.previousText`.
- Copilot candidate iteration covers access checks, exact candidate token
  counts, requests, and stream consumption. Only unavailable/no-permission
  failures advance; blocked, cancelled, and unknown failures surface. Each
  dispatched candidate has a separate runtime-owned reservation, and lifecycle
  cancellation or budget denial prevents later dispatch.
- README, configuration guidance, and architecture documentation now describe
  the rendering, privacy, cleanup, selection, and budget behavior.

### TDD evidence

- Malicious Markdown: 1 expected failure showed the raw interpolated payload;
  the test passed after `appendText` rendering.
- Diagnostic ordering: 1 expected failure exposed both the raw URI and
  index-coupled identity; the reordered diagnostic remained dismissed after
  the fix.
- Local resource projection: 1 expected failure covered every remote field.
  Self-review added another expected failure for quoted/standalone paths with
  spaces before extending the projector.
- Response cleanup: 3 expected failures covered non-2xx cancellation,
  pre-read size rejection, and cleanup-error causality; streamed overflow was
  retained as a passing cancellation regression.
- Nested arrows: the direct-arrow probe confirmed existing behavior; a wrapped
  nested-arrow regression then failed and passed after shared unwrapping was
  applied to scope identity.
- Symbol specificity: 2 expected failures covered unsorted nested and flat
  symbol results.
- First stable edit: 1 expected failure reproduced invalid-to-stable baseline
  loss.
- Copilot candidates: 4 provider regressions failed for unavailable
  access/count/request and cancellation behavior; 1 runtime regression failed
  before per-candidate budget ownership. The over-budget no-dispatch regression
  also passed with the final loop.
- Focused final run: **7 files, 206 tests passed**.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **17 files, 310 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 87.94%, branches 78.84%, functions 91.57%, lines 88.09%
- `npm run package`: **PASS**
- `npm audit`: **PASS — 0 vulnerabilities**
- VSIX inspection: **156 files**
  - compiled `symbolContext` and runtime output are present;
  - source, tests, coverage, private review material, source maps, and
    workspace/CI files are excluded.
- `git diff --check`: **PASS**
- Production and packaged secret-value scans: **PASS**
- Packaged repository/bugs/homepage fake-URL scan: **PASS**
- Changed-file self-review found and fixed the spaced-path projection gap; no
  remaining high-confidence correctness, privacy, lifecycle, or budget issue
  was found.

### Residual concerns

- Official Copilot consent/UI behavior, Command Palette interaction, and a live
  third-party OpenAI-compatible service were not exercised in this
  non-interactive environment. Provider, lifecycle, cleanup, and budget
  boundaries are covered by focused contract tests.

## Remaining Copilot re-review fixes (2026-09-13)

### Corrections implemented

- Replaced the absolute-path regular-expression chain with a boundary scanner.
  It projects complete POSIX, Windows, UNC, `file:`, and `vscode-remote:`
  resources after punctuation and keeps unquoted spaced path segments together,
  including multi-word filenames. It skips relative package specifiers,
  ordinary slash-separated prose, and non-local URLs.
- Symbol resolution now receives both clamped evidence endpoints. Nested and
  flat candidates must contain both endpoints, and the existing total
  specificity ordering selects the smallest containing range independently of
  provider ordering.
- Copilot dispatch now rechecks lifecycle cancellation after model selection,
  request dispatch, every token count, stream completion, and immediately
  before returning a response. A fulfilled final token count cannot publish a
  stale response. Candidate resources are also disposed if cancellation wins
  immediately after preparation.

### TDD evidence

- Path scanner: five original regressions failed for comma boundaries and
  unquoted spaced POSIX, Windows, `file:`, and `vscode-remote:` values; all
  passed after the scanner replaced the path regexes.
- Symbol containment: both mixed provider orderings initially chose the inner
  symbol that contained only the evidence start; both passed after requiring
  start-and-end containment.
- Copilot cancellation: the deferred final-count regression initially resolved
  with a response, then rejected with `AbortError` after post-await checks were
  added.
- Self-review added failing regressions for multi-word POSIX filenames and
  cancellation between candidate preparation and caller resumption. The full
  suite then exposed two preserved-behavior regressions (`./repository` and a
  rejected pre-dispatch selection); both were corrected before final
  verification.

### Verification

- Focused tests: **3 files, 123 tests passed**.
- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **17 files, 323 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 88.32%, branches 80.10%, functions 92.32%, lines 88.44%
- `npm run package`: **PASS**
- `npm audit`: **PASS — 0 vulnerabilities**
- VSIX inspection: **156 files**
  - required compiled sanitizer, symbol, provider, and extension modules are
    present;
  - source, tests, coverage, private review material, source maps, and
    workspace/CI files are excluded.
- `git diff --check`: **PASS**
- Production and packaged first-party secret-pattern scans: **PASS**
- Packaged repository/bugs/homepage URL assertions: **PASS**
- Changed-file self-review found and fixed the spaced-filename and
  post-preparation disposal gaps; no remaining high-confidence issue was found.

### Residual concerns

- Live VS Code document-symbol providers and GitHub Copilot model APIs were not
  available in this non-interactive environment. Their range, cancellation,
  token-count, and disposal boundaries are covered by focused contract tests.

---

## Whitelist projection and cancellation follow-up (2026-09-13)

### Corrections implemented

- Replaced cleaned raw automatic evidence with an exhaustive
  `Evidence.kind` whitelist. Every kind now emits fixed extension-owned
  title/detail/source strings, a hashed identity, numeric severity/confidence/
  range metadata, and no references. Analyzer/editor titles, details, sources,
  specifiers, diagnostic messages/codes, URIs, and paths cannot enter either
  remote provider payload.
- Kept local shared evidence unprojected until the model boundary so inline and
  local-template rendering retain useful detail. Explicit Chat prompts and
  symbol fields are inspected before remote bounding.
- Replaced path substring projection with simple detection. Exact `file://` and
  `vscode-remote://` URIs (including directory URIs), recognized or
  multi-segment POSIX paths, Windows drive paths, and UNC paths mark the whole
  field sensitive. Custom schemes, closing markup, package names, and ordinary
  prose remain benign.
- Any detected credential or local resource now keeps the complete Chat request
  local. The unsafe field becomes the fixed
  `[REDACTED] Sensitive content kept local.` notice; no partially redacted field
  is sent remotely.
- Copilot rejected-await handling now checks the request signal before error
  classification. Concurrent cancellation during model selection, preflight or
  streamed token counting, and request send surfaces the signal's official
  `AbortError` path without classifying or propagating the provider error.
- Updated README, configuration, architecture, design, and implementation-plan
  privacy descriptions to document fixed kind-level remote summaries.

### TDD evidence

- RED: **18 expected failures** covered all five evidence kinds; exact
  `file:///Users/alice/`, `vscode-remote://host/home/alice/`,
  `/Users/alice/my project`, extensionless spaced Windows/UNC paths;
  `custom-file:///docs` and `</section>` false positives; sensitive Chat local
  routing; and rejected selection/send/count cancellation races.
- GREEN: focused privacy/provider/runtime/chat/model verification passed with
  **5 files, 220 tests**.
- Existing tests were updated where their old expectations encoded partial
  redaction, diagnostic-code forwarding, early Chat projection, or provider
  errors winning over concurrent cancellation.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **17 files, 343 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 87.92%, branches 78.76%, functions 91.84%, lines 88.07%
- `npm run package`: **PASS — 156 files, 4.35 MB**
- `npm audit`: **PASS — 0 vulnerabilities**
- VSIX inspection: required compiled privacy/provider modules and public privacy
  docs are present; source, tests, coverage, private review material, source
  maps, workspace/CI files are absent; runtime dependency root is only
  `typescript`.
- `git diff --check`: **PASS**
- Production and packaged credential-value scans: **PASS**
- Production URL and packaged repository/bugs/homepage fake-URL scans: **PASS**
- Changed-file self-review found no remaining high-confidence privacy,
  cancellation, lifecycle, packaging, or documentation concern.

### Residual concerns

- Live GitHub Copilot cancellation behavior and a third-party
  OpenAI-compatible endpoint were not available in this non-interactive
  environment. Injected provider tests cover selection, send, token-count,
  stream, and cancellation ordering at each changed boundary.

---

## Raw-local and whitelist-remote projection follow-up (2026-09-13)

### Corrections implemented

- Preserved two request forms at the runtime boundary: the original structured
  request is retained for `local-template`, while only the fixed kind-level
  projection reaches Copilot or an OpenAI-compatible provider.
- Routed sensitive-content, preflight/admission budget denial, unavailable
  Copilot, and unavailable OpenAI-compatible fallbacks through the original
  local request. Local questions therefore retain bounded evidence detail
  instead of degrading to the generic remote summary.
- Replaced the derived remote evidence hash with a constant structural
  placeholder. Evidence IDs remain absent from both Copilot and
  OpenAI-compatible prompt payloads.
- Corrected README, configuration, and architecture privacy guidance to state
  that evidence IDs are omitted from remote prompts and that fallback rendering
  uses the bounded original evidence.

### TDD evidence

- RED: the five kind-projection cases failed while expecting the constant
  non-identifying placeholder; unavailable Copilot and post-count budget denial
  returned generic projected detail; unavailable OpenAI-compatible generation
  rejected instead of falling back.
- GREEN: focused model/provider/privacy/runtime verification passed with
  **4 files, 202 tests**.
- Runtime tests assert that Copilot token-count and OpenAI request payloads
  contain fixed projection text and none of the raw ID, title, detail, source,
  or references. They separately assert raw, 1,000-character-bounded local
  evidence rendering for fallback.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **17 files, 346 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 87.90%, branches 78.76%, functions 91.86%, lines 88.05%
- `npm run package`: **PASS — 156 files, 4.35 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- VSIX content scan: required compiled model/runtime/provider modules and
  public privacy docs are present; source, tests, coverage, private review
  material, source maps, workspace, and CI files are absent.
- Runtime dependency root scan: **PASS — `typescript` only**
- Production and packaged credential-value scans: **PASS**
- Package repository/bugs/homepage URL scan: **PASS**

### Self-review and residual concerns

- Changed-file review found no remaining high-confidence privacy, fallback,
  budget-accounting, cancellation, test, or documentation issue.
- Live GitHub Copilot and third-party OpenAI-compatible services were not
  available in this non-interactive environment. Injected provider tests cover
  the changed projection and fallback boundaries.

---

## Other-reviewer valid findings follow-up (2026-09-13)

### Corrections implemented

- Made dismissal maps null-prototype records throughout defaults, validation,
  cloning, freezing, and repository scoping. Repository lookups now require an
  own property, so `constructor` and `__proto__` are safe repository IDs.
- Added effective statement-or-element type-only state to external ESM
  re-export signatures.
- Included nested TypeScript module/namespace ancestry in complexity keys and
  display names.
- Made quoted sensitive assignments delimiter-specific and escape-aware, so
  the opposite quote character remains part of the secret value. Sensitive
  explicit Chat prompts still fall back as one complete local-only field.
- Unwrapped parentheses, assertions, `satisfies`, and non-null wrappers before
  class/function/identifier export dispatch.
- Evaluated CommonJS export assignments in source order. Whole
  `module.exports` assignments replace prior CommonJS state; later property
  assignments overwrite or extend the current state.
- Limited stale `/trace` checks to symbol lookups that actually started, so
  disabled and inactive requests render their intended guidance.
- Strengthened the inline-comment controller fake to reject post-disposal
  rendering, prove `clear()` remains reusable, and count final controller
  disposal.

### TDD evidence

- RED: **16 expected regression failures** covered special repository IDs,
  both forms and directions of type-only re-exports, nested namespaces,
  opposite quote delimiters, parenthesized default identifiers, CommonJS
  replacement order, disabled/inactive `/trace`, and stateful controller
  disposal.
- GREEN: focused verification passed with **5 files, 194 tests**.
- The CommonJS post-replacement extension case passed as a preservation
  characterization while the overwrite/removal cases failed before the fix.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **17 files, 363 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 88.34%, branches 79.52%, functions 91.95%, lines 88.49%
- `npm run package`: **PASS — 156 files, 4.35 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- VSIX content scan: required compiled modules and public docs are present;
  source, tests, coverage, private review material, source maps, workspace,
  and CI files are absent.
- Runtime dependency root scan: **PASS — `typescript` only**
- `git diff --check`: **PASS**
- Production and packaged credential-value scans: **PASS**
- Production and packaged fake-URL scans, including package repository,
  bugs, and homepage metadata assertions: **PASS**

### Self-review and residual concerns

- Changed-file review found no remaining high-confidence correctness, privacy,
  lifecycle, packaging, or documentation issue. No public documentation change
  was needed because the fixes preserve the documented APIs and behavior.
- Live VS Code document-symbol providers were unavailable in this
  non-interactive environment; handler-level tests cover the changed `/trace`
  guidance and stale-lookup boundaries.

---

## CommonJS export identity collision follow-up (2026-09-13)

### Corrections implemented

- Replaced flattened CommonJS export names with structured property-segment
  paths and JSON-encoded internal identities. The root callable, property
  `default`, nested `foo.bar`, and literal property `"foo.bar"` are now
  independent subjects.
- Kept human-readable external names in signature records, separate from the
  encoded identity used for matching and evidence IDs.
- Made property assignment removal compare path segments. Reassigning
  `module.exports.foo` removes only `foo` and its descendants, without removing
  the root callable or a literal `"foo.bar"` sibling.
- Added nested property traversal for dot/bracket assignment chains and nested
  object-literal exports.
- Kept whole `module.exports = ...` replacement as a complete reset of prior
  CommonJS signatures and path ownership.

### TDD evidence

- RED: the focused semantic suite produced the four expected regression
  failures: root plus `.default` collapsed to one record, a root-only change
  disappeared behind unchanged `.default`, dotted literal/nested paths
  disappeared or collided, and whole replacement exposed only three of five
  expected changes.
- GREEN: `npm test -- test/semanticAnalyzer.test.ts` passed with **45/45
  tests**.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **17 files, 367 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 89.11%, branches 80.98%, functions 92.04%, lines 89.26%
- `npm run package`: **PASS — 156 files, 4.35 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- VSIX content scan: required compiled semantic analyzer and public docs are
  present; source, tests, coverage, private review material, source maps,
  workspace, and CI files are absent.
- Runtime dependency root scan: **PASS — `typescript` only**
- Production and packaged credential-value scans: **PASS**
- Production and packaged fake-URL scans, including package repository, bugs,
  and homepage metadata assertions: **PASS**

### Self-review and residual concerns

- Changed-file review found no remaining high-confidence identity, replacement,
  display, or regression issue.
- Dynamically computed CommonJS property names remain intentionally outside the
  analyzer's static, per-document scope.

---

## Copilot review 5187487833 follow-up (2026-09-13)

### Corrections implemented

- Bounded VS Code global-state memory to **256** recent unique dismissal hashes
  per repository, **32** most recently used repository entries, and **256**
  recent unique approved summaries.
- Added explicit persisted repository recency order. Repeated dismissals and
  approvals move to the newest position, repository isolation remains intact,
  and preference values plus `interventionStyleExplicit` are never evicted.
- Reworked legacy/current validation to scan all input for corruption while
  retaining and cloning only bounded collections. Oversized valid records are
  compacted on load through the shared mutation queue when the revision is
  still current, and every save re-applies compaction.
- Made document-listener startup atomic. Concrete registration disposes every
  earlier listener if a later registration throws; lifecycle startup then
  cancels pending work, clears prepared/transient state, and rethrows the
  current-generation failure. Replaced-generation failures remain suppressed.
- Replaced per-character Copilot stream truncation with a binary search over
  UTF-16 code-point boundaries. It returns the longest officially counted
  prefix within the output cap, never cuts a surrogate pair, preserves
  conservative observed-output settlement, and checks cancellation immediately
  after every awaited token count.
- Documented the retention limits and deterministic eviction behavior in the
  README privacy guidance and configuration reference.

### TDD evidence

- RED: dismissal load compaction initially had no retention contract; mutation
  retained the wrong repository and did not refresh the repeated evidence.
- RED: approval load compaction had no configured limit, and a new unique
  approval persisted **257** entries instead of **256**.
- RED: first-listener failure retained prepared document state; second-listener
  failure also leaked the first registered listener. A reentrant stale
  registration failure rejected instead of resolving as stopped.
- RED: a 4,096-code-point fragment made **2,050** output `countTokens` calls
  against a logarithmic ceiling of **15**. Cancellation during the first binary
  probe made two additional token-count calls instead of stopping at **3**.
- GREEN: focused verification passed with **4 files, 106 tests**.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **17 files, 376 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 89.03%, branches 80.90%, functions 92.05%, lines 89.16%
- `npm run package`: **PASS — 156 files, 4.35 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- VSIX content scan: required compiled memory/lifecycle/provider modules and
  public configuration/privacy docs are present; source, tests, coverage,
  private review material, source maps, workspace, and CI files are absent.
- Runtime dependency root scan: **PASS — `typescript` only**
- `git diff --check`: **PASS**
- Production and packaged credential-value scans: **PASS**
- Production and packaged fake-URL scans plus package repository, bugs, and
  homepage metadata assertions: **PASS**

### Self-review and residual concerns

- Changed-file review found no remaining high-confidence retention, repository
  isolation, startup cleanup, Unicode truncation, cancellation, packaging, or
  documentation issue.
- Live VS Code listener registration and GitHub Copilot tokenization were not
  available in this non-interactive environment. Deterministic VS Code adapter
  failures and injected official-token-count behavior cover the changed
  boundaries.

---

## Final memory migration and Unicode stream fixes (2026-09-13)

### Corrections implemented

- Legacy version-1 memory records without `dismissedRepositoryOrder` now
  trigger fenced compaction write-back even when every retained collection is
  already within its limit. Repository order is derived deterministically from
  the validated legacy dismissal-map order, persisted explicitly, and used to
  rebuild the dismissal map in the same order. Existing malformed-record
  rejection and preservation behavior remains unchanged.
- Copilot stream consumption now buffers a fragment-ending high surrogate.
  A following low surrogate is combined before official token counting,
  truncation, or response publication. A buffered surrogate is discarded when
  it is not completed, when the cap is reached, or when the stream ends.
  Existing binary code-point-safe truncation, logarithmic token-count calls,
  cancellation checks, and conservative observed-token settlement remain
  intact.

### TDD evidence

- Memory RED: the in-bounds legacy record loaded successfully but retained no
  `dismissedRepositoryOrder`; GREEN: the focused memory suite passed with
  **21 tests**, including deterministic order and write-back assertions.
- Unicode RED: split-emoji regressions exposed a dangling high surrogate at a
  one-token cap, token counting of an incomplete surrogate below the cap, and
  a dangling surrogate at end of stream. GREEN: the focused Copilot suite
  passed with **34 tests**, including cap, below-cap, end-of-stream,
  logarithmic counting, cancellation, and settlement coverage.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **17 files, 380 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 89.18%, branches 81.21%, functions 92.08%, lines 89.31%
- `npm run package`: **PASS — 156 files, 4.35 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- VSIX content and compiled-marker scans: **PASS**
  - changed memory and Copilot stream logic is present in compiled output;
  - source, tests, coverage, private review material, source maps, workspace,
    and CI files are absent.
- Runtime dependency root scan: **PASS — `typescript` only**
- Production and packaged secret-pattern scans: **PASS**
- Production URL and packaged repository/bugs/homepage metadata scans:
  **PASS**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- Changed-file review found no remaining high-confidence migration,
  corruption-preservation, Unicode-boundary, token-accounting, cancellation,
  or packaging concern.
- Live GitHub Copilot streaming was unavailable in this non-interactive
  environment. Injected fragment streams and official-token-count fakes cover
  the changed cap, no-cap, and end-of-stream boundaries.

---

## Secondary review local-export and repository-scope fixes (2026-09-13)

### Corrections implemented

- Local ESM named export lists now add the effective
  `statement.isTypeOnly || element.isTypeOnly` mode to the exported signature.
  Both `export type { load as fetchItem }` and
  `export { type load as fetchItem }` therefore report a
  `public-api-change` when replacing a value export.
- The export-mode signature uses the external alias while retaining the
  callable signatures already collected for the local declaration.
- The repository-isolation test now captures `memoryStoreB.load()` and uses an
  exact `toEqual({})` assertion for `dismissedEvidenceByRepository`. Existing
  production filtering required no change.

### TDD evidence

- RED: both focused local value-to-type-only transition cases returned no
  evidence; the focused run reported **2 failures and 66 passes**.
- GREEN: the focused semantic and memory run passed with **2 files and 68
  tests**. The existing external-alias callable-signature test remained green.
- The stronger repository-scope assertion passed immediately, confirming the
  existing load filter already returns no dismissal keys from another
  repository.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **17 files, 382 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 89.19%, branches 81.25%, functions 92.08%, lines 89.32%
- `npm run package`: **PASS — 156 files, 4.35 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- VSIX content and compiled-marker scans: **PASS**
  - compiled semantic analyzer contains the local export-mode marker;
  - source, tests, coverage, private review material, source maps, workspace,
    and CI files are absent.
- Runtime dependency root scan: **PASS — `typescript` only**
- Production and packaged secret-pattern scans: **PASS**
- Production URL and packaged repository/bugs/homepage metadata scans:
  **PASS**

### Self-review and residual concerns

- Changed-file review found no remaining high-confidence export-mode,
  external-alias, callable-signature, repository-isolation, or packaging
  issue.
- The analyzer intentionally reports syntactic value/type export-mode changes;
  it does not attempt cross-module runtime resolution, matching the existing
  named re-export behavior.

---

## Local export signature normalization fix (2026-09-13)

### Correction implemented

- Local ESM export lists now add a signature mode marker only when the
  statement or element is effectively type-only.
- Ordinary local-list value exports retain only their callable signatures, so
  `export const load = ...` and `const load = ...; export { load };` normalize
  identically in both refactor directions.
- Statement-level and element-level value-to-type-only and type-only-to-value
  transitions remain detectable under the external export identity.

### TDD evidence

- RED: the direct-to-local-list value-export regression produced one false
  `public-api-change`.
- GREEN: the focused semantic analyzer suite passed with **50 tests**, including
  both normalization directions and all four statement/element mode
  transitions.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **17 files, 385 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 89.19%, branches 81.22%, functions 92.08%, lines 89.32%
- `npm run package`: **PASS — 156 files, 4.35 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- VSIX content and compiled-marker scans: **PASS**
  - compiled output contains `local-export:type-only` and no
    `local-export:value`;
  - source, tests, coverage, private review material, source maps, workspace,
    and CI files are absent.
- Runtime dependency root scan: **PASS — `typescript` only**
- Production and packaged secret-pattern and fake-URL scans: **PASS**
- Packaged repository, bugs, and homepage metadata assertions: **PASS**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- Changed-file review found no remaining high-confidence normalization,
  transition-detection, or packaging issue.
- The analyzer remains intentionally per-document and does not resolve
  cross-module runtime bindings; this change only normalizes equivalent local
  declaration/export syntax.

---

## Token budget and lifecycle cleanup follow-up (2026-09-13)

### Corrections implemented

- `TokenBudget.tryReserve` now classifies input requests above the total window
  maximum, output requests above either the per-call or total window maximum,
  and zero-output reservations before computing expiry-based delays.
- Impossible reservations return an explicit `retryable: false` decision with
  a specific request-level reason and no `retryAfterMs`. Temporary call/input/
  output exhaustion retains `retryable: true` and the time at which enough
  occupied capacity expires.
- Exact input/output boundaries remain admissible. Remote callers continue to
  fall back locally without dispatching or consuming budget, and surface the
  new non-retryable reason in runtime status.
- Cleanup now runs through an all-attempted cleanup primitive. A single failure
  is rethrown unchanged; multiple failures are surfaced as an `AggregateError`
  in deterministic attempt order.
- Session stop, dispose, disabled-start rollback, and failed-start rollback
  clear active/listener state before cleanup, abort pending startup, attempt
  listener disposal, cancellation, and transient-state clearing, and only then
  surface failures. Disposal marks the lifecycle disposed before cleanup.
- Document-listener composites detach and attempt every registered listener in
  reverse registration order, including registration rollback. Runtime stop
  and disposal continue through session publication, aggregator, scheduler,
  inline controller, and status resources even if listener cleanup fails.

### TDD evidence

- RED: the focused budget/lifecycle/runtime run reported **12 failures and 62
  passes**. Failures demonstrated finite zero-delay decisions for impossible
  reservations, missing retryability discrimination, early lifecycle cleanup
  termination, cleanup-error loss, incomplete runtime disposal, and the old
  caller fallback reason.
- GREEN: the same three focused suites passed with **74 tests**, covering
  oversized input, per-call and total oversized output, exact boundaries,
  empty reservations, expiry-backed retry delays, local fallback, ordered
  multi-listener disposal, stop failure aggregation, disposal finality, and
  startup rollback aggregation.
- The existing serialized-request budget assertion was updated to require the
  non-retryable oversized-input decision and absence of `retryAfterMs`.

### Verification

- Focused budget/lifecycle/runtime suites: **PASS — 3 files, 74 tests**
- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **17 files, 396 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 89.46%, branches 81.55%, functions 92.37%, lines 89.59%
- `npm run package`: **PASS — 156 files, 4.35 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript` only**
- VSIX content and compiled-marker scans: **PASS**
  - non-retryable budget reasons and aggregate cleanup paths are present in
    compiled and packaged output;
  - project source, tests, coverage, private review material, source maps,
    workspace, and CI files are absent.
- Production and packaged secret-pattern and fake-URL scans: **PASS**
- Packaged repository, bugs, and homepage metadata assertions: **PASS**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- Changed-file review found no remaining high-confidence budget retry,
  listener ordering, lifecycle state-finalization, runtime disposal, or
  packaging issue.
- Live VS Code listener disposal and GitHub Copilot dispatch were unavailable
  in this non-interactive environment. Deterministic adapter failures and
  injected official-token counts cover the changed boundaries.

---

## Remaining budget and inline-disposal findings (2026-09-13)

### Corrections implemented

- Call-limit retry timing now selects the expiry of the
  `active reservations - maxCalls + 1` reservation. This waits until enough
  calls have expired to admit one new call after any downward reconfiguration,
  including repeated changes and equal-expiry groups.
- Existing cumulative input/output retry calculation remains authoritative
  when token capacity needs a later expiry than call capacity.
- `InlinePairController.clear(uri)` and `disposeUri(uri)` remove the target
  reference before disposal, so a throwing thread cannot remain registered and
  unrelated threads remain usable.
- Whole-controller clear/dispose detaches every thread reference before
  cleanup. Disposal also marks final state and drops the controller reference
  before attempting every thread and then the controller through the shared
  aggregate-cleanup primitive.
- Rendering after final disposal is rejected, while repeated disposal is a
  no-op. Runtime cleanup receives one top-level aggregate while still disposing
  all throwing threads, the comment controller, and later runtime resources.

### TDD evidence

- RED: the first focused budget/controller/runtime run reported **5 failures
  and 65 passes**. It exposed oldest-only call retry timing, retained targeted
  references after disposal failure, early termination on the first throwing
  thread, and leaked controller/runtime resources.
- GREEN: the final focused run passed **3 files, 71 tests**, covering repeated
  downward call-limit changes, equal expiries, exact expiry admission,
  cumulative input and output release, targeted throwing cleanup, direct
  aggregate disposal, and runtime-level aggregate propagation.

### Verification

- Focused budget/controller/runtime suites: **PASS — 3 files, 71 tests**
- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **17 files, 403 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 89.41%, branches 81.54%, functions 92.25%, lines 89.52%
- `npm run package`: **PASS — 156 files, 4.35 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript` only**
- VSIX exclusion, compiled behavior-marker, metadata, production/package
  secret-pattern, and fake-URL scans: **PASS**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- Changed-file review found no remaining high-confidence call-retry,
  cumulative-capacity, disposal-finality, aggregation, or packaging issue.
- Live VS Code disposal failures cannot be induced in this environment; the
  stateful CommentThread/CommentController adapters cover the exact throw-after-
  state-change behavior and runtime propagation path.

---

## Latest secondary-review privacy and lexical-identity findings (2026-09-13)

### Corrections implemented

- Explicit prompt sanitation now detects a normalized sensitive key as soon as
  its assignment/header separator is present. Detection no longer depends on
  parsing a complete quoted value, so actual CR/LF, multiline single quotes,
  and escaped quote/newline combinations keep the complete field local-only.
- Function-valued variables now include deterministic lexical block ordinals
  in their internal enclosing-scope keys while retaining user-facing names.
  Ordinals are structural rather than absolute source offsets, and traversal
  does not descend into an earlier sibling block, preserving later sibling
  identities when only that earlier block's contents grow.
- Lifecycle cleanup code was not changed.

### TDD evidence

- Privacy RED: the focused suite reported **4 failures and 110 passes** for
  multiline double quotes, multiline single quotes, and escaped quote/newline
  combinations.
- Privacy GREEN: **114 tests passed**.
- Semantic RED: the focused suite reported **1 failure and 50 passes** because
  same-named sibling-block arrows collided.
- Semantic GREEN: **51 tests passed**; only the first arrow reports complexity
  growth while the unchanged second arrow retains its identity despite the
  earlier block's added lines.
- Self-review corrected the privacy regression to exercise
  `context.userPrompt` directly. The final combined focused run passed
  **2 files, 165 tests**.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **17 files, 408 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 89.49%, branches 81.74%, functions 92.33%, lines 89.61%
- `npm run package`: **PASS — 156 files, 4.35 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript` only**
- VSIX exclusion and compiled behavior-marker scans: **PASS**
- Production credential-pattern and packaged metadata scans: **PASS**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- Changed-file review found and corrected one test-boundary issue: the exact
  multiline cases now enter through the explicit Chat prompt rather than the
  generic goal field.
- No remaining high-confidence correctness, privacy, identity-stability,
  lifecycle, or packaging issue was found.
- A lexical block inserted before a sibling at the same nesting level will
  necessarily renumber later anonymous block identities; edits confined within
  an existing earlier block do not.

---

## Class static-block lexical identity finding (2026-09-13)

### Correction implemented

- `ClassStaticBlockDeclaration` now participates directly in lexical-scope
  identity traversal; its body block is excluded from ordinary block identity so
  a static scope contributes exactly one path segment.
- Each static scope receives a deterministic ordinal among only the owning
  class's static blocks. The internal segment is combined with the existing
  class identity, while user-facing class, method, nested-function, namespace,
  and arrow display names remain unchanged.
- Same-named arrows in sibling static blocks therefore occupy separate
  complexity-map records, and edits inside an earlier static block do not
  renumber a later static block.

### TDD evidence

- RED: the focused semantic suite reported **1 failure and 51 passes**. The new
  regression expected one complexity item for the first `Worker.helper`, but
  received none because the unchanged second static-block arrow overwrote the
  first arrow's current complexity record.
- GREEN: the focused semantic suite passed **52 tests**. Exactly one item is
  emitted for the first arrow, with `Worker.helper`, 6 branches up from 2, and
  the first static block's source range.

### Verification

- Focused semantic suite: **PASS — 1 file, 52 tests**
- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **17 files, 409 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 89.55%, branches 81.81%, functions 92.37%, lines 89.67%
- `npm run package`: **PASS — 156 files, 4.35 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript` only**
- VSIX exclusion and compiled static-block behavior-marker scans: **PASS**
- Production credential-pattern, fake-URL, and packaged metadata scans:
  **PASS**

### Self-review and residual concerns

- Existing focused semantic regressions for methods, classes, nested functions,
  namespaces, outer arrows, and ordinary sibling lexical blocks remain green.
- The static-block ordinal is intentionally structural: inserting or deleting a
  static block before another will renumber later identities, while editing a
  static block's contents will not.
- No remaining high-confidence lexical-identity or packaging concern was found.

---

## GitHub Copilot access and deadline findings (2026-09-13)

### Corrections implemented

- The VS Code adapter now maps `LanguageModelAccessKind.Allowed` to `true`,
  `Disallowed` to `false`, and `NeedsConsent` to `undefined` before values
  reach the provider contract. Unknown values fail closed. A compatibility
  fallback preserves the prior boolean API shape when the runtime does not
  expose the enum object.
- Automatic interventions skip consent-needed models without invoking
  `countTokens` or `sendRequest`. User actions may enter VS Code's consent
  path, while disallowed models are never attempted.
- One 15-second Copilot deadline now spans model selection, preflight token
  counting, `sendRequest`, each async stream `next()` wait, streamed/prefix
  token counts, and iterator cleanup.
- Deadline and caller-cancellation outcomes race every provider await.
  Deadline expiry cancels the VS Code cancellation source immediately, and
  late provider rejections are observed without delaying cleanup.
- Copilot and OpenAI-compatible timeouts now surface the shared typed
  `ModelProviderTimeoutError`, including provider identity and whether a
  request was dispatched.
- A pre-dispatch Copilot timeout can release its exact unused reservation.
  Once dispatch was attempted, the reservation remains conservatively charged
  until normal budget-window expiry. Candidate and cancellation-registry
  resources are disposed on every terminal path.
- README, configuration, and architecture documentation now describe the
  access-kind and deadline behavior.

### TDD evidence

- Access RED: the focused suites reported **4 failures and 36 passes** because
  allowed and disallowed enum values were not mapped and therefore routed as
  consent-needed.
- Access GREEN: **2 files, 40 tests passed**, covering all three enum values,
  automatic consent suppression, user-initiated consent, denied access, and
  allowed automatic routing.
- Deadline RED: the provider suite reported **7 failures and 37 passes** for
  unresolved selection/send, stalled stream reads, final token counting,
  cancellation precedence, and reservation ownership.
- Deadline GREEN: the provider suite passed **44 tests**. A separate RED/GREEN
  cycle changed the OpenAI-compatible timeout assertion from an untyped
  `Error` to `ModelProviderTimeoutError`.
- Final focused provider/runtime/extension run: **5 files, 122 tests passed**,
  including runtime consent routing and timeout cleanup/accounting.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **18 files, 424 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 89.81%, branches 82.14%, functions 92.51%, lines 89.95%
- `npm run package`: **PASS — 157 files, 4.36 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript` only**
- VSIX exclusion and compiled access/deadline marker scans: **PASS**
- Production credential-pattern, placeholder-URL, and packaged metadata scans:
  **PASS**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- Changed-file review covered adapter mapping, provider races, late rejection
  handling, stream closure, runtime routing, cancellation-source disposal, and
  reservation transitions. No high-confidence correctness, security,
  lifecycle, or packaging issue remains.
- The deadline is intentionally one end-to-end 15-second budget, rather than a
  fresh timeout for each stage.
- A dispatched timeout intentionally retains conservative call/input/output
  reservation values because final provider usage may be unknowable.

---

## Active workspace-folder memory refresh (2026-09-13)

### Corrections implemented

- Registered the public VS Code `onDidChangeWorkspaceFolders` event inside the
  active session's listener bundle, so it is rolled back and disposed
  atomically with open, close, and text-change listeners.
- Added a lifecycle-owned refresh generation. A folder event keeps the
  explicitly started session active while blocking new processing, invalidates
  prior active-work fences, cancels pending edit/model/Chat work, and clears
  document evidence, cooldown state, shared evidence, and inline threads.
- Session preparation now runs again against a snapshot of the current
  workspace roots. Its atomic commit replaces the repository dismissal map and
  reseeds the then-current open documents before processing becomes ready.
  Removed roots therefore leave memory, and added-root dismissals are present
  before manual or automatic analysis can run.
- Stop, restart, disposal, and later folder events abort and fence older
  refreshes. Only the latest refresh belonging to the still-active session can
  restore processing readiness or update status.
- Preserved global preferences and rolling budget state. A normal folder
  change does not require another explicit start.
- Updated the README plus architecture and configuration references with the
  active-session refresh contract.

### TDD evidence

- Lifecycle RED: **3 expected failures** (`refresh is not a function`) covered
  blocking fences, overlapping refreshes, and rapid stop/restart.
- Runtime RED: **8 expected failures** covered fourth-listener registration and
  atomic disposal, root replacement, deferred cancellation/blocking,
  overlapping events, stop/restart, disposal, and new-root dismissal
  suppression.
- Explicit-activity RED: **1 expected failure** showed that an in-progress
  refresh was incorrectly published as a stopped session; processing readiness
  is now separate from explicit session activity.
- Disabled-refresh RED: **1 expected failure** covered safe teardown if the
  enable gate changes during preparation.
- Focused GREEN: `pairSessionLifecycle` and `pairRuntimeLifecycle` passed
  **74 tests**.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **18 files, 436 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 89.32%, branches 81.94%, functions 92.69%, lines 89.45%
- `npm run package`: **PASS — 157 files, 4.36 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript` only**
- VSIX exclusion, public-document inclusion, and compiled workspace-refresh
  marker scans: **PASS**
- Production credential-pattern, placeholder-URL, packaged metadata, and
  `git diff --check` scans: **PASS**

### Self-review and residual concerns

- Changed-file review covered refresh generation transitions, reentrant folder
  events, stop/restart/disposal fencing, readiness gates, listener rollback,
  memory replacement, and failure cleanup. No high-confidence correctness,
  security, lifecycle, or packaging issue remains.
- The deterministic tests exercise the public event contract through a VS Code
  test double. A live VS Code multi-root UI session was not available in this
  non-interactive environment.

---

## Overnight semantic and memory review fixes (2026-09-13)

### Corrections implemented

- Recursively collect identifiers from object and array binding patterns in
  top-level variable declarations. Each binding identifier is registered with
  the TypeScript checker, and direct exports plus aliased local export lists
  now compare checker-resolved callable signatures.
- Treat getter and setter declarations as enclosing complexity scopes.
  Accessor keys include owning class identity, static/instance scope, get/set
  kind, and property name, preventing same-named nested arrows from replacing
  one another.
- Preserve the accumulated lexical block path when scope traversal reaches a
  source file. Same-named arrows in sibling top-level blocks now retain
  distinct keys while keeping their public display names unchanged.
- Deep-clone corrupt values from the backing test store before calling
  `updatePreferences` or `loadOrDefault`, then compare storage against those
  independent snapshots.
- Made no change for the reported missing outer `describe` closure: the test
  file already compiles and closes correctly.

### TDD evidence

- Destructuring RED: **2 expected failures** showed that nested object and
  array binding identifiers were omitted. GREEN: both direct-export and
  aliased local-export regressions passed.
- Accessor RED: **1 expected failure** showed first-accessor-only complexity
  growth was lost to a later same-named arrow. GREEN: the regression passed
  with all accessor identity dimensions represented.
- Top-level block RED: **1 expected failure** showed first-block-only growth
  was lost at the source-file boundary. GREEN: the sibling-block regression
  passed with a stable `helper` display name.
- Corrupt-memory mutation check RED: a temporary in-place mutation probe made
  both strengthened snapshot assertions fail. After removing the probe,
  GREEN passed for both `updatePreferences` and `loadOrDefault`.
- Final focused semantic/memory run: **2 files, 77 tests passed**.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **18 files, 440 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 89.37%, branches 82.27%, functions 92.73%, lines 89.50%
- `npm run package`: **PASS — 157 files, 4.36 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript` only**
- VSIX exclusion and compiled destructuring/accessor/block marker scans:
  **PASS**
- Production credential-pattern and packaged metadata scans: **PASS**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- Changed-file review covered recursive binding aliases/defaults, checker
  signature resolution, accessor identity dimensions, source-root lexical
  paths, evidence ranges/display names, and independent corrupt-store
  snapshots. No high-confidence correctness, security, or packaging issue
  remains.
- No production memory behavior changed; the strengthened tests now detect
  any future in-place corruption before a rejected update or safe recovery.

---

## Accessor scope fallback regression (2026-09-13)

### Correction implemented

- `enclosingScopeIdentity` now returns an accessor-qualified identity only
  when `accessorIdentity` resolves. Object-literal, class-expression, and
  computed accessors otherwise continue to the nearest enclosing
  function/variable/class/module/lexical identity.
- Existing named class accessor handling is unchanged, including get/set and
  static/instance identity dimensions.
- Added first-only complexity-growth regressions for same-named helper arrows
  in object-literal getters, class-expression setters, and computed static
  getters under different outer functions.

### TDD evidence

- RED: all **3** new focused regressions failed with zero complexity evidence,
  confirming that the unresolved accessor returned before reaching its outer
  scope.
- GREEN: all **3** regressions passed after the guarded accessor return.
- Focused semantic suite: **59 tests passed**.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **18 files, 443 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 89.50%, branches 82.66%, functions 92.73%, lines 89.63%
- `npm run package`: **PASS — 157 files, 4.36 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Production credential-value scan: **PASS**
- Package metadata URL scan: **PASS**
- VSIX exclusion scan: **PASS**, allowing packaged TypeScript library
  declarations.

### Self-review and residual concerns

- Reviewed the complete change against accessor, class, function, variable,
  module, and lexical fallback order. The guarded return is the minimal fix
  and leaves resolved named class accessor identities intact.
- No high-confidence correctness, security, or packaging concerns remain.
  Unresolvable accessor names intentionally inherit the nearest resolvable
  enclosing scope rather than inventing an unstable accessor identity.

---

## Latest Copilot evidence-boundary fixes (2026-09-13)

### Corrections implemented

- Added normalized `cookie` and `setcookie` sensitive-key roots. Explicit
  `Cookie` and `Set-Cookie` text now marks the complete request local-only;
  OpenAI-compatible and Copilot payload builders cannot contain that text.
- Centralized local evidence presentation limits and single-line ellipsis
  normalization: 1,000 characters for questions/local responses, 120 for
  titles, 500 for details, 120 for sources, 240 per reference, and eight
  references per evidence item.
- Kept complete dependency specifiers only as private comparison/hash inputs.
  New-dependency detail and reference values expose bounded useful prefixes.
- Expanded dependency discovery to ESM imports, literal `require("...")`,
  literal dynamic `import("...")`, and named/star re-exports. Non-literal
  expressions are ignored, and repeated complete specifiers use the first
  source occurrence deterministically.
- Added a diagnostic evidence builder that hashes the complete URI, range,
  source, code, and message while putting only bounded single-line message,
  source, and code prefixes into local evidence.
- Applied the same centralized bounds at inline and shared-context publication
  boundaries without changing evidence identity or the fixed remote whitelist
  projection.
- Documented supported dependency forms, local display limits, full-input
  identity behavior, and cookie handling in the README, configuration
  reference, and architecture guide.

### TDD evidence

- Privacy RED/GREEN covered exact `Cookie`/`Set-Cookie` headers, normalized
  cookie key variants, both remote prompt builders, and runtime no-dispatch
  fallback.
- Semantic RED/GREEN covered four new literal dependency forms, deterministic
  cross-form deduplication, huge/multiline specifiers, and distinct full-input
  hashes. Computed `require` and dynamic-import expressions remain ignored.
- Diagnostic/runtime RED/GREEN covered huge multiline messages, sources, and
  codes; bounded local evidence; full-input stable IDs; and omission of
  diagnostic targets.
- Inline RED/GREEN covered every dynamic Markdown field plus the reference
  count boundary.
- Self-review found that inline normalization alone left a generic raw
  evidence/question pair in shared context. A focused regression failed at
  2,116 question characters, then passed after the publication boundary reused
  the centralized normalizer.
- Final focused semantic/privacy/runtime/inline run: **5 files, 272 tests
  passed**.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **18 files, 464 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 89.73%, branches 82.98%, functions 92.88%, lines 89.85%
- `npm run package`: **PASS — 158 files, 4.36 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript@5.9.3` only**
- VSIX inclusion/exclusion scan: **PASS**
  - compiled evidence presentation module and public docs are present;
  - source, tests, coverage, private review material, source maps, workspace,
    and CI files are absent.
- Production and packaged fixture-secret scans: **PASS**
- Production URL and packaged metadata scans: **PASS**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- Changed-file review covered privacy classification, remote projection,
  source-order traversal, non-literal exclusions, full-input identity,
  truncation, shared context, inline escaping, documentation, and packaging.
  No remaining high-confidence correctness, privacy, or payload-size concern
  was found.
- Live VS Code diagnostics and remote model services were unavailable in this
  non-interactive environment. Pure diagnostic builders, VS Code test doubles,
  and injected OpenAI-compatible/Copilot boundaries cover the changed paths.

---

## Automatic-evidence routing and URI revision retention (2026-09-13)

### Corrections implemented

- Automatic evidence remains a fixed kind-level remote projection. Before
  projection, the existing credential/local-resource detector now inspects the
  raw ID, title, detail, source, and every reference. Any match sets
  `sensitiveDataDetected`, selects `local-template`, and prevents remote
  dispatch without copying the raw value into projection, status, or error
  text.
- `PairSharedContext` now allocates every per-URI evidence revision from one
  shared-context-wide monotonic epoch. Removing or evicting a URI never resets
  that epoch, so republishing the same URI cannot reuse an earlier revision.
- The URI revision table is a documented 256-entry LRU. Reads and writes
  refresh recency, overflow evicts the oldest URI, document close releases one
  URI, and session stop/runtime replacement/current-runtime disposal release
  all tracked URIs.
- Runtime revision ownership remains authoritative: a replaced runtime's late
  disposal cannot clear evidence published by its replacement.

### TDD evidence

- Sensitivity RED: **10 expected failures** across the privacy and runtime
  suites demonstrated that credentials and `file://`/`vscode-remote://`
  resources in raw automatic evidence did not set the sensitive flag and still
  reached the injected remote provider.
- Sensitivity GREEN: **2 files, 190 tests passed**, covering all five raw
  evidence fields, `new-dependency`, `diagnostic`, and `external-harness`
  evidence, benign controls, fixed projections, generic status text, and
  analyzer-produced no-dispatch behavior.
- Revision RED: **4 expected failures** demonstrated the missing close-release
  API, retained revisions across close/replacement, and the unbounded URI map.
- Revision GREEN: **2 files, 90 tests passed**, covering close, runtime
  replacement, stale-runtime disposal, bounded LRU eviction, evicted/same-URI
  reuse, and dismissal completion after an awaited write.
- Final focused model/runtime/Chat/Copilot-adapter run: **5 files, 284 tests
  passed**.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **18 files, 476 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 90.32%, branches 83.29%, functions 93.33%, lines 90.45%
- `npm run package`: **PASS - 158 files, 4.36 MB**
- `npm audit --audit-level=low`: **PASS - 0 vulnerabilities**
- Runtime dependency root scan: **PASS - `typescript@5.9.3` only**
- VSIX inclusion/exclusion scan: **PASS**
  - compiled model-router/shared-context code and public privacy/architecture
    docs are present;
  - source, tests, coverage, private review material, source maps, workspace,
    and CI files are absent.
- Production and packaged fixture-secret scans: **PASS**
- Production URL scan: **PASS - only the documented loopback default**
- Source and packaged repository/bugs/homepage metadata scans: **PASS**

### Self-review and residual concerns

- Changed-file review covered detector ordering, fixed projections, both
  remote-provider routing paths, monotonic allocation, close/rebuild/disposal
  ownership, LRU recency, same-URI reuse, post-await cleanup, documentation,
  and package contents.
- Self-review corrected one documentation overstatement from process-wide to
  shared-context-wide epoch lifetime. No remaining high-confidence
  correctness, privacy, lifecycle, retention, or packaging concern was found.
- Live VS Code hosts and remote services were unavailable in this
  non-interactive environment. VS Code test doubles and injected provider
  boundaries cover the changed behavior.

---

## Double-eviction dismissal fence (2026-09-13)

### Correction implemented

- URI revision lookup now represents eviction or absence as `undefined`
  instead of the reusable numeric sentinel `0`.
- `captureEvidenceRevisionForUri` returns the URI's current fence or allocates
  a new globally monotonic fence and inserts it into the same bounded 256-entry
  LRU. Allocation continues from the shared-context epoch, so released and
  evicted values are never reused.
- Delayed dismissal captures through the allocating API and validates through
  the non-allocating current lookup. If either the captured fence or its
  replacement is evicted, current validation is absent and cannot equal the
  captured numeric fence.
- Existing close, runtime replacement, and disposal assertions now treat
  absence distinctly. Ordinary dismissal with no current evidence still
  returns `no-evidence` without entering persistence or fence handling.

### TDD evidence

- Initial RED: **6 expected failures** exposed every remaining `0` absence
  assertion and the missing capture API.
- Isolated RED after making absence explicit: the capture API test failed
  because the method did not exist, and the exact double-eviction regression
  failed because delayed dismissal cleared the replacement (`latest` became
  `undefined`).
- GREEN: focused shared-context/runtime suites passed **2 files, 93 tests**.
  The regression evicts the original URI revision before dismissal capture,
  publishes replacement evidence while persistence is delayed, evicts the
  replacement revision, then verifies the stale completion preserves the
  replacement evidence and inline thread.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **18 files, 479 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 90.37%, branches 83.37%, functions 93.35%, lines 90.50%
- `npm run package`: **PASS - 158 files, 4.36 MB**
- `npm audit --audit-level=low`: **PASS - 0 vulnerabilities**
- Runtime dependency root scan: **PASS - `typescript@5.9.3` only**
- VSIX inclusion/exclusion scan: **PASS**
  - compiled shared-context runtime and both public docs are present;
  - source, tests, coverage, private review material, and source maps are
    absent.
- Production and packaged secret-pattern scans: **PASS**
- Production URL scan: **PASS - only the documented loopback default**
- Source and packaged repository/bugs/homepage metadata scans: **PASS**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- Changed-file review covered capture/current API separation, monotonic
  allocation, LRU insertion and eviction, close/rebuild/disposal behavior,
  delayed persistence ordering, no-evidence handling, and package contents.
  No remaining high-confidence correctness, lifecycle, retention, security,
  or packaging concern was found.
- The exact race is deterministic under deferred persistence and VS Code test
  doubles; a live VS Code host was not exercised in this non-interactive
  environment.

---

## Export-equals, session-revision, and selected-diagnostic findings (2026-09-13)

### Corrections implemented

- TypeScript `export =` assignments now participate in public API analysis under
  a stable `export-equals` identity displayed as `export =`, distinct from both
  ESM default exports and CommonJS root assignments. Identifier, inline
  function, inline class, and checker-resolved callable expressions contribute
  signatures, so signature changes and removal produce `public-api-change`
  evidence while local renames with unchanged signatures remain quiet.
- `PairSharedContext` now advances its session revision for every exposed
  snapshot field: enabled/active/generation, goal/role/provider, all remaining
  budget counters, coexistence notice, and configuration warning. Complete
  semantically identical snapshots do not advance it.
- Chat trace, success, and error fences use that revision. A request-scoped
  revision fence advances only across session publications owned by that same
  runtime request, preserving valid responses after their own budget accounting
  while still rejecting any response crossed by an unrelated session update.
- Manual **Review Current Block** now intersects diagnostics with the selected
  range before taking the 20-item diagnostic bound. Automatic collection still
  takes only the first 20 diagnostics, and selected diagnostics continue through
  the existing normalization and stable-ID path.

### TDD evidence

- Export-equals RED: **7 expected failures** covered identifier/function/class/
  checker-callable signature changes, removal, and identity separation; the
  no-change characterization already passed. GREEN: **8 focused tests passed**.
- Session revision RED: **13 expected failures** covered all newly tracked
  fields and deferred provider/budget/notice/warning updates; unchanged and
  already tracked fields passed. GREEN: **18 focused tests passed**.
- Diagnostic ordering RED: the selected diagnostic after **21 earlier
  diagnostics** was omitted while the automatic 20-item guard passed. GREEN:
  both focused runtime regressions passed.
- Self-review RED/GREEN: a real runtime Chat response was initially suppressed
  by its own newly visible budget update; the request-owned revision fence made
  that regression pass without weakening unrelated-update rejection.
- Final focused semantic/Chat/runtime run: **3 files, 187 tests passed**.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **18 files, 507 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 90.44%, branches 83.55%, functions 93.41%, lines 90.57%
- `npm run package`: **PASS - 158 files, 4.36 MB**
- `npm audit --audit-level=low`: **PASS - 0 vulnerabilities**
- Runtime dependency root scan: **PASS - `typescript@5.9.3` only**
- VSIX inclusion/exclusion scan: **PASS**
  - compiled extension, semantic analyzer, Chat/runtime code, and public docs
    are present;
  - source, tests, coverage, private review material, editor/CI files, and
    source maps are absent.
- Production and packaged secret-pattern scans: **PASS**
- Production URL scan: **PASS - only the documented loopback default**
- Source and packaged repository/bugs/homepage metadata scans: **PASS**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- Changed-file review covered export identity collisions among supported module
  forms, checker-backed callable resolution, signature removal, every session
  snapshot field, stale trace/success/error paths, request-owned budget updates,
  diagnostic filtering order, normalization, automatic bounds, and package
  contents.
- Self-review found and corrected the request self-invalidation described above.
  No remaining high-confidence correctness, lifecycle, privacy, or packaging
  concern was found.
- A live VS Code host was unavailable in this non-interactive environment;
  deterministic VS Code test doubles and the packaged artifact cover the
  changed boundaries.

---

## Timeout-budget, class-export, and export-namespace findings (2026-09-13)

### Corrections implemented

- Exact unused reservation releases now republish the restored budget through
  the current request's revision fence. A Copilot deadline that expires after
  reservation but before provider dispatch therefore restores all capacity
  without making Chat suppress the request's own timeout.
- Variable declarations initialized with class expressions are resolved as
  class values. Checker construct signatures also resolve aliased classes and
  structural constructor types, including public constructor, instance-method,
  and static-method signatures. `export =`, default, direct, and local-alias
  exports now report class method/constructor changes and removals under their
  public labels.
- Export identities now use structured ESM, TypeScript export-equals, and
  CommonJS categories. The user-defined string-literal alias `export-equals`
  remains distinct from TypeScript `export =`, while existing default and
  CommonJS identity relationships and all display labels remain unchanged.

### TDD evidence

- Pre-dispatch timeout RED: the budget object restored its reservation, but the
  shared session still exposed zero capacity. GREEN: the integrated
  Runtime/Chat regression observes restored capacity, no provider dispatch,
  and the visible `ModelProviderTimeoutError`.
- Class-valued export RED: **5 expected failures** covered `export =`, default,
  and local-alias method changes, checker-resolved constructor changes, and
  method removal. A separate checker-only constructor/member regression failed
  before structural construct-member collection was added. GREEN: all **6**
  regressions passed.
- Export namespace RED: both directions of the string-literal
  `export-equals`/TypeScript `export =` transition produced no evidence.
  GREEN: each direction produces distinct added and removed API evidence.
- Final focused semantic/runtime/provider run: **3 files, 197 tests passed**.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **18 files, 516 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 90.59%, branches 83.67%, functions 93.50%, lines 90.71%
- `npm run package`: **PASS - 158 files, 4.36 MB**
- `npm audit --audit-level=low`: **PASS - 0 vulnerabilities**
- Runtime dependency root scan: **PASS - `typescript@5.9.3` only**
- VSIX inclusion/exclusion scan: **PASS**
  - compiled runtime and public docs are present;
  - source, tests, coverage, private review material, editor/CI files, and
    source maps are absent.
- Production and packaged credential-pattern scans: **PASS**
- Production and packaged URL scans: **PASS - loopback default only**
- Source and packaged repository/bugs/homepage metadata scans: **PASS**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- Changed-file review covered release ownership, revision-fence advancement,
  timeout surfacing, all requested class-valued export forms, public-member
  filtering, export-family collisions, evidence labels, and packaged contents.
  No remaining high-confidence correctness, lifecycle, privacy, or packaging
  issue was found.
- A live VS Code host was not exercised in this non-interactive environment.
  The semantic analyzer remains intentionally per-document, so class values
  imported from other modules are outside this slice.

---

## Remaining class-valued export signatures (2026-09-13)

### Corrections implemented

- Class declarations and expressions now always publish a constructor record.
  Their checker-derived constructor shape covers implicit and inherited
  constructors, normalizes away local class names, and retains public overload
  order.
- Callable and constructable type aliases, interfaces, variables, and
  expressions are collected under their external export identities. Structural
  construct signatures retain both parameter and return types instead of being
  mistaken for aliases to the returned class declaration.
- Callable/constructable values now compose call, construct, and applicable
  class/member signatures rather than returning after the callable surface.
  Exact duplicate entries are removed while the first occurrence order remains
  significant.
- Direct, default, TypeScript `export =`, local alias, and CommonJS paths keep
  the existing structured ESM/export-equals/CommonJS identity scheme.

### TDD evidence

- Initial semantic RED: **11 expected failures, 82 passing tests**. The
  regressions covered four implicit-constructor removal paths, implicit
  constructor addition/change, a structural constructor type alias, a
  structural variable return change, constructor-only change on a callable
  and constructable value, callable class members, duplicate signatures, and
  construct overload order.
- Self-review RED: a callable class intersection normalized an additional
  structural constructor as though it belonged to the class, hiding its return
  change. Per-signature ownership now normalizes only class-owned constructors.
- Focused semantic GREEN: **1 file, 94 tests passed**.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **18 files, 528 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 90.60%, branches 83.81%, functions 93.39%, lines 90.72%
- `npm run package`: **PASS — 158 files, 4.36 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript@5.9.3` only**
- VSIX inclusion/exclusion scan: **PASS**
  - compiled extension, semantic analyzer, and public docs are present;
  - source, tests, coverage, private review material, editor/CI files, and
    source maps are absent.
- Production and packaged credential-pattern scans: **PASS**
- Production and packaged runtime URL scans: **PASS — loopback default only**
- Source and packaged repository/bugs/homepage metadata scans: **PASS**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- Changed-file review covered implicit and inherited constructors, explicit
  overloads, structural parameter/return changes, hybrid call/construct
  surfaces, class intersections, duplicate entries, overload ordering, export
  paths, public-member filtering, and structured identities. The intersection
  ownership issue described above was fixed with its own RED/GREEN regression;
  no remaining high-confidence issue was found.
- A live VS Code host was not exercised in this non-interactive environment.
  Analysis remains intentionally per-document, so imported class declarations
  are not resolved across modules.

---

## Class/type export review findings (2026-09-13)

### Corrections implemented

- Removed the synthetic public zero-argument constructor fallback. Constructor
  records now come only from checker-resolved signatures whose effective
  declarations are public, including inherited constructor accessibility.
- Unified direct classes, class expressions, checker-resolved aliases, and
  callable/constructable intersections behind one checker-derived public
  surface. Nominal and inherited constructors are canonicalized without their
  local return-class names, while additional structural/class-intersection
  constructors retain overload order and return types.
- Added deterministic, deduplicated static and constructed-instance member
  collection. Public methods and data properties are included; private,
  protected, and private-identifier declarations remain excluded.
- Added a distinct type-export namespace and structural surface records for
  direct aliases/interfaces and local type export lists. Runtime value exports
  no longer masquerade as type-only exports, while equivalent direct/list and
  `export type`/`export { type ... }` forms share external identities.
- Keyed legal default interface exports by the external `default` identity.
- Added class-level abstract/concrete markers and structural
  abstract-constructor markers. Class markers also cover inaccessible
  constructors without fabricating a public construct signature.

### TDD evidence

- Initial semantic RED: **13 expected failures** across the constructor-access,
  structural-member, direct-type/default, namespace, and abstract regressions.
  The initially vacuous constructor-equivalence case was tightened through a
  checker-resolved alias and then failed for the expected duplicate signature.
- Self-review RED cases covered an abstract class with a protected constructor,
  a non-primary class return in a constructable intersection, duplicate
  abstract/class evidence, and an abstract structural constructor returning
  the intersected nominal class.
- Focused semantic GREEN: **1 file, 111 tests passed**.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **18 files, 545 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 91.01%, branches 84.38%, functions 93.66%, lines 91.14%
- `npm run package`: **PASS — 158 files, 4.36 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript@5.9.3` only**
- VSIX inclusion/exclusion scan: **PASS**
  - compiled extension, semantic analyzer, and public docs are present;
  - source, tests, coverage, private review material, editor/CI files, and
    source maps are absent.
- Production and packaged credential-pattern scans: **PASS**
- Production and packaged runtime URL scans: **PASS — loopback default only**
- Source and packaged repository/bugs/homepage metadata scans: **PASS**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- Changed-file review covered explicit, implicit, inherited, inaccessible, and
  overloaded constructors; class and structural abstractness; external export
  identities; type/value namespace transitions; intersection member ordering
  and deduplication; non-public filtering; and structural constructor returns.
- Self-review found and corrected over-normalization of non-primary class and
  structural constructor returns, plus duplicate abstract-class evidence. No
  remaining high-confidence correctness, privacy, or packaging concern was
  found.
- Analysis remains intentionally per-document with module resolution disabled,
  so public surfaces imported from other project files remain outside this
  analyzer slice.

---

## Latest class/type API surface findings (2026-09-13)

### Corrections implemented

- Canonicalized recursive references in exported type, interface, and class
  member signatures to a stable `__external_self__` token. The normalizer
  rewrites only parsed type references/type queries, preserves shadowing by
  signature type parameters, and therefore ignores equivalent local/default
  renames without hiding real recursive shape changes.
- Added explicit `value-*` and `type-*` signature namespaces. Local merged
  symbols now retain both checker value and declared type surfaces, including
  non-callable merged values, while value-only and type-only transitions remain
  independently observable.
- Added separate getter/setter signature markers to public property surfaces.
  Getter/setter availability and setter parameter changes are now observable;
  non-public accessor halves remain outside the public shape.
- Replaced first-constituent class abstractness with a sorted marker for every
  class constituent. Construct-signature groups are canonicalized across
  intersection order while preserving overload order inside each constituent,
  and abstract constructor markers inspect the owning class where applicable.
- Deduplicated equivalent type/value member changes and removals using a
  namespace-neutral public key plus the complete before/after signature
  transition. Evidence IDs derive from that same stable transition, so source
  declaration order cannot select a different duplicate identity.

### TDD evidence

- Recursive normalization RED: **4 expected failures** for renamed recursive
  aliases, interfaces, classes, and default exports; the real-shape-change
  control already passed. GREEN: **5 focused cases passed**.
- Merged namespaces RED: **3 expected failures** for dual-surface addition and
  value-only/type-only transitions. A self-review case was tightened from an
  already-supported callable variable to a scalar merged value, then failed as
  expected. GREEN: **4 focused cases passed**.
- Accessor shape RED: **2 expected failures** for adding a setter and changing
  its parameter. Self-review added a third expected failure for a private
  setter incorrectly suppressing its public getter. GREEN: **3 focused cases
  passed**.
- Intersection abstractness RED: **3 expected failures** for a non-primary
  class marker and class/construct constituent reordering; the non-primary
  structural abstractness control already passed. Self-review added one
  expected failure proving overload order inside a constituent must remain
  significant. GREEN: **7 focused intersection cases passed**.
- Duplicate evidence RED: **2 expected failures** for duplicate merged-member
  change/removal findings. A declaration-order identity case was tightened to
  direct merged exports and then failed as expected. GREEN: **4 focused
  deduplication/identity cases passed**.
- Final focused semantic suite: **1 file, 131 tests passed**.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **18 files, 565 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 91.05%, branches 84.64%, functions 93.57%, lines 91.17%
- `npm run package`: **PASS — 158 files, 4.36 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript@5.9.3` only**
- VSIX inclusion/exclusion scan: **PASS**
  - compiled extension, semantic analyzer, and public docs are present;
  - source, tests, coverage, private review material, editor/CI files, and
    source maps are absent.
- Production and packaged credential-pattern scans: **PASS**
- Production and packaged runtime URL scans: **PASS — loopback default plus
  declared repository metadata only**
- Source and packaged repository/bugs/homepage metadata scans: **PASS**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- Changed-file review covered recursive aliases/defaults, generic shadowing,
  merged callable/scalar/class symbols, namespace transitions, public and
  non-public accessors, inaccessible constructors, intersection reordering,
  overload ordering, duplicate transitions, CommonJS paths, and existing
  direct/local/export-equals/default export paths.
- Self-review found and corrected merged scalar-value loss, overload-order
  erasure within intersections, non-public setter suppression of a public
  getter, and declaration-order-dependent deduplicated IDs.
- No remaining high-confidence correctness, privacy, packaging, or dependency
  issue was found. Analysis intentionally remains per-document with module
  resolution disabled; a live VS Code extension host was not exercised in this
  non-interactive run.

---

## Exported surface serializer final review fixes (2026-09-13)

### Corrections implemented

- Replaced textual self-name matching with checker symbol and alias-target
  identity. Canonical printer substitutions now distinguish the exported root,
  structurally different recursive constituents, imported provenance, and
  legal user identifiers that resemble internal sentinels.
- Added a stable type surface for classes in direct, local, aliased, merged,
  anonymous, and namespace-nested forms. Consolidating equivalent interface
  augmentation into a class is now a no-op, while real instance/static changes
  remain visible.
- Expanded value serialization to non-callable object properties, declared
  values merged with interfaces, namespace/function statics, nested namespace
  classes and types, enums, computed symbol keys, and CommonJS object members.
  Library-only members are excluded while generic roots remain represented.
- Derived accessor surfaces independently from public getter returns and setter
  parameters. Private/protected TypeScript and JSDoc accessors cannot affect a
  public counterpart; explicit JSDoc setter types remain visible.
- Introduced structured `SurfaceSignature` records. Callable and constructable
  intersections, callable members, and class-instance members retain overload
  order inside each constituent while sorting and deduplicating complete
  constituent groups.
- Preserved namespace and member provenance in transition keys and evidence
  IDs. Type and value changes with equal text remain distinct, while exact
  duplicates within one namespace/member collapse deterministically.
- Hardened directly coupled cases found during self-review: strict nullable
  types, index signatures, generic constraints/defaults, mapped modifiers,
  external heritage syntax, local type fingerprints with bounded traversal,
  imported re-exports, CommonJS alias/replacement/spread ordering, and
  implementation-vs-overload separation.

### TDD evidence

- Added focused RED/GREEN regressions and no-change controls for all six
  findings, plus the directly coupled alias, namespace, CommonJS, generic,
  computed-key, enum, and overload cases found during review.
- Each primary reproducer failed for the expected missing or conflated surface
  before its implementation change.
- Final focused semantic suite: **1 file, 241 tests passed**.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **18 files, 675 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 91.51%, branches 85.31%, functions 93.80%, lines 91.61%
- `npm run package`: **PASS — 158 files, 4.37 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript@5.9.3` only**
- VSIX inclusion/exclusion scan: **PASS**
  - compiled extension, semantic analyzer, and public docs are present;
  - source, tests, coverage, private review material, editor/CI files, and
    source maps are absent.
- Production and packaged credential-pattern scans: **PASS**
- Production and packaged runtime URL scans: **PASS — loopback default only**
- Source and packaged repository/bugs/homepage metadata scans: **PASS**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- Base-to-working-tree review covered all changed collection, canonicalization,
  transition, CommonJS, and regression-test paths. Focused differential probes
  confirmed stable no-op identities and visible real changes across both type
  and value namespaces.
- Analysis intentionally remains per-document: imported symbols contribute
  syntax-level provenance, but external module bodies are not resolved or
  analyzed. A live VS Code extension host was not exercised in this
  non-interactive run.

---

## Type-surface provenance review fixes (2026-09-13)

### Corrections implemented

- Recursive local-type fingerprints now collect public getter returns and
  setter parameters independently. Private and protected accessor halves are
  excluded before type derivation, while public setter-only and
  public-setter/private-getter changes remain observable.
- Constructable intersections retain each constituent type alongside its
  overload group. Constructor signatures and constructed-instance members use
  that constituent's self symbols, eliminating equivalent local class rename
  noise without hiding structurally different return classes.
- Checker-resolved values only acquire class-constructor and type-namespace
  surfaces when the exported value type is constructable. A value such as
  `export const api = new Container()` now remains an instance value.
- Every checker member identity now uses a tagged structured key for literal,
  computed-literal, exported-computed, computed-symbol, or checker fallback
  provenance. Literal text cannot collide with a computed-key encoding.
- CommonJS object collection now combines getter/setter halves and applies
  source-order overwrite semantics to checker-known spread keys. Index,
  `any`, `unknown`, broad-object, and type-parameter spreads conservatively
  invalidate prior property certainty before their own surface is collected.
- Recursive property worklists are sorted by canonical member identity before
  the shared 512-node fingerprint budget is consumed. Equivalent large
  interfaces therefore remain stable across reversed declaration order while
  the existing hard bound, cache, and cycle guards remain intact.

### TDD evidence

- RED: the focused new-regression run produced **9 expected failures and 3
  passes**. Failures covered private/protected getter contamination,
  constructor constituent self references, class-instance type fabrication,
  literal/computed key collision, split CommonJS accessors, known and unknown
  spread overwrites, and reversed large-interface budgets.
- Two tightened regressions independently failed for a public setter hidden by
  a private getter and the extra class-instance type namespace.
- GREEN: the focused provenance run passed **13 tests**; the complete semantic
  analyzer suite passed **254 tests**.
- The older non-primary class-return control was strengthened with distinct
  public instance shapes so it continues to prove real constituent return
  changes while equivalent nominal renames normalize.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **18 files, 688 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 91.58%, branches 85.18%, functions 93.88%, lines 91.68%
- `npm run package`: **PASS — 158 files, 4.37 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript@5.9.3` only**
- VSIX inclusion/exclusion and compiled-marker scans: **PASS**
  - the compiled provenance implementation is present;
  - source, tests, coverage, private review material, editor/CI files, and
    source maps are absent.
- Production and packaged credential-value scans: **PASS**
- Production runtime URL scan: **PASS — loopback default only**
- Source and packaged repository/bugs/homepage and fake-URL scans: **PASS**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- Base-to-working-tree review covered accessor filtering, constituent
  ownership, constructor/instance discrimination, structured identities,
  CommonJS accessor/spread ordering, budget exhaustion, cache/cycle behavior,
  and every added regression. No remaining high-confidence correctness,
  privacy, packaging, or dependency finding was identified.
- Unknown-key CommonJS spreads intentionally discard certainty about prior
  properties; this is conservative and may suppress a change that depends on
  a runtime-absent spread key, but it never presents an earlier value as the
  definite final export.
- Analysis remains per-document with external module bodies unresolved. A live
  VS Code extension host was not exercised in this non-interactive run.

---

## Declaration-emitter public API correction (2026-09-14)

### Corrections implemented

- Replaced the bespoke exported signature, class/member, type-fingerprint,
  provenance, and CommonJS surface collectors with TypeScript's official
  declaration-only `Program.emit`.
- Previous and current TypeScript/JavaScript text are compiled independently
  with `declaration: true`, `emitDeclarationOnly: true`, and `noResolve: true`.
  The existing containment-checked host exposes only the in-memory document
  and installed TypeScript standard-library files; project and external module
  files remain unavailable.
- Captured each `.d.ts` output in memory and canonicalized it as a TypeScript
  scanner token stream with trivia skipped. No declaration text enters
  evidence.
- A differing reliable declaration surface now yields exactly one generic,
  bounded `public-api-change` item per edit. Its detail distinguishes an
  added, removed, or changed document surface; its ID contains only a
  privacy-safe module hash and declaration-transition hash.
- Current ESM export syntax anchors evidence to a current exported declaration.
  Declaration removal and other cases use a valid zero-width source-start
  range.
- Missing output, declaration-emit errors, scanner errors, or an unstable
  source suppress public API evidence. There is deliberately no heuristic
  fallback.
- Retained dependency and complexity analyzers unchanged. Removed obsolete
  hand-built surface tests and replaced them with a compact representative
  emitter suite covering functions, classes/accessors, type/interface merges,
  function-valued and destructured exports, export lists, unresolved
  re-exports and type-only exports, `export =`, CommonJS root/named exports,
  removal, formatting-only edits, invalid source, IDs, privacy, and ranges.
- Updated README, configuration, vertical-slice architecture, design, and
  implementation-plan wording to describe the best-effort, generic,
  per-document compiler declaration boundary.

### TDD evidence

- Baseline before changes: **18 files, 688 tests passed**.
- RED: the new declaration-emitter suite produced **15 expected failures and 2
  passes** against the bespoke implementation. Failures demonstrated
  symbol-specific/multiple evidence, declaration details, and invalid-baseline
  fallback rather than the required generic compiler-emitted behavior.
- GREEN: the new suite passed **17 tests** after the emitter implementation.
- The pruned, focused semantic analyzer suite passed **43 tests**; the focused
  semantic/runtime baseline integration run passed **114 tests** across two
  files.

### Complexity and removal checks

- `src/core/semanticAnalyzer.ts`: **4,702 -> 1,064 lines** (**3,638 removed**).
- `npx tsc -p tsconfig.json --noEmit --sourceMap false --noUnusedLocals
  --noUnusedParameters`: **PASS**.
- Obsolete-symbol scan for `SurfaceSignature`, `SignatureRecord`,
  `collectExportedSignatures`, `documentTypeFingerprint`, checker serializers,
  CommonJS surface collectors, imported-binding provenance, surface-member
  identity, and type-fingerprint machinery: **PASS — no matches**.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **18 files, 477 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 89.77%, branches 82.97%, functions 92.99%, lines 89.91%
- `npm run package`: **PASS — 158 files, 4.36 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript@5.9.3` only**
- VSIX exclusion and compiled declaration-emitter marker scans: **PASS**
  - source, tests, coverage, private review material, editor/CI files, and
    source maps are absent;
  - declaration emit and scanner code are present in the package.
- Production and packaged credential-value scans: **PASS**
- Production and packaged runtime URL scans: **PASS — loopback default only**
- Source and packaged repository/bugs/homepage and fake-URL scans: **PASS**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- The final diff was reviewed for compiler-host containment, declaration
  reliability gates, token canonicalization, evidence cardinality/privacy,
  range validity, non-API analyzer preservation, integration expectations,
  documentation accuracy, and package contents. No high-confidence defect was
  found.
- Public API evidence intentionally loses symbol-level specificity in favor of
  the compiler-owned declaration surface and one generic document signal.
- Analysis remains best-effort and per-document. External modules are not
  resolved, and declaration-emission failure suppresses API evidence rather
  than guessing. A live VS Code extension host was not exercised in this
  non-interactive run.

---

## Declaration-file and remote-projection follow-up (2026-09-14)

### Corrections implemented

- Existing `.d.ts`, `.d.mts`, and `.d.cts` documents are recognized through
  TypeScript's declaration-file classification and canonicalized directly
  from their trivia-free source token streams instead of requiring declaration
  output that the compiler does not emit for an input declaration file.
- Direct declaration comparison preserves the existing single bounded,
  privacy-safe `public-api-change` item and its added, removed, or changed
  classification. Equal surfaces and formatting/comment-only edits remain
  silent; invalid current declarations remain unstable, while invalid prior
  declarations suppress public API evidence.
- The fixed remote `public-api-change` projection now describes a public
  declaration/API surface addition, removal, or change involving types,
  interfaces, or values. Analyzer details and raw declaration text remain
  excluded from remote requests.
- README, configuration, and architecture documentation now describe both the
  direct declaration-file path and the generic remote projection.

### TDD evidence

- RED: the focused semantic/privacy run reported **4 expected failures and 172
  passes**: `.d.ts`, `.d.mts`, and `.d.cts` changes produced no evidence, and
  the privacy projection retained the obsolete signature-only wording.
- GREEN: the same two focused suites passed **176 tests**, including all three
  declaration extensions, added/removed/changed classifications, unchanged
  input, formatting/comment-only edits, invalid input, fixed projection text,
  and raw-text omission.

### Verification

- Focused semantic/privacy suites: **PASS — 2 files, 176 tests**
- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **18 files, 483 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 89.78%, branches 83.00%, functions 92.99%, lines 89.92%
- `npm run package`: **PASS — 158 files, 4.36 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript@5.9.3` only**
- VSIX exclusion and compiled review-fix marker scans: **PASS**
- Production and packaged credential-value scans: **PASS**
- Production and packaged runtime URL scans: **PASS — loopback default only**
- Source and packaged repository/bugs/homepage and fake-URL scans: **PASS**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- Changed-file review found no remaining high-confidence declaration
  classification, canonicalization, privacy-projection, documentation, or
  packaging issue.
- Analysis remains intentionally per-document and trivia-insensitive.
  External modules are unresolved, and syntactically invalid declaration
  surfaces are skipped rather than guessed. A live VS Code extension host was
  not exercised in this non-interactive run.

---

## Declaration diagnostics and printer canonicalization follow-up (2026-09-14)

### Corrections implemented

- `.d.ts`, `.d.mts`, and `.d.cts` inputs now run TypeScript program syntactic
  and semantic diagnostics inside the existing containment-checked in-memory
  compiler host. Semantic declaration errors such as ambient function bodies
  and disallowed initializers suppress fingerprinting and public API evidence;
  analysis remains explicitly stable with no unsupported evidence or
  diagnostic text exposed.
- Valid declarations are normalized with the TypeScript Printer configured to
  remove comments before scanner token fingerprinting. Equivalent optional
  interface member semicolon/comma choices now compare equal, while modifiers,
  optionality, member types, and exports remain represented.
- Regression coverage exercises both invalid-current and invalid-previous
  function bodies and initializers across all three declaration extensions,
  optional delimiter equivalence across all three extensions, and real member
  type changes across all three extensions.
- README, configuration, and architecture documentation now describe
  diagnostic gating and printer-based canonicalization.

### TDD evidence

- RED: the focused semantic suite reported **7 expected failures and 52
  passes**. All three optional semicolon/comma cases produced false public API
  evidence, and invalid current/prior function-body and initializer cases
  produced evidence instead of remaining unsupported.
- GREEN: the focused semantic suite passed **59 tests**, including every new
  declaration-extension regression.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **18 files, 493 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 89.76%, branches 83.04%, functions 93.00%, lines 89.91%
- `npm run package`: **PASS — 158 files, 4.36 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript@5.9.3` only**
- VSIX exclusion and compiled declaration diagnostic/printer marker scans:
  **PASS**
- Production and packaged credential-value scans: **PASS**
- Production and packaged runtime URL scans: **PASS — loopback default only**
- Source placeholder URL and packaged repository metadata scans: **PASS**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- The changed code and tests were reviewed for restricted-host preservation,
  declaration diagnostic gating, diagnostic privacy, printer normalization,
  meaningful syntax retention, evidence cardinality, documentation accuracy,
  and package contents. No high-confidence defect was found.
- Declaration files that depend on unresolved external modules remain
  intentionally unsupported by the per-document restricted host and therefore
  produce no public API evidence. A live VS Code extension host was not
  exercised in this non-interactive run.

---

## Runtime context and dismissal race follow-up (2026-09-14)

### Corrections implemented

- `PairContextRevisionFence` is now an opaque, context-owned token. Shared
  session and evidence publications reject stale or foreign fences while
  allowing the owning request's accepted session updates to advance that same
  token.
- Manual, automatic, and Chat generation capture one request fence before
  provider work. The fence composes shared-context revision, session
  generation, cancellation, document version, and exact per-URI request
  ownership.
- Local-template, Copilot, and OpenAI-compatible paths carry the same fence
  through preparation, reservation, completion, status publication, error
  handling, and local fallback. Stale work may still settle budget actually
  consumed by a provider, but it cannot publish that stale snapshot, change the
  visible provider/status, fall back locally, render inline, or replace shared
  latest evidence.
- Dismissal now cancels the target URI's runtime intervention and every Chat
  request and advances its unique evidence fence before awaiting
  persistence. Post-persistence cleanup still compares the unique URI revision,
  so evidence legitimately replaced during persistence is retained. The
  target-scoped invalidation does not cancel or stale an otherwise-current
  request for another URI.
- Added ignored-cancellation dismissal regressions for manual, automatic, and
  Chat requests, plus deferred cross-URI success, output-limit error, and local
  fallback regressions.

### TDD evidence

- RED: the focused runtime suite first reported **6 expected failures and 71
  passes**, followed by one focused independent-URI failure. The failures
  showed no pre-persistence cancellation or fence
  advance, stale manual/automatic/Chat completion, a slower success replacing
  newer URI evidence, a slower error replacing current status, and a slower
  failure running local fallback and rendering stale evidence; the follow-up
  exposed over-broad dismissal invalidation of unrelated work.
- GREEN: the focused runtime/Chat suites passed **121 tests**. The existing
  concurrent over-limit test now also verifies that stale budget publication
  is withheld until the current request owner publishes the settled aggregate.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **18 files, 500 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 89.54%, branches 83.44%, functions 93.32%, lines 89.68%
- `npm run package`: **PASS — 158 files, 4.36 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript@5.9.3` only**
- VSIX exclusion and compiled lifecycle-fence marker scans: **PASS**
- Production and packaged credential-value scans: **PASS**
- Production and packaged runtime URL scans: **PASS — loopback default only**
- Source placeholder URL and source/packaged repository metadata scans:
  **PASS**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- Changed-file review covered fence opacity/ownership, session and evidence
  publication ordering, budget settlement, per-URI independence, dismissal
  rollback/replacement behavior, cancellation-ignoring providers, Chat
  suppression, cleanup, and package output. No remaining high-confidence
  correctness or security defect was found.
- A live VS Code extension host and live GitHub Copilot service were not
  exercised in this non-interactive environment. Deterministic VS Code adapter,
  OpenAI-compatible ignored-cancellation, local fallback, and lifecycle tests
  cover the changed boundaries.

---

## Session-preparation race follow-up (2026-09-14)

### Corrections implemented

- Session preparation now stages memory, coexistence discovery, and the
  deterministic ordered workspace-root snapshot instead of mutating runtime
  state before listener activation.
- Startup registers the complete listener set before committing staged state.
  The commit re-reads workspace roots and the memory revision; stale
  preparations are discarded and retried against current roots.
- Startup and active refresh share a three-attempt bound. Sustained churn
  aborts through the existing lifecycle rollback path, disposing listeners,
  cancelling work, and clearing transient state instead of retrying forever.
- Open-document listeners are activated atomically and fenced to their owning
  listener generation. Reconciliation occurs only after all listeners are
  installed, while duplicate open events safely reseed the same document.
- Active refreshes continue to block edit processing and defer document
  seeding until the current prepared transaction commits.

### TDD evidence

- RED: the added-root startup regression expected a second discovery but
  observed one, proving the original root snapshot was reused.
- RED: the removed-root registration regression likewise observed one
  discovery and exposed stale root-specific dismissals at activation.
- RED: the deferred document-open regression observed zero analyzer calls on
  the first edit because the document had no baseline.
- RED: invoking a stopped generation's retained open callback incorrectly
  seeded stale text; an atomic-registration regression likewise retained a
  document that opened and closed while listeners were only partly installed.
- GREEN: focused lifecycle/runtime/support verification passed **3 files and
  122 tests**, including add/remove, bounded repeated churn, first-edit
  analysis with fake timers, stop/dispose, restart, refresh, and rollback.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **18 files, 509 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 89.65%, branches 83.44%, functions 93.73%, lines 89.79%
- `npm run package`: **PASS — 158 files, 4.36 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript@5.9.3` only**
- VSIX exclusion and compiled preparation-marker scans: **PASS**
- Production and packaged credential-value scans: **PASS**
- Production and packaged runtime URL scans: **PASS — loopback default only**
- Source and packaged repository metadata scans: **PASS**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- Changed-file review covered staged commit ordering, root and memory revision
  checks, bounded retries, overlapping refreshes, listener registration
  rollback, stale callback fencing, exact open-document reconciliation, and
  first-edit baselines. One timing-sensitive test was converted to fake timers;
  no remaining high-confidence defect was found.
- Sustained workspace-folder churn intentionally stops the session after three
  failed snapshots and reports the refresh/start failure. A live VS Code
  extension host was not exercised; deterministic adapter tests cover the
  affected event-ordering boundaries.

---

## Remaining preparation-race closure (2026-09-14)

### Corrections implemented

- Overlapping workspace-folder events now join one session-owned refresh
  promise. They no longer abort and replace the in-flight generation, repeat
  cancellation/clearing, or reset its three-attempt preparation budget.
- The refresh coordinator remains non-ready while serialized attempts run. If
  all three snapshots lose their root fence, it aborts pending work, clears
  transient state, disposes the session listeners, publishes Pair as stopped,
  and displays one workspace-refresh failure. A later explicit start creates a
  fresh generation and receives a fresh three-attempt budget.
- Root-memory loads are sequentially cancellation-fenced. Preparation checks
  its session immediately after every awaited repository load, before
  coexistence discovery, after discovery, and after any revision-triggered
  reload, so a stopped or disposed generation cannot advance to a later stage.
- The listener-registration first-edit regression now depends exclusively on
  production open-listener and preparation reconciliation; it no longer
  manually invokes the open listener after startup.
- Atomic listener rollback and repository-scoped root-memory replacement remain
  covered by the focused and full lifecycle suites.

### TDD evidence

- RED: the lifecycle suite reported **2 expected failures and 18 passes**:
  overlapping refresh calls returned four distinct promises, replaced the
  in-flight generation, and did not share one bounded coordinator.
- RED: after the lifecycle coordinator was introduced, the targeted runtime
  suite reported **1 expected failure and 1 pass** because four coalesced folder
  events attached four rejection handlers and displayed the same failure four
  times.
- RED: the deferred-memory-stop regression reported **1 expected failure**:
  preparation launched two root-memory reads instead of stopping after the
  first awaited read.
- GREEN: focused lifecycle/runtime/support verification passed **3 files and
  125 tests**. The production-only first-edit regression also passed after its
  manual post-start listener calls were removed.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **18 files, 512 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 90.40%, branches 83.82%, functions 93.92%, lines 90.54%
- `npm run package`: **PASS — 158 files, 4.36 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript@5.9.3` only**
- VSIX exclusion and compiled preparation-marker scans: **PASS**
- Production and packaged credential-value scans: **PASS**
- Production and packaged runtime URL scans: **PASS — loopback default only**
- Source and packaged repository metadata scans: **PASS**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- Changed-file review covered shared attempt ownership, promise coalescing,
  generation and abort fencing, one-time visible failure, failure cleanup,
  explicit restart, per-root memory cancellation, listener rollback, root
  replacement, and first-edit baseline ownership. No remaining
  high-confidence correctness or security defect was found.
- A live VS Code extension host was not exercised in this non-interactive
  environment. Deterministic runtime/lifecycle tests cover the affected event
  ordering and cancellation boundaries.

---

## Copilot Chat response display bound (2026-09-14)

### Corrections implemented

- Added one non-configurable **16,384 Unicode code-point** Chat response
  display limit shared by local-template, Copilot, and OpenAI-compatible
  successes and fallbacks.
- Added a single formatter immediately before every `ChatResponseStream.markdown`
  call that can contain provider or dynamic text. Dynamic session-control and
  session-plan text use the same boundary; the fixed short unavailable-status
  message remains untouched.
- Applied the formatter to dynamic provider error detail as well as successful
  Markdown output.
- Normalized CRLF, CR, and Unicode line separators to LF. Unsafe control and
  format characters become spaces, while tabs, intentional Markdown/newlines,
  and Unicode joiners are preserved.
- Truncation counts Unicode code points, reserves the last displayed code point
  for an explicit `…`, and cannot split a UTF-16 surrogate pair.
- Documented the display cap in README and configuration guidance, explicitly
  distinguishing it from the 180-token remote output allowance and the
  OpenAI-compatible 64 KiB HTTP response-body cap.

### TDD evidence

- Initial RED: both focused suites failed to load because the wished-for
  display-boundary module did not exist.
- Integration RED: the Chat suite reported **3 expected failures** for
  unbounded session-control text, session-plan fields, and provider error
  detail.
- GREEN: focused formatter/Chat verification passed **2 files, 52 tests**.
- Required regressions cover a 64 KiB ASCII OpenAI-compatible response,
  long Copilot Markdown with CJK and emoji, local fallback output, CRLF/CR and
  control normalization, the exact 16,384-code-point boundary, and
  no-dangling-surrogate truncation.

### Verification

- Focused Chat/provider/runtime tests: **PASS — 5 files, 208 tests**
- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **19 files, 522 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 90.44%, branches 83.90%, functions 93.94%, lines 90.58%
- `npm run package`: **PASS — 159 files, 4.36 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript@5.9.3` only**
- VSIX exclusion and compiled display-limit marker scans: **PASS**
- Production and packaged credential-pattern scans: **PASS**
- Production and packaged runtime URL scans: **PASS — loopback default only**
- Source and packaged repository metadata scans: **PASS**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- Changed-file review covered all Chat Markdown calls, local/remote/fallback
  routing, error detail, lifecycle fences, Markdown preservation, line-ending
  and control normalization, code-point boundaries, documentation, and package
  contents. No high-confidence correctness, security, lifecycle, or packaging
  issue was found.
- Live VS Code Chat rendering and remote providers were unavailable in this
  non-interactive environment. Deterministic response-stream and provider
  adapter tests cover the changed display boundary.

---

## Local Chat Markdown/action injection closure (2026-09-14)

### Corrections implemented

- Added one central Markdown text escaper for untrusted values embedded in
  extension-owned Chat templates. It escapes ASCII Markdown punctuation and
  backslashes, makes HTML delimiters literal, and breaks `command:` and
  `vscode:`-family URI schemes with a non-URI separator while preserving
  Unicode and line structure.
- Local `/why`, `/explain`, and `/trace` templates now escape evidence title,
  detail, source, references, severity, symbol name/kind, and evidence/symbol
  ranges before interpolation. `/explain` includes the escaped bounded
  references explicitly.
- `/session` keeps its extension-owned labels and layout as Markdown while
  escaping goal, role, provider, coexistence/workspace notice, and
  configuration warning values. Session-control results and provider error
  detail are escaped as text before applying the existing display bound.
- All four `ChatResponseStream.markdown` call sites were audited: one is a
  fixed literal, session-control text is escaped, fixed plan messages are
  either literal or field-escaped at construction, and generated provider
  output passes through the model-Markdown sanitizer.
- Remote model Markdown intentionally retains headings, emphasis, fenced code,
  paragraphs, and newlines. Link/image brackets and raw HTML delimiters are
  escaped, and bare or linked action URI schemes are made non-actionable.
  The sanitizer is idempotent, so already escaped local fallback fields are
  not escaped again.
- Inline comments remain on their existing safe path:
  `MarkdownString.appendText` receives unescaped plain intervention text,
  preventing visible double escaping while keeping untrusted text inert.
- Documented the local-template and remote-model rendering policies in the
  README and configuration guide.

### TDD evidence

- RED: the new central safety suite failed to load because the requested
  `chatMarkdownSafety` module did not exist.
- RED: malicious local `/why`, `/explain`, and `/trace` plus unavailable
  Copilot fallback regressions reported **2 expected failures** with active
  command/vscode links, images, HTML, fences, and emphasis left in output.
- RED: participant regressions reported **6 expected failures** across
  workspace/configuration status, session-control, remote `/why`, `/explain`,
  `/trace`, and provider-error paths.
- RED: the inline regression exposed double escaping through
  `MarkdownString.appendText`; the local intervention path was separated from
  Chat Markdown escaping before proceeding.
- RED: the local `/explain` reference regression failed until references were
  included and escaped.
- GREEN: central, command, fallback, status, error, inline, and remote-policy
  regressions pass with malicious command links, vscode images, inline/block
  HTML, headings, emphasis, code fences, backslashes, and Korean/emoji text.

### Verification

- Focused Chat/model/runtime tests: **PASS — 8 files, 363 tests**
- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **20 files, 533 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 90.64%, branches 84.17%, functions 94.03%, lines 90.78%
- `npm run package`: **PASS — 160 files, 4.36 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript@5.9.3` only**
- VSIX safety-module inclusion and source/test/secret exclusion scan: **PASS**
- Production and compiled credential-pattern scan: **PASS**
- Production and compiled runtime URL scan: **PASS — loopback default only**
- Source, compiled, and packaged Chat sink audit: **PASS — 4/4 reviewed**
- Source and packaged repository metadata scan: **PASS**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- Changed-file review covered action-link/image forms, bare and encoded action
  schemes, raw HTML, Markdown block/inline punctuation, backslashes, Unicode,
  output truncation ordering, local fallback routing, fixed-template
  preservation, and all Chat Markdown sinks. No remaining high-confidence
  correctness or security defect was found.
- Remote links and images are deliberately rendered inert rather than
  allow-listed. A live VS Code Chat renderer and live remote model were not
  available in this non-interactive environment; deterministic stream tests
  and packaged-code scans cover the enforced boundary.

---

## Chat Markdown bare-autolink closure (2026-09-14)

### Corrections implemented

- `sanitizeModelMarkdown` now neutralizes GFM extended autolinks beginning with
  bare `http://`, `https://`, or `www.`, plus bare email addresses.
- The sanitizer backslash-escapes one ASCII separator (`:`, `.`, or `@`).
  CommonMark/GFM renders the original readable punctuation, but the source no
  longer contains the contiguous token required by the autolink scanner.
- URL text remaining inside an escaped Markdown link or image destination is
  neutralized by the same rule, so escaping the delimiters cannot expose a
  second bare-autolink path.
- Sanitized URL spans are recognized on later passes, preventing a nested
  `www.` or email-shaped path segment from receiving an additional escape.
- Existing fullwidth-colon handling for `command:` and `vscode:` schemes and
  delimiter escaping for links, images, raw HTML, `data:`, and `file:` targets
  remain unchanged.
- README and configuration guidance now document the rendering-compatible,
  idempotent separator strategy.

### TDD evidence

- RED: the focused safety suite ran **11 tests with 9 expected failures**.
  Exact bare HTTP/HTTPS, `www.`, email, escaped link/image destination,
  punctuation, Unicode, retained inert-scheme, and repeat-sanitization cases
  all exposed the missing autolink neutralization.
- GREEN: the focused sanitizer suite passed **11/11 tests** after the minimal
  source transformation was implemented.

### Verification

- Focused Chat safety tests: **PASS — 8 files, 248 tests**
- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **20 files, 542 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 90.68%, branches 84.23%, functions 94.05%, lines 90.81%
- `npm run package`: **PASS — 160 files, 4.37 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript@5.9.3` only**
- VSIX safety-module inclusion and source/test/secret exclusion scan: **PASS**
- Secretlint preset scan of source, compiled output, package metadata, and
  public documentation: **PASS**
- Production and compiled credential-pattern scan: **PASS**
- Production and compiled runtime URL scan: **PASS — loopback default only**
- Source and compiled Chat sink scan: **PASS — 4/4 sinks retained**
- Packaged repository metadata scan: **PASS**
- Markdown-it linkify rendering check: **PASS — 6 autolink/idempotence cases
  rendered with no anchors or images**
- `git diff --check`: **PASS**

### Self-review and residual concerns

- Changed-file review covered exact output, punctuation boundaries, Unicode,
  nested `www.`/email text in an already neutralized URL, repeated
  sanitization, existing schemes, HTML, links/images, documentation, compiled
  output, and package contents. No high-confidence defect remains.
- A live VS Code Chat renderer was unavailable in this non-interactive
  environment. The exact sanitizer tests plus a Markdown-it linkify rendering
  check exercise the same documented backslash-escape behavior.

---

## Chat safe-text rendering architecture (2026-09-14)

### Corrections implemented

- Replaced direct `ChatResponseStream` use with an internal response abstraction
  that has separate `markdown` and `text` methods.
- The production adapter forwards only fixed extension-owned formatting through
  `markdown`. Its `text` method creates a VS Code `MarkdownString`, calls
  `appendText(value)`, and passes that object to `ChatResponseStream.markdown`.
- Every provider response—including local template output, Copilot,
  OpenAI-compatible output, and local fallback—now uses the text method.
  Provider output is no longer parsed or transformed as Markdown.
- Session-control results and dynamic provider-error details use the text
  method. Error result metadata is fixed extension copy. Session status is
  represented as typed parts so fixed labels remain Markdown while goal,
  role, provider, budget, coexistence, and configuration values remain text.
- Multi-part status output retains the shared 16,384-Unicode-code-point bound,
  line-ending/control normalization, Unicode safety, and explicit truncation
  ellipsis.
- Removed `chatMarkdownSafety` and its URL/email/action-URI sanitizer. No
  provider output path depends on Markdown pattern matching.
- Updated README, configuration, and architecture documentation to describe
  inert provider text and trusted extension formatting.

### TDD evidence

- RED: focused participant/model tests reported **9 expected failures** because
  provider output, session results, and error details still used Markdown and
  local template fields were pre-escaped.
- RED: the production-adapter test failed because the safe VS Code adapter did
  not exist.
- GREEN: focused Chat/model/runtime tests passed **5 files, 175 tests**.
- The regressions distinguish Markdown and text writes and cover nested URLs,
  Unicode email addresses, inline and fenced code, images, `command:`,
  `vscode:`, `data:`, and `file:` links, multiple links, ordinary Unicode,
  normalized line breaks, code-point bounds, and local fallback output.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **20 files, 533 tests passed**
- `npm run test:coverage`: **PASS**
  - statements 90.59%, branches 84.06%, functions 94.02%, lines 90.73%
- `npm run package`: **PASS — 160 files, 4.37 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript@5.9.3` only**
- Source, compiled-output, and VSIX sink scans: **PASS**
  - generated output reaches the text abstraction;
  - the packaged adapter contains `new MarkdownString().appendText(value)`;
  - the retired sanitizer is absent from source, compiled output, and VSIX.
- VSIX exclusion, production/public-doc and packaged-runtime secret scans,
  runtime URL scan, repository metadata assertions, and `git diff --check`:
  **PASS**

### Self-review and residual concerns

- Reviewed every Chat Markdown/text sink, provider and fallback route, dynamic
  status/error field, multipart bound, adapter boundary, documentation change,
  and packaged artifact. No remaining high-confidence security, correctness,
  lifecycle, or packaging issue was found.
- Live VS Code Chat rendering and live remote providers were unavailable in
  this non-interactive environment. The adapter contract test verifies that raw
  provider text reaches VS Code only through `MarkdownString.appendText`.

---

## Chat safe-text bare-autolink neutralization (2026-09-14)

### Corrections implemented

- Added one idempotent neutralization operation at the production Chat text
  adapter boundary, immediately before `MarkdownString.appendText`.
- Every `://` separator receives an invisible U+2060 WORD JOINER. Replacement
  is global and therefore covers repeated, adjacent, nested, arbitrary, and
  uppercase-scheme URLs without parsing Markdown.
- Every email or mention `@` is surrounded with U+2060 WORD JOINER characters.
  Bare `www.` receives U+200A HAIR SPACE before its dot because the rendering
  linkifier ignores zero-width format characters inside domain names.
- The trusted `markdown` adapter method remains a direct pass-through. Only
  untrusted Chat `text` writes are neutralized, after which `appendText`
  continues to escape Markdown delimiters and HTML.
- Updated README, configuration, and architecture documentation to describe
  inert readable plain-text rendering and automatic-link neutralization.
- Added direct `linkify-it` as a development-only dependency so the regression
  suite checks rendered-link discovery rather than only observing a mock call.

### TDD evidence

- RED: the focused adapter suite reported **7 expected failures**. The existing
  adapter passed raw email text to `appendText`; the requested neutralizer did
  not exist, so nested/adjacent schemes, arbitrary and uppercase schemes,
  `www.`, ASCII/punycode/Unicode email, mention, escaped-link, code-string,
  idempotence, Unicode, and linkifier assertions failed.
- GREEN: the focused adapter suite passed **1 file, 7 tests** after the minimal
  adapter-boundary implementation.
- The rendering-oriented regression passes all neutralized samples through
  `linkify-it` and asserts that it discovers no automatic links.

### Verification

- Focused Chat adapter:
  `npx vitest run test/vsCodeChatResponse.test.ts --testTimeout=15000`:
  **PASS — 1 file, 7 tests**
- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **20 files, 539 tests passed**
- `npm run test:coverage`: **PASS — 20 files, 539 tests**
  - statements 90.63%, branches 84.06%, functions 94.04%, lines 90.77%
- `npm run package`: **PASS — 160 files, 4.37 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript@5.9.3` only**
- Source, compiled-output, and packaged adapter sink scans: **PASS**
- VSIX exclusion scan: **PASS — 160 entries; development linkifier absent**
- Production/public-doc and packaged-runtime credential-value scans:
  **PASS — 24 source/doc files and 25 packaged files**
- Compiled and packaged runtime URL scans, repository metadata assertions, and
  `git diff --check`: **PASS**

### Self-review and residual concerns

- Reviewed the complete changed-file diff, all Chat response sinks, the
  trusted/untrusted boundary, marker placement and idempotence, Unicode
  handling, dependencies, documentation, and packaged output. The first full
  check caught a literal U+200A in a test expectation; that expectation now
  constructs the marker from an escaped constant, and the full check passed.
- A live VS Code Chat renderer was unavailable. The production-adapter contract
  test verifies ordering at `appendText`, while the `linkify-it` assertion
  supplies a rendering-oriented check for the required URL and email forms.

---

## Inline autolinks and dismissal persistence window (2026-09-14)

### Corrections implemented

- Extracted Chat's idempotent plain-text automatic-link neutralizer into a
  shared VS Code utility and retained the existing Chat export.
- Every dynamic inline Comment value now passes through that same neutralizer
  immediately before `MarkdownString.appendText`: question, title, detail,
  source, confidence status, and each reference.
- Fixed extension-owned labels, list layout, and navigator notice remain
  trusted Markdown. URI `://`, bare `www.`, email, and mention triggers become
  inert while marker removal reconstructs the original readable Unicode.
- Dismissal now cancels target runtime and Chat requests, invalidates cached
  evidence, retires the target URI fence, withdraws shared evidence, and
  disposes the inline thread synchronously before awaiting repository-scoped
  memory persistence.
- A repository-keyed pending-dismissal set blocks diagnostic/manual
  reselection during the write. Reference counts keep overlapping dismissals
  isolated.
- Successful persistence promotes the hashed evidence identity to the
  repository's durable in-memory dismissal set without any post-write UI
  cleanup. Evidence published during persistence therefore remains intact.
- Failed persistence removes only the pending suppression, displays a storage
  error, and leaves stale shared/inline evidence withdrawn. Later analysis can
  publish fresh evidence naturally.
- Target withdrawal advances only the target URI fence; unrelated URI
  interventions remain eligible to complete, and monotonic URI epochs still
  prevent revision reuse after close, runtime replacement, or LRU eviction.
- Updated README, configuration, and architecture documentation for both
  boundaries.

### TDD evidence

- Inline RED: **3 expected failures** showed unneutralized dynamic values and
  confidence still interpolated into trusted Markdown.
- Inline GREEN: focused Inline/Chat suites passed **2 files, 15 tests**.
- Dismissal RED: **3 expected failures** reproduced visible evidence during a
  deferred write, a new `/why`/manual dispatch window, and stale UI revival
  after failed storage.
- Dismissal GREEN: the three focused deferred-persistence regressions passed.
- The first full runtime run exposed one independent-URI regression caused by
  advancing the global context fence during synchronous withdrawal. The
  target-only URI withdrawal preserved unrelated work; the full runtime suite
  then passed **91 tests**.
- Final focused Inline/runtime/Chat run: **5 files, 166 tests passed**.

### Verification

- `npm run check`: **PASS**
  - TypeScript compile: pass
  - ESLint: pass, zero warnings/errors
  - Vitest: **20 files, 542 tests passed**
- `npm run test:coverage`: **PASS — 20 files, 542 tests**
  - statements 90.59%, branches 83.83%, functions 94.08%, lines 90.73%
- `npm run package`: **PASS — 161 files, 4.37 MB**
- `npm audit --audit-level=low`: **PASS — 0 vulnerabilities**
- Runtime dependency root scan: **PASS — `typescript@5.9.3` only**
- Source, compiled-output, and packaged Inline/Chat/runtime sink scans:
  **PASS — 4 packaged modules byte-match compiled output**
- VSIX exclusion scan: **PASS — 161 entries; source, tests, coverage,
  Superpowers material, source maps, and development linkifier absent**
- Credential-shaped value scan: **PASS — 49 working-tree files and 26
  packaged files**
- Compiled runtime URL scan: **PASS — documented loopback default only**
- Source and packaged repository metadata assertions and `git diff --check`:
  **PASS**

### Self-review and residual concerns

- Reviewed the complete changed-file diff, all inline `appendText` and
  `appendMarkdown` sinks, cancellation/withdrawal/persistence ordering,
  repository isolation, pending suppression cleanup, URI epoch behavior,
  replacement publication, failure recovery, documentation, compiled output,
  and VSIX contents. No remaining high-confidence defect was found.
- A live VS Code Markdown renderer and a failing real global-state backend were
  unavailable in this non-interactive environment. Inline regressions exercise
  the production helper through captured `appendText` values and
  `linkify-it`; deferred mocked storage verifies the full runtime ordering.
