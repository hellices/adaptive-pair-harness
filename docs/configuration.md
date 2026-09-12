# Adaptive Pair configuration

Adaptive Pair reads all user-facing settings from the `adaptivePair` namespace.
The vertical slice ships with explicit session control: the extension loads, but
pairing remains off until the user starts a session.

## Settings reference

| Setting | Type | Default | Effect |
| --- | --- | --- | --- |
| `adaptivePair.enabled` | boolean | `true` | Global enable/disable flag. When `false`, sessions cannot start and no model provider is invoked. |
| `adaptivePair.debounceMs` | number | `500` | Delay before edit episodes are analyzed after typing stops. Values are clamped to `300`-`800`. |
| `adaptivePair.interventionStyle` | `eco` \| `balanced` \| `active` | `balanced` | Sets the threshold and 10-minute token budget used for remote interventions. |
| `adaptivePair.model.provider` | `local-template` \| `vscode-copilot` \| `openai-compatible` | `local-template` | Application-scoped provider selection. |
| `adaptivePair.model.baseUrl` | string | `http://localhost:11434/v1` | Application-scoped OpenAI-compatible root. HTTPS is required except for exact loopback hosts. URL credentials, queries, and fragments are rejected. |
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
- Pair memory lives in VS Code workspace state, not in tracked project files.

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
- If no model is available, access is denied, or the request cannot proceed,
  Adaptive Pair falls back to `local-template` and surfaces that in status.

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
userinfo, a query, a fragment, surrounding whitespace, or a non-HTTP(S) scheme
are rejected. Requests time out after 15 seconds and response bodies are capped
at 64 KiB.

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
handles URL userinfo, sensitive query parameters, bearer/JWT and common token
formats, credential assignments, control characters, and long opaque
secret-like values. If an automatic intervention contains possible credential
material, no remote provider is called; the local template is used instead.

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

- input estimates are based on the serialized remote request payload;
- each completion is capped at 180 output tokens and output usage is accounted;
- reservations and usage survive configuration and API-key runtime rebuilds;
- only a Copilot selection/consent failure known to occur before prompt
  dispatch releases its exact reservation;
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
than always using the first folder. If the persisted memory record is corrupt,
Pair starts with in-memory defaults, preserves the stored corruption, and shows
a warning. **Adaptive Pair: Reset Local Memory** is the only operation that
replaces that record with defaults.
