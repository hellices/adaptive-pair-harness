---
title: "Adaptive Pair as a VS Code Session Target"
category: "Platform & Infrastructure"
status: "🟡 In Progress"
priority: "High"
timebox: "2 days"
created: 2026-09-14
updated: 2026-09-14
owner: "Adaptive Pair maintainers"
tags: ["technical-spike", "platform", "vscode", "agent-runtime"]
---

# Adaptive Pair as a VS Code Session Target

## Summary

**Spike Objective:** Determine whether Adaptive Pair can appear beside Local,
Copilot, Claude, and Codex in VS Code's Session Target control and own the
complete request, instruction, tool, and session loop.

**Why This Matters:** A dedicated target could enforce Growth, Pair, and
Delivery contracts more reliably than instructions layered onto another
harness. Depending on an unstable API would also block a normal Stable and
Marketplace release.

**Timebox:** Two engineering days.

**Decision Deadline:** Before writing the native-adapter and v2.0 release
implementation plan.

## Research Questions

**Primary Question:** Can a third-party extension register an Adaptive Pair
Session Target using supported VS Code mechanisms?

**Secondary Questions:**

- Does the target own new-session creation, history, streaming, request
  handling, model choices, and session options?
- Does it appear in the same target picker as provider harnesses?
- Can it use Pair extension tools and the selected VS Code language model?
- What cancellation, interruption, attachment, diff, and persistence behavior
  does the provider receive?
- Can the result be published to the Marketplace and run on Stable?
- Is a standalone AHP server necessary or beneficial?

## Investigation Plan

### Research Tasks

- [x] Inspect the stable VS Code extension API.
- [x] Inspect `vscode.proposed.chatSessionsProvider.d.ts`.
- [x] Inspect the internal `chatSessions` contribution registration path.
- [x] Inspect the Copilot extension's contributed session manifest.
- [x] Inspect proposed-API distribution restrictions.
- [x] Inspect AHP documentation and available TypeScript package.
- [x] Build a minimal Adaptive Pair target extension for VS Code Insiders.
- [x] Verify contributed target action, target-scoped model selection, and
  native session materialization in a clean Insiders profile.
- [x] Verify one request reaches the dynamic participant and completes through
  native Chat streaming.
- [ ] Verify one Pair tool call, native interruption, and restored history.
- [x] Record logs, API incompatibilities, and recommendation.

### Success Criteria

**This spike is complete when:**

- [x] VS Code registers the native `Adaptive Pair` target action and opens an
  `adaptive-pair:` target session in a clean Insiders profile.
- [ ] Existing Local, Copilot, Claude, Codex, and Cloud entries remain present,
  ordered as before, and retain the prior default.
- [x] A new target session is created through
  `ChatSessionItemController.newChatSessionItemHandler`.
- [x] `ChatSessionContentProvider` is invoked and the dynamic participant
  handles a submitted request.
- [ ] `ChatSessionContentProvider` restores persisted history.
- [ ] The target calls one Pair extension tool and reports its observed result.
- [ ] Growth Mode rejects an edit request through the target.
- [ ] Stop or interruption leaves no late state mutation.
- [ ] Install, target selection, deselection, and uninstall do not modify user
  settings, another session, participant routing, or native Chat behavior.
- [x] Stable, Insiders, VSIX, and Marketplace limitations are documented.
- [x] A clear promote, retain-experimental, or reject decision is recorded.

## Technical Context

**Related Components:** Pair Presence, Pair Runtime, harness instruction
compiler, Pair tool catalog, VS Code extension, Agent Plugin, controlled
`@pair` adapter.

**Dependencies:** The open Pair Runtime and mode contracts remain independent
of this result. Only the preferred VS Code chat entry changes.

**Constraints:**

- Stable v2.0 cannot require an unpublished proposed API.
- Pair Presence remains the workspace lifecycle.
- Growth, Pair, and Delivery remain Pair Runtime state, not provider options
  with weaker semantics.
- The target must remain model- and provider-agnostic.
- No direct workspace mutation may bypass Pair tools.
- The extension may add only namespaced UI and must not modify another
  extension, target, setting, default, or session.

## Research Findings

### 1. Stable extension API

The stable `vscode.d.ts` exposes Chat Participants and Language Model Tools, but
does not expose the chat-session provider/controller API.

Stable extensions can therefore provide Adaptive Pair behavior and tools, but
cannot use the stable API alone to register a new Session Target.

### 2. Proposed Session Target API

The proposed `chatSessionsProvider` API exposes:

- `chat.createChatSessionItemController`;
- `chat.registerChatSessionContentProvider`;
- `ChatSessionItemController.newChatSessionItemHandler`;
- provider-defined input option groups;
- `ChatSession.history`;
- `ChatSession.activeResponseCallback`;
- `ChatSession.requestHandler`;
- session status, timing, changes, metadata, fork, and refresh behavior.

The companion `contributes.chatSessions` manifest contribution defines the
target type, display name, description, icon, visibility condition, commands,
attachments, model behavior, custom-agent target, and sign-in requirements.

VS Code's internal session service ignores the contribution unless the
extension has the `chatSessionsProvider` proposal enabled. For accepted
contributions, the service creates new-session actions using the extension's
display name. This is the mechanism needed to show `Adaptive Pair` in the
native target UI.

### 3. Current distribution restriction

VS Code documents proposed APIs as:

- subject to change;
- available to third-party development in Insiders;
- unsuitable for Marketplace-published extensions.

A proposed-API VSIX can be shared, but users must run VS Code Insiders with:

```bash
code-insiders . --enable-proposed-api=adaptive-pair.adaptive-pair
```

This is acceptable for a proof of concept and unacceptable as the only v2.0
entry.

### 4. What the Codex settings demonstrate

The current VS Code source includes these Codex feature settings:

```json
{
  "chat.agentHost.codexAgent.enabled": true,
  "chat.editor.codex.preferAgentHost": true
}
```

They control whether VS Code surfaces the already implemented Codex Agent Host
provider in the Agents window and regular editor chat. They do not constitute
a generic provider-registration mechanism.

The fact that Codex appears after enabling the settings confirms that target
visibility is dynamic. Adaptive Pair still needs its own `chatSessions`
contribution and content provider; two arbitrary settings cannot register it.

### 5. Extension-host target versus AHP server

The proposed chat-session provider is sufficient to build a target that runs
inside the VS Code extension host and owns the native chat request flow. It
does not require a standalone AHP server.

AHP is an open, agent-agnostic JSON-RPC protocol with immutable channel state,
reducers, write-ahead actions, tool-call confirmation, and reconnect support.
The official TypeScript package is currently version 0.9 and provides wire
types, reducers, transports, and client orchestration. The VS Code Agent Host
is the reference server; the package is not a ready-made TypeScript server
framework.

A standalone Adaptive Pair AHP host would add persistence, remote clients, and
host independence, but also requires implementing and distributing a compliant
server plus a supported VS Code connection/discovery path. It is not needed to
answer the target-picker question.

### Prototype and Testing Notes

The executable POC lives at `poc/session-target/`.

Validated environment:

- VS Code Insiders commit
  `07b4ff1883f94da91f6d698744fc7c3638b59720`;
- isolated temporary workspace, user-data, and extensions directories;
- extension proposal enablement limited to
  `adaptive-pair.adaptive-pair`;
- Node.js 22.22.1 test runner.

Observed results:

- generated command
  `workbench.action.chat.openNewChatSessionInPlace.adaptive-pair` exists;
- target-scoped model `adaptive-pair-poc/echo` is selected for
  `modelTarget="adaptive-pair"`; the host test does not independently inspect
  the general model picker to prove exclusion there;
- an `adaptive-pair:/untitled-*` resource materializes into
  `adaptive-pair:/sessions/*`;
- the content provider is invoked;
- a submitted request reaches the default dynamic participant and the stored
  session becomes `completed`;
- the existing Local target action remains registered and inspected Chat/Codex
  settings are unchanged across the request;
- four unit-test files pass six tests;
- one Extension Host test passes;
- an eight-file, 6.85-KiB VSIX packages without source maps or test code.

A dependency-only revalidation on September 16, 2026 updated the isolated POC to
VSCE 4.0.0 and added its own clean install, full audit, compile/unit checks, and
packaging to CI. Under Node.js 24.20.0, the existing six unit cases, one isolated
Insiders host case, and an eight-entry VSIX passed; checks and packaging also
passed under Node.js 22.22.1. Both pre-update and post-update POC audits reported
zero findings. See the [maintenance evidence](../research.md) for the selected
versions, audit scope, and compatibility retentions. No runtime source or
vendored declaration changed, and the spike's remaining questions stay open.

Critical proposed-API rules discovered from documentation and confirmed by
the POC:

1. activation uses `onChatSession:<type>`;
2. the dynamic participant ID must equal the session `type`;
3. the current implementation registers that dynamic participant only when
   `canDelegate: true`;
4. a clean target needs an actual selectable model, not only option metadata;
5. a model can be scoped to the target with
   `LanguageModelChatInformation.targetChatSessionType`;
6. the content provider's default participant handles requests; returning a
   second request handler is unnecessary for this flow.
7. `supportsInterruptions` must remain false until native interruption and
   side-effect-free resume are tested.

The spike remains in progress because persisted history, Pair tool routing,
native cancellation, full target-list coexistence, and visual review have not
yet passed.

### External Resources

- [Proposed Chat Sessions Provider API](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.chatSessionsProvider.d.ts)
- [VS Code proposed API policy](https://code.visualstudio.com/api/advanced-topics/using-proposed-api)
- [VS Code agent harness concepts](https://code.visualstudio.com/docs/agents/concepts/agent-harnesses)
- [VS Code Agent Host](https://code.visualstudio.com/docs/agents/concepts/agent-host)
- [Agent Host Protocol](https://github.com/microsoft/agent-host-protocol)
- [AHP TypeScript client](https://www.npmjs.com/package/@microsoft/agent-host-protocol)

## Options

| Option | Picker entry | Stable/Marketplace | Runtime control | Cost | Decision |
|---|---|---|---|---|---|
| Pair Presence + Pair tools + `@pair` | Command/chat entry, not Session Target | Yes | Own stable controlled loop | Low | Required Stable baseline |
| Optional Agent Plugin | Agent control, not Session Target | Plugin marketplace or repository | Underlying harness owns loop; Pair tools enforce effects | Low | Optional add-on |
| Proposed chat-session provider | Adaptive Pair Session Target | Insiders VSIX only | Own request, instructions, options, history, and tools | Medium | Build proof of concept |
| Standalone AHP server | Remote/persistent host after integration | No documented third-party distribution path yet | Full host and session ownership | Very high | Defer |
| VS Code fork/internal provider | Native target | Custom VS Code build only | Full control | Very high maintenance | Reject |

## Decision

### Recommendation

Build the proposed extension-host Session Target proof of concept, while
keeping Stable Pair Presence, Pair tools, and controlled `@pair` in the same
extension.

If `chatSessionsProvider` stabilizes and the proof passes all Pair mode
contracts, promote `Adaptive Pair` to the primary **chat** entry. Pair Presence
remains the primary **workspace** entry.

Do not build a standalone AHP server for v2.0.

Produce two mutually exclusive packages from one extension codebase:

- `adaptive-pair-<version>-stable.vsix` without proposed API declarations;
- `adaptive-pair-<version>-insiders.vsix` with the Session Target provider.

The Agent Plugin is optional and not required by either VSIX.

### Rationale

- The proposed provider proves the desired picker experience is technically
  real rather than speculative.
- Owning the request handler aligns with Adaptive Pair's instruction and tool
  restraint requirements.
- Keeping Pair Runtime host-agnostic prevents lock-in to a proposed API.
- The Stable profile preserves Marketplace distribution and normal VS Code
  use without a second required installation.
- AHP remains a compatible future host boundary without imposing server work
  before the product interaction is validated.

### Prototype Shape

The proof uses:

```json
{
  "enabledApiProposals": ["chatProvider", "chatSessionsProvider"],
  "contributes": {
    "languageModelChatProviders": [
      {
        "vendor": "adaptive-pair-poc",
        "displayName": "Adaptive Pair POC"
      }
    ],
    "chatSessions": [
      {
        "type": "adaptive-pair",
        "name": "pair",
        "displayName": "Adaptive Pair",
        "description": "Capability-preserving AI pair programming",
        "icon": "$(git-compare)",
        "order": 100,
        "canDelegate": true,
        "requiresCustomModels": true,
        "supportsAutoModel": false,
        "requiresCopilotSignIn": false
      }
    ]
  }
}
```

Activation must:

1. create the `adaptive-pair` session item controller;
2. create the dynamic chat participant with ID `adaptive-pair`, matching the
   session type;
3. register a target-scoped language model or expose compatible configured
   models;
4. register the `adaptive-pair` content provider;
5. expose Growth, Pair, and Delivery as Pair Runtime state;
6. expose model and permission choices as provider input options only when
   their semantics are supported;
7. route every workspace action through the Pair tool catalog;
8. use a temporary in-memory store for the first picker test, then the real
   Pair journal for cancellation and restore tests.

The clean-profile test records Session Targets, selected defaults, settings,
commands, keybindings, session history, and idle extension activity before
installation. The only accepted default change after installation is the
additional Adaptive Pair contribution.

### Follow-up Actions

- [ ] Execute the Insiders proof of concept in an isolated branch.
- [ ] File upstream API feedback for missing interruption, option, tool, or
  distribution semantics.
- [ ] Update `docs/design.md` with measured results.
- [ ] Update the native-adapter implementation plan.
- [ ] Reassess when `chatSessionsProvider` enters Stable.

## Status History

| Date | Status | Notes |
|---|---|---|
| 2026-09-14 | 🔴 Not Started | Spike question created |
| 2026-09-14 | 🟡 In Progress | Static API and source research complete; Insiders proof pending |
| 2026-09-14 | 🟡 In Progress | Target registration and native request flow proven; conformance hardening remains |
| 2026-09-16 | 🟡 In Progress | Dependency maintenance revalidated the existing POC and added its isolated graph to CI; remaining product questions stay open |

---

_Last updated: September 14, 2026 by Adaptive Pair maintainers_
