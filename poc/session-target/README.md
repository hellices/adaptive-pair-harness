# Adaptive Pair Session Target POC

This isolated extension proves that a third-party proposed chat-session
provider can appear as an `Adaptive Pair` Session Target and handle a native
chat request in VS Code Insiders.

## Run

```bash
npm ci
npm audit --audit-level=low
npx @vscode/dts main
npx @vscode/dts dev
npm run check
npm run test:host
npm run package
```

The host runner downloads an isolated VS Code Insiders build, uses temporary
workspace, user-data, and extension directories, and enables proposed API only
for `adaptive-pair.adaptive-pair`.

This directory has its own lockfile and is outside the root workspace globs.
CI separately runs its clean install, full dependency audit, compile/unit
checks, and packaging; a root-only audit does not cover it. Declaration
downloads are not part of dependency CI because they change the vendored API
snapshot. The repository's [maintenance policy](../../docs/design.md#dependency-and-version-maintenance)
also applies to this active prototype. Passing these checks does not close the
spike's remaining product questions or make proposed APIs available on Stable.

## Verified in the POC

- `contributes.chatSessions` adds the `adaptive-pair` session type.
- The generated native target action exists alongside native Chat.
- A target-scoped POC model is selected without Copilot sign-in.
- An untitled target session materializes into an Adaptive Pair resource.
- `onChatSession:adaptive-pair` activates the extension.
- The dynamic participant ID matches the session type and receives the
  submitted request.
- The content provider is invoked through native Chat.
- Existing Local target action and tracked Chat/Codex settings remain
  unchanged.
- An already-aborted core request streams nothing and becomes `needs-input`.
- The provider does not advertise native interruption support.

## Deliberate limitations

- This uses proposed APIs and is not a Marketplace extension.
- It requires VS Code Insiders and explicit proposed-API enablement.
- The response is deterministic POC text, not a Pair Runtime or coding model.
- Session records are in memory and history is not restored after restart.
- Native interruption, session fork, attachments, Pair tools, and mode
  conformance are not implemented.
- It does not modify VS Code, Copilot, Claude, or Codex settings and does not
  replace an existing target.
