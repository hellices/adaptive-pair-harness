# Adaptive Pair vertical slice architecture

This document describes the implemented goal-aware realtime vertical slice,
not the full future design.

## Scope of the slice

The shipped slice has a background navigator and a supervised interactive pair:

- reads bounded project documents locally and asks the developer to confirm a
  working goal, acceptance criteria, and constraints;
- supports planning, explicit decisions, and verification checkpoints before
  or during code edits, with scoped conversational continuity;
- watches open TypeScript/JavaScript `file:` and `vscode-remote:` documents
  after an explicit session start;
- aggregates short edit bursts into an edit episode;
- derives bounded evidence from semantic analysis and editor diagnostics;
- decides whether to stay quiet, ask a local question, or call a configured
  model provider;
- renders a single inline preview comment thread per file URI;
- shares the latest evidence with the `@pair` chat participant.

The background navigator does not edit or execute. Interactive `@pair` can
apply individually approved exact edits and run approved npm validation scripts;
it never claims exclusive driver ownership or unattended project control.

## Interactive model/tool loop

`pairChatParticipant` sends ordinary, planning, brief, work and checkpoint
requests to `PairAgentSession` by default, auto-starting on the user action.
`pairAgentModel` adapts that request's exact native `ChatRequest.model` without
selecting another vendor or consulting the background provider. Native tool-call
and tool-result message parts preserve the protocol across model iterations.

`pairAgent` requires an initial read, then admits only mode-appropriate tools.
`pairWorkspaceTools` owns root-scoped discovery/read/search, reviewed exact edits
and approved npm checks. Real observations return to the model before its next
answer. A separate activity record reports actual actions even when a later
model operation fails. Per-turn calls, tokens, results and time are bounded.

Interactive workspace consent is separate from background sharing and bound
to session generation, conversation ID, selected root and exact vendor/model.
The agent uses lifecycle/working scope rather than volatile inline-evidence
revisions, so its own approved edit does not invalidate its next verification
step. Tool implementations independently reject stale file contents before
mutation. Stop/rebuild/goal/context replacement abort pending work; no late
approval can resurrect it. `chat.mode=local-only` bypasses interactive models
and tools rather than silently choosing another remote provider.

## Edit episode flow

1. **Activation** initializes shared session state as enabled-but-inactive.
2. **Configuration rebuild** reads local behavior settings plus
   application-scoped remote routing. Workspace/folder remote overrides are
   ignored. OpenAI-compatible keys are looked up by validated canonical origin;
   disposal is checked again after the asynchronous secret lookup and before
   constructing replacement runtime or VS Code resources.
3. **Session start** is explicit. `adaptivePair.startSession`,
   `adaptivePair.toggle`, and `@pair /start` all route through the same
   lifecycle gate.
4. **Session preparation** loads preferences and repository-scoped workspace
   memory, using the owning folder for each document in multi-root workspaces,
   seeds only stable open documents, and discovers coexistence signals. A
   memory revision fence reloads preparation state after a concurrent
   style/dismiss/approve/reset action. Each asynchronous root-memory load is
   followed by a generation check before another load or coexistence discovery
   can begin. Stop, replacement, disposal, and memory reset invalidate pending
   preparation; rejection from stale preparation returns the stopped result,
   while a current-generation failure still surfaces.
5. **Workspace-folder changes** keep the explicit session active but advance
   its lifecycle generation and block new document/model work. Pending edit,
   model, and Chat work is cancelled; transient evidence and threads are
   cleared; and preparation reloads the current root set, repository-scoped
   dismissals, open-document seeds, and coexistence signals. Removed roots are
   absent from the replacement snapshot, and added-root dismissals commit
   before processing resumes. Folder events that arrive during preparation
   coalesce into the session's serialized refresh instead of replacing it, and
   all attempts share a three-attempt bound. If roots remain unstable for all
   three attempts, the coordinator cancels and clears pending work, disposes
   the session listeners, stops Pair, and surfaces the failure. A later
   explicit start uses a fresh generation and attempt budget. Stop, disposal,
   and restart invalidate stale asynchronous work. The workspace-folder
   listener is owned and disposed with the other active session listeners.
6. **Document changes** invalidate existing inline evidence for that file,
   cancel in-flight work, and queue an edit episode through the debounced
   aggregator.
7. **Episode analysis** returns an explicit stable/unstable result. Unstable
   edits produce no intervention and do not replace the last-stable baseline;
   the next stable edit is compared with that baseline. If no stable snapshot
   has ever been retained, the first stable edit uses the episode's actual
   `previousText` rather than comparing the document with itself.
8. **Policy evaluation** picks the highest-priority eligible evidence and
   respects confidence thresholds and rendered-intervention cooldown.
   Runtime-owned rolling budget admission occurs immediately before dispatch.
9. **Intervention rendering** either uses a local template question or a model
   provider response, then renders the result inline and publishes it to shared
   chat state.

## Working agreement flow

Project context is separate from the static evidence sensor:

1. On explicit start or context refresh, `projectContextReader` reads the
   selected root's README/AGENTS and Markdown under `docs/`. Selection uses the
   active editor's owning root, otherwise the first root; changing editor focus
   alone does not replace the working agreement.
2. The injected reader requires Workspace Trust, checks root/URI ownership and
   symlink ancestors, limits candidate discovery to 50 and attempted files to
   five, rejects files over 64 KiB, and retains at most 4,000 characters per
   document. Open buffers supersede saved text. Trust and lifecycle checks
   after asynchronous operations prevent stale reads from publishing.
3. `projectContext` extracts English/Korean goal, acceptance, and constraint
   headings outside fenced examples. Working plans/briefs are prioritized,
   followed by README and specifications. Criteria come from the selected
   goal's document, not an unrelated-plan merge. Proposed goals need explicit
   `/goal` confirmation.
4. The transient working agreement retains the confirmed task, current phase,
   up to eight explicit decisions, four recent developer statements, sharing
   permission, and a random conversation scope. The palette draft command opens
   unsaved Markdown; interactive `/brief` prepares an individually approved edit.
5. `/plan`, `/checkpoint`, and ordinary Chat can run without evidence. Model
   requests can incorporate the task, scoped dialogue, and, only after explicit
   destination-disclosed consent, bounded documents and same-root code excerpts.
   Automatic evidence feedback uses the same working task rather than a
   separate generic goal. Interactive checkpoints can run an approved validation
   script and report actual output; they never infer success from absent diagnostics.
6. Goal, context, and consent changes invalidate pending model/Chat work. Goal
   changes discard previous decisions/dialogue. Same-root refresh preserves the
   confirmed agreement but immediately revokes sharing and rotates Chat scope.
   A dedicated lifecycle/read-revision fence allows concurrent planning without
   cancelling the refresh, while sharing approval waits for it to finish. Stop,
   rebuild, or root replacement clears working state and sharing. Cross-root
   requests never inherit another root's working context.

Dialogue and phase updates commit only after a successful, current generation.
Cancelled/stale requests leave no retained turn. Code ranges apply only to the
requested source document: root-scoped planning uses the active selection, and
a missing evidence document is not replaced by another active buffer.

This is bounded context preparation and a planning loop, not autonomous task
execution or whole-repository retrieval.

## Semantic analyzer boundaries

The semantic analyzer is intentionally narrow.

### Supported evidence kinds

- new static dependencies from ESM imports, literal `require("...")`, literal
  dynamic `import("...")`, and named/star re-exports; computed expressions are
  ignored and complete specifiers are deduplicated in source order
- best-effort, per-document public API changes for TypeScript and JavaScript:
  the official TypeScript declaration-only emitter produces the previous and
  current `.d.ts` surfaces in memory; existing `.d.ts`, `.d.mts`, and `.d.cts`
  documents receive TypeScript syntactic and semantic diagnostics in the same
  restricted host because they are already public declaration surfaces; valid
  surfaces are normalized through the comment-free TypeScript printer before
  both paths compare trivia-free token streams
- at most one generic `public-api-change` item per edit; its detail identifies
  an added, removed, or changed surface without embedding declarations
- substantial complexity growth

Declaration programs can read only the installed TypeScript standard-library
files through the containment-checked host. Project files are never read,
external modules and re-exports remain unresolved, and failed or otherwise
unreliable declaration emits and invalid declaration-file inputs suppress
public API evidence rather than falling back to hand-written export or
type-surface heuristics.

### Supported language boundary

- `typescript`
- `typescriptreact`
- `javascript`
- `javascriptreact`

These language IDs are eligible only for `file:` and `vscode-remote:` URIs.
Other URI schemes are rejected.

### Important exclusions

The analyzer does not currently:

- inspect editors outside the `file:` and `vscode-remote:` schemes;
- review whole-repository history;
- understand runtime behavior beyond syntax/AST evidence and editor
  diagnostics;
- reason across multiple files as a single evidence graph;
- resolve external modules while comparing compiler-emitted public
  declarations.

## Policy and budget decisions

`InterventionPolicy` applies three gates before a remote intervention is used:

1. **Confidence threshold** by interaction style:
   - `eco`: 0.90
   - `balanced`: 0.72
   - `active`: 0.55
2. **Cooldown**: the same privacy-safe, module-qualified evidence ID is not
   resurfaced for 30 seconds after a successful render. Stop clears cooldown.
   Diagnostic identities use a URI hash, complete range, full source/code hash,
   and full message hash, so list reordering does not bypass cooldown or a
   persisted dismissal.
3. **Budget**: remote-capable styles reserve input and output capacity inside a
   rolling 10-minute window. Budget state is hoisted across runtime rebuilds,
   Copilot counts the exact prepared prompt with the selected model before
   reservation, OpenAI-compatible providers conservatively estimate the UTF-8
   bytes of the exact serialized body, and each admitted request pre-reserves
   its full offered output allowance before dispatch. Successful responses
   settle exact or conservative observed usage; an owned reservation is
   released only when the provider proves that no request was sent.

If the budget denies the request, the runtime falls back to a local-template
question instead of dropping the intervention entirely.

Automatic/manual inline responses retain a 180-token cap; explicit Chat can
reserve up to 600 tokens through the same ledger. The eco/balanced/active
ten-minute limits are 2/4/8 calls, 12,000/24,000/48,000 input tokens, and
1,200/2,400/4,800 output tokens. These defaults accommodate bounded working
context without bypassing admission.

The configured style remains authoritative until the style command records an
explicit selection in global Pair memory. Session preparation reapplies only
an explicit selection to policy thresholds and the shared rolling budget;
unrelated memory writes preserve configuration authority.

## Model request shape

Remote-capable providers receive a sanitized `ModelRequest` shape:

- `goal`
- `interactionStyle`
- optional `evidence` (planning and checkpoints do not require it)
  - `kind`
  - `severity`
  - `title`
  - `detail`
  - `source`
  - `confidence`
  - `range`
- purpose-specific instructions;
- optional working/user context:
  - bounded `userPrompt`
  - bounded symbol identity and symbol range
  - confirmed goal, criteria, constraints, phase, and recorded decisions;
  - bounded same-scope user/assistant conversation;
  - only with session sharing consent: document excerpts, their proposed
    requirements, and current/previous code excerpts from the working root.

Unapproved workspace context is omitted entirely, including document-derived
proposals, and does not affect sensitivity routing. Approved context retains at
most three documents of 1,200 characters each, current/previous code of 1,500
characters each, and six dialogue turns of 600 characters each. The structured
context has a 6,000-serialized-character bound before token admission. Document
URIs are not projected. Retrieved content and history are quoted as untrusted
data, never as tool permissions.

Automatic evidence crosses the remote boundary only through a whitelist keyed
by `Evidence.kind`. Each kind has fixed extension-owned title, detail, and
source strings; the evidence identity is omitted from prompts, the numeric
range is retained, and raw analyzer/editor titles, details, sources,
references, specifiers, diagnostics, URIs, and paths are omitted. For
`public-api-change`, the fixed detail generically identifies a public
declaration/API surface addition, removal, or change involving types,
interfaces, or values; no raw declaration text is transmitted. Before
projection, the raw evidence ID, title, detail, source, and every reference are
inspected by the existing credential/local-resource detector. A match selects
the local provider before any remote dispatch; raw values are not copied into
the projection, status, or error text. A separate raw structured request stays
local so any availability, budget, or sensitive-content fallback can render
the bounded original evidence.

Explicit Chat, working-task, history, and approved workspace fields are
inspected before bounding. Sensitivity metadata survives repeated projection.
Known credential material
or an exact `file://`/`vscode-remote://` URI, recognized or multi-segment POSIX
path, Windows drive path, or UNC path keeps the complete request local. The
unsafe field is replaced with a fixed local-only notice rather than partially
redacted for remote use. Custom schemes, closing markup, package names, and
ordinary prose are not classified as local resources. Normalized `cookie` and
`setcookie` keys and headers are credential material and force the local-only
path.

### Provider behavior

- **Local template**: deterministic, purpose-specific local response, zero
  remote tokens. Planning/checkpoints organize supplied information and expose
  missing decisions/results; they do not claim semantic code understanding or
  unperformed tests. Automatic questions remain concise.
- **Official VS Code Copilot**: uses the VS Code language model API and falls
  back locally when no model is available, access is denied, or proactive access
  is unavailable. VS Code access kinds map explicitly to allowed, disallowed,
  and consent-needed adapter states; only user actions may enter the consent
  path. Candidates advance only after unavailable/no-permission failures;
  blocked, cancelled, and unknown failures surface. Every candidate counts the
  exact prepared prompt and receives its own runtime-owned reservation before
  dispatch, and iteration stops on lifecycle cancellation or budget denial.
  One deadline spans selection, dispatch, stream reads, and official token
  counts, racing provider operations that ignore cancellation. Expiry cancels
  and disposes the VS Code request source. The request passes the supported
  `max_tokens` model option; streamed display is bounded with that candidate's
  official `countTokens` API and cancellation. VS Code does not guarantee a
  provider-side generation or billing hard limit, so dispatched timeouts and
  observed over-boundary fragments are conservatively accounted.
- **OpenAI-compatible**: posts JSON to `/chat/completions` at the configured
  safe base URL, optionally with an origin-bound bearer token from
  `SecretStorage`; requests have a deadline, 64 KiB response cap, and a
  completion-token cap. Input admission uses a conservative UTF-8 byte estimate
  of the serialized body. Non-success and pre-read/streamed size rejection
  cancel the response body first; cancellation failure is attached to the
  primary provider error. Blank output is rejected, and output accounting uses
  the greater of reported completion usage and a conservative UTF-8 byte bound.

## Inline rendering lifecycle

Adaptive Pair owns one preview comment thread per file URI.

- new evidence replaces the previous thread for that file;
- edits clear stale threads and cancel in-flight requests;
- closing a document disposes only that document's thread;
- stopping the session clears all transient inline state;
- cooldown begins only after thread creation succeeds;
- threads are preview-only (`canReply = false`) and direct follow-up to `@pair`.
- dynamic question, title, detail, source, and reference values use
  the same idempotent automatic-link neutralizer as Chat before
  `MarkdownString.appendText`; confidence text follows the same path, and only
  fixed extension copy is Markdown.
- those dynamic values are normalized to one line and bounded centrally to
  1,000 characters for questions/local responses, 120 for titles, 500 for
  details, 120 for sources, and 240 for each of at most eight references;
  truncation uses `…`.

New-dependency evidence keeps complete specifiers only for private
deduplication and hashed identity. Diagnostic evidence likewise hashes complete
raw URI/message/source/code inputs before bounded display fields are created.

The inline message always reminds the user that Adaptive Pair has **not changed
code**.

## Shared `@pair` chat

`@pair` does not maintain a separate hidden model session.

Instead, it reads the shared Pair snapshot containing:

- whether the extension is enabled;
- whether the session is active;
- current provider and remaining budget;
- coexistence notice;
- the latest published evidence/question pair, if present;
- the selected root's document summary, working task, phase, sharing state, and
  opaque conversation scope.

`pairConversation` reads the last three completed exchanges from VS Code Chat
history, filtered to this participant and matching response metadata. Assistant
turns require workspace sharing consent; old session/goal/consent turns and
other participants are excluded. Successful responses return scoped metadata.
No hidden durable conversation store is introduced, and invalidating scope
does not erase the existing Chat UI history.

Published evidence carries its host-resolved owning root. Planning omits
evidence without matching working-root ownership, and responses about another
root receive no working-scope metadata. Thus local fallback text from another
root cannot be forwarded later under the working root's sharing approval.

`/goal`, `/decision`, and `/context` remain explicit runtime controls. In the
default interactive path, `/brief`, `/plan`, `/work`, `/checkpoint` and ordinary
dialogue invoke the selected Chat model with scoped tools. In local-only mode,
the legacy navigator path keeps `/brief` local and `/why`/`/trace` evidence-backed.

That is why `@pair /why` expands the latest inline question rather than
reconstructing unrelated state. The interactive session includes the approved
same-root observation, question and relative source range as earlier evidence,
and directs the selected model to re-read it before judging current behavior.
An unrelated active editor cannot silently replace this explanation target.
The local provider has distinct `/why` and
`/explain` summaries. Local `/trace` discloses only the resolved symbol/range
and explicitly declines to fabricate deeper flow analysis. When symbol
providers return nested or flat results in arbitrary order, the smallest range
containing the evidence position is selected.

The Chat boundary has separate trusted-Markdown and untrusted-text methods.
Fixed extension guidance and layout use the former. Every provider response
and each dynamic error, session, workspace, configuration, evidence, or symbol
field uses the latter. The production adapter implements text writes with
an idempotent autolink-neutralization pass followed by
`new MarkdownString().appendText(value)` before calling the VS Code
`ChatResponseStream.markdown` API. Invisible Unicode separators break every
URI `://` and email/mention `@` trigger, while a hair-space separator breaks
bare `www.` prefixes. The pass covers repeated or nested URLs, arbitrary
scheme casing, and ASCII, punycode, or Unicode domains. `appendText` remains
responsible for Markdown-delimiter and HTML escaping, so untrusted Chat output
is inert readable plain text; trusted extension Markdown is untouched.

Every runtime claim and evidence publication advances an opaque monotonic
shared-context revision. Chat captures that revision before asynchronous symbol
resolution or generation and verifies it afterward. The fence does not depend
on projected evidence IDs and therefore rejects responses from replaced
runtimes even when their visible generation, URI, range, and sanitized evidence
appear identical.

Dismissal cleanup also uses per-URI revisions allocated from one monotonic
shared-context-wide evidence epoch. The epoch survives document-close removal,
runtime replacement/disposal, and LRU eviction, so a later publication for the
same URI cannot reuse a stale revision. The per-URI table is capped at 256
entries; lookup and publication refresh LRU order, and the oldest entry is
evicted when close events do not arrive. Closing a document releases its entry,
while session stop and current-runtime disposal release all entries. Runtime
tokens prevent an older runtime's late disposal from clearing a replacement
runtime's state.

## Coexistence discovery

On session start, the runtime checks for:

- installed Copilot extensions;
- installed Cline extensions;
- `AGENTS.md` files;
- Markdown files directly under `docs/superpowers/plans/`.

Detection is deliberately **observational only**. The coexistence notice is a
status annotation such as `...; observing only`.

Detection does **not** imply:

- driver ownership;
- exclusive control of the workspace;
- command interception;
- suspension of another harness.

## Persistence and privacy boundary

Persistent state is stored in VS Code global state and secret storage, not in
repository files.

- personal pair memory is shared through global state, while repository
  dismissals stay keyed by document-owning roots inside that global record;
- one extension-scoped memory store and adapter serialize mutations across
  configuration-driven runtime rebuilds;
- Command Palette actions dismiss the current evidence for its owning root,
  approve only its bounded summary, and persist an explicitly selected
  intervention style without converting default values into user intent;
- persisted evidence identities are SHA-256 hashes, and approved titles are
  stripped of paths and secrets and bounded to 120 characters;
- dismissal synchronously retires a globally allocated per-URI evidence
  revision, invalidates cached evidence, and withdraws the target's shared and
  inline state before persistence; unrelated in-flight work remains valid,
  replacement evidence has no post-write cleanup race, and a failed write does
  not restore stale state; tracked URIs use the bounded 256-entry LRU described
  above;
- corrupt memory is preserved while in-memory defaults keep Pair usable, until
  the user invokes the explicit reset command; reset stops active and pending
  session work before storage mutation, and completion remains fenced so a
  replaced runtime cannot be overwritten;
- OpenAI-compatible keys are stored in `SecretStorage`, separately per
  validated canonical endpoint origin;
- remote settings are application-scoped and cannot be supplied by a folder;
- workspace excerpts remain local until destination-disclosed, session/root-
  scoped sharing consent; revocation/refresh/stop/rebuild invalidate pending
  work, and drafts remain unsaved;
- remote requests bound approved source/document excerpts, whitelist automatic
  evidence by kind, and keep detected credential/local-resource fields local.

## Differences from the full design

Compared with the broader Adaptive Pair design, this slice is intentionally
smaller:

- developer-led pairing, with no unattended driver mode
- no unattended edits, arbitrary shell execution, or autonomous task ownership
- no whole-repository retrieval, durable multi-file memory, or GitHub-backed history
- no broader language support beyond TypeScript/JavaScript
- no advanced evidence ranking beyond the implemented thresholds/cooldown
- no durable threaded inline discussion; only the latest preview thread per file
- no claim that GUI consent flows for the official Copilot provider have been
  manually validated end to end yet
