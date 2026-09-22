# Adaptive Pair — Native Growth trial

Version **0.2.0-preview.2** adds deterministic native setup, a small human-repair
exercise, and explicit checkpoint/history routes to the Stable Growth preview.
The AI remains a read-only navigator. Product correctness and learning outcomes
are separate; this trial makes no learning or productivity claim.

**Evidence status:** the route contract and disposable exercise checks are
implemented. Native checkpoint/reopen checks passed across separate application
launches on **VS Code 1.136.2, 1.138.0, and 1.139.0-insider**, with no restored
live authority. Local root/POC checks, refreshed dependency audits, and Stable
packaging pass. Whole-branch PR review/CI and authenticated account/selected-model
inference remain **pending**. See [observed host evidence](#observed-host-evidence): these
zero-model-call runs and injected fixture models are not authenticated inference.

## Install and prerequisites

- Use VS Code Stable compatible with the extension's `^1.136.0` engine range.
  No proposed API, Session Target, SDK, or replacement chat UI is required.
- Open **regular local VS Code Chat**, choose **Ask** mode, and invoke `@pair`
  there. Do not use Copilot CLI, another Session Target, or your current
  Agents-provider conversation for this measured trial. You choose the model,
  local chat session, and mode explicitly; Pair never switches them or changes
  your defaults automatically.
- Use Node.js **24 or later** and npm, available to VS Code's terminal and
  verification process. The exercise's only script is `npm test` (`node --test`).
- For model guidance, obtain access to the selected model and its provider in
  native Chat. A Copilot-hosted model requires Copilot sign-in and entitlement;
  other providers have their own access requirements. Pair uses the request's
  selected model and adds no authentication flow. Installation grants no account
  access, quota, or model consent.
  Setup, state, checkpoint, and history routes make no model call, but still need
  a host in which the native participant is accessible.
- Open only a workspace you trust. Keep private code and credentials out of this
  exercise. Model-provider permission, Pair's workspace-disclosure consent, setup
  confirmations, and process authorization are separate decisions.

Install the trial through **Extensions: Install from VSIX...**. The target
release artifact is `adaptive-pair-0.2.0-preview.2-stable.vsix`. To build from a
repository checkout, run these commands at the repository root:

```sh
npm ci
npm run typecheck
npm run package
```

The packaging entry point builds, stages the documentation, and verifies the
archive. Select the VSIX path it prints and check that the installed extension
version is `0.2.0-preview.2`. These development dependencies belong to the
repository, **not** the exercise. Final combined package and release validation
remain release gates; do not infer them from the instructions alone.

## Prepare a fresh exercise copy

The source checkout includes `examples/growth-trial`. It is
separate from the VSIX and is never installed into another workspace by Pair.
Keep the repository fixture unchanged so future trials begin with the same bug.

From the repository root, copy only the package, source, and tests into a new
temporary directory. On macOS or Linux:

```sh
trial_root="$(mktemp -d "${TMPDIR:-/tmp}/adaptive-pair-growth.XXXXXX")"
cp examples/growth-trial/package.json "$trial_root/"
cp -R examples/growth-trial/src examples/growth-trial/test "$trial_root/"
code --new-window "$trial_root"
```

On Windows, use PowerShell:

```powershell
$trialRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("adaptive-pair-growth-" + [System.Guid]::NewGuid())
New-Item -ItemType Directory -Path $trialRoot | Out-Null
Copy-Item examples/growth-trial/package.json $trialRoot
Copy-Item examples/growth-trial/src, examples/growth-trial/test $trialRoot -Recurse
code --new-window $trialRoot
```

If the `code` command is unavailable, use VS Code's **Open Folder** on the new
directory. It must be the workspace root, not a subfolder of the monorepo.
The repository's example `tsconfig.json` uses repository development tooling
for typed linting and is deliberately not copied. No npm installation, lockfile,
or editor extension is required to run this dependency-free Node exercise.

In the copied workspace's terminal, run:

```sh
node --version
npm test
```

Expect **2 passing and 4 failing tests**, with exit code **1**. These are the
deliberate retry-boundary failures for zero and positive integer limits, not an
installation error. Read the tests and trace the behavior yourself. Do not
change the tests to hide the failure. This walkthrough intentionally withholds
the repair.

## Native first-use walkthrough

1. Trust the copied workspace, then run **Adaptive Pair: Enable Presence** from
   the Command Palette. Installation alone never enables observation.
2. Run **Adaptive Pair: Start a Session**. This enters briefing; it does not
   establish a learning agreement or an operational work unit.
3. In **regular local VS Code Chat** with **Ask** selected, send
   **`@pair /setup`**. Use the native prompts to enter a bounded objective,
   choose one eligible file, describe an independent variation, and select the
   verification expression. For this exercise, use:

   | Setup input | Trial value |
   | --- | --- |
   | Objective | Repair the retry attempt limit myself and explain the observed behavior. |
   | Selected file | `src/retry.mjs` in the copied workspace |
   | Independent variation | Predict and check a different positive attempt limit without hints. |
   | Verification plan | `npm test` |

4. Review **three separate native Continue once confirmations**: first the
   **learning agreement**, including human-owned implementation, diagnosis, and
   repair, the independent variation, and hint ceiling **4**; then **Growth
   mode**, with you as the sole edit owner; then the **work-unit agreement**,
   including the objective, selected file, and verification plan. Decline any
   decision you do not agree with. No model grants these decisions. Setup checks
   the plan's syntax; it does not prove that the script exists or passes.
5. Send **`@pair /brief`** and check the agreed file, objective, verification plan,
   and ceiling. This reads current core state without a model request. Do not
   ask an unconstrained model prompt to bootstrap the agreement: guidance is
   intentionally gated until native setup completes.
6. Make your own attempt in the copied source and save it. Send **`@pair /attempt`
   followed by an honest description of what you tried**, and record your
   diagnosis with **`@pair /hypothesis`**. Review any action confirmation. A typed
   description is your report, not independent proof of learning.
7. If you need help, send **`@pair /hint`**. It uses the model selected in native
   Chat, subject to account availability, provider permission, Pair's scoped
   disclosure consent, and the current assistance gates. Review each prompt;
   do not grant consent merely to follow this walkthrough. A missing model or
   declined prompt is not a successful hint. You still own diagnosis and edits.
8. Make and save the repair yourself. Send **`@pair /check`**: this explicit user
   request supplies the action grant directly. Review the runner's **one
   separate process-confirmation modal per run**, then inspect the observed
   result. There is no additional action-confirmation modal on this direct route.
   The unchanged task fails; the intended human repair
   makes `npm test` report **6 passing tests**, with exit code **0**. A manual
   terminal run does not automatically become Pair's observed product verdict.
   A passing check never marks a Growth outcome.
9. Inspect **`@pair /session`**, then continue to the explicit checkpoint and
   reopen procedure. No checkpoint is written automatically after a turn.

For work already in progress, the same enable/start/setup sequence applies.
**Adaptive Pair: Join Work in Progress** captures a bounded local entry or
resumes a paused session; it grants no new agreement or edit authority. Setup
does not overwrite an operational work unit. Use the full reset below when you
need a different task or scope.

## Checkpoint, history, and a fresh runtime

1. With Presence enabled and a live Growth work unit, send **`@pair /checkpoint`**.
   Read its separate confirmation: a minimized record will be attached to this
   response and retained under **VS Code's native chat-history controls**.
2. Confirm only if you want that attachment. Declining, cancelling, pausing,
   disabling, or changing the relevant session state during confirmation returns
   no checkpoint. A save response acknowledges metadata attachment, **not atomic
   disk publication, crash durability, or permission to resume work**.
3. Send **`@pair /history`** in the same chat. If checkpoint metadata is available,
   it renders a deterministic **historical report, not live state or verified
   evidence**. It does not call a model or run a tool.
4. To exercise a fresh runtime, reload the VS Code window or close and reopen
   the workspace, then reopen the previous chat using VS Code's native history
   UI. This sequence has been observed on VS Code 1.136.2 and 1.138.0; it is not
   a promise of crash durability or identical behavior on every host version.
   Merely switching or forking chats in the existing window is not a runtime
   restart: the live Pair runtime is workspace-window scoped, not per chat.
5. Enable Presence explicitly before asking **`@pair /history`** again. If the
   host supplies the old metadata, its attempt/hypothesis flags and hint level
   are historical only. If metadata is absent or invalid, an empty/unavailable
   report is the safe result; old prompt text is not a substitute.
6. Ask **`@pair /session`** to inspect the current window's live state. The fresh
   runtime has no restored work unit, scope, consent, grant, attempt gate, or
   verification result from that checkpoint. Historical flags never authorize
   a hint, check, model call, or workspace access.
7. To continue work, explicitly start a new session and repeat **`@pair /setup`**
   with all three fresh confirmations. Record a new attempt before higher hints
   and rerun verification with its own process confirmation. This is a new
   agreement, **not resumed authority**.

The checkpoint is a closed **version 1** object capped at **512 UTF-8 bytes**.
It contains a format marker, mode, work-unit status, maximum hint level,
attempt/hypothesis flags, hint level, and whether a solution was revealed. It
contains no paths, file content, objective, summaries, identifiers, timestamps,
hashes, grants, baselines, verification results, or learning-outcome claims.

`/history` examines only the latest **32 total native chat turns** and only
metadata from this participant's responses. An invalid or unsupported newest
owned checkpoint is unavailable; it does not silently fall back to an older
one. Another participant's metadata and prompt text are ignored. Checkpoint
metadata is excluded from model-context construction. Native copies/forks may
carry a historical report, but never create or identify live Pair authority.

## Cancellation, pause, and reset

- Cancel a setup input or decline a confirmation to stop that action. Partial
  setup is not reported as complete. Inspect `/session`; a still-briefing
  session can retry `/setup` only with fresh confirmations. Workspace changes,
  pause, disable, session replacement, and conflicting turns invalidate pending
  setup or checkpoint decisions rather than transferring their authority.
- Use native Chat cancellation to cancel a pending turn. An interrupted or
  unconfirmed check is not a passing product result; inspect the outcome before
  explicitly retrying it.
- **Adaptive Pair: Stay Quiet** suppresses proactive nudges while leaving
  Presence on. **Adaptive Pair: Pause Presence** suspends observation and
  in-flight work. **Adaptive Pair: Join Work in Progress** is the resume entry;
  pausing is not a full reset.
- For a full Pair reset, run **Adaptive Pair: Disable Presence and Clear
  Continuity**, then enable Presence, start a session, and run `/setup` again.
  Disable deletes Pair's owned local observation journal and clears its live
  state. It does **not** revert your edits or delete native chat history.
- To restart the exercise from its original bug, make another fresh temporary
  copy. To remove a native checkpoint, manage/delete its chat through VS Code's
  native UI. Independently retained forks, copies, and backups are outside
  Pair's erasure claim.

## Public routes and permission boundaries

| Route | Behavior |
| --- | --- |
| `/setup` | Collects one scoped Growth task and requests three native confirmations; no model call. |
| `/brief` | Reports the current agreed task, scope, verification, and ceiling; no model call. |
| `/attempt` | Records your attempt; required before hint level 2 or higher. |
| `/hypothesis` | Records your diagnosis without transferring diagnosis ownership. |
| `/hint` | Requests bounded guidance within the agreed ceiling; no AI edits. |
| `/reveal` | A separate explicit reveal request, never a bypass of the agreed ceiling. The trial ceiling is 4; a level-5 solution is not part of this walkthrough. |
| `/check` | The direct request supplies the action grant; one separate runner modal confirms process execution per run. Reports only the observed product result. |
| `/transfer` | Requests a distinct independent variation and records it as started, not demonstrated. |
| `/checkpoint` | Explicitly confirms minimized response metadata; no model call or Pair disk store. |
| `/history` | Reports selected-chat history without restoring current authority; no model call. |
| `/session` | Reports the current window runtime, assistance, transfer, and separate outcomes; no model call. |

`/check` runs only an existing root package script named `test`, `check`, `lint`,
`typecheck`, or `build`, optionally with a `:suffix`. It does not guess a missing
script, execute arbitrary shell text, or infer success from a model statement.
The allowed expression in setup is not process authorization.

Only operational public tools are contributed: Pair state, bounded scoped
read/search, agreed verification, and session close. Human attempt, diagnosis,
hint, and reveal transitions remain on controlled routes, not generic tools
through which a model could author human learning evidence. Repository text,
tool output, and chat content are untrusted data, never permissions. Guidance
that exceeds the current restraint boundary is withheld.

## Product verification and the five Growth fields

Product verification comes only from an observed process result, not model
prose, checkpoint metadata, or a historical passing check. The five Growth
fields are independent:

1. **Similar generation** — demonstrated / not demonstrated / not assessed.
2. **Varied debugging** — demonstrated / not demonstrated / not assessed.
3. **Explanation** — demonstrated / not demonstrated / not assessed.
4. **Meaningful authorship** — demonstrated / not demonstrated / not assessed.
5. **Next-assistance proposal** — less / unchanged / more / not assessed.

Each starts as **not assessed** until its own demonstration is recorded. A
Growth verdict requires all four demonstration fields; the next-assistance
proposal is a separate, correctable suggestion. Starting `/transfer` proves
none of them. Transfer completion and recording its resulting demonstrations
are not implemented in this preview.

## Data ownership and additive integration

Pair's local journal stores bounded edit-episode metadata, not raw content or
an authoritative live session. Replaying that observation journal cannot
restore grants, ownership, or work-unit authority. The checkpoint feature adds
no Pair disk adapter and does not implement P2b restart admission.

VS Code owns native chat reopening, copying/forking, retention, and deletion.
Minimizing checkpoint fields does **not** minimize ordinary prompts and
responses retained in the native transcript. Disabling Pair leaves that history
under the host's controls.

Installing Pair does not change another extension, Session Target, participant,
tool, session, setting, keybinding, default selection, or native UI behavior.
Before explicit enablement, Pair registers no document listeners, starts no
timers, reads no workspace content, makes no model calls, and performs no network
activity. User-requested, separately authorized model guidance can use the
selected provider's network service; there is no Pair cloud sync or telemetry.

## Observed host evidence

Each supported test host passed the existing **17 isolated smoke tests**, then
two clean application launches using production participant wiring in an
isolated profile, with regular local VS Code Chat in **Ask** mode:

| VS Code | Embedded Node.js | Runner Node.js | Native history result |
| --- | --- | --- | --- |
| 1.136.2 | 24.18.1 | 24.21.0 | Checkpoint returned after reopening; no live authority restored. |
| 1.138.0 | 24.18.1 | 24.21.0 | Checkpoint returned after reopening; no live authority restored. |
| 1.139.0-insider | 24.20.0 | 24.21.0 | Checkpoint returned after reopening; no live authority restored. |

The first launch submitted real native `/setup` requests, cancelled a partial
setup, then completed a retry with three fresh confirmations. It observed a real
exercise `/check` fail, made a test-driver human-like edit, and observed the next
check pass, with two process confirmations across those two runs. It recorded
`/attempt` and `/hypothesis`, declined one checkpoint,
then accepted another. The driver edit is controlled test evidence, not a claim
of an independent human learning outcome or an AI edit in Growth.

The second process reopened the actual native chat. `/history` received its
checkpoint metadata while leaving the fresh live runtime unchanged: no restored
work unit, learning agreement, grants, or assistance. A fresh chat had no
checkpoint. Both launches started with Presence off.

These runs made **zero model and token-count calls**, loaded **no Copilot
extension**, and used **no proposed API**. Private native-chat automation commands
and session-resource diagnostics belong only to the isolated test driver; they
are not production dependencies. The automation runner supports Linux/macOS
POSIX hosts, not Windows host-proof claims. Normal restart/reopen evidence is
not proof of power-loss durability, arbitrary native fork retention, or an
authenticated selected-model response. The latter still needs an owner account
with model access and an explicitly authorized manual trial.

## Preview limits and pending evidence

- **Passed locally:** full typecheck/lint and 2,997 root tests, both dependency
  audits, isolated POC checks, the three-host runs, and the seven-entry Stable
  VSIX inspection. The test driver and its private diagnostics are not shipped.
- **Pending:** whole-branch PR review/final-revision CI and authenticated
  selected-model inference with the owner's account. The
  observed native reopen results are bounded to the hosts and controlled
  scenarios above; fixture
  models and synthetic histories cannot replace that evidence.
- The measured surface is regular local Chat in Ask mode. Fixture proof does
  not establish support for Copilot CLI, another Session Target, or an
  Agents-provider conversation.
- Growth is the only implemented mode. Pair Mode AI edits, Delivery commands,
  and the native Agent Plugin are outside this trial. The AI never edits the
  exercise or changes another participant's behavior.
- There is no live runtime per native chat/fork and no automatic authority
  restoration. A checkpoint attachment is not a crash-durability guarantee.
- Local evidence sensors target JavaScript and TypeScript. Observed verification
  uses root package scripts, not another provider's selected tests or guessed
  native Testing results.
- The evaluation serializer has open-core coverage, but the Stable extension
  exposes no export command or inferred session-level metric export.
- The experimental Session Target remains an isolated Insiders POC under
  `poc/session-target`, not this Stable trial. The Stable VSIX includes neither
  `enabledApiProposals` nor `contributes.chatSessions`.

## License

Apache-2.0. See [LICENSE](../LICENSE).
