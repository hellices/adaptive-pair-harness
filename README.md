# Adaptive Pair Harness

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

1. Open the repository in **GitHub Codespaces**.
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
- **OpenAI-compatible API key**: `Adaptive Pair: Set OpenAI-Compatible API Key`
- **Memory recovery**: `Adaptive Pair: Reset Local Memory`

Stopping a session clears transient inline state and shared evidence for the
current session.

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
If Copilot is unavailable, access is denied, or access still requires a
user-initiated action, Adaptive Pair falls back to the local template.

### `openai-compatible`

Sends a structured request to `adaptivePair.model.baseUrl` using the configured
`adaptivePair.model.name`. Store the API key with
**Adaptive Pair: Set OpenAI-Compatible API Key** if your endpoint requires one.
API keys are stored separately for each canonical endpoint origin, so changing
the origin requires explicit key setup. Non-loopback endpoints require HTTPS;
URL credentials, query strings, fragments, and unsafe URL forms are rejected.
An invalid base URL disables this provider and falls back to `local-template`.

See the repository documentation for the full configuration reference:

- [Configuration reference](docs/configuration.md)
- [Vertical-slice architecture](docs/architecture/vertical-slice.md)

## Privacy and token behavior

- Adaptive Pair performs **no project-file writes**.
- `local-template` keeps all generation local to the extension process.
- Remote requests send **structured evidence**, not full source buffers.
- One centralized policy redacts or suppresses credentials in semantic,
  diagnostic, symbol, and Chat fields, including URL userinfo and sensitive
  query values. Credential-bearing automatic evidence stays local.
- The latest local inline question is **not** forwarded back to remote chat
  providers.
- Token budgets are enforced per 10-minute window and survive configuration or
  API-key runtime rebuilds:
  - `eco`: 2 calls / 2,000 input / 360 output tokens
  - `balanced`: 4 calls / 6,000 input / 720 output tokens
  - `active`: 8 calls / 12,000 input / 1,440 output tokens
- Remote completions are capped at 180 output tokens per call. OpenAI-compatible
  requests also use a deadline and a bounded response body.
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
- Use a TypeScript or JavaScript file under the `file:` scheme.
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

Pair starts with safe in-memory defaults, preserves the corrupt stored record,
and shows a warning. Use **Adaptive Pair: Reset Local Memory** only when you
intend to replace that record with clean defaults.

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
