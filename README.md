# Adaptive Pair

Keep learning to build software, even when AI can build it for you.

Adaptive Pair is an open-source capability-preserving programming runtime. It
protects opportunities for developers to generate code, encounter failure,
diagnose, repair, and verify for themselves, while still allowing honest pair
work and explicit AI delegation.

Enable it at the start of a product, inside an existing repository, or halfway
through debugging. Pair Presence follows bounded local workspace activity,
stays available beside normal development, and can be quieted or paused without
discarding the task.

It exists because a default coding agent can outsource the whole learning loop,
not just a narrow calculation. Learning to prompt, review, and select AI output
is valuable, but it does not automatically replace the ability to create and
debug software directly.

## Native Growth trial (0.2.0-preview.2)

The trial adds opt-in Pair Presence and a native `@pair` Growth participant to
VS Code Stable. It changes no existing VS Code or GitHub Copilot Chat behavior,
never edits your files, and makes **no learning or productivity claim**. Native
`/setup` establishes the task without a model-generated bootstrap. Explicit
`/checkpoint` and `/history` report historical progress, never restored authority.

**Evidence status:** VS Code **1.136.2, 1.138.0, and 1.139.0-insider** each passed
17 isolated host smokes and a two-launch native checkpoint/reopen check on
macOS and Linux using production wiring.
Historical metadata returned without restoring live authority. Those runs made
zero model and token-count calls, loaded no Copilot extension, and used no
proposed API. At that native-preview revision, the 3,040-test root check, both
dependency audits, and Stable packaging passed. PR #14 tracks review and the
latest revision's delivery checks.
Authenticated selected-model inference remains an explicit owner trial check.
See the [trial walkthrough](docs/growth-preview.md#observed-host-evidence)
for the evidence boundaries and remaining manual checks.

### Codespaces (owner-run)

Use the single [Codespaces walkthrough](docs/growth-preview.md#codespaces-owner-run-trial)
to create the trial under your own account and quota/billing arrangement.
**Until PR #14 is merged:** select `agents/native-growth-trial`, not `main`,
before creating the Codespace; after merge, use the updated `main` branch.
Preparation builds the VSIX and a separate
exercise; installation, opening that folder, sign-in, and Pair enablement stay
explicit. Codespaces UI, authenticated inference, and reconnect/history checks
remain owner acceptance work, not results established by the desktop host tests.

### Local quickstart

Use VS Code Stable compatible with `^1.136.0`, Node.js **24 or later**, and npm.
Install the trial VSIX through **Extensions: Install from VSIX...**; the target
artifact is `adaptive-pair-0.2.0-preview.2-stable.vsix`. See
[installation](docs/growth-preview.md#install-and-prerequisites) to build it.
Model guidance additionally needs access to the selected model and its provider
in native Chat. Selecting a Copilot-hosted model requires the corresponding
Copilot sign-in and entitlement; other providers have their own access
requirements. Pair adds no authentication flow. Availability and provider
consent are separate from Pair's permissions; installing Pair grants none of them.

For this trial, open **ordinary built-in VS Code Chat**, choose **Ask** mode, and
invoke `@pair` there, not in Copilot CLI, another Session Target, or your current
Agents-provider conversation. These are your opt-in UI choices: Pair never
switches your model, session, mode, or defaults automatically. Here, "local Chat"
means that ordinary chat surface, not a requirement for files to reside on your
computer. The observed desktop host evidence covers Chat/Ask, not those other
agent surfaces or Codespaces UI.

From the repository root, make a fresh temporary copy of the exercise and open
that copy as its own workspace. Do not repair the repository fixture:

```sh
trial_root="$(mktemp -d "${TMPDIR:-/tmp}/adaptive-pair-growth.XXXXXX")"
cp examples/growth-trial/package.json "$trial_root/"
cp -R examples/growth-trial/src examples/growth-trial/test "$trial_root/"
code --new-window "$trial_root"
```

The exercise has **zero dependencies and needs no install**. The repository-only
typed-lint project configuration is not needed in this copy. In its terminal,
`npm test` initially reports **2 passing and 4 failing tests** by design.

1. Trust only the copied exercise workspace. Run **Adaptive Pair: Enable
   Presence**, then **Adaptive Pair: Start a Session** from the Command Palette.
2. In that Ask chat, send `@pair /setup`. Enter your repair objective,
   select `src/retry.mjs`, describe an independent variation, and choose
   `npm test` as verification.
3. Review three separate **Continue once** confirmations: the learning
   agreement (hint ceiling **4**), Growth mode (you own edits), and the final
   work-unit scope and verification plan. Starting a session alone is not setup.
4. Use `@pair /brief`, make your own attempt, and record what you actually did
   with `@pair /attempt`. Record your diagnosis with `@pair /hypothesis` and ask
   `@pair /hint` if needed; review selected-model disclosure and action prompts.
5. Repair the copied source yourself, save it, and send `@pair /check`. This
   explicit request supplies the action grant; review the runner's one separate
   process-confirmation modal for that run. The intended repair yields
   **6 passing tests**; a passing product check proves no learning outcome.
6. Send `@pair /checkpoint`, review its separate native-history confirmation,
   then inspect `@pair /history`. VS Code owns retention and deletion. A save
   response is not a disk-durability acknowledgement.
7. To try reopening, reload the window or close and reopen the workspace, then
   reopen the chat using VS Code history. Enable Presence before `/history`.
   Any recovered metadata is historical only; `/session` describes the fresh
   window runtime. Start again and repeat `/setup` with fresh confirmations
   before working. A chat switch or fork alone does not create a new Pair runtime.

Cancel any input or confirmation to stop that action. For a full Pair reset,
run **Adaptive Pair: Disable Presence and Clear Continuity**, then enable,
start, and set up again. Disable clears Pair's local journal and live state,
**not native chat history or your edits**. Use VS Code's native controls to
delete chats. The [walkthrough](docs/growth-preview.md) covers partial setup,
pause/quiet controls, verification failures, observed host evidence, and pending
authenticated account/model inference.

## Why it exists

Coding agents can now interpret a problem, choose an approach, generate code,
find errors, debug, write tests, and explain the result. Used only for task
completion, they can remove most of the attempt-feedback-repair loop through
which developers form practical skill.

This does not mean developers learn nothing with AI. They can become better at
request decomposition, agent steering, code review, and choosing among
proposals. Adaptive Pair exists because those capabilities do not automatically
replace direct code generation, debugging, language fluency, design
internalization, or confidence built by resolving a block.

A 2026 randomized experiment with 52 experienced Python users who were new to
Trio found a roughly 17-percentage-point lower immediate assessment score for
the AI-assisted group and no statistically significant main-task acceleration.
Observed participants who emphasized conceptual questions or explanations
scored better than those who relied on code and debugging completion, but those
usage patterns were not separately randomized. The result is a warning to
preserve direct practice, not proof that one Adaptive Pair mode causes learning.
See the [research and limitations](docs/research.md#coding-specific-support).

Adaptive Pair is therefore pro-AI and pro-capability: use delegation when it is
valuable, pair when shared work is valuable, and protect direct practice when
the developer wants to learn or remain fluent.

## Product direction

v2 is a complete redesign around a host-agnostic open core:

- deterministic session, work-unit, edit-authority, and recovery state
  machines;
- Growth, Pair, and Delivery as explicit operating modes;
- learning agreements, progressive hints, solution-reveal boundaries, and
  independent transfer checks;
- a versioned harness kernel that compiles mode instructions and tool
  capabilities from the same Pair state;
- Driver/Navigator ownership and optional collaboration cadences on one core;
- local-first editor and compiler evidence;
- explicit, local-first Pair Presence for greenfield, existing, and
  join-in-progress work;
- replaceable VS Code, Agent Plugin, model, storage, and profile adapters;
- local evaluation with no telemetry upload by default.

VS Code is the first host. GitHub Copilot and hosted models are optional
adapters, not owners of product state.

Codex, Copilot, and other coding agents are examples, not the product
definition. The same mode contracts apply regardless of which agent or model
executes them.

## Three honest modes

### Practice/Growth

The developer is the only edit owner. AI stays a read-only navigator, gives
progressive hints instead of a target solution, waits for a human attempt and
diagnosis, and ends with a varied task that the developer performs without AI
mutation.

### Pair

Human and AI alternate meaningful work units with one explicit driver at a
time. One side does not silently own design, tests, implementation, diagnosis,
repair, and verification for an entire learning-relevant sequence.

### Delivery

Familiar or mechanical work can be delegated for productivity. Scope,
conflict, privacy, and verification controls remain, but the product labels the
session as delivery and makes no growth or balanced-pair claim.

The choice is based on the current learning value of doing the work personally,
not merely on whether AI can complete it.

## What makes it controlled collaboration

- Both the developer and AI can drive an agreed work unit.
- Only one participant owns edits within that unit.
- Both can ask questions, challenge direction, and propose a handoff.
- Human pause or takeover immediately removes future AI edit authority.
- Applied edits and observed checks are shown separately from model claims.
- Conflicts, late results, reconnects, and uncertain completion have explicit
  recovery behavior.
- Personal preferences are explicit, correctable, local by default, and never
  stored in the repository.
- Existing and in-progress edits remain developer-owned until a new work unit
  explicitly says otherwise.

## Stable v2.0

Previews build Growth, Pair, then Delivery in sequence. Stable v2.0 ships only
when all three mode contracts complete end to end:

```text
brief task and learning value
  -> agree on a work unit
  -> attempt, pair, or delegate according to mode
  -> verify the actual result
  -> independently check growth when promised
  -> hand off, switch mode, pause, or continue
  -> report product and capability outcomes separately
  -> resume safely after interruption
```

Ping-Pong TDD and additional collaboration cadences can be added without a
second session engine after v2.0.

## Architecture

The open-source Pair Runtime is the source of truth. One VS Code extension
contains the runtime, tools, local sensors, inline UI, `@pair`, and the
experimental Session Target adapter.

Native model selection, streaming, confirmations, diffs, and session UX are
reused. Workspace read, edit, verification, terminal, web, and MCP tools are
wrapped or excluded whenever they could bypass the active mode, owner, scope,
consent, or recovery contract.

Native integration is capability-gated. When the host cannot enforce the
pairing invariants, Adaptive Pair uses its controlled surface or safely degrades
to Human Driver / AI Navigator instead of claiming unsupported AI edit control.

## VS Code entry

The current trial uses the native `@pair` quickstart above. The broader Agent
and Session Target integration described here is design direction, not a
requirement or a completed feature of this Growth trial.

The `Copilot / Claude / Codex / Local` **Session Target** control chooses the
execution harness. On the stable integration path, Adaptive Pair does not
replace that choice.

1. Enable **Pair Presence** for the workspace or select **Pair here** while
   already working.
2. Keep or choose the Session Target that should execute the agent.
3. Select **Adaptive Pair** under the separate Agent control when supported, or
   use `@pair` as the controlled fallback.
4. Select or restore Growth, Pair, or Delivery inside the Pair session.
5. Choose the model and native permission level independently.

This separation lets the same Pair state and learning contract work across
supported agents instead of binding the product to one harness.

An **Adaptive Pair** Session Target is also technically possible through VS
Code's proposed `chatSessionsProvider` API. The v2 plan includes an Insiders
proof of concept because a dedicated target could give Adaptive Pair direct
control over instructions, tools, restraint, and session handling. The API is
not yet suitable as the only Stable or Marketplace entry: third-party proposed
APIs require Insiders and explicit `--enable-proposed-api` activation.

The executable POC now confirms native target-action registration,
target-scoped model selection, session materialization, content-provider
loading, and dynamic-participant request completion in an isolated VS Code
Insiders Extension Host. Persisted history, Pair tool routing, native
interruption, and visual coexistence review remain open.

Follow the time-boxed
[Session Target technical spike](docs/spikes/platform-adaptive-pair-session-target-spike.md)
for the prototype criteria and current evidence.
The POC source and reproduction steps are under
[poc/session-target](poc/session-target/).

The planned channel split is:

| Artifact | Use |
|---|---|
| `adaptive-pair-<version>-stable.vsix` | Stable APIs, Pair Presence, Pair tools, and `@pair`; Marketplace candidate |
| `adaptive-pair-<version>-insiders.vsix` | The same product plus the proposed Adaptive Pair Session Target |

Only the Stable product package is part of this trial; the isolated Session
Target POC is not an installable second product channel. The proposed channels
would share one extension ID and be alternatives, not two required installations.
An Agent Plugin remains future integration work, not a trial prerequisite.

## Additive, not a replacement

Installing Adaptive Pair must not change ordinary VS Code or GitHub Copilot
Chat behavior.

- It does not modify `chat.*`, `github.copilot.*`, Claude, or Codex settings.
- It does not change the default Session Target, Agent, model, permissions,
  keybindings, or code-isolation choice.
- It does not intercept another participant's prompt, command, tool, session,
  or response.
- It contributes only namespaced commands, tools, status, `@pair`, and the
  optional Adaptive Pair target.
- Presence, observation, model calls, and workspace reads remain off until the
  developer explicitly enables or selects Adaptive Pair.
- `@pair` is explicit and is not registered for automatic participant routing.
- Quiet, pause, and disable affect only Adaptive Pair behavior. **Disable and
  Clear Pair Data** removes its persisted state; uninstall removes its
  contributions without touching another product.
- Existing Copilot, Claude, Codex, Local, and Cloud sessions remain readable
  and usable before, during, and after Adaptive Pair use.

The Session Target proof must demonstrate that Adaptive Pair is added beside
existing targets, never in place of them.

## Product quality

Every mode must still produce professionally reviewable software. Adaptive
Pair reports product completion only from observed files and verification, not
from model prose.

Release candidates are compared with the underlying native agent on the same
tasks for correctness, regression coverage, maintainability, security,
review/rework burden, elapsed time, and developer effort. Growth outcomes are
reported separately: green tests alone do not prove learning, and learning
controls do not excuse a broken product result.

Read the complete initial [product and system design](docs/design.md).
Dependency and platform versions are not frozen. Necessary security,
compatibility, and version updates follow the
[maintenance policy](docs/design.md#dependency-and-version-maintenance) and
must pass the affected regression checks.
The [sequential roadmap](docs/design.md#sequential-delivery-roadmap) covers the
remaining work through v2.0. The current
[P2b persistence and restart contract plan](docs/implementation-plan.md) is
complete and merged (PR #12), following P2a (PR #11). P2a supplies bounded journal parsing and
read-only inspection, not a durable store or working resume feature. P2b adds a
separate closed, minimized journal format, exact historical replay, trusted
candidate projection with explicit commit resolution, and a non-authorizing
restart assessment. The separate storage port has a test-only fault model;
it is not a disk adapter or a second application-wired journal. No existing
journal is serialized wholesale, and no recovered record grants live authority.
Disk storage, live restoration, Pair ownership/handoff, and P3 editing/UI retain
their separate design, review, verification, and merge gates.

Before choosing another store, the
[native continuity feasibility probe](docs/spikes/native-session-continuity-spike.md)
passes seven restart/fork/isolation/deletion phases on two Stable VS Code hosts.
This supports native-first historical checkpoints for a controlled participant;
it does **not** prove authenticated Copilot Agent integration, durable Pair
authority, or automatic resume. No production persistence behavior changes.

The [two-layer reuse investigation](docs/spikes/api-copilot-runtime-reuse-spike.md)
also verifies the real Copilot SDK runtime with a deterministic local model:
tool restrictions, effect denial, restart, fresh permissions, and cooperative
cancellation. SDK/CLI sessions are not VS Code Local sessions, and failed hooks
are not an authority boundary. Authenticated native Agent integration remains
unproven; neither experiment wires a new product adapter.

## Development checks

Use Node.js 24 or later. Install all three maintained dependency graphs before
running the complete checks; both isolated dependency-bearing POCs are
deliberately outside npm workspace globs. The separate Growth exercise is
dependency-free and needs no install or lockfile:

```sh
npm ci
npm --prefix poc/session-target ci
npm --prefix poc/copilot-runtime-reuse ci
npm run check
npm --prefix poc/session-target run check
npm --prefix poc/copilot-runtime-reuse run check
```

`npm run check` runs workspace typechecking, ESLint, and the test suite,
including the dependency-free native continuity probe's non-GUI regressions.
Run its isolated desktop experiment explicitly with
`npm run probe:native-continuity`; it is not part of GUI CI.
The Copilot runtime suite uses synthetic loopback responses, requires no login
or paid model, and runs in CI on POSIX. It does not exercise the native Agent UI.
`npm run lint` also includes `examples`, both dependency-bearing POCs' authored
source/tests, the native continuity probe, host fixtures, and root/POC lint and
test configurations. Production,
regular tests, and the Growth exercise require typed linting; standalone
configurations and intentionally incomplete host fixtures use syntactic rules
with the same size limits. Only host-fixture function parameters may be unused,
preserving the bug the host scenarios repair. The root exercise acceptance test
expects its deliberate failures, verifies a repair only in a disposable copy,
and checks that the shipped fixture remains unchanged.
Dependency-boundary tests compare actual imports, manifests, and TypeScript
project references, including declaration and direction checks for reference-only
edges.

| Maintained code | Maximum effective lines/file | Maximum effective lines/function |
|---|---:|---:|
| Production code, release scripts, and configurations | 400 | 100 |
| Tests, shared fixtures, and host smoke cases | 600 | 200 |

Only blank and comment-only lines are discounted; immediately invoked functions
are checked too. Oversized code must be split
by responsibility, not exempted or compressed into dense statements. Inline
ESLint suppression is disabled and warnings fail the lint command. Generated
artifacts and vendored upstream declarations are not authored-code targets.
These limits are a backstop, not proof of good architecture; the
[practical architecture contract](docs/design.md#510-maintainable-boundaries)
also requires cohesive modules and preserved behavior.

## Research

The [research and platform rationale](docs/research.md) covers:

- pair-programming evidence and its limits;
- human-AI programming productivity, skill, usability, and security studies;
- current VS Code Agent, custom-agent, tool, plugin, approval, and host APIs;
- the design decisions and evaluation hypotheses derived from that evidence.

The project does not claim that one pairing style is universally best, or that
AI universally improves speed, quality, learning, or satisfaction.

## Project status

This branch contains the initial v2 design and the installable **Stable Growth
Mode preview** (Foundation Tasks 1–12): the Pair
Presence shell, the versioned harness kernel, the in-memory authoritative runtime, Growth
restraint, join-in-progress capture, observed verification, and a clean-profile
Extension Host smoke plus packaging and CI. Pair Mode AI edits, Delivery Mode
commands, and the native Agent Plugin remain out of scope for this preview.

The `0.2.0-preview.2` native Growth trial adds deterministic `/setup`, an
independent retry exercise, and explicit minimized `/checkpoint` and `/history`
routes. Native checkpoint/reopen checks passed on VS Code 1.136.2, 1.138.0, and
1.139.0-insider on macOS and Linux. Local checks, refreshed audits, and Stable
packaging pass; PR #14 records review and the latest revision's CI.
Authenticated account/model inference remains a manual trial check. Earlier
host results below remain historical evidence. The [walkthrough](docs/growth-preview.md) separates
the implemented route contract, observed host behavior, and outstanding checks.

P1 adds tested, side-effect-free Pair work-unit admission, related human
follow-up, and handoff-preflight contracts to `@adaptive-pair/modes`. These
assessments change no authority or persisted state and are not wired to the
runtime or extension. The Stable preview remains Growth-only. P2a now implements
the [journal inspection boundary](docs/design.md#131-p2a-journal-inspection):
complete revision-zero histories, commit/revision/identity checks, and recorded
unfinished-operation warnings. A successful report restores no session, grants,
or authority and replays no effect. See the [implementation evidence](docs/research.md#p2a-implementation-evidence).
P2b implements the [minimized persistence/restart contracts](docs/design.md#132-p2b-persistence-and-restart-contracts)
without filesystem access, live hydration, or automatic retries. Expired or
invalid histories never return an executable request; pending/unknown records
remain warnings, including after session closure. Pure helpers and a test-only
storage schedule do not prove crash durability, physical deletion, or a working
resume feature. The [current plan](docs/implementation-plan.md) records the
implementation and delivery gates. The disk adapter, live admission, remaining
P2 ownership/handoff, and guarded edits/complete Stable Pair experience in P3
remain separately reviewed increments. Growth transfer completion and evaluation
export remain release work, not completed preview features. Work proceeds one
milestone at a time; there is no committed calendar release date.

The merged P1 baseline passed typecheck, lint, 673
tests across 43 files, Stable VSIX verification, and all 17 isolated Extension
Host smoke tests on VS Code 1.137.0. The modes suite contains 75 new Pair cases
and four unchanged Growth cases. Its two dependency graphs passed full audits;
the isolated POC's six unit cases and one host case are counted separately.
See the [P1 validation evidence](docs/research.md#p1-post-maintenance-integration)
and the separate [stabilization evidence](docs/research.md#runtime-boundary-stabilization).
These results verify the pure policies and preserve the existing Growth
preview; they do not establish Pair runtime integration or host edit safety.

The stabilization branch replaces split store writes and direct snapshot
replacement with atomic commits through one transition queue. Growth response
release belongs to the host-independent runtime; native adapters retain UI,
consent, and effect wiring. Model state queries expose bounded metadata rather
than internal snapshots, diagnostics, operation payloads, or grants.
Growth consent and cached transfer/check results are bound to the committed
workspace/session lifetime, not reusable IDs. The participant rejects unsupported
modes before consent, and a committed model-tool contract ends the turn so the
next request compiles fresh instructions and tools. Switching workspace bindings
clears the old session authority and requires a fresh session agreement.
Windows cancellation never
treats successful `taskkill` delivery as proof that the process tree exited;
without that evidence it reports termination as unconfirmed.
Pair's local journal persists only edit-episode continuity. Explicit minimized
checkpoint metadata may be retained by VS Code's native chat history; it never
restores a live session, work unit, grant, or observed verification result.
Durable authoritative session/ownership recovery remains future work.

The completed Foundation and Growth implementation plan remains available in
Git history at `ae1f095:docs/implementation-plan.md`, the completed P1 plan
at `9eebbf1:docs/implementation-plan.md`, and the merged event-validation plan
at `469cb93:docs/implementation-plan.md`. Only one implementation
plan is current; replacing it does not approve the successor.

The earlier runnable experiment remains on
`feature/realtime-pair-vertical-slice`. It is a test and behavior baseline plus
a source of compatible modules, not the v2 architecture.

Historical v1 documents remain under [docs/archive](docs/archive/).

## Open source

The protocol, runtime, adapters, tests, evaluation schemas, and release workflow
will be public under the Apache License 2.0. Contributions and independent host
or model adapters are welcome once the v2 core interfaces land.

## License

Licensed under the [Apache License 2.0](LICENSE).
