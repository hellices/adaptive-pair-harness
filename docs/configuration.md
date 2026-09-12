# Adaptive Pair configuration

Adaptive Pair reads all user-facing settings from the `adaptivePair` namespace.
The vertical slice ships with explicit session control: the extension loads, but
pairing remains off until the user starts a session.

## Settings reference

| Setting | Type | Default | Effect |
| --- | --- | --- | --- |
| `adaptivePair.enabled` | boolean | `true` | Global enable/disable flag. When `false`, sessions cannot start and no model provider is invoked. |
| `adaptivePair.debounceMs` | number | `500` | Delay before edit episodes are analyzed after typing stops. Values are clamped to `300`-`800`. |
| `adaptivePair.interventionStyle` | `eco` \| `balanced` \| `active` | `balanced` | Authoritative threshold and 10-minute token budget until **Adaptive Pair: Set Intervention Style** persists an explicit selection. |
| `adaptivePair.model.provider` | `local-template` \| `vscode-copilot` \| `openai-compatible` | `local-template` | Application-scoped provider selection. |
| `adaptivePair.model.baseUrl` | string | `http://localhost:11434/v1` | Application-scoped OpenAI-compatible root. HTTPS is required except for exact loopback hosts. Raw URL credentials, query/fragment delimiters, and ASCII whitespace/control characters are rejected. |
| `adaptivePair.model.name` | string | `qwen2.5-coder:7b` | Application-scoped model identifier used for OpenAI-compatible requests and token estimation. |

The three remote-routing settings are deliberately application-scoped. Runtime
loading reads only application/user values and defaults; workspace,
workspace-folder, and workspace-language overrides are ignored with a visible
warning. This prevents a repository from redirecting credentials or evidence.

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

## Provider setup

### `local-template`

No extra setup is required.

Recommended when you want:

- no remote model traffic;
- predictable navigator-only prompts;
- a safe fallback when budgets or provider access fail.

### `vscode-copilot`

1. Install **GitHub Copilot** and **GitHub Copilot Chat** in VS Code.
2. Sign in with a GitHub account that has Copilot access.
3. Set `adaptivePair.model.provider` to `vscode-copilot`.
4. Start the Pair explicitly.

Implementation notes for this slice:

- Requests go through the official VS Code Language Model API with
  `selectChatModels({ vendor: "copilot" })`.
- Automatic inline interventions require access to already be available through
  `languageModelAccessInformation.canSendRequest(...)`.
- User-initiated actions such as `@pair /why` or **Adaptive Pair: Review Current
  Block** are allowed to attempt the official request path even when proactive
  access is not yet available.
- Candidate models advance only for unavailable or no-permission failures.
  Blocked and unknown failures surface; cancellation stops iteration. Each
  candidate is counted and admitted separately before it can dispatch.
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

## Exact data sent for a remote request

Adaptive Pair does **not** send full source buffers, edit histories, or project
files to remote providers.

Every remote request is reduced to a bounded structured prompt containing:

- `goal`
- `interactionStyle`
- evidence metadata:
  - `kind`
  - `severity`
  - `title`
  - `detail`
  - `source`
  - `confidence`
  - `range`
  - `references`
- optional user-initiated context:
  - bounded `userPrompt`
  - current symbol `name`, `kind`, and `range`

All string fields pass through the same suppression/redaction policy. It
handles HTTP and non-HTTP DSN userinfo, sensitive query parameters, bearer/JWT
and common token formats, complete Basic authorization payloads, quoted JSON
keys and quoted or unquoted credential assignments, control characters, and
long base64/base64url or opaque secret-like values. Local `file:` and
`vscode-remote:` URIs plus absolute POSIX, Windows, and import paths become
deterministic hashed labels in every remote text field. If an automatic
intervention contains possible credential or local-path material, no remote
provider is called; the local template is used instead.

### Diagnostic sanitization

Diagnostics are narrowed before remote use:

- title becomes `Editor diagnostic`;
- detail becomes `See VS Code Problems for the complete diagnostic message.`;
- source is bounded to a short single line;
- diagnostic references are reduced to short code-like values such as `TS2322`.

### Data intentionally not sent

Remote requests exclude:

- full document text;
- pre-edit and post-edit source snapshots;
- selection text;
- inline comment history;
- the latest locally rendered question;
- workspace memory blobs;
- any project-file writes.

## Token budgets by interaction style

Budgets are enforced over a rolling 10-minute window.

| Style | Max remote calls | Max input tokens | Max output tokens |
| --- | --- | --- | --- |
| `eco` | 2 | 2,000 | 360 |
| `balanced` | 4 | 6,000 | 720 |
| `active` | 8 | 12,000 | 1,440 |

Behavior:

- before reservation, each eligible Copilot candidate is counted with that
  model's official `countTokens` API, while OpenAI-compatible input uses a
  conservative UTF-8 byte estimate of the exact serialized request body;
- each request atomically reserves up to its 180-token output allowance before
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
- the user must start a session with a command, `@pair /start`, or the toggle
  shortcut before inline analysis will run. While the session is off, Adaptive
  Pair does not analyze evidence, render interventions, or call a model.

### Cooldown

The current vertical slice applies a fixed per-evidence cooldown of **30 seconds**.
Cooldown starts only after an inline thread renders successfully. Entries expire
from memory, and stop/restart clears all transient cooldown state.

### Active local-template sessions

This document reserves “local-only” for an active Pair session using the
`local-template` provider.

An active session stays local when any of the following is true:

- provider is `local-template`;
- an OpenAI-compatible base URL is invalid;
- a Copilot model is unavailable or inaccessible;
- the remote token budget is exhausted;
- automatic evidence may contain credential material;

In this active local-template mode, the extension still analyzes supported
evidence and can render inline navigator questions without network traffic.

Local Chat is command-specific: `/why` explains significance, `/explain`
summarizes the evidence, and `/trace` reports only the VS Code-resolved
symbol/range while stating that deeper analysis requires a model.

## Memory recovery and multi-root identity

Repository dismissals use the workspace folder that owns each document, rather
than always using the first folder. Evidence cleanup is fenced per URI, so
activity in another document cannot leave a completed dismissal visible, while
newer evidence for the same URI is preserved. One extension-scoped memory
adapter serializes mutations across configuration-driven runtime rebuilds, and
session preparation reloads when a concurrent memory action changes its
revision. If the persisted memory record is corrupt, Pair starts with in-memory
defaults, preserves the stored corruption, and shows a warning. **Adaptive
Pair: Reset Local Memory** is the only operation that replaces that record with
defaults, and it invalidates any pending session preparation before writing or
publishing reset state.
