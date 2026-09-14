# Adaptive Pair — Growth Mode preview

This is a preview of the Adaptive Pair **Stable Growth** experience. It adds an
opt-in Pair Presence layer and a `@pair` Growth Mode chat participant to Visual
Studio Code. Everything below describes behavior that is implemented and
observed in this preview; it makes no claim about learning or productivity
outcomes.

## What this preview does and does not change

Installing Adaptive Pair is additive and opt-in. It does **not** replace or
reconfigure existing Visual Studio Code or GitHub Copilot Chat behavior, and it
does not change any other extension, Session Target, chat participant, language
model tool, session, setting, keybinding, default selection, or native VS Code
UI. Its only contributions are namespaced: the `adaptivePair.*` commands, the
`adaptive_pair_*` language model tools, and the `@pair` chat participant.

Before you explicitly enable Pair Presence, the extension does nothing
observable: it registers no document listener, starts no timer, reads no
workspace content, makes no model request, and performs no network request.

## Controls

Pair Presence is driven by namespaced commands (Command Palette):

| Control | Command | Effect |
| --- | --- | --- |
| Enable | `Adaptive Pair: Enable Presence` | Turns on the ambient presence layer in a trusted workspace. |
| Stay quiet | `Adaptive Pair: Stay Quiet` | Keeps Presence on but silences proactive nudges. |
| Pause | `Adaptive Pair: Pause Presence` | Suspends observation and any in-flight work unit. |
| Join | `Adaptive Pair: Join Work in Progress` | Captures a bounded local entry snapshot of your current work. |
| Start | `Adaptive Pair: Start a Session` | Starts a Pair session for a fresh piece of work. |
| Disable | `Adaptive Pair: Disable Presence and Clear Continuity` | Disables Presence and deletes the local Pair journal. |

Growth guidance is requested through the `@pair` chat participant. Every slash
command below has an implemented, deterministic route, and each one also has a
natural-language equivalent:

| Command | Natural phrasing | What it actually does |
| --- | --- | --- |
| `/brief` | "what is my current task?" | Reports the agreed goal, criteria, work unit, scope, verification plan, and hint ceiling from current core state. No model call. |
| `/attempt` | "I tried …" | Records your attempt, which is required before hint level 2 or higher. |
| `/hypothesis` | "I think the cause is …" | Records your diagnosis. Diagnosis stays yours. |
| `/hint` | "give me a hint" | Escalates one bounded hint level and returns a guarded response. |
| `/reveal` | "show me the solution" | Asks for explicit confirmation, records the authorization, then returns a level-5 response. |
| `/check` | "run the verification" | Runs the agreed verification plan through the real effect port and reports only the observed product result. No model call. |
| `/transfer` | "give me something to try on my own" | Requests one bounded independent variation that must be distinct from the current work-unit objective, and records it as **started, not demonstrated**. |
| `/session` | "show the session status" | Reports mode, work unit, assistance, transfer state, and every outcome field from current core state. No model call. |

`/check` needs an explicit action grant, and the verification runner asks its
own separate confirmation before any process starts. Only an existing root
package script named `test`, `check`, `lint`, `typecheck`, or `build` (with an
optional `:suffix`) can be run; anything else is refused rather than guessed.

## Walkthroughs

### Greenfield (start new work)

1. Open a trusted workspace and run `Adaptive Pair: Enable Presence`.
2. Run `Adaptive Pair: Start a Session`.
3. In chat, use `@pair /brief` to frame the work, agree a Growth work unit, and
   begin. You own every edit; Adaptive Pair never writes to your files in Growth
   Mode.

### Join in progress

1. With Presence enabled, open the file you are already working on.
2. Run `Adaptive Pair: Join Work in Progress` to capture a bounded entry
   snapshot (open paths, dirty paths, diagnostics, and git metadata only — never
   raw file contents or keystrokes). Capturing context never grants edit
   authority.
3. Continue with `@pair` for hints while you keep ownership of the code.

## Growth hint and reveal behavior

Growth Mode escalates assistance in graduated levels. The first hint is a
question-level nudge; higher levels require you to record an attempt first, and
a full solution requires an explicit reveal that records your authorization
before a level-5 response. Every model response is checked against the current
hint ceiling; a response that exceeds the boundary is withheld and your work is
left unchanged. Repository text, tool output, or conversation content cannot
change the mode, owner, scope, consent, or hint ceiling — it is treated as
untrusted data.

## Product verification and the five Growth fields

**Product verification is separate from Growth.** The product verdict is derived
only from an observed verification result (a real process exit code), never from
model prose — and a passing check never marks any Growth outcome.

Growth is reported as exactly five fields, each recorded independently:

1. **Similar generation** — demonstrated / not demonstrated / not assessed.
2. **Varied debugging** — demonstrated / not demonstrated / not assessed.
3. **Explanation** — demonstrated / not demonstrated / not assessed.
4. **Meaningful authorship** — demonstrated / not demonstrated / not assessed.
5. **Next-assistance proposal** — less / unchanged / more / not assessed.

The Growth verdict is `verified` only when the four demonstration fields are all
`demonstrated`. The fifth field, the next-assistance proposal, is a separate and
correctable suggestion that never changes the product or Growth verdict.

Every field starts as **not assessed** and stays that way until its own
demonstration is recorded. In particular, **starting a transfer task
demonstrates nothing**: `/transfer` records a `transfer-started` state that is
explicitly `demonstrated: false`, and a skipped or merely started transfer check
is reported as "not assessed" rather than as success.

## Local storage, export, and deletion

- **Storage** — Pair continuity is a local, append-only journal in the
  extension's own global storage. It stores bounded edit-episode metadata (file
  path, language id, document versions, and changed line ranges) with a hash
  chain; it refuses to serialize raw content, multi-line text, absolute paths,
  or strings longer than 500 characters.
- **Reconciliation** — on restart, the persisted journal is replayed and
  reconciled so continuity survives a host reload.
- **Export** — an evaluation export is rendered in an unsaved editor for your
  review before you choose any destination; nothing is written to disk on your
  behalf.
- **Deletion** — `Adaptive Pair: Disable Presence and Clear Continuity` deletes
  the local journal and clears in-memory Pair state. Your VS Code settings,
  defaults, sessions, and native UI are left unchanged.

## Supported languages and host versions

- **Languages** — local evidence sensors currently target TypeScript and
  JavaScript. The interactive Growth flow (hints, attempts, verification) is
  language-agnostic wherever the host and your package scripts support it.
- **Host versions** — this Stable VSIX targets Visual Studio Code `^1.136.0`. It
  is validated in the isolated Extension Host smoke test on `1.136.2` and
  `1.137.0`, with an allowed-failure Insiders compatibility job.

## Pair Presence vs. Session Target

On the Stable path, **Pair Presence** is the workspace entry point: it is the
ambient layer you enable per workspace. A **Session Target** — which execution
harness runs an agent — is a separate execution choice and is not required to
use Pair Presence.

An experimental **Adaptive Pair Session Target** exists as a proof of concept
under `poc/session-target`. It is **not** part of this Stable VSIX. It relies on
the proposed `chatSessionsProvider` and `chatProvider` extension APIs, is
subject to change, is supported for third-party development only in VS Code
**Insiders**, and requires launching Insiders with `--enable-proposed-api`. This
Stable VSIX intentionally contains no `enabledApiProposals` and no
`contributes.chatSessions`.

## Known limitations

- Growth Mode is the only implemented mode. Pair Mode AI edits, Delivery Mode
  commands, and the native Agent Plugin are out of scope for this preview; their
  tools are declined by the Stable shell.
- The AI never applies edits or runs delivery commands in this preview:
  `adaptive_pair_apply_edit` and `adaptive_pair_run_command` are unavailable and
  rejected in Growth Mode.
- Observed verification uses an allowlisted root package script
  (`test`, `check`, `lint`, `typecheck`, or `build`). VS Code Stable exposes no
  documented consumer API to run another provider's selected tests and observe
  their results, so the preview never uses `testing.*` commands and never infers
  success from a selected-test run; package scripts are the observed
  verification path.
- Pair continuity is local only. There is no cloud sync, telemetry, or network
  activity.
- `/transfer` starts an independent variation and records only that it started.
  Completing a transfer, and any resulting Growth demonstration, is not
  implemented in this preview and is never claimed.
- The `adaptive_pair_accept_handoff` and `adaptive_pair_record_transfer` tools
  are contributed for forward compatibility but are not routable in this
  preview; the policy hides them in every current mode.
- This preview makes no claim that it improves learning or productivity.

## License

Apache-2.0. See `LICENSE`.
