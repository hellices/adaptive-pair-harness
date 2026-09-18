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

## Growth Mode preview (0.2.0-preview.1)

This branch ships an installable **Stable Growth** preview: an opt-in Pair
Presence layer and a `@pair` Growth Mode chat participant. It is additive and
changes no existing VS Code or GitHub Copilot Chat behavior. It makes **no claim
that it improves learning or productivity**.

Controls (Command Palette, all namespaced under `Adaptive Pair:`):

- **Enable Presence** — turn on the ambient presence layer in a trusted workspace.
- **Stay Quiet** — keep Presence on but silence proactive nudges.
- **Pause Presence** — suspend observation and any in-flight work unit.
- **Join Work in Progress** — capture a bounded local entry snapshot.
- **Start a Session** — begin a Pair session for fresh work.
- **Disable Presence and Clear Continuity** — disable and delete the local journal.

Growth guidance is requested through `@pair` and its slash commands, each of
which has an implemented route and a natural-language equivalent: `/brief` and
`/session` report current core state without any model call, `/attempt` and
`/hypothesis` record your work, `/hint` and `/reveal` return bounded guidance,
`/check` runs the agreed verification plan and reports only the observed product
result, and `/transfer` requests one independent variation distinct from the
current work unit. The AI never edits your files in Growth Mode.

Product verification is reported separately from Growth. Growth itself is
reported as five independent fields — similar generation, varied debugging,
explanation, meaningful authorship, and the next-assistance proposal — and each
stays "not assessed" until its own demonstration is recorded. Starting a
transfer task demonstrates none of them.

See **[docs/growth-preview.md](docs/growth-preview.md)** for the greenfield and
join-in-progress walkthroughs, hint and reveal behavior, product verification
and the five Growth fields, local storage/deletion and the export limitation,
supported languages and host versions, the experimental Session Target and its
Insiders proposed-API limitation, and the exact known limitations. The Stable VSIX
(`adaptive-pair-0.2.0-preview.1-stable.vsix`) contains no `enabledApiProposals`
and no `contributes.chatSessions`.

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

The same extension codebase produces two channel packages:

| Artifact | Use |
|---|---|
| `adaptive-pair-<version>-stable.vsix` | Stable APIs, Pair Presence, Pair tools, and `@pair`; Marketplace candidate |
| `adaptive-pair-<version>-insiders.vsix` | The same product plus the proposed Adaptive Pair Session Target |

They share one extension ID and are alternatives, not two required
installations. An Agent Plugin may optionally expose Adaptive Pair under the
Agent control on compatible Stable targets, but it is not required.

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
[P2a journal and recovery contract plan](docs/implementation-plan.md) is a
**design-only proposal** after the merged version-1 event-validation increment
(PR #9). It proposes bounded journal inspection and a non-authorizing restart
assessment, not a durable store or a working resume feature. The owner authorized
this design/plan review, not its implementation. Disk storage, live restoration,
Pair ownership/handoff, and P3 editing/UI still need separate approval.

## Development checks

Use Node.js 24 or later. Install both maintained dependency graphs before
running the complete checks; the Session Target POC is deliberately not an npm
workspace:

```sh
npm ci
npm --prefix poc/session-target ci
npm run check
npm --prefix poc/session-target run check
```

`npm run check` runs workspace typechecking, ESLint, and the workspace test
suite. `npm run lint` also covers the isolated POC's authored source/tests,
host fixtures, and root/POC lint and test configurations. Production and regular
tests use typed linting; standalone configurations and intentionally incomplete
host fixtures use syntactic rules with the same size limits. Only fixture
function parameters may be unused, preserving the bug the host scenarios repair.
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

P1 adds tested, side-effect-free Pair work-unit admission, related human
follow-up, and handoff-preflight contracts to `@adaptive-pair/modes`. These
assessments change no authority or persisted state and are not wired to the
runtime or extension. The Stable preview remains Growth-only. P2 runtime
ownership and lifecycle is split first at the proposed P2a journal/recovery
contract boundary; its [design](docs/design.md#131-proposed-p2a-journal-inspection)
and plan are under review, not implemented. The rest of P2 and the guarded edits
and complete Stable Pair experience in P3 remain separately gated. Neither
increment is authorized by an earlier milestone's completion. Growth transfer
completion and evaluation export remain release work, not completed preview features. Work proceeds one
milestone at a time; there is no committed calendar release date.

The merged P1 baseline passed typecheck, lint, 673
tests across 43 files, Stable VSIX verification, and all 17 isolated Extension
Host smoke tests on VS Code 1.137.0. The modes suite contains 75 new Pair cases
and four unchanged Growth cases. Both active dependency graphs pass full audits;
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
Only edit-episode continuity is persisted today;
durable authoritative session/ownership recovery remains future work.

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
