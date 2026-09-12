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
  - exported API signature changes or removals;
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

- **New import dependency** — a newly introduced module import
- **Exported signature change** — a changed, added, or removed ESM/CommonJS
  function, function-valued variable, alias, default export, or exported class
  method signature
- **Complexity growth** — a function or method whose branch count grows
  substantially
- **Editor diagnostic** — an error or warning already surfaced by VS Code

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

The configured intervention style remains authoritative until the style picker
records an explicit user selection in VS Code global state. Dismiss and approve
actions do not convert the materialized `balanced` default into a selection.
Reset clears the selection and immediately returns to the configured style.
Dismissals are stored only under the workspace root that owns the evidence.
Persisted evidence identities are SHA-256 hashes; approvals retain only the
kind, approval time, and a sanitized title bounded to 120 characters, never a
raw evidence URI, source buffer, reference, or secret.

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
- Remote requests send **structured evidence**, not full source buffers.
- One centralized policy redacts or suppresses credentials in semantic,
  diagnostic, symbol, and Chat fields, including HTTP/DSN userinfo, sensitive
  query values, quoted JSON/assignment values, long base64/base64url values,
  and complete Basic/Bearer authorization payloads. Credential-bearing
  automatic evidence stays local.
- Local `file:`/`vscode-remote:` URIs and absolute POSIX, Windows, and import
  paths become deterministic hashed labels in every remote text field.
- The latest local inline question is **not** forwarded back to remote chat
  providers.
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
  output and account for the maximum observed token count. The stable VS Code
  API does not promise a provider-side generation or billing hard limit;
  cancellation at the display boundary is best effort, while the budget
  retains conservative accounting.
- OpenAI-compatible requests also use a deadline and a bounded response body.
  Rejected status and size-limit paths cancel the body before returning the
  primary provider error; a cancellation failure is retained as its cause.
- If a remote request would exceed the budget, Adaptive Pair falls back to the
  local template for that intervention.

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
- evidence is limited to import changes, exported signature changes,
  complexity growth, and editor diagnostics
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
