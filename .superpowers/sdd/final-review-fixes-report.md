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
