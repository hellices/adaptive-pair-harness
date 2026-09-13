# Adaptive Pair Harness

[Open in GitHub Codespaces](https://codespaces.new/hellices/adaptive-pair-harness?quickstart=1)

Adaptive Pair Harness is an open-source VS Code extension that watches active
TypeScript and JavaScript edits, detects a small set of high-signal changes,
and asks concise navigator-style questions inline.

It is **not** an autonomous coding agent. It does not edit files, run commands,
or write project files. Sessions start **off** and stay dormant until you
explicitly start one.

## What it is

- A navigator-only pair for VS Code 1.136+
- A shared `@pair` Chat participant plus inline preview comments
- An evidence-backed reviewer for:
  - new import dependencies;
  - best-effort public declaration surface changes;
  - substantial complexity growth;
  - active editor diagnostics.
- A harness that can use:
  - a local template response;
  - the official VS Code GitHub Copilot Language Model integration;
  - an OpenAI-compatible endpoint.

## What it is not

- Not a driver that writes code for you
- Not a background agent that changes your repository
- Not a general-purpose language extension outside TypeScript/JavaScript today
- Not proof of ownership over Copilot, Superpowers, Cline, or other tools it
  detects in the workspace

## Supported today

### Languages

- TypeScript
- TypeScript React
- JavaScript
- JavaScript React

Supported documents may use either the local `file:` scheme or VS Code's
`vscode-remote:` scheme, including Codespaces and Remote SSH workspaces.
Unrelated schemes remain ignored.

### Evidence types

- **New static dependency** — a newly introduced ESM import, literal
  `require("...")`, literal dynamic `import("...")`, named re-export, or star
  re-export. Computed/non-literal calls are ignored, and repeated specifiers
  are reported once at their first occurrence.
- **Public API surface change (best effort)** — one generic, per-document
  signal when the previous and current public declaration surfaces differ.
  TypeScript and JavaScript implementation files use TypeScript's official
  declaration-only emitter; existing `.d.ts`, `.d.mts`, and `.d.cts` files
  are first checked with TypeScript's syntactic and semantic diagnostics, then
  normalized with its comment-free printer. Formatting, comments, and optional
  member semicolon/comma choices are ignored. External modules are deliberately
  left unresolved, and invalid or unreliable surfaces are skipped.
- **Complexity growth** — a function or method whose branch count grows
  substantially
- **Editor diagnostic** — an error or warning already surfaced by VS Code

### Local evidence display bounds

Before evidence is shared with `@pair` or rendered inline, dynamic UI text is
collapsed to one line and truncated with `…`:

| Field | Maximum |
| --- | ---: |
| Question or local response | 1,000 characters |
| Title | 120 characters |
| Detail | 500 characters |
| Source | 120 characters |
| Each reference | 240 characters |
| References per evidence item | 8 |

New-dependency identity and deduplication use the complete module specifier
privately, while local detail/reference fields contain only its bounded useful
prefix. Diagnostic identity hashes the complete URI, message, source, and code
inputs; only bounded single-line message, source, and code prefixes enter
`Evidence` or inline Markdown.

## Prerequisites

- VS Code **1.136.0 or newer**
- Node.js **22.13 or newer** for local packaging; **Node 24 LTS recommended**
- GitHub Copilot installed if you want to test the official Copilot provider
- A TypeScript or JavaScript workspace

## Quick start: test in GitHub Codespaces

This is the fastest end-to-end validation path.

1. Select [Open in GitHub Codespaces](https://codespaces.new/hellices/adaptive-pair-harness?quickstart=1)
   or create a codespace from the repository's **Code** menu.
2. Wait for the dev container to finish `npm ci`.
3. In the Codespaces terminal, run:

   ```bash
   npm ci
   npm run check
   npm run package
   code --install-extension adaptive-pair-harness-0.1.0.vsix
   ```

4. Reload VS Code when prompted.
5. Authenticate GitHub Copilot if you plan to use the official Copilot provider.
6. Open a **TypeScript** file.
7. Start a session with one of these:
   - Command Palette → **Adaptive Pair: Start Pairing Session**
   - Chat → `@pair /start`
   - Keyboard shortcut → `Ctrl+Shift+Alt+P` on Windows/Linux or
     `Cmd+Shift+Alt+P` on macOS
8. Add a **new import** or change an **exported public signature**.
9. If an inline question appears, open Chat and run `@pair /why`.
10. If no inline question appears, run **Adaptive Pair: Review Current Block**
    with the relevant code selected.

## Local installation from the VSIX

From the repository root:

```bash
npm install
npm run check
npm run package
code --install-extension adaptive-pair-harness-0.1.0.vsix
```

Then reload VS Code, open a TypeScript or JavaScript workspace, and explicitly
start the Pair before expecting inline guidance.

## Start, stop, and toggle

Adaptive Pair never auto-starts.

- **Start**: `Adaptive Pair: Start Pairing Session`
- **Stop**: `Adaptive Pair: Stop Pairing Session`
- **Toggle**: `Adaptive Pair: Toggle Pairing Session`
- **Shortcut**: `Ctrl+Shift+Alt+P` / `Cmd+Shift+Alt+P`
- **Manual review**: `Adaptive Pair: Review Current Block`
- **Dismiss current evidence for its owning repository**:
  `Adaptive Pair: Dismiss Current Evidence`
- **Approve the current privacy-safe evidence summary**:
  `Adaptive Pair: Approve Current Evidence`
- **Choose and persist intervention style**:
  `Adaptive Pair: Set Intervention Style`
- **OpenAI-compatible API key**: `Adaptive Pair: Set OpenAI-Compatible API Key`
- **Memory recovery**: `Adaptive Pair: Reset Local Memory`

Stopping a session clears transient inline state and shared evidence for the
current session. Resetting local memory also stops an active or still-preparing
session before publishing the reset state.

Adding or removing a workspace folder does not require restarting an active
session. Pair pauses document and model work, cancels pending requests, clears
transient evidence, reloads dismissal memory for the current set of workspace
roots, and then resumes the same explicit session. Removed roots are discarded,
and a newly added root's dismissals load before its documents are reviewed.
Folder events received while that refresh is in flight are coalesced into the
same serialized coordinator and share its limit of three preparation attempts.
If the roots do not stabilize within those three attempts, Pair cancels pending
work, clears transient state, stops the session, and reports the failure. A
later explicit start creates a fresh session generation with a fresh attempt
budget.

The configured intervention style remains authoritative until the style picker
records an explicit user selection in VS Code global state. Dismiss and approve
actions do not convert the materialized `balanced` default into a selection.
Reset clears the selection and immediately returns to the configured style.
Dismissals are stored only under the workspace root that owns the evidence.
Persisted evidence identities are SHA-256 hashes; approvals retain only the
kind, approval time, and a sanitized title bounded to 120 characters, never a
raw evidence URI, source buffer, reference, or secret.
Retention is also bounded to the 256 most recent unique dismissals in each of
the 32 most recently used repository entries and the 256 most recent unique
approved summaries. Repeating an entry refreshes its position without creating
a duplicate. Valid legacy or oversized records are compacted on load and
before saves; preference values and the explicit-selection marker are retained.

## Using `@pair` Chat and inline comments

Adaptive Pair contributes one shared Chat participant: `@pair`.

Available Chat commands:

- `@pair /start`
- `@pair /stop`
- `@pair /session`
- `@pair /explain`
- `@pair /trace`
- `@pair /why`

How it works today:

- Inline guidance is rendered as a **preview Comment Thread** in the editor.
- The thread is navigator-only and does **not** include a reply box.
- Questions and evidence metadata are appended through
  `MarkdownString.appendText`; only extension-owned labels and the
  navigator-only notice are interpreted as Markdown.
- `@pair` reads the same shared session/evidence state as the inline question;
  it does not create a separate hidden chat-specific session.
- Use `@pair /why` to expand the latest inline question.
- Use `@pair /trace` to ask for control/data-flow context when VS Code can
  resolve a current symbol.
- With `local-template`, `/why` and `/explain` return distinct bounded local
  summaries. `/trace` reports only the symbol and range resolved by VS Code and
  says that deeper control/data-flow analysis requires a model.
- Fixed extension-owned Chat labels remain Markdown. Evidence, symbol,
  workspace, configuration, provider-error, and session-result values are
  escaped as text before insertion, including punctuation, backslashes, HTML,
  links, images, and `command:`/`vscode:` action URI forms.
- Remote model responses intentionally retain headings, emphasis, fenced code,
  paragraphs, and line breaks. Links and images are rendered inert, raw HTML is
  escaped, and bare or linked `command:`/`vscode:` action schemes are broken
  before VS Code receives the Markdown.
- Every dynamic `@pair` Chat response—local success, remote success, fallback,
  and dynamic error detail—passes through one **16,384 Unicode code-point**
  display limit. CRLF/CR line endings and unsafe control characters are
  normalized, permitted Markdown and LF newlines are preserved, and truncated
  output ends with an explicit `…` without splitting a surrogate pair. Fixed
  short status guidance remains unchanged.

## Provider selection

Set `adaptivePair.model.provider` in VS Code settings.

Remote provider, endpoint, and model settings are application-scoped. Checked-in
workspace or folder settings cannot redirect model traffic and are ignored at
runtime.

### `local-template`

Default. No remote model request is sent. Adaptive Pair generates a local,
rule-based question from the selected evidence.

### `vscode-copilot`

Uses the **official VS Code Language Model API** (`vendor: copilot`).
Automatic inline requests require Copilot model access to already be available.
Candidate models are tried in order when one is unavailable or lacks
permission. Each candidate is token-counted and admitted against its own budget
reservation before dispatch; blocked or unknown failures surface immediately.
If every candidate is unavailable, access is denied, access still requires a
user-initiated action, or a later candidate is over budget, Adaptive Pair falls
back to the local template.

### `openai-compatible`

Sends a structured request to `adaptivePair.model.baseUrl` using the configured
`adaptivePair.model.name`. Store the API key with
**Adaptive Pair: Set OpenAI-Compatible API Key** if your endpoint requires one.
API keys are stored separately for each canonical endpoint origin, so changing
the origin requires explicit key setup. Non-loopback endpoints require HTTPS;
raw URL credentials, query/fragment delimiters, ASCII whitespace/control
characters, and unsafe URL forms are rejected. A valid base path such as `/v1`
is preserved when `/chat/completions` is appended. An invalid base URL disables
this provider and falls back to `local-template`.

See the repository documentation for the full configuration reference:

- [Configuration reference](docs/configuration.md)
- [Vertical-slice architecture](docs/architecture/vertical-slice.md)

## Privacy and token behavior

- Adaptive Pair performs **no project-file writes**.
- `local-template` keeps all generation local to the extension process.
- Remote requests send **fixed kind-level evidence summaries**, not cleaned
  analyzer/editor text or full source buffers. Evidence IDs and raw titles,
  details, sources, references, specifiers, diagnostics, URIs, and paths are
  omitted from remote prompts. The public-API summary generically covers
  declaration/API surface additions, removals, and changes involving types,
  interfaces, and values; raw declarations are never transmitted.
- Before that fixed projection is built, every raw automatic-evidence ID,
  title, detail, source, and reference is inspected by the same credential and
  local-resource detector used for explicit Chat fields. Any match routes the
  complete request to `local-template`; no remote provider is invoked, and the
  raw value is not copied into the projection, status, or error text.
- Remote-provider fallback renders from the bounded original local evidence,
  not the reduced remote projection, so unavailable providers and denied
  budgets do not erase useful local context.
- Explicit Chat prompts and symbol fields are bounded only after credential
  and local-resource detection. If any field contains known credential
  material or a local resource, the entire request stays local and that field
  becomes a fixed local-only notice rather than a partial redaction.
- Normalized `cookie` and `setcookie` keys (including `Cookie` and
  `Set-Cookie` headers) are credential material, so explicit text containing
  them always takes the local-only path.
- Local-resource detection covers exact `file://` and `vscode-remote://`
  schemes (including directory URIs), recognized or multi-segment POSIX
  paths, Windows drive paths, and UNC paths. It does not treat custom schemes,
  closing markup, package names, or ordinary prose as local paths.
- The latest local inline question is **not** forwarded back to remote chat
  providers.
- Transient per-URI evidence revisions use a shared-context-wide monotonic
  epoch and a 256-entry least-recently-used table. Document close, session
  stop, runtime replacement, and runtime disposal release URI entries; a later
  publication for the same or an evicted URI always receives a newer revision,
  so stale post-await actions cannot clear replacement evidence.
- VS Code global-state memory retains at most 256 unique dismissal hashes per
  repository, 32 repository entries, and 256 unique approved summaries.
  Retention is deterministic: oldest entries are evicted so the newest survive,
  repository isolation is preserved, and intervention preferences are not
  part of eviction.
- Token budgets are enforced per 10-minute window and survive configuration or
  API-key runtime rebuilds:
  - `eco`: 2 calls / 2,000 input / 360 output tokens
  - `balanced`: 4 calls / 6,000 input / 720 output tokens
  - `active`: 8 calls / 12,000 input / 1,440 output tokens
- Before reservation, Copilot requests use the selected model's official
  `countTokens` result and OpenAI-compatible requests use a conservative UTF-8
  byte estimate of the exact serialized body. Each admitted remote call then
  atomically reserves its input count and up to its 180-token output allowance.
  OpenAI-compatible requests send `max_tokens`, reject blank or conservatively
  over-limit output, and account for the greater of reported and conservative
  observed usage.
- Copilot requests pass the supported `max_tokens` model option and use the
  same selected model's official `countTokens` API to cap displayed stream
  output and account for the maximum observed token count. A 15-second
  provider deadline bounds model selection, request dispatch, stream reads,
  and token counting even when the provider ignores cancellation. Timed-out
  dispatched calls retain conservative budget accounting. The stable VS Code
  API does not promise a provider-side generation or billing hard limit;
  cancellation at the display boundary is best effort.
- OpenAI-compatible requests also use a deadline and a bounded response body.
  Rejected status and size-limit paths cancel the body before returning the
  primary provider error; a cancellation failure is retained as its cause.
- If a remote request would exceed the budget, Adaptive Pair falls back to the
  local template for that intervention.
- The 16,384-code-point Chat display cap is a UI safety boundary, not a model
  generation, token-budget, or billing limit. The separate 180-token per-call
  allowance governs remote admission/accounting, and the OpenAI-compatible
  64 KiB limit bounds the complete HTTP response body.

## Coexistence

Adaptive Pair can notice Copilot, Cline, `AGENTS.md`, and Superpowers plan
signals and reports them as **observing only** status. Detection does not mean
Adaptive Pair owns the driver role, blocks another tool, or can control another
harness.

## Troubleshooting

### No inline comment appeared

- Confirm the session is started.
- Confirm `adaptivePair.enabled` is still `true`.
- Use a TypeScript or JavaScript document under the `file:` or
  `vscode-remote:` scheme.
- Make one of the supported evidence-producing changes, or run
  **Adaptive Pair: Review Current Block**.
- Wait for the debounce window after editing.

### Copilot provider is unavailable

- Verify GitHub Copilot and GitHub Copilot Chat are installed and signed in.
- Select `adaptivePair.model.provider = vscode-copilot`.
- Retry with a user-initiated action such as `@pair /why` or
  **Adaptive Pair: Review Current Block**.
- If Copilot still cannot serve the request, Adaptive Pair will fall back to
  `local-template` and show that status.

### Invalid provider or base URL

- Valid provider values are `local-template`, `vscode-copilot`, and
  `openai-compatible`.
- `adaptivePair.model.baseUrl` must use HTTPS, except exact loopback HTTP
  endpoints such as `localhost`, `127.0.0.1`, or `[::1]`.
- Invalid provider values or invalid OpenAI-compatible URLs produce a
  configuration warning and local fallback behavior.

### Pair is disabled or off

- `adaptivePair.enabled = false` disables all session starts and model use.
- A disabled extension and an off session are different states:
  - **disabled**: configuration blocks all Pair activity;
  - **off**: the extension is available, but you have not started the session;
    Pair stays dormant and does not analyze evidence, render interventions, or
    call a model until you start it.

### Corrupt local memory

Personal Pair memory is stored in VS Code global state. Repository dismissals
remain isolated under repository-specific keys in that global record.
The extension reuses one serialized memory store across runtime rebuilds, so a
configuration rebuild cannot race an in-flight memory action. Existing
version-1 records remain readable: a legacy `balanced` value without an
explicit-selection marker is treated as a default, while legacy non-default
styles retain their prior selected behavior. Legacy raw evidence identities
are normalized to hashes when read and are written back only in hashed form on
the next memory mutation.
Pair starts with safe in-memory defaults, preserves the corrupt stored record,
and shows a warning. Use **Adaptive Pair: Reset Local Memory** only when you
intend to replace that record with clean defaults; reset stops any active or
pending session first.

## Current limitations

This release is intentionally narrow:

- navigator-only; no code edits or command execution
- TypeScript/JavaScript only
- one active inline preview thread per file URI
- evidence is limited to static dependency changes, best-effort compiler-emitted
  public declaration changes, complexity growth, and editor diagnostics
- public API comparison is per document; imported and re-exported external
  modules are represented in emitted declarations but are not resolved
- remote prompts are sanitized, bounded summaries rather than full-code review
- coexistence detection is informational only
- README guidance documents the implemented command flow, but GUI consent paths
  for official Copilot requests have not been manually validated end to end yet

## Repository documentation

For repository readers, this branch also includes dedicated documentation:

- [Configuration reference](docs/configuration.md)
- [Vertical-slice architecture](docs/architecture/vertical-slice.md)

- [Contributing](#contributing)
- [License](#license)

## Contributing

Issues and pull requests are welcome. Keep changes open-source, preserve the
explicit start/stop flow, and avoid introducing automatic repository writes.

For implementation details and configuration, see:

- [Configuration reference](docs/configuration.md)
- [Vertical-slice architecture](docs/architecture/vertical-slice.md)

## License

Licensed under the Apache License 2.0. See the packaged LICENSE file for the full text.
