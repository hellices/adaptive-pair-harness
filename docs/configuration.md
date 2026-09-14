# Adaptive Pair configuration

Adaptive Pair reads all user-facing settings from the `adaptivePair` namespace.
The vertical slice ships with explicit session control: the extension loads, but
pairing remains off until the user starts a session or sends an interactive `@pair` request.

## Settings reference

| Setting | Type | Default | Effect |
| --- | --- | --- | --- |
| `adaptivePair.enabled` | boolean | `true` | Global enable/disable flag. When `false`, sessions cannot start and no model provider is invoked. |
| `adaptivePair.chat.mode` | `workspace-agent` \| `local-only` | `workspace-agent` | Application-scoped interactive mode. Uses the exact Chat picker model and supervised tools, or disables interactive model/tool calls. |
| `adaptivePair.debounceMs` | number | `500` | Delay before edit episodes are analyzed after typing stops. Values are clamped to `300`-`800`. |
| `adaptivePair.interventionStyle` | `eco` \| `balanced` \| `active` | `balanced` | Authoritative threshold and 10-minute token budget until **Adaptive Pair: Set Intervention Style** persists an explicit selection. |
| `adaptivePair.model.provider` | `local-template` \| `vscode-copilot` \| `openai-compatible` | `local-template` | Application-scoped background navigator provider; does not replace the interactive Chat picker model. |
| `adaptivePair.model.baseUrl` | string | `http://localhost:11434/v1` | Application-scoped OpenAI-compatible root. HTTPS is required except for exact loopback hosts. Raw URL credentials, query/fragment delimiters, and ASCII whitespace/control characters are rejected. |
| `adaptivePair.model.name` | string | `qwen2.5-coder:7b` | Application-scoped model identifier used for OpenAI-compatible requests and token estimation. |

Chat mode and the three background remote-routing settings are deliberately application-scoped. Runtime
loading reads only application/user values and defaults; workspace,
workspace-folder, and workspace-language overrides are ignored with a visible
warning. This prevents a repository from redirecting credentials or evidence.

## Working goal and project context

The working agreement is session state, not a workspace setting. Use:

- **Adaptive Pair: Set Working Goal** or `@pair /goal` to confirm the goal,
  acceptance criteria, and constraints. Document-derived goals remain proposals
  until the developer confirms them.
- **Adaptive Pair: Refresh Project Context** or `@pair /context` to read the
  active editor's workspace root (otherwise the first root). Refresh revokes
  model sharing; a different root also replaces the working agreement.
- **Adaptive Pair: Draft Working Agreement** to open a local unsaved Markdown
  brief. In workspace-agent mode, `@pair /brief` instead inspects the project and
  prepares a document edit that requires diff review and approval before saving.
- `@pair /access` to approve/revoke project access for the current Chat model.
  That approval never grants background sharing or blanket edit/check permission.
- **Adaptive Pair: Toggle Project Context Sharing** to approve or revoke
  bounded background navigator sharing for this root and session. The approval dialog
  identifies the configured destination. Provider selection alone is not
  permission to share workspace contents.
- `@pair /decision` to record an explicit decision and reason after confirming
  a goal; `/plan` and `/checkpoint` to discuss next steps and observed results
  even before any static evidence exists.

Initial document reads require Workspace Trust and are restricted to root README/AGENTS/WORKING-AGREEMENT
and Markdown under `docs/`: at most 50 candidates, five attempted files,
64 KiB per file, and 4,000 retained characters per document. Symlinks and
out-of-root, oversized, binary, or invalid UTF-8 files are skipped. Open document
text takes precedence over disk text. These are partial references, not a
whole-repository analysis.

Approved interactive read/search tools can inspect additional current source,
tests and documentation. The first model request exposes read tools only and
requires a tool call before edits/checks are offered. `/plan`, `/why`, `/explain`
and `/trace` are read-only; `/brief` adds approved edits; `/checkpoint` adds
approved checks; `/work` and ordinary requests can use both. Edits require a
prior read, an exact unique replacement, unchanged current content, a diff and
individual Apply and save approval. Checks accept only existing npm validation
scripts, disclose pre/post scripts and return actual bounded output/exit codes.
Interactive tools currently require a verifiable local `file:` root. Each file
is at most 128 KiB; per-turn reads are limited to 64 files/2 MiB and a read returns
at most 200 lines. Each check stops after 120 seconds or 128 KiB of process output.

Interactive requests use their own visible per-turn limits: eight model calls,
twelve tool calls, 60,000 counted input tokens, 8,000 counted output tokens and
four minutes. They do not consume the small automatic-intervention allowance.
Missing models, unsupported tool calls, failed/denied checks and exhausted limits
are explicit errors or tool outcomes, not hidden local-template success.

Stop, runtime/provider rebuild, and root replacement clear the agreement and
sharing permission. Same-root refresh preserves the confirmed agreement but
revokes sharing before reading and starts a new Chat scope. Sharing cannot be
re-approved during that read. Goal changes clear old decisions
and dialogue. See [Goal-aware pairing](goal-aware-pairing.md) for the full flow.

## Semantic evidence scope

Public API evidence is best-effort and per document. For each stable
TypeScript or JavaScript edit, Adaptive Pair asks TypeScript's official
declaration-only emitter for the previous and current public declaration
surfaces. Existing `.d.ts`, `.d.mts`, and `.d.cts` documents are already
public declaration surfaces, so TypeScript checks their syntactic and semantic
diagnostics before its comment-free printer canonicalizes them. Both paths
ignore formatting and comments, including optional member semicolon/comma
choices, and emit at most one generic added, removed, or changed
`public-api-change` item. External modules are left unresolved, and invalid or
unreliable surfaces are skipped rather than replaced with custom heuristics.
There is no setting that expands this analysis to the project filesystem or to
cross-document type resolution. The separate project document reader supplies
planning context; it does not expand this semantic analyzer's scope.

## Secret storage behavior

Adaptive Pair does not write secrets to workspace files.

- The OpenAI-compatible API key is stored in VS Code `SecretStorage` under an
  opaque name derived from the validated canonical endpoint origin.
- Set or clear it with **Adaptive Pair: Set OpenAI-Compatible API Key**.
- Changing endpoint origin never reuses the previous origin's key; run the key
  command explicitly for the new origin.
- If no API key is stored, OpenAI-compatible requests are sent without an
  `Authorization` header.
- Personal Pair memory lives in VS Code global state, not in tracked project
  files. Repository dismissals remain keyed by repository within that global
  record.

## Memory actions

The Command Palette exposes the implemented memory controls:

- **Adaptive Pair: Dismiss Current Evidence** stores a SHA-256 hash of the
  evidence ID under the workspace root that owns its document, removes that
  URI's inline/shared evidence, and suppresses it from automatic and manual
  review in that root.
- **Adaptive Pair: Approve Current Evidence** stores only the hashed evidence
  ID, kind, approval time, and a sanitized title bounded to 120 characters. It
  does not store raw evidence URIs, paths, secrets, detail text, references, or
  source buffers.
- **Adaptive Pair: Set Intervention Style** opens a Quick Pick for `eco`,
  `balanced`, or `active`, persists the selection in global Pair memory, and
  applies its threshold and budget immediately and on later session starts.
- **Adaptive Pair: Reset Local Memory** first stops an active or pending
  session, then clears the saved selection and replaces Pair memory with safe
  defaults. The configured style becomes authoritative immediately; start a
  new session afterward.

When no style has been explicitly selected, `adaptivePair.interventionStyle`
supplies the style. Dismiss/approve writes preserve that distinction. Existing
version-1 records remain compatible: an unmarked legacy `balanced` value is
treated as a materialized default, while unmarked legacy `eco`/`active` values
retain their selected behavior. Repository dismissals remain isolated per
document-owning workspace root, including multi-root and `vscode-remote:`
workspaces.

### Retention limits

The version-1 global-state record has fixed retention limits:

| Persisted item | Limit | Eviction order |
| --- | ---: | --- |
| Dismissed evidence IDs | 256 per repository | Oldest unique ID first |
| Repositories containing dismissals | 32 | Least recently dismissed-in repository first |
| Approved evidence summaries | 256 total | Oldest unique approval first |

Recording an existing dismissal or approval removes its older occurrence and
appends the new occurrence, so the most recent unique entries survive.
Repository recency is stored explicitly and does not merge dismissal sets
across roots. The preferences object, including
`interventionStyleExplicit`, is never subject to evidence retention.

Valid legacy records without repository-order metadata and valid oversized
current records are compacted deterministically during load. Compacted data is
written back only if no newer memory mutation has won the serialization fence.
Every save applies the same limits before writing, and validation retains only
bounded collections rather than first cloning the full persisted arrays.

## Provider setup

### `local-template`

No extra setup is required.

Recommended when you want:

- no remote model traffic;
- predictable navigator-only prompts;
- a safe fallback when budgets or provider access fail.

It can organize supplied goals, document excerpts, and decisions into a brief
or checklist. It does not semantically understand arbitrary code or execute
tests; a model-backed discussion requires a configured provider and, for
workspace excerpts, explicit sharing approval.

### `vscode-copilot`

1. Install **GitHub Copilot** and **GitHub Copilot Chat** in VS Code.
2. Sign in with a GitHub account that has Copilot access.
3. Set `adaptivePair.model.provider` to `vscode-copilot`.
4. Start the Pair explicitly.

Implementation notes for this slice:

- Requests go through the official VS Code Language Model API with
  `selectChatModels({ vendor: "copilot" })`.
- `LanguageModelAccessKind.Allowed`, `.Disallowed`, and `.NeedsConsent` map to
  allowed, denied, and consent-needed adapter states respectively. Automatic
  inline interventions proceed only for `Allowed`.
- User-initiated actions such as `@pair /why` or **Adaptive Pair: Review Current
  Block** may attempt the official request path for `NeedsConsent`, allowing VS
  Code to request consent; `Disallowed` models are never attempted.
- Candidate models advance only for unavailable or no-permission failures.
  Blocked and unknown failures surface; cancellation stops iteration. Each
  candidate is counted and admitted separately before it can dispatch.
- One 15-second deadline spans model selection, dispatch, every streamed
  `next()` wait, and official token counts. Expiry cancels and disposes the VS
  Code request source; reservations for dispatched calls remain conservative,
  while an exact reservation can be released if expiry precedes dispatch.
- If no candidate is available, access is denied, or candidate admission
  exhausts the budget, Adaptive Pair falls back to `local-template` and
  surfaces that in status.

### `openai-compatible`

1. Set `adaptivePair.model.provider` to `openai-compatible`.
2. Set `adaptivePair.model.baseUrl` to an OpenAI-compatible API root.
3. Set `adaptivePair.model.name` to your model identifier.
4. Run **Adaptive Pair: Set OpenAI-Compatible API Key** if the endpoint requires
   authentication.
5. Start the Pair explicitly.

The extension sends requests to:

- `<baseUrl>/chat/completions`
- method: `POST`
- `content-type: application/json`
- an authorization bearer header only when a key is stored.

Non-loopback endpoints must use HTTPS. Loopback HTTP is limited to
`localhost`, the `127.0.0.0/8` range, and `[::1]`. Endpoint URLs containing
userinfo, a raw `?` or `#` delimiter (even with no value), ASCII whitespace or
control characters, or a non-HTTP(S) scheme are rejected before URL
normalization. A valid path prefix such as `/v1` is retained when
`chat/completions` is joined. Requests time out after 15 seconds and response
bodies are capped at 64 KiB. Non-success and oversized responses are cancelled
before rejection; cleanup failures are attached to the primary provider error.

## Chat response display bound

Every provider path uses the same non-configurable **16,384 Unicode
code-point** limit immediately before dynamic text is displayed by `@pair`
Chat. This includes local and remote successes, local fallback text, session
result text, and dynamic error detail. CRLF and CR line endings are normalized
to LF, unsafe control/format characters are replaced, and tabs, line breaks,
and Unicode joiners are preserved. Truncated text reserves its final code point
for an explicit `…`, so supplementary characters such as emoji are never
split. Exact-boundary responses are unchanged.

Extension-owned guidance, labels, and layout remain trusted Markdown. Dynamic
evidence, symbol, workspace/coexistence, configuration, provider-error, and
session-result fields use a distinct text response method and are never
interpolated into trusted Markdown.

All provider prose is untrusted plain text, including `local-template`,
GitHub Copilot, OpenAI-compatible output, and local fallback. The production
VS Code adapter first neutralizes automatic-link triggers in that text. It
inserts an invisible word-joining separator into every `://` and around every
`@`; bare `www.` prefixes receive a hair-space separator before the dot. The
operation is global, case-insensitive where applicable, idempotent, and covers
nested URLs, arbitrary schemes, mentions, and ASCII, punycode, or
Unicode-domain email addresses. It does not parse Markdown.

The adapter then creates a `MarkdownString`, calls `appendText(value)`, and
passes that object to `ChatResponseStream.markdown`. Thus `appendText` still
handles headings, emphasis, inline and fenced code, images, explicit links, raw
HTML, and `command:`, `vscode:`, `data:`, or `file:` link forms as literal
text, while the preceding separators keep bare links inert. Ordinary Unicode
and line breaks remain readable. Fixed extension-owned Markdown does not pass
through this neutralizer or `appendText`.

Interactive fenced code examples have a separate untrusted code sink. It uses
a fence longer than any embedded backtick run, validates the language label,
disables trusted commands/HTML and bounds the displayed code without altering
URLs inside the code. The model never supplies trusted layout or executable links.

This display limit is independent of model limits. It does not increase or
replace the 180-token inline or 600-token legacy navigator Chat output allowance,
rolling token accounting, or
provider billing behavior. It is also distinct from the OpenAI-compatible
64 KiB HTTP response-body limit, which bounds transport data including JSON
overhead rather than displayed Unicode code points.

## Exact data sent for a remote request

This section describes the background navigator's fixed projection. Interactive
Chat uses the separately approved document/source/tool context and per-turn
limits described above, with full-input sensitivity checks before truncation.

By default, Adaptive Pair omits document text and source/selection excerpts
from remote requests. Explicit session-scoped sharing approval permits bounded
excerpts, not unrestricted repository access.

Every remote request is reduced to a bounded structured prompt containing:

- `goal`
- `interactionStyle`
- purpose-specific instructions for intervention, explanation, planning, or
  verification;
- optional fixed kind-level evidence metadata (planning needs no evidence):
  - `kind`
  - `severity`
  - extension-owned `title`, `detail`, and `source` strings selected only by
    `kind`
  - `confidence`
  - `range`
- optional working and user-initiated context:
  - bounded `userPrompt`
  - current symbol `name`, `kind`, and `range`
  - confirmed goal, acceptance criteria, constraints, phase, and explicitly
    recorded decisions;
  - scoped conversation, limited to six turns of 600 characters each;
  - with sharing approval only: up to three documents of 1,200 characters each,
    their proposed goal/criteria/constraints, and current/previous code excerpts
    of 1,500 characters each. Document URIs are omitted; relative labels remain.

The complete structured context is bounded to 6,000 serialized characters,
then admitted through the provider's token budget. Working goals, decisions,
and recent developer statements can inform subsequent automatic feedback too.
Unapproved workspace fields are omitted entirely and do not affect routing.
Assistant history is included only with workspace sharing approval because it
may contain local evidence. Retrieved text and dialogue are untrusted reference
data, never permission to run tools or follow embedded instructions.

Automatic evidence is whitelist-projected: no analyzer/editor title, detail,
source, reference, module specifier, diagnostic text, URI, or path is copied
into a remote request, and evidence IDs are omitted from remote prompts.
The fixed projection for `public-api-change` says that a public
declaration/API surface addition, removal, or change involving types,
interfaces, or values was detected. It does not transmit raw declaration text.
Before projection, the raw automatic-evidence ID, title, detail, source, and
every reference are inspected by the existing credential and local-resource
detector. If any field matches, the request is routed directly to
`local-template` and no remote provider is invoked. Detection does not copy raw
content into the fixed projection, runtime status, or provider error text.
The raw structured request remains local and is used for bounded
`local-template` rendering whenever remote generation falls back because of
availability, budget, or sensitive content. Explicit Chat text, working task
fields, history, and approved workspace content are checked before bounding.
Detection also precedes local document/code excerpt limits and explicit goal
parsing, including discarded criteria or constraints. Task sensitivity applies
regardless of workspace-sharing consent, survives same-root refresh, and clears
on clean explicit goal replacement. Internal sensitivity markers do not enter
model prompts. The detector checks for HTTP
and non-HTTP DSN userinfo, sensitive query parameters, bearer/JWT and common
token formats, complete Basic authorization payloads, credential assignments,
normalized `cookie`/`setcookie` keys and headers, and long secret-like values.
Thus explicit `Cookie` or `Set-Cookie` text always stays local and never enters
a remote payload. Explicit text is also checked for exact `file://` and
`vscode-remote://` schemes, recognized or multi-segment POSIX paths, Windows
drive paths, and UNC paths. If any checked field is unsafe, the complete request
stays local and the unsafe field is replaced with a fixed local-only notice;
partially redacted content is never sent.

### Local evidence presentation bounds

All dynamic evidence UI values are normalized to one line and use an ellipsis
when truncated. The centralized limits are:

| Field | Maximum |
| --- | ---: |
| Question or local response | 1,000 characters |
| Title | 120 characters |
| Detail | 500 characters |
| Source | 120 characters |
| Each reference | 240 characters |
| References per evidence item | 8 |

Static dependency evidence recognizes ESM imports, literal
`require("...")`, literal dynamic `import("...")`, named re-exports, and star
re-exports. Computed/non-literal expressions are ignored. Identical complete
specifiers are deduplicated in source order. The complete specifier remains
private to comparison and hashed identity; only bounded single-line prefixes
appear in local detail/reference fields.

### Diagnostic projection

Diagnostics use fixed extension-owned metadata before remote use:

- title becomes `Editor diagnostic detected`;
- detail becomes `VS Code reported a diagnostic at the evidence range.`;
- source becomes `vscode-diagnostics`;
- raw diagnostic messages, sources, codes, and references are omitted.

Locally, the complete raw diagnostic inputs feed stable hashes, while only the
bounded single-line message, source, and code prefixes enter `Evidence` and
inline Markdown.

### Transient URI revision retention

The shared Chat context retains at most 256 per-URI evidence revisions in
least-recently-used order. Accessing or publishing a URI refreshes its
position. Document close, session stop, runtime replacement, and runtime
disposal remove the applicable entries. Revision values come from one
shared-context-wide monotonic epoch that is not reset when an entry is removed
or evicted, so publishing an evicted or reused URI cannot recreate an earlier
revision. This preserves post-await dismissal and Chat lifecycle fences while
bounding URI state when an editor host omits close events.

### Data intentionally not sent

Remote requests exclude:

- unapproved workspace content, including document-derived proposals;
- unbounded document text, source snapshots, and selections;
- private document URIs and other workspace roots' working context;
- conversation from a different session, goal, or sharing scope;
- inline comment history;
- the latest locally rendered question;
- workspace memory blobs;
- any project-file writes.

## Token budgets by interaction style

Budgets are enforced over a rolling 10-minute window.

| Style | Max remote calls | Max input tokens | Max output tokens |
| --- | --- | --- | --- |
| `eco` | 2 | 12,000 | 1,200 |
| `balanced` | 4 | 24,000 | 2,400 |
| `active` | 8 | 48,000 | 4,800 |

These defaults replace the earlier evidence-only budgets to accommodate
explicit goal-aware discussion. Automatic and manual inline questions retain
a 180-token per-call cap; explicit Chat can reserve up to 600 tokens. Both use
the same rolling ledger and visible remaining capacity.

Behavior:

- before reservation, each eligible Copilot candidate is counted with that
  model's official `countTokens` API, while OpenAI-compatible input uses a
  conservative UTF-8 byte estimate of the exact serialized request body;
- each request atomically reserves its inline or Chat output allowance before
  dispatch, so concurrent calls cannot reuse pending capacity;
- OpenAI-compatible requests send `max_tokens`, reject blank output, reject
  conservatively over-limit output, and settle with the greater of reported
  completion usage and a conservative UTF-8 byte upper bound;
- Copilot requests pass the supported `max_tokens` model option, use the
  selected model's official `countTokens` API at stream boundaries, cancel and
  truncate displayed text at the allowance, and settle with the maximum
  observed count;
- the stable VS Code API does not guarantee that `modelOptions.max_tokens` is a
  provider-side generation or billing hard limit. Display enforcement and
  cancellation are best effort, and conservative accounting can exceed the
  reserved allowance when an already-received fragment crosses it;
- reservations and usage survive configuration and API-key runtime rebuilds;
- Copilot selection, consent, and input-count failures occur before reservation.
  Unavailable/no-permission candidates may advance; every dispatched candidate
  owns a separate reservation, released only when the provider proves no
  request was sent;
- if a remote request would exceed call or token limits, the current
  intervention falls back to `local-template`;
- the shared `@pair /session` view reports remaining budget.

## Disabling, cooldown, and local-template sessions

### Disabling

- `adaptivePair.enabled = false` blocks session starts, analysis, interventions,
  and model calls.
- Disabled state also prevents manual review and chat-backed model generation.
- The status bar reports the disabled reason.

### Session off vs enabled

Enabled does not mean active.

- the extension can be enabled while the Pair session is still off;
- the user starts a session with an interactive `@pair` request, `@pair /start`, or the toggle
  shortcut before inline analysis will run. While the session is off, Adaptive
  Pair does not analyze evidence, render interventions, or call a model.

### Cooldown

The current vertical slice applies a fixed per-evidence cooldown of **30 seconds**.
Cooldown starts only after an inline thread renders successfully. Entries expire
from memory, and stop/restart clears all transient cooldown state.

### Active local-template sessions

Interactive “local-only” means `adaptivePair.chat.mode = "local-only"`, which
prevents interactive model and workspace-tool calls even if the separately
configured background navigator uses a remote provider. The following describes
the background `local-template` provider.

An active session stays local when any of the following is true:

- provider is `local-template`;
- an OpenAI-compatible base URL is invalid;
- a Copilot model is unavailable or inaccessible;
- the remote token budget is exhausted;
- a transferable evidence, Chat, working-task, history, or approved workspace
  field contains known credential or local-resource material.

In this active local-template mode, the extension still analyzes supported
evidence and can render inline navigator questions without network traffic.

Local Chat is command-specific: `/why` explains significance, `/explain`
summarizes the evidence, and `/trace` reports only the VS Code-resolved
symbol/range while stating that deeper analysis requires a model. `/plan`
organizes the supplied goal and next steps, while `/checkpoint` asks for actual
verification results without claiming to run checks. These two commands and
ordinary planning dialogue work without an evidence item.

## Memory recovery and multi-root identity

Repository dismissals use the workspace folder that owns each document, rather
than always using the first folder. Dismissal retires the target URI fence and
withdraws its shared evidence and inline thread before awaiting persistence, so
new Chat or manual requests cannot reuse it during the write. Unrelated pending
work and replacement evidence remain valid. A failed write is reported while
the stale evidence remains withdrawn; later fresh analysis may publish it
again. One extension-scoped memory adapter serializes mutations across
configuration-driven runtime rebuilds, and session preparation reloads when a
concurrent memory action changes its revision. While a session is active, a
public VS Code workspace-folder change event pauses processing, cancels pending
edit/model/Chat work, clears transient evidence, and replaces the
repository-memory snapshot from the current roots.
Removed roots are dropped, and newly added roots load their dismissal sets
before document processing resumes. Overlapping folder events coalesce behind
one session-owned refresh and share its limit of three preparation attempts;
they do not replace the in-flight refresh or reset that budget. Stop, restart,
and disposal still invalidate stale generations. If roots cannot stabilize in
three attempts, Pair cancels pending work, clears transient state, stops
visibly, and requires a later explicit start, which receives a fresh generation
and attempt budget. If the persisted memory record is corrupt, Pair starts with
in-memory defaults, preserves the stored corruption, and shows a warning.
**Adaptive Pair: Reset Local Memory** is the only operation that replaces that
record with defaults, and it invalidates any pending session preparation before
writing or publishing reset state.
