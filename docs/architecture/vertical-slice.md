# Adaptive Pair vertical slice architecture

This document describes the implemented realtime vertical slice in this branch,
not the full future design.

## Scope of the slice

The shipped slice is a **navigator-only** VS Code extension that:

- watches open TypeScript/JavaScript documents after an explicit session start;
- aggregates short edit bursts into an edit episode;
- derives bounded evidence from semantic analysis and editor diagnostics;
- decides whether to stay quiet, ask a local question, or call a configured
  model provider;
- renders a single inline preview comment thread per file URI;
- shares the latest evidence with the `@pair` chat participant.

It does **not** edit code, invoke tools, claim driver ownership, or persist
project changes.

## Edit episode flow

1. **Activation** initializes shared session state as enabled-but-inactive.
2. **Configuration rebuild** reads local behavior settings plus
   application-scoped remote routing. Workspace/folder remote overrides are
   ignored. OpenAI-compatible keys are looked up by validated canonical origin.
3. **Session start** is explicit. `adaptivePair.startSession`,
   `adaptivePair.toggle`, and `@pair /start` all route through the same
   lifecycle gate.
4. **Session preparation** loads repository-scoped workspace memory, using the
   owning folder for each document in multi-root workspaces, seeds only stable
   open documents, and discovers coexistence signals.
5. **Document changes** invalidate existing inline evidence for that file,
   cancel in-flight work, and queue an edit episode through the debounced
   aggregator.
6. **Episode analysis** returns an explicit stable/unstable result. Unstable
   edits produce no intervention and do not replace the last-stable baseline;
   the next stable edit is compared with that baseline.
7. **Policy evaluation** picks the highest-priority eligible evidence and
   respects confidence thresholds and rendered-intervention cooldown.
   Runtime-owned rolling budget admission occurs immediately before dispatch.
8. **Intervention rendering** either uses a local template question or a model
   provider response, then renders the result inline and publishes it to shared
   chat state.

## Semantic analyzer boundaries

The semantic analyzer is intentionally narrow.

### Supported evidence kinds

- new dependency imports
- ESM and CommonJS exported API additions, signature changes, and removals,
  including aliases, default exports, function-valued variables, and
  TypeScript-checker-resolved call signatures for callable identifier chains
- substantial complexity growth

### Supported language boundary

- `typescript`
- `typescriptreact`
- `javascript`
- `javascriptreact`

### Important exclusions

The analyzer does not currently:

- inspect non-file editors;
- review whole-repository history;
- understand runtime behavior beyond syntax/AST evidence and editor
  diagnostics;
- reason across multiple files as a single evidence graph.

## Policy and budget decisions

`InterventionPolicy` applies three gates before a remote intervention is used:

1. **Confidence threshold** by interaction style:
   - `eco`: 0.90
   - `balanced`: 0.72
   - `active`: 0.55
2. **Cooldown**: the same privacy-safe, module-qualified evidence ID is not
   resurfaced for 30 seconds after a successful render. Stop clears cooldown.
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

## Model request shape

Remote-capable providers receive a sanitized `ModelRequest` shape:

- `goal`
- `interactionStyle`
- `evidence`
  - `kind`
  - `severity`
  - `title`
  - `detail`
  - `source`
  - `confidence`
  - `range`
  - `references`
- optional user context for chat:
  - bounded `userPrompt`
  - bounded symbol identity and symbol range

One central redaction policy covers all of these string fields. Credential-like
automatic evidence is kept local rather than sent after redaction.

### Provider behavior

- **Local template**: deterministic local question, zero remote tokens
- **Official VS Code Copilot**: uses the VS Code language model API and falls
  back locally when no model is available, access is denied, or proactive access
  is unavailable. The selected model counts the prepared prompt before budget
  reservation and dispatch. The request passes the supported `max_tokens`
  model option; streamed display is bounded with the same model's official
  `countTokens` API and cancellation. VS Code does not guarantee a
  provider-side generation or billing hard limit, so observed over-boundary
  fragments are conservatively accounted.
- **OpenAI-compatible**: posts JSON to `/chat/completions` at the configured
  safe base URL, optionally with an origin-bound bearer token from
  `SecretStorage`; requests have a deadline, 64 KiB response cap, and a
  completion-token cap. Input admission uses a conservative UTF-8 byte estimate
  of the serialized body. Blank output is rejected, and output accounting uses
  the greater of reported completion usage and a conservative UTF-8 byte bound.

## Inline rendering lifecycle

Adaptive Pair owns one preview comment thread per file URI.

- new evidence replaces the previous thread for that file;
- edits clear stale threads and cancel in-flight requests;
- closing a document disposes only that document's thread;
- stopping the session clears all transient inline state;
- cooldown begins only after thread creation succeeds;
- threads are preview-only (`canReply = false`) and direct follow-up to `@pair`.

The inline message always reminds the user that Adaptive Pair has **not changed
code**.

## Shared `@pair` chat

`@pair` does not maintain a separate hidden model session.

Instead, it reads the shared Pair snapshot containing:

- whether the extension is enabled;
- whether the session is active;
- current provider and remaining budget;
- coexistence notice;
- the latest published evidence/question pair.

That is why `@pair /why` expands the latest inline question rather than
reconstructing unrelated state. The local provider has distinct `/why` and
`/explain` summaries. Local `/trace` discloses only the resolved symbol/range
and explicitly declines to fabricate deeper flow analysis.

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
- corrupt memory is preserved while in-memory defaults keep Pair usable, until
  the user invokes the explicit reset command; reset completion is fenced to
  the runtime generation that initiated it, so a replaced runtime cannot be
  overwritten;
- OpenAI-compatible keys are stored in `SecretStorage`, separately per
  validated canonical endpoint origin;
- remote settings are application-scoped and cannot be supplied by a folder;
- remote requests avoid full source text and centrally redact every structured
  evidence/Chat field.

## Differences from the full design

Compared with the broader Adaptive Pair design, this slice is intentionally
smaller:

- navigator-only, with no driver mode
- no automatic code edits, tool execution, or task orchestration
- no multi-file repository memory or GitHub-backed history
- no broader language support beyond TypeScript/JavaScript
- no advanced evidence ranking beyond the implemented thresholds/cooldown
- no durable threaded inline discussion; only the latest preview thread per file
- no claim that GUI consent flows for the official Copilot provider have been
  manually validated end to end yet
