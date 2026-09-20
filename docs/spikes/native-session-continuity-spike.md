---
title: "Native Session Continuity Before a Storage Adapter"
category: "Platform & Infrastructure"
status: "Complete: bounded Local-participant feasibility; native Agent gate open"
priority: "High"
timebox: "1 engineering day"
created: 2026-09-20
updated: 2026-09-20
owner: "Adaptive Pair maintainers"
tags: ["technical-spike", "vscode", "copilot", "persistence"]
---

# Native Session Continuity Before a Storage Adapter

## Question and decision

The owner asked whether GitHub Copilot and VS Code already provide the session
persistence and editor integration that a separate Pair storage adapter would
duplicate, and required an executable feasibility check before moving forward.
This spike starts from merged P2b at `ba20468` (PR #12). It does not implement
production checkpoints, a disk adapter, live restoration, or automatic resume.

**Native historical continuity is feasible for the controlled participant
route. Authenticated Copilot Agent integration is not yet established.**
Prefer native session reuse before selecting a separate store, but do not
convert native history into Pair authority or a transactional storage receipt.
The [design decision](../design.md#133-native-session-reuse-measured-boundary)
and [research evidence](../research.md#native-session-continuity-feasibility)
are the canonical integration points. The completed P2b
[implementation plan](../implementation-plan.md) remains unchanged in scope.

| Gate | Result | Permitted conclusion |
| --- | --- | --- |
| Historical checkpoint through a controlled `@pair`-style participant | GO for a separately reviewed design | Native `ChatResult.metadata` returns through `ChatContext.history` after an explicit reopen |
| Authenticated Copilot Agent, CLI/SDK, custom agent, and native tool loop | NOT PROVEN | A Local participant test is not a Copilot harness integration test |
| P2b durable publication, restored authority, automatic replay, or global erasure | NO GO on this evidence | None of these guarantees follows from recovered chat metadata |
| Independent Pair disk store | DEFERRED | Select one only if a reviewed requirement cannot be met by a supported native contract |

## Method and isolation

The private [probe](../../poc/native-session-continuity/) runs a real VS Code
desktop development host with two synthetic participants and one offline model
provider. The provider rejects any response request and counts calls. The
participant returns only a fixture marker, a random process boot key, and
literal `authorityRestored: false` / `automaticReplayAllowed: false` fields.
No product extension or production state is involved.

Each of seven phases launches a new application process, completes its native
action, writes evidence, and quits the application. The launcher waits for
process closure before the next phase. All phases use one newly generated,
owned profile so native persistence, not a retained extension object, must
carry history between launches. The report asserts seven distinct boot keys.

Isolation includes separate user-data, shared-data, extensions, workspace,
HOME, and COPILOT_HOME locations. Sync, telemetry, update checks, unrelated
extensions, shell environment resolution, and persistent secret storage are
disabled for these test hosts. Only allowlisted OS, locale, temporary-directory,
and GUI environment variables are inherited; profile overrides, credentials,
Node bootstrap injection, and parent VS Code IPC variables are not forwarded.
XDG configuration/data/cache/state roots are also owned by the run.
The workbench driver uses an allocated loopback debug port. A fresh per-run
window token must match both the discovered target title and the live document
title before any UI action, so an unrelated editor that acquires the released
port is rejected. This is a diagnostic ownership check, not authentication
against malicious same-user processes. Only the generated synthetic session is deleted. The
watchdog targets only the spawned process group. Logs must open before the
host is spawned; logging errors terminate and wait for the owned host.
An already-exited group is tolerated during termination. Other signal errors
retain a bounded five-second wait for actual child closure; expiry reports
cleanup as unconfirmed, releases pipe handles, and never claims termination.
Artifacts are retained for
inspection, not copied into public documentation or a user's normal profile.

The probe loads no Copilot extension, uses no sign-in, and makes no fixture
model call. It is not a network-egress audit of the entire VS Code application.
It deliberately does not borrow a developer's authenticated Copilot session.
Its startup activation and UI automation are test-only: the fixture is not
part of the product VSIX and does not change inactive-zero behavior.

## Measured results

Measured on **September 20, 2026**, macOS arm64, with runner Node.js
**24.21.0** and embedded Extension Host Node.js **24.18.1**:

| Host | Build identity | Result |
| --- | --- | --- |
| Stable compatibility-floor host **1.136.2** | `88e44fa0e00b08f7758b4f6d05632e4fd5e4df6f`, September 4 build | All seven phases pass |
| Installed Stable **1.138.0** | `7debcd0e2acdea1c52de81bf9ee1620444407dda`, September 15 build | All seven phases pass |

“Installed Stable” does not claim the latest upstream release was independently
verified. Windows is explicitly rejected by this POSIX process-group runner;
Linux and remote/web hosts were not measured. These results do not expand the
product's advertised platform support.

| Phase | Native action and assertion | Both hosts |
| --- | --- | --- |
| Seed | Invoke the synthetic participant in a new Local session; history is empty and a native disk payload contains the fixture marker | Pass |
| Resume | Fully restart the application and explicitly reopen the original session; its historical seed metadata has the original boot key | Pass |
| Fork | Use the native fork action; historical seed metadata is copied but the native session resource differs | Pass |
| Peer isolation | A second participant cannot see the first participant's metadata; the first cannot see the second's metadata | Pass |
| Delete | Use native session deletion, click its actual confirmation dialog, exit the application, and verify the original payload is absent | Pass |
| Fork after deletion | Fully restart again and reopen the fork; its payload and historical seed metadata remain | Pass |
| Fresh | Create a new native chat; the participant receives empty history | Pass |

Both reports record **zero fixture model calls**, **seven distinct boot keys**,
**no Copilot extension**, and **no enabled API proposals**. Deletion has both a
positive pre-deletion disk witness and a negative post-deletion witness. It is
not inferred merely from a command returning or a dialog disappearing.

`modelCalls` counts model-response/inference attempts; local token-count
callbacks are reported separately as `tokenCountCalls` and aggregated in the
summary. Both final host runs report zero for each count. Token counting
remains a constant offline fixture, not a backend request. Proposal status is
derived from the manifest evidence captured in
every phase, with missing or nonempty lists rejected, and independently
checked against the runtime disposal-API guard. It is not a hardcoded result.

## Supported contracts versus diagnostic internals

The public participant contract supplies `ChatResult.metadata` and
`ChatContext.history`. The maintained `@types/vscode@1.136.0` declarations
include both. The official
[Chat Participant API guide](https://code.visualstudio.com/api/extension-guides/ai/chat)
describes participant-scoped history; the
[API reference](https://code.visualstudio.com/api/references/vscode-api#ChatResult)
describes result metadata. Native session management is also a
[documented user-facing capability](https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions).
These contracts do not promise an extension-controlled atomic durable write.

The following are **test-driver internals, not approved product dependencies**:

- `ChatRequest.sessionResource` can be read at runtime on both measured hosts,
  but is absent from the maintained public declarations. It is used only to
  locate the probe's own sessions for UI automation and payload inspection.
- Native workbench commands and their structured arguments, DOM selectors,
  CDP evaluation, native resource encoding, and chat payload filenames can
  change independently of a supported extension API.
- Access to `vscode.chat.onDidDisposeChatSession` actually throws
  `CANNOT use API proposal: chatParticipantPrivate` on both hosts. The probe
  records and asserts that restriction rather than enabling the proposal.
- Inspecting the owned profile's native payload confirms this experiment's
  before/after disk behavior. Reading Copilot or VS Code private storage is
  not a proposed product persistence adapter.

The fork result rules out treating copied metadata as a unique live-session
binding. The original deletion result rules out assuming source deletion
erases independent forks. A payload check says nothing about logs, backups,
account sync, secure erasure, or complete removal of all derivative data.

## Investigation corrections

1. The first extension-test-mode pilot routed requests but could not prove
   disk persistence. Inspection of the installed host implementation found
   storage configured with `useInMemoryStorage` when
   `extensionTestsLocationURI` is present. The final runner therefore uses
   ordinary development hosts, not `--extensionTestsPath`.
2. `--user-data-dir` alone did not isolate all shared application state in the
   newer host. The final runner also supplies `--shared-data-dir`, because
   the installed host resolves `appSharedDataHome` separately.
3. Opening the generic Chat view after restart created a new session with
   empty history. Explicitly reopening the original recovered the metadata.
   This establishes selected-session continuity, not automatic resume.
4. A native fork can open in the sidebar rather than an additional editor
   tab. The final driver waits for the native fork title and checks a
   different resource instead of assuming a tab-count change.
5. Deletion assertions were strengthened to witness the seed payload before
   deletion and its absence afterward. The independently retained fork is
   checked separately.
6. Independent review reproduced a false-isolation counterexample using two
   different native sessions. The final peer phase also asserts both expected
   participant identities and the original session resource before accepting
   the metadata result. Review also identified inherited profile overrides
   that outrank the command-line data directory, unhandled logging errors,
   and process-group exit races. An allowlisted environment and owned-process
   lifecycle now address those cases; fault-injection regressions reproduce
   the original failures without launching a real host or signaling a process.
7. Repository review identified the allocated-port handoff race and immediate
   rejection after a failed termination signal. The final driver verifies its
   per-run window token twice before acting and waits for a bounded cleanup
   result. Additional regressions reject an unrelated endpoint and changed
   document identity, and verify both early close and cleanup deadline paths.
   Token-count accounting and proposal evidence were also made explicit.

These observations are tied to the measured builds. They are not generalized
as stable extension contracts or as a substitute for testing a future host.

## Reproduction and artifact handling

From the repository root with Node.js 24 and installed root dependencies:

```sh
npm ci
npm run probe:native-continuity
```

The runner defaults to the standard macOS Stable application. Set
`VSCODE_EXECUTABLE_PATH` to another compatible installed desktop executable to
repeat the measurement. Do not set `--extensionTestsPath` or reuse a normal
profile. The command opens isolated development windows and terminates each
owned application between phases; it does not modify a running user's host.

The command prints its newly owned artifact directory, seven phase summaries,
and a final `summary.json`. Each phase retains evidence and a host log. Review
the statuses, boot-key distinction, zero model calls, absent Copilot/proposals,
and the three payload witness fields. The runner exits nonzero for failed
assertions or a host timeout. Artifacts may contain generated absolute paths
and host diagnostics; inspect locally and do not commit or publish raw logs.

Root `typecheck` and `lint` include the typed probe, and **18 non-GUI regression
cases** run in the root test suite. They cover inherited environment isolation,
log-open gating, log failure cleanup, bounded termination races/errors,
endpoint identity, model/token accounting, proposal evidence, and rejection
of incorrect participant/session evidence. The GUI continuity run is
**manual**, not an additional CI claim. The new private manifest declares no
dependencies and adds no third dependency graph or lockfile. Normal product
build and package allowlists continue to exclude all POC code.

## Remaining gate before product implementation

A separately reviewed historical-checkpoint design must still specify a
closed minimized schema, size/retention limits, fork-as-history semantics,
unsupported/corrupt history handling, and explicit user reconfirmation.
Historical content must never mint a scope, grant, ownership, or replay right.
Native retention/deletion behavior must be disclosed instead of promising that
Pair can independently erase copies it does not own.

The intended **authenticated Copilot native Agent route** needs its own
consented, isolated end-to-end experiment: invoke actual Pair extension tools
from the selected custom agent, restart and reopen that native session, and
verify public identity/binding, cancellation, pending-effect handling,
permissions, context boundaries, and coexistence without hidden APIs. Include
fork/delete and target-switch behavior. The current fixture intentionally
cannot answer those questions.

Do not begin a production disk adapter merely because these native gates are
open. Conversely, do not wire native metadata into the P2b storage port or
restore live Pair authority because this narrower experiment passed. The
feasibility PR must be reviewed on its own terms; neither merging it nor
the completed P2b plan approves that next implementation milestone.
