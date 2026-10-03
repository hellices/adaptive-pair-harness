---
title: "Native UI and Copilot Runtime Reuse Boundaries"
category: "API Integration"
status: "Complete: isolated SDK engine measured; authenticated native Agent gate open"
priority: "High"
timebox: "1 engineering day"
created: 2026-09-21
updated: 2026-09-21
owner: "Adaptive Pair maintainers"
tags: ["technical-spike", "vscode", "copilot", "sdk", "permissions"]
---

# Native UI and Copilot Runtime Reuse Boundaries

## Question and decision

The owner asked to investigate both native VS Code session reuse and reuse of
the GitHub Copilot execution engine. These are different integration contracts,
not two names for access to the same session.

**Both layers offer reusable capabilities.** Native participant history is
already measured, and the official Copilot SDK now passes an isolated, real
runtime experiment. Neither result establishes takeover of an authenticated
VS Code Copilot Agent session or a product-ready Pair adapter. Keep the
controlled Stable participant; evaluate SDK execution as an optional adapter
without replacing Pair authority, shipping a proposed API, or selecting a new
store by default. This is evidence for a later reviewed design, not its approval.

## Reuse map

| Layer | Available contract | Evidence and boundary |
| --- | --- | --- |
| Native Chat and historical continuity | `ChatResult.metadata`, `ChatContext.history`, existing session UI | The [September 20 probe](native-session-continuity-spike.md) recovered participant metadata after full desktop restart and explicit reopen, fork, and original deletion on two Stable hosts. History is not a live grant or a unique fork identity. |
| Selected model and extension tools | `ChatRequest.model`, `lm.invokeTool`, `LanguageModelTool`, opaque `toolInvocationToken` | Stable API surfaces used by the existing controlled adapter. Native approval supplements, rather than replaces, Pair scope and edit ownership. This investigation does not measure new model-provider compatibility. |
| Copilot Agent with an Adaptive Pair custom agent | Extension-contributed `chatAgents`, an explicit tool list, extension tools, optional scoped hooks | Documented integration, not yet a measured end-to-end Pair route. Native context disclosure, strict Growth output restraint, public session binding, interruption, and coexistence remain gates. |
| Copilot execution engine through the SDK | `CopilotClient`, session create/resume/delete, tools, permission callbacks, hooks, events, abort | Nine runtime scenarios pass with SDK **1.0.14**, bundled runtime **1.0.85**, protocol **3**. The runtime is real; model responses are scripted on loopback. GitHub-authenticated inference and the VS Code Agent UI are not exercised. |
| CLI-to-IDE integration | Documented `/ide` connection, context/diff surfaces, CLI transcripts in the Sessions view, and resume in a terminal | Existing native UI can present CLI sessions too. This is not a public third-party takeover API or proof that an isolated SDK store is automatically discovered. Not exercised here. |
| A separate Adaptive Pair Session Target | Proposed `chatSessionsProvider` APIs | The existing [Insiders POC](platform-adaptive-pair-session-target-spike.md) remains experimental. No Stable/Marketplace promotion follows from an SDK pass. |

The official [custom-agent documentation](https://code.visualstudio.com/docs/copilot/customization/custom-agents)
and [contribution-point reference](https://code.visualstudio.com/api/references/contribution-points#contributes.chatAgents)
describe adding an agent without modifying another agent. The
[tool guide](https://code.visualstudio.com/api/extension-guides/ai/tools)
describes contributing tools to agent execution. The
[IDE integration guide](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/connecting-vs-code)
documents viewing CLI transcripts in the Sessions view and continuing them in
a terminal. It also describes public-preview ACP support in compatible clients;
that is a separate transport option, not promotion of VS Code's proposed
third-party Session Target API. None of these IDE routes is exercised here.

## Method and measured results

Measured on **September 21, 2026 UTC**, macOS arm64, using Node.js **24.21.0**.
The private [test-only fixture](../../poc/copilot-runtime-reuse/) installs the
published SDK in its own lockfile. It runs the SDK's bundled **stdio child
process**, not the globally installed CLI and not experimental in-process
hosting. The package is outside the product workspace graph and VSIX allowlist.

Every run owns new HOME, configuration, data, cache, state, temporary, and
working directories. The child receives an explicit environment allowlist,
`useLoggedInUser: false`, disabled remote control/export and auto-update, and
SDK `mode: "empty"`. Session configuration disables instruction discovery and
session telemetry. No account credential, developer workspace, installed agent
plugin, or existing session is supplied. The runtime reports unauthenticated.

The only configured model endpoint is a loopback HTTP fixture with a per-run
synthetic bearer token and a bounded request body. It deliberately requests
specific tools, including an excluded tool, and returns deterministic final
text. The compatibility model ID is not evidence of a real model invocation.
This measures runtime mechanics, not reasoning quality, Copilot entitlement,
billing, or an application-wide network-egress audit.

| Scenario | Observed result |
| --- | --- |
| Restricted real tool loop | Only the four non-excluded synthetic tools are advertised. The allowed handler runs and returns through another model request; callback session and tool-call identities are present. |
| Explicit pre-tool denial | A denied tool reaches neither its handler nor the permission callback. |
| Excluded-tool forgery | The tool is absent from the model catalog; even a scripted call to its name reaches neither its handler nor the permission callback. |
| Throwing pre-tool hook | With native permission approved, the synthetic handler **does run**. Hook failure is not an implicit denial. |
| Effect-side refusal | A separate synthetic handler refuses its effect even when its hook throws and native permission approves; the model receives the refusal. This is not a production Pair adapter test. |
| Runtime restart | After disconnect and runtime stop/start, `resumeSession` returns the original seed history. Replacing the permission handler with a denying handler prevents a previously allowed effect. Resume requests `continuePendingWork: false`; no pending-effect replay scenario is exercised. |
| Built-in shell denial | The shell is explicitly exposed for this case only. A denying permission callback prevents the requested marker write in the owned workspace. A fresh session does not inherit the seed. |
| Cooperative cancellation | `abort()` reaches the running custom tool's `AbortSignal`; the fixture completes without an effect. This does not prove forcible termination of an uncooperative tool or an external process tree. |
| Owned-session deletion | The original appears in `listSessions` before deletion; after deleting only run-owned IDs, the API list is empty. This is not forensic erasure of every copy. |

The committed suite reports **nine scenarios / ten Node test entries**,
**15 loopback model requests**, and successful SDK shutdown. The September 20
desktop continuity measurements are reused as prior evidence, not presented as
freshly rerun or as authentication tests. Linux CI execution is a delivery
check, not a claim that native Linux VS Code continuity was measured. Windows
is explicitly rejected by this POSIX shell-denial probe.

The restart case uses single-call approvals, not remembered session approval
rules. It does not prove that all cached permissions are reset. A product must
recheck Pair authority at each effect regardless of the SDK's approval state.

## Important safety finding

SDK 1.0.14's
[hook dispatcher](https://github.com/github/copilot-sdk/blob/v1.0.14/nodejs/src/session.ts)
catches a hook exception and returns no decision. The negative scenario confirms
the consequence with an otherwise approved, harmless tool. Therefore neither
a prompt nor a hook is Pair's authority boundary. Keep current scope, consent,
ownership, budgets, cancellation, and document-version checks at the actual
effect dispatcher. A runtime permission approval is necessary where applicable,
but cannot mint Pair authorization.

This agrees with the existing design's defense-in-depth treatment of
[VS Code hooks](https://code.visualstudio.com/docs/agent-customization/hooks).
Do not enable a global hook setting, change another tool, or broaden permissions
to make the experiment pass. A supported hook still does not establish strict
control of the native agent's direct textual response.

## Session ownership and compatibility

SDK persistence is an SDK/CLI runtime contract, not access to VS Code Local
participant storage. A later native-UI/SDK bridge must explicitly define which
component owns live execution, how user selection binds to a fresh Pair lease,
and how fork, cancellation, deletion, and target switching interact. Copying an
SDK session ID into chat metadata is insufficient: native forks copy metadata
and must not thereby share one live authority or concurrently resume one SDK
session. The SDK's
[persistence guide](https://github.com/github/copilot-sdk/blob/v1.0.14/docs/features/session-persistence.md)
also warns that concurrent access has no built-in session locking and that
in-memory tool state is not persisted.

The published **`@types/vscode@1.137.0`** was separately inspected. Like the
maintained 1.136.0 baseline, it does not declare `ChatRequest.sessionResource`,
`onDidDisposeChatSession`, or the Session Target controller/provider APIs.
Opaque tool invocation tokens must not be decoded into private session IDs.
The [proposed-API policy](https://code.visualstudio.com/api/advanced-topics/using-proposed-api)
continues to exclude that route from a Marketplace foundation. This bounded
inventory is not a claim that no future public integration can exist.

Versions were checked separately rather than assumed interchangeable:

| Component | Observed version and interpretation |
| --- | --- |
| SDK npm release and upstream tag | **1.0.14**, [released September 16](https://github.com/github/copilot-sdk/releases/tag/v1.0.14); the tagged README describes the SDK as generally available. Experimental individual features remain experimental. |
| SDK-bundled runtime used here | **1.0.85**, protocol **3**, reported by the running process. |
| Installed standalone CLI | **1.0.83**; not used or upgraded by the probe. |
| Upstream standalone CLI | GitHub's **1.0.87** release was published September 21; npm's stable tag still returned **1.0.86** during this investigation. Neither replaces the SDK's measured bundled version. |
| Installed VS Code | **1.138.0**, bundled Copilot extension **0.66.0**, bundled CLI package **1.0.73**. Package inspection is not execution evidence for the built-in Agent path. |

## Reproduction and delivery

With Node.js 24 and the repository checked out:

```sh
npm --prefix poc/copilot-runtime-reuse ci
npm --prefix poc/copilot-runtime-reuse audit --audit-level=low
npm --prefix poc/copilot-runtime-reuse run check
```

No Copilot login or paid model is required. The assertion suite launches only
owned runtime processes and a local model fixture. It does not launch VS Code,
select a user's agent, or change their settings. Generated synthetic runtime
data remains in new temporary directories; do not publish raw diagnostics.

CI installs and audits this third dependency graph before running the suite.
Root ESLint includes the typed fixture with the existing test size limits;
there are no new lint exemptions. The two CI/lint coverage regressions were
observed failing before wiring these checks. Product source and the reviewed
P2b implementation plan remain unchanged.

Repository review requested direct hook-invocation witnesses. The explicit
denial and both throwing-hook scenarios now assert the expected tool and
session in the observed callback log. A temporary no-op mutation of the two
throwing-hook paths passed the earlier assertions; with the new witnesses,
both affected scenarios fail. Restoring the real callbacks passes the suite.
The fixture also observes actual exceptions before rethrowing them to the SDK;
a mutation that retains invocation logging but returns instead of throwing
fails these exception witnesses. Neither mutation is retained in the fixture.

## Remaining product gates

1. **Native Agent route:** a separately consented, authenticated clean-profile
   experiment must select the contributed Pair agent, invoke real Pair tools,
   and test public binding, context disclosure, Growth response restraint,
   cancellation, native approval, restart/fork/delete, target switches, and
   coexistence. Use synthetic project data, not an existing developer session.
2. **SDK adapter route:** review the native-UI/SDK ownership and fork contract,
   then verify actual Pair effect guards and output restraint, real provider
   errors, disconnect/crash behavior, uncooperative cancellation, and supported
   host/distribution combinations. Authentication is a separate optional-provider
   gate; the SDK's BYOK engine mechanics do not require Copilot account reuse.
3. **Persistence:** keep native metadata non-authorizing. Neither backend is a
   demonstrated implementation of P2b atomic pre-effect publication, power-loss
   durability, live authority recovery, or global erasure.

Do not begin a production adapter, change the default agent/target, or merge
this feasibility work without its corresponding owner direction.
