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
- [ ] Build a minimal Adaptive Pair target extension for VS Code Insiders.
- [ ] Verify target picker visibility in a clean Insiders profile.
- [ ] Verify one streamed request, model option, Pair tool call, cancellation,
  and restored session.
- [ ] Record screenshots, logs, API incompatibilities, and recommendation.

### Success Criteria

**This spike is complete when:**

- [ ] `Adaptive Pair` appears in the Session Target control in a clean Insiders
  profile.
- [ ] A new target session is created through
  `ChatSessionItemController.newChatSessionItemHandler`.
- [ ] `ChatSessionContentProvider` restores history and handles a new request.
- [ ] The target calls one Pair extension tool and reports its observed result.
- [ ] Growth Mode rejects an edit request through the target.
- [ ] Stop or interruption leaves no late state mutation.
- [ ] Stable, Insiders, VSIX, and Marketplace limitations are documented.
- [ ] A clear promote, retain-experimental, or reject decision is recorded.

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

Static source inspection confirms the extension contribution and request
provider path. No runtime prototype has been executed in this environment
because a compatible VS Code executable is not installed. The spike remains
in progress until a clean Insiders profile demonstrates target visibility and
the request/tool/cancellation flow.

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
| Custom agent + Pair tools | Agent control, not Session Target | Yes | Strong tool enforcement; underlying harness owns loop | Low | Stable baseline |
| Proposed chat-session provider | Adaptive Pair Session Target | Insiders VSIX only | Own request, instructions, options, history, and tools | Medium | Build proof of concept |
| Standalone AHP server | Remote/persistent host after integration | No documented third-party distribution path yet | Full host and session ownership | Very high | Defer |
| VS Code fork/internal provider | Native target | Custom VS Code build only | Full control | Very high maintenance | Reject |

## Decision

### Recommendation

Build the proposed extension-host Session Target proof of concept, while
keeping the stable custom-agent/tool and controlled `@pair` paths.

If `chatSessionsProvider` stabilizes and the proof passes all Pair mode
contracts, promote `Adaptive Pair` to the primary **chat** entry. Pair Presence
remains the primary **workspace** entry.

Do not build a standalone AHP server for v2.0.

### Rationale

- The proposed provider proves the desired picker experience is technically
  real rather than speculative.
- Owning the request handler aligns with Adaptive Pair's instruction and tool
  restraint requirements.
- Keeping Pair Runtime host-agnostic prevents lock-in to a proposed API.
- The stable fallback preserves Marketplace distribution and normal VS Code
  use.
- AHP remains a compatible future host boundary without imposing server work
  before the product interaction is validated.

### Prototype Shape

The proof uses:

```json
{
  "enabledApiProposals": ["chatSessionsProvider"],
  "contributes": {
    "chatSessions": [
      {
        "type": "adaptive-pair",
        "name": "pair",
        "displayName": "Adaptive Pair",
        "description": "Capability-preserving AI pair programming",
        "icon": "$(git-compare)",
        "order": 1,
        "canDelegate": false,
        "requiresCustomModels": false,
        "supportsAutoModel": true,
        "requiresCopilotSignIn": false
      }
    ]
  }
}
```

Activation must:

1. create the `adaptive-pair` session item controller;
2. provide an `Adaptive Pair` chat participant;
3. register the `adaptive-pair` content provider;
4. expose Growth, Pair, and Delivery as Pair Runtime state;
5. expose model and permission choices as provider input options only when
   their semantics are supported;
6. route every workspace action through the Pair tool catalog;
7. use a temporary in-memory store for the first picker test, then the real
   Pair journal for cancellation and restore tests.

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

---

_Last updated: September 14, 2026 by Adaptive Pair maintainers_
