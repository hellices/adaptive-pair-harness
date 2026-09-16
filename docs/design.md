# Adaptive Pair v2: Product and System Design

- **Updated:** September 16, 2026 (UTC)
- **Status:** The reviewed P1 policy increment is merged as pure contracts.
  The owner then authorized runtime-boundary and code-size stabilization before
  further product work. The remaining v2 roadmap is
  proposed and requires separately reviewed implementation plans and approval.
- **Implementation:** Stable Growth Mode preview implemented (Tasks 1–12):
  host-agnostic protocol, in-memory authoritative runtime, versioned harness kernel, Growth
  restraint, Pair Presence with join-in-progress capture, observed verification,
  deterministic `/brief`, `/session`, `/check`, and `/transfer` participant
  routes, and a clean-profile Extension Host smoke with deterministic packaging,
  automated VSIX release verification, and CI. Transfer is implemented only as a
  *started* independent variation: completing a transfer, and any resulting
  Growth demonstration, is not implemented. Pair Mode AI edits, Delivery Mode
  commands, and the native Agent Plugin remain out of scope for this preview.
  The modes package also implements tested Pair admission, related human
  follow-up, and handoff-preflight policies without runtime or host wiring.
- **Current plan:** `implementation-plan.md` records the authorized runtime
  stabilization, bounded-code refactoring, and review gates. It deliberately
  replaces the completed P1 plan retained at
  `9eebbf1:docs/implementation-plan.md` in Git history. The Foundation plan
  remains at `ae1f095:docs/implementation-plan.md`. P2 ownership/lifecycle scope
  review follows stabilization; no Pair runtime, edit adapter, or new extension
  control is authorized by this refactoring.

This document is the first complete product and architecture specification for
Adaptive Pair v2. Every v2 behavior starts here as an initial design decision;
no earlier v2 note is treated as an inherited or already-validated
requirement. It incorporates the evidence summarized in
[research.md](research.md), the current VS Code platform, the product values
defined in this planning cycle, and the lessons from the historical v1
implementation.

## 1. Product thesis

Adaptive Pair is a complete open-source capability-preserving programming
runtime, not a prompt bundle and not an autonomous ticket-to-code agent.

Its defining value is:

> Even when AI can perform the whole development task, protect deliberate
> opportunities for people to form and maintain the ability to develop
> software themselves.

Default coding agents can outsource the entire learning loop:

```text
interpret the problem
  -> choose an approach
  -> generate code
  -> encounter a failure
  -> form a diagnosis
  -> repair the code
  -> verify the result
```

The developer may still learn to decompose requests, read generated code,
review an agent's diagnosis, and select among proposals. Those are valuable
skills, but they do not automatically replace code generation, debugging,
language fluency, design internalization, or confidence built by overcoming a
block.

Understanding an explanation or agreeing with AI-generated code is not the
same capability as producing, failing, diagnosing, and repairing code without
the answer already present.

This value is independent of execution method. Prompt configuration, skills,
permissions, plugins, extensions, and custom runtimes are implementation
options evaluated by the same observable mode contracts.

The motivation does not depend on an interview, product endorsement, or a
claim that AI always harms learning. The closest direct evidence in the
current review is a 2026 randomized study of 52 experienced Python users new to
Trio: the AI-assisted group scored about 17 percentage points lower on an
immediate assessment, without statistically significant main-task
acceleration. Higher-scoring conceptual-question and explanation patterns were
observational subgroups, not randomized treatments. The product response is to
preserve and measure direct practice, not to claim a proven learning effect.

In Growth and Pair modes, one developer and one AI share:

- an explicit goal;
- one agreed work unit at a time;
- clear driver and navigator responsibilities;
- one active edit owner;
- observable verification;
- negotiated handoffs, pause, takeover, and resume;
- a short, correctable reflection at the end of the session.

Both participants may propose direction, question assumptions, and edit code.
The developer can interrupt at any time. The AI never gains edit authority from
a model response alone.

Adaptive Pair can accompany normal development rather than requiring work to
begin inside a special agent request. After the developer explicitly enables
Pair Presence for a trusted workspace, it can:

- help start a new product or repository;
- begin a fresh task in an existing project;
- join work that is already in progress;
- remain quietly aware between explicit work units;
- resume after interruption by reconciling the actual workspace first.

Presence means bounded local observation and availability, not continuous
remote model surveillance or permission to act.

### What "complete" means

Development previews may build one mode at a time, but v2.0 stable is complete
only when the product can honestly distinguish and run all three operating
modes:

1. **Practice/Growth Mode** protects human code generation, failure, diagnosis,
   repair, and independent transfer.
2. **Pair Mode** alternates meaningful work between human and AI without
   allowing either participant to monopolize the whole development loop.
3. **Delivery Mode** permits explicit delegation when learning value is low and
   optimizes verified delivery without calling it growth or pairing.

Each mode must move from briefing through implementation, verification,
interruption, recovery, and close without hidden state or undocumented manual
repair. The implementation sequence starts with Growth, then Pair, then
Delivery; stable release waits for all three mode contracts.

### Open-source boundary

The following are Apache-2.0 open-source product code:

- the protocol and schemas;
- session and work-unit state machines;
- edit-authority and recovery rules;
- mode and collaboration-cadence policies;
- learning agreements, hint progression, and restraint rules;
- deterministic evidence processing;
- model, host, storage, and profile ports;
- the VS Code extension and fallback chat surface;
- the Copilot-compatible Agent Plugin;
- the test kit and local evaluation tooling.

VS Code, GitHub Copilot, hosted models, and account-sync services are optional
adapters. No proprietary service is the source of truth for pairing state or
required to exercise the core in tests.

## 2. Product principles

1. **Protect capability formation.** When an activity has current learning
   value, the developer must have a real opportunity to generate, fail,
   diagnose, repair, and verify.
2. **Name delegation honestly.** Delivery Mode may delegate broadly; Growth and
   Pair modes may not behave like Delivery while retaining a learning label.
3. **Attempt before rescue.** In Growth Mode, the AI escalates through bounded
   help only after a human attempt or explicit bypass.
4. **One edit owner, two active participants.** Conversational initiative is
   shared; mutation authority is explicit.
5. **Human control is monotonic.** Pause or takeover immediately removes future
   AI mutation authority. No later result can silently restore it.
6. **Evidence outranks prose.** Applied file state and observed check results
   outrank model claims.
7. **The model proposes; deterministic code authorizes.** Mode prompts,
   custom agents, and model output never bypass the session core.
8. **Local observation, selective disclosure.** Editor and compiler signals are
   processed locally. Remote context is destination-disclosed and consented.
9. **Adapt to learning value, not an inferred rank.** Preferences and
   familiarity are correctable hypotheses, never a permanent ability score.
10. **No universal mode claim.** The modes are product choices to
   evaluate, not an evidence-backed leaderboard.
11. **Host capabilities are replaceable.** Native Agent features are used when
   they preserve the product invariants; otherwise the controlled adapter runs.
12. **Add, never replace.** Installing Adaptive Pair does not alter the
   defaults, settings, sessions, commands, or UI behavior of VS Code, GitHub
   Copilot Chat, Claude, Codex, or another harness.
13. **No telemetry by default.** Evaluation data stays local unless the
   developer explicitly exports it.

## 3. Scope and release strategy

### First stable release

The stable v2.0 release includes:

- VS Code as the first host;
- complete Growth, Pair, and Delivery mode contracts;
- greenfield, existing-project, join-in-progress, and resume entry paths;
- workspace-level Pair Presence that can observe quietly without an active
  work unit;
- a per-session learning agreement that distinguishes new capabilities,
  already-familiar work, human-owned practice, and delegatable mechanical work;
- a Growth Mode hint ladder, answer-reveal boundary, and independent transfer
  check;
- a Pair Mode Driver/Navigator workflow with meaningful role rotation;
- an explicitly labeled Delivery Mode;
- human-driver and AI-driver work units;
- local TypeScript and JavaScript evidence sensors;
- language-agnostic interactive file and verification tools where the host can
  safely operate;
- native Agent picker integration when its capability gate passes;
- an extension-owned `@pair` fallback using the same runtime;
- local session recovery and explicit deletion;
- explicit, local personal preferences;
- offline deterministic tests and a local evaluation export.

### Sequential delivery roadmap

**Confirmed workflow choice:** proceed one bounded milestone at a time, without
a calendar deadline. A session selects a concrete deliverable and its
verification gate. A draft, a passing unit test, or the completion of an earlier
milestone does not authorize the next implementation. Review the current plan
before executing it; keep `implementation-plan.md` as the single current
implementation sequence.

**Confirmed delivery workflow:** start from `main`, submit each authorized
increment through a dedicated pull request branch, request review, address
findings with verified fixes or reasoned thread replies, and resolve addressed
threads. Report readiness only after checking follow-up feedback and the final
revision's required checks. Stop for the user's merge decision; do not merge
or enable auto-merge implicitly. Review of documentation does not itself
authorize implementation or the next milestone. P1 received separate execution
authorization when the repository owner requested merging PR #4 and proceeding
with the next increment on September 16, 2026; P2 and P3 remain unapproved.

**Proposed sequence:** retain the four program milestones from the Foundation
plan, but split Pair into smaller reviewable increments. Dates and duration
estimates are intentionally not assigned.

| Milestone | Deliverable | Current state | Exit gate |
|---|---|---|---|
| M1 — Foundation and Growth preview | Shared protocol, in-memory runtime, durable edit-episode continuity, Presence, Growth guidance, observed verification, Stable packaging | Implemented at `ae1f095`; preview scope only; baseline revalidation complete | Preserve the existing unit, property, contract, package, and isolated-host baseline |
| M2 — Pair Mode | Meaningful human/AI work units, explicit handoff, guarded AI edits, complete Stable `@pair` flow | P1 pure contracts implemented; P2/P3 runtime and host work remain unimplemented | Both initial owners complete a Pair session with observed checks, interruption/recovery, ownership reporting, and unchanged Growth/coexistence behavior |
| M3 — Delivery and mode switching | Explicit delegation, classified commands, safe mode changes, separate outcome reporting | Future plan | Complete Delivery sessions; switches revoke old authority and require new agreement; no delegated work is reported as Growth or balanced pairing |
| M4 — Completion, native adapters, and v2.0 | Finish preview gaps, validate optional native entry points, harden both channels, publish release evidence | Future plans and an existing Session Target proof of concept | Every gate in section 17 is satisfied; unavailable optional native capabilities are reported honestly and never required by Stable |

**Baseline prerequisite R0 — complete:** on 2026-09-16, a full isolated
Extension Host rerun on VS Code 1.137.0 passed all 17 smoke tests and exited
with code 0. Unit, type, lint, and VSIX checks also passed on unchanged
application source. Earlier interrupted attempts are not counted as passes;
no source fix or confirmed termination cause is claimed. Details are in
[the evidence checkpoint](research.md#implementation-evidence-for-the-next-pair-increment).
Repeat the baseline checks for each increment and preserve the regression gates
throughout the roadmap. Correctness and coexistence regressions block release
in every increment; they are not postponed to M4.

M2 has three ordered increments, not three competing active plans:

1. **P1 — Pair policy contracts:** pure work-unit admission, related human
   follow-up rules, and handoff preflight assessment in `packages/modes`.
   Existing protocol types are inputs. No authority changes, persistence
   migration, host effects, public tool additions, or Pair UI activation occur.
   Implemented, reviewed, and merged with 75 new Pair cases. This is an
   open-core contract deliverable, not a usable Pair preview.
2. **P2 — Runtime ownership and lifecycle:** consume reviewed P1 contracts in
   the authoritative core. Add versioned handoff, work-unit completion and
   history, human confirmation, operation quiescence, explicit reconciliation,
   and replay/migration contracts. Track capability-category ownership without
   converting it into a learning or typing-share score. Review this scope after
   stabilization, then deliberately replace the canonical implementation plan.
   Publishing that plan does not itself authorize its implementation.
3. **P3 — Stable Pair experience:** prove the host's guarded-edit boundary and
   then wire native diff/confirmation, the Pair chat route, operational tool
   declarations, and end-to-end verification. Reject stale document versions,
   root/scope changes, dirty-entry ownership conflicts, and late results. If
   enforcing the edit contract needs a prototype, use a bounded technical
   spike and record its decision here; do not quietly relax the contract.

The current authorized increment between P1 and P2 is runtime-boundary and
code-size stabilization: atomic state transitions, lifecycle cancellation,
host-independent guarded Growth turns, and executable dependency/size checks.
It adds no Pair ownership, handoff, persistence, or editing feature.

The full Pair Mode gate still requires P1, P2, and P3. A pure policy returning
an admissible result is not edit permission, a completed handoff, or evidence
that a host can apply an edit safely. Stable remains Growth-only until P3 has a
reviewed plan and its complete routes pass their release tests.

#### Remaining work ownership

These are proposed assignments of known gaps and release requirements, not
claims that a later milestone is already planned in implementation detail.

| Remaining requirement | Owning increment | Required evidence |
|---|---|---|
| Pair work-unit checks and related human follow-up policy | M2/P1 | Deterministic policy examples and negative cases; no state or host mutation |
| Handoff acceptance, takeover, completion, successors, and replay | M2/P2 | Core and coordinator fault tests, durable human decisions, stale-grant rejection, no automatic replay of unknown mutations |
| Pair capability-category ownership and reflection | M2/P2, surfaced in P3 | Observed work-unit history and correctable reflection; no score inferred from typing or model prose |
| Bounded AI edits and complete Pair chat/tool routes | M2/P3 | Real fixture edits and observed checks, conflict/cancellation tests, native diff/confirmation, public-tool parity |
| Delivery commands and cross-mode authority changes | M3 | Classified and consented effects, epoch invalidation, honest mode-specific outcomes |
| Growth transfer completion, four demonstration fields, and the next-assistance proposal | M4 completion | A started task proves nothing; demonstrations require observed evidence, next assistance remains a separate correctable proposal, and bypass/reveal stays visible |
| Session metric aggregation, inspectable preferences, reflection, and evaluation export | M4 completion | Only observed values are aggregated; inspection/correction/deletion and a user-invoked, privacy-reviewed export work end to end |
| Presence availability, low-noise interventions, and usability gaps | M4 completion | Enable/quiet/pause/off and resume work across entry paths; pilot observation distinguishes available controls from validated usability |
| Native Agent/tool/Testing integration and target compatibility | M4 adapters | A capability matrix and mode-conformance results for each advertised combination; no inference from one host or target to another |
| Insiders Session Target history, interruption, and shared behavior | M4 adapters | Harden the existing POC; prove Stable independence and shared runtime behavior without requiring proposed APIs on Stable |
| Stable/Insiders replacement, uninstall, and inactive/coexistence guarantees | M4 release | Clean-profile installation, replacement and deletion tests; zero inactive observation/model/network activity; other extensions and user state unchanged |
| Product evaluation, independent review, and pilot UX | M4 release | Native-baseline comparison, no open critical correctness/security/privacy/data-loss findings, observed pilot and interruption outcomes |
| Release checksums, SBOM, dependency licensing, and contributor/security/privacy/governance documentation | M4 release | Reproducible release artifacts and published, reviewable project documentation |

Growth preview completion must not hide its remaining transfer and export
work. M4 cannot close while those requirements are missing. If an earlier
increment needs one of these requirements, deliberately move its ownership in
this table and review the changed scope rather than silently expanding a task.

### Experimental after v2.0

- Ping-Pong TDD;
- additional language-specific sensors;
- optional profile synchronization;
- remote or multi-client pairing hosts.

Guided questions, hints, demonstrations, and reflection are part of Growth Mode
in v2.0 rather than a separate experimental product mode. Experimental features
use designed extension points and do not redefine the three mode contracts.

### Outside the product

- unattended issue-to-pull-request execution;
- multi-agent swarms;
- multi-person Mob sessions;
- a repository knowledge platform;
- automatic novice, intermediate, or expert classification;
- default mining of commit or pull-request history for personal assessment;
- a requirement to use GitHub Copilot or any single model vendor.
- modifying, patching, hiding, redirecting, or replacing another extension,
  Session Target, chat participant, model, permission choice, or user setting.

## 4. Repository and package structure

v2 uses npm workspaces so dependency direction is visible and enforceable.

```text
packages/
  protocol/          Versioned commands, events, snapshots, and JSON schemas
  session-core/      Pure reducers, state machines, and authority decisions
  runtime/           Effect coordinator, journal, reconciliation, and ports
  presence/          Workspace presence, entry snapshots, observation policy
  modes/             Growth, Pair, Delivery, and optional cadence policies
  restraint/         Tool gates, hint ladder, answer boundary, transfer checks
  harness/           Instruction compiler, tool catalog, policy, native mapping
  evidence/          Evidence contracts, ranking, freshness, and TS/JS sensors
  profile/           Explicit preferences, profile proposals, and store ports
  evaluation/        Local metrics, experiment records, and export schemas
  testkit/           Fake clock, host, model, store, and fault-injection tools
apps/
  vscode-extension/  Shared VS Code host, tools, UI, @pair, target adapter
plugins/
  copilot/           Optional Stable custom-agent and skill distribution
```

Dependency rules:

- `protocol` has no product dependencies.
- `session-core` depends only on `protocol` and injected deterministic
  utilities.
- `presence` turns bounded host events into local observation episodes and
  entry snapshots; it cannot authorize workspace mutation.
- `modes` reads protocol snapshots and emits policy proposals; it cannot
  invoke effects.
- `restraint` applies mode-specific capability and response policies without
  owning session state.
- `harness` compiles instruction and tool views from immutable Pair state; it
  cannot grant authority beyond a core decision.
- `runtime` depends inward on `session-core`, `modes`, `restraint`, `harness`,
  and port interfaces.
- `evidence`, `profile`, and `evaluation` communicate through protocol types.
- host, model, storage, and UI adapters depend on the runtime, never the other
  way around.
- no package under `packages/` imports `vscode`, Copilot SDK types, or a
  model-vendor SDK.

This layout permits an alternate host later without creating a second pairing
engine. No alternate UI is implemented in the first release.

### Dependency and version maintenance

The owner removed the blanket dependency and version freeze on September 16,
2026. Dependencies, development tools, CI actions, package versions, protocol
versions, and VS Code API versions may be updated when needed for security,
compatibility, or authorized work. Check the actual current stable releases
and their compatibility requirements rather than relying on remembered
version numbers or upgrading indiscriminately.

Inventory every active dependency graph, including isolated prototypes outside
workspace globs, and cross-check direct dependency metadata and upstream release
records. An empty `npm outdated` report does not prove that every upstream
release is current. Record compatibility or availability reasons for retaining
an older release and revisit that choice when those conditions change.

Keep dependency declarations and their lockfiles synchronized. Review breaking
changes, make any required protocol or storage migration explicit, and rerun
the affected type, lint, unit, contract, isolated-host, and package checks.
Audit development dependencies as well as production dependencies; an existing
finding still needs triage and disposition. CI separately installs and runs
`npm audit --audit-level=low` for the root workspace graph and the active
`poc/session-target` graph, using `npm --prefix poc/session-target` for the latter.
Both audits include development dependencies and block the build-and-package
job on failure. The isolated POC also runs its compile/unit checks and packaging;
it remains separate from the Stable VSIX and its spike remains in progress.

A toolchain refresh does not itself require a product or protocol version bump
or a higher host API floor. Preserve the package boundaries, permission
contracts, additive integration, and inactive-zero behavior. This maintenance
authorization does not start another product milestone or permit unrelated
feature changes.

## 5. Architecture

```text
VS Code Agent Plugin -----+
                          |
@pair Chat participant ---+--> Surface adapter
                                |
                                v
                         Harness kernel
                    (instructions + tool view)
                                |
                                v
                      Pair Runtime coordinator
                                |
  +---------------+---------------+---------------+----------------+
  |               |               |               |                |
  v               v               v               v                v
Session core  Pair Presence   Mode policy   Restraint engine  Evidence engine
(authority)   (local context) (proposals)   (capability gate) (observations)
            |
            v
       Authorized effects
            |
    +-------+---------+-----------+------------+
    |                 |           |            |
 Host port        Model port   Store port   Consent/profile ports
    |                 |           |            |
 VS Code         selected LM,   local       local profile,
 adapter         local model,   journal     optional sync
                 OpenAI-compatible
```

In native Agent mode, the Agent Host owns the conversational model loop and
calls Pair Runtime tools. The `ModelPort` is used by the controlled chat
adapter and by explicitly configured local or OpenAI-compatible providers. The
session core does not depend on either path.

### 5.1 Protocol

`protocol` defines JSON-serializable, versioned types for:

- commands submitted by a human, model, host, or policy;
- accepted domain events;
- immutable session snapshots;
- effect requests and observed effect results;
- evidence and privacy classifications;
- local evaluation records.

Every command and event has an opaque ID, optional task session ID, expected
Pair runtime revision, actor, and timestamp supplied by an injected clock. The
runtime processes it under one workspace stream ID. Schemas reject unknown
fields.
Protocol evolution is additive within a major version and uses explicit
migrations across major versions.

### 5.2 Session core

The session core is a pure reducer and command decider. Given the current
snapshot and a command, it returns either:

- a rejection with a stable reason code; or
- ordered domain events and authorized effect descriptions.

It does not read files, call models, store state, render UI, or inspect VS Code.
This is the only component allowed to change edit ownership, work-unit status,
or session authority.

### 5.3 Runtime coordinator

The implemented coordinator:

1. serializes authoritative mutations and checks committed command IDs;
2. asks the core for a decision;
3. atomically commits the complete event batch, resulting snapshot, and command
   IDs against the expected revision;
4. invalidates obsolete operations after a committed authority change;
5. dispatches authorized effects through ports outside the transition queue;
6. records each observed result through the same queued command boundary.

Effects never mutate the snapshot directly. An adapter result becomes true
pairing state only after the core accepts the corresponding observation.
The internal `ToolExecutor` owns invocation, effect cancellation, and bounded
read reconciliation; the coordinator retains commit ordering. Native tool
input-to-command mapping is separate from both responsibilities.

Recovery re-admits each candidate read on that same transition queue using a
fresh authoritative snapshot. It excludes in-flight invocations/recoveries and
registers cancellation before executing outside the queue. Pause or Disable can
therefore invalidate a recovered effect without waiting for it to settle. Only
eligible authorized reads are retried; unknown state-changing effects are never
automatically replayed.

`PairStore.load` returns immutable state and committed command IDs.
`PairStore.commit(streamId, expectedRevision, events)` must validate the entire
batch before publishing any state, history, or IDs. A rejected batch leaves all
three unchanged. The shared `InMemoryJournal` implements this contract in
production and contract-preserving test wrappers; a future durable adapter must
meet the same atomicity and idempotency tests. A rejected transition does not
poison the queue. Confirmation UI, model work, filesystem capture, and process
execution never hold it.

Presence enable/quiet/pause/disable and host workspace observations are core
commands, not host-side snapshot replacement. Disable keeps the runtime
revision monotonic while clearing the current session and observation state.
Host lifecycle generations cancel obsolete intent before a deferred trusted
action can enable Presence again, and UI/listener projections use current
authoritative state after cleanup. Entry capture carries a lifecycle-bound
abort signal and checks it across native asynchronous boundaries.

### 5.4 Mode policies

A policy receives an immutable snapshot and recent event. It may emit:

- a question;
- a proposed next work unit;
- a handoff proposal;
- a suggested scaffold level;
- a recommendation to pause, verify, reflect, or switch mode or cadence.

Policies cannot grant authority, write files, run checks, persist profile data,
or override a human command.

### 5.5 Pair Presence

Pair Presence receives bounded local host events:

- stable edit episodes, not raw keystroke streams;
- active document, selection, and symbol changes;
- saves and external file changes;
- editor diagnostics;
- observed test and task results;
- workspace, branch, and dirty-state changes;
- explicit developer controls such as `Ask`, `Pair here`, `Stay quiet`,
  `Pause`, and `Take over`.

It keeps a bounded in-memory observation window and emits semantic summaries to
the runtime. It does not infer that silence means confusion, that an error means
low ability, or that navigation means consent.

No remote model receives the continuous event stream. A model receives only a
bounded, consented summary when an intervention or explicit request requires
reasoning.

### 5.6 Restraint engine

The restraint engine converts the active mode and learning agreement into
enforceable capabilities:

- whether AI mutation is permitted;
- which work-unit scopes it may touch;
- the current hint ceiling;
- whether target code, a complete patch, or a direct diagnosis may be shown;
- whether a human attempt or hypothesis is required before escalation;
- whether a transfer check must run before a growth claim.

How an adapter realizes these rules is an implementation choice. Instructions,
tool restrictions, structured responses, or other controls may contribute, but
the observable mode contract is the product boundary. No adapter may advertise
a mode it cannot preserve.

### 5.7 Evidence engine

The evidence engine accepts local observations from host-specific sensors and
normalizes them into bounded evidence:

- editor diagnostics;
- new dependency or boundary crossings;
- public declaration changes;
- substantial complexity growth;
- test and build results;
- stale baseline or conflicting edits.

Evidence records include provenance, confidence, freshness, affected range,
privacy classification, and the work unit that owned the observation. The
engine may recommend an intervention; the runtime and active policy decide
whether it is timely.

### 5.8 Profile boundary

The profile contains only explicit preferences and developer-approved
reflections, for example:

- preferred intervention intensity;
- preferred explanation depth;
- task- or language-specific familiarity stated by the developer;
- operating modes or collaboration cadences the developer wants to practice;
- corrected or deleted prior summaries.

Raw code, file paths, diagnostics, prompts, conversation transcripts, timing
traces, and inferred global ability scores are not profile fields.

The first release uses a local profile scoped to the OS/VS Code user. A
`ProfileStore` port permits optional account synchronization later without
changing the session core. Profile sync is not required for a complete local
pairing session.

### 5.9 Harness kernel

The harness kernel turns immutable Pair state into two synchronized products:

1. an instruction envelope describing the current product, mode, learning
   agreement, work unit, evidence, and response boundary;
2. a tool view describing which capabilities are visible and what preconditions
   each invocation must satisfy.

Instructions explain expected behavior. Tools and the session core enforce
authority. A model that ignores an instruction still cannot gain a capability
that the tool view or core denies.

The instruction layers are deterministic and versioned:

1. product identity and non-negotiable mode meanings;
2. active mode and restraint contract;
3. confirmed learning agreement;
4. current work unit, owner, scope, verification, and stopping condition;
5. bounded local observations and evidence;
6. current user request;
7. repository and tool text, quoted as untrusted reference data.

Later layers add task information but cannot override earlier authority or
privacy rules. The compiled envelope records its instruction-set version,
Pair runtime revision, authority epoch, and maximum response class.

Every tool descriptor declares:

- stable name and version;
- read, mutation, verification, network, or external-side-effect class;
- supported modes;
- required actor and edit owner;
- whether an explicit user action is required and how its one-shot grant is
  correlated;
- scope and consent requirements;
- input and output schemas;
- approval behavior;
- retry and unknown-completion policy;
- sensitivity and display bounds.

The visible tool list is a projection for model guidance, not the security
boundary. Every invocation repeats the same checks against the latest core
snapshot.

### 5.10 Maintainable boundaries

This stabilization adopts a functional core with explicit application/adapter
boundaries, not a full framework-driven Clean Architecture rewrite.

| Principle | Concrete adoption | Deliberate limit |
|---|---|---|
| Single responsibility | Command decisions and event reducers are grouped by presence, session, agreements, Growth, and authorization; model transport, response publication, workspace access, verification, and archive inspection have separate modules | Moving code into arbitrary numbered files or adding pass-through classes is not a refactor |
| Open/closed | New host, model, store, and effect implementations use existing ports | New commands and modes still require deliberate protocol/policy review; no unrestricted plugin registry |
| Liskov substitution | The production store and fault-injection fixtures share atomic commit, revision, idempotency, and immutability behavior | Type compatibility alone is insufficient, and no generic repository hierarchy is needed |
| Interface segregation | Growth turns need only snapshot/prepare capabilities; Presence has its own port; the tool executor receives command/query and result-observation capabilities | No interface for every internal helper or concrete class |
| Dependency inversion | Runtime owns model/effect/store/clock contracts; the VS Code shell implements and composes them; pure packages contain no host/vendor SDK types | No DI container, mode inheritance hierarchy, or speculative alternate-host implementation |

The guarded Growth workflow is owned by `runtime`, not by a VS Code-shaped
participant. `requestGuardedGrowthTurn` handles the asynchronous request;
`finishGuardedGrowthTurn` performs synchronous final boundary/restraint checks.
The host reads its authoritative in-memory store through a required synchronous
`snapshotNow` capability, then finalizes, records evaluation, and publishes
Markdown in the same continuation. Awaiting even the final snapshot can return
state captured before a queued Pause commits; neither a cached coordinator view
nor an extra await before publication is safe. The same `SessionController`
wires this live view and the command coordinator in production and host tests.
The convenience
`runGuardedGrowthTurn` returns data, not an atomic publication guarantee for a
caller that later displays it. Consent dialogs, cancellation-token conversion,
model-vendor transport, and native presentation stay in the extension.

The shell checks Chat cancellation before finalization and again before a
transfer command's later synchronous state/publication continuation. The model
transport uses the same derived cancellation signal at dispatch and completion;
timer expiry retains its time-cap reason even if the wall clock moves backward.
Token-accounting completion cannot start another model dispatch after
cancellation. Explicit Growth actions bind grants to the revision and authority
epoch the caller observed, and a multi-action reveal chains the next grant from
the preceding action's committed result rather than silently adopting new intent.

Executable dependency tests inspect source and test imports, including type
imports, re-exports, and literal dynamic imports. They compare the Stable
workspace's manifests and TypeScript references, reject undeclared direct or
forbidden inward dependencies, cross-package relative/deep imports,
production-to-test imports, and package-graph cycles. Reference-only edges must
also declare a direct dependency and obey the reviewed inward direction;
test-only declarations cannot hide outward references. Unknown reference targets
are rejected. A new product package requires an explicit dependency policy. The
isolated Session Target POC stays outside this Stable package graph.

ESLint additionally enforces 400 effective lines per production, configuration,
or release-script file and 100 per function. Test files, shared fixtures, and host
smoke cases have bounded 600/200 limits so setup and assertions can remain
together. Only blank/comment-only lines are discounted, and immediately invoked
functions are included; there are no individual file exemptions or inline
suppression. Warnings fail the command. Both the
Stable graph and the POC's authored source/tests/configurations are linted.
Production and regular tests retain type-aware rules. Standalone configurations
and intentionally incomplete host fixtures, which are outside compiled TypeScript
programs, use syntactic lint with the same size limits and suppression policy.
Only fixture function parameters may be unused, retaining the deliberate bug the
host tests repair. Generated output and vendored upstream declarations are not
authored code. Negative tests check the actual effective configuration and
oversized-code rejection. These limits support reviewability but never replace
responsibility-based design, behavior tests, host checks, or review.

## 6. Domain model

The immutable `PairRuntimeSnapshot` is the state supplied to the harness. It
contains the protocol version, one monotonic runtime revision, workspace-level
Pair Presence, and an optional task-scoped Pair Session. Commands and tool
views use the runtime revision; only the active session carries an authority
epoch.

### 6.1 Pair Presence

`PairPresence` is workspace-scoped and can outlive an individual task:

- workspace identity and trust state;
- status: `off`, `observing`, `engaged`, `quiet`, or `paused`;
- observation window revision and retention bounds;
- active entry snapshot, if work is being joined;
- intervention style, cooldown, and explicit quiet controls;
- current task session ID, if one exists.

Presence has no edit owner and cannot authorize operations. It provides
continuity and context to a task-scoped Pair Session.

### 6.2 Pair session

A `PairSession` snapshot contains:

- session ID and authority epoch;
- status and pause reason;
- confirmed goal and observable completion criteria;
- active operating mode and mode configuration;
- optional Pair Mode collaboration cadence;
- the learning agreement and current hint ceiling;
- current work unit, if any;
- consent scopes and model destination;
- local project-context references;
- last confirmed checkpoint;
- bounded event and evaluation summaries.

Chat history is presentation context, not authoritative state.

### 6.3 Learning agreement

At session start, the developer confirms a `LearningAgreement`:

- what they want to learn or keep fluent;
- what they already know well enough for delegation;
- which code generation, test design, debugging, or design decisions they will
  perform personally;
- which mechanical work the AI may own;
- how help may escalate;
- the independent variation or debugging check that can verify transfer.

The AI may propose this split, but it never infers or confirms it from behavior
alone. The developer can change it at any work-unit boundary.

### 6.4 Entry snapshot

When joining an existing project or in-progress task, the runtime creates an
`EntrySnapshot` from the actual workspace:

- workspace and branch identity;
- dirty, staged, and untracked file summaries;
- open and active documents;
- current document versions or hashes;
- active diagnostics;
- recent observed verification results;
- developer-confirmed goal, constraints, protected changes, and resume point.

The snapshot is local and bounded. Existing changes are treated as
developer-owned until explicitly assigned to a work unit. Adaptive Pair
observes before proposing action.

### 6.5 Work unit

Every code-changing activity belongs to one `WorkUnit`:

- objective;
- active mode and declared learning value;
- capability category: problem framing, design, test, implementation,
  diagnosis, repair, or verification;
- observable acceptance checks;
- allowed workspace root, paths, and optional symbols;
- edit owner: `human` or `ai`;
- navigator: the other participant;
- verification plan;
- baseline document versions or content hashes;
- stopping condition;
- status and result.

Only one participant owns edits within the unit. The human can always edit, but
a human edit that intersects an AI-owned scope invalidates affected pending AI
operations and requires reconciliation. Adaptive Pair never locks the developer
out of the editor.

### 6.6 Assistance state

Growth Mode records:

- the developer's attempt or explicit bypass;
- their failure prediction or diagnosis hypothesis when applicable;
- current hint level;
- whether a target solution was revealed;
- the independent check and its observed result.

These records describe the chosen process. They are not a global ability score.

### 6.7 Operation ledger

Every read, edit, check, or external action has an operation record:

```text
planned
  -> authorized
  -> started
  -> confirmed | failed | declined | cancelled | unknown
```

Only `confirmed` operations support success claims. `unknown` means an effect
may have occurred but its final state was not observed; it is never
automatically replayed when state-changing.

### 6.8 Evidence and reflection

Evidence describes an observation, not a verdict about the developer. A
reflection is a proposed summary at session close. It enters the profile only
after the developer reviews and accepts it.

## 7. State machines

### 7.1 Presence state

```text
off
  -> observing
  -> engaged
  -> quiet
  -> observing
  -> paused
  -> observing | off
```

`observing` means local bounded sensing is active. `engaged` means a task
session or explicit interaction is active. `quiet` suppresses proactive
interventions while preserving local continuity. `paused` stops observation
and model disclosure until the developer resumes.

### 7.2 Session state

```text
inactive
  -> briefing
  -> ready
  -> active
  -> paused
  -> reconciling
  -> active
  -> closing
  -> closed
```

Allowed variations:

- `active <-> paused`;
- `paused -> reconciling -> active`;
- `active -> reconciling` after a conflict or reconnect;
- any non-closed state may move to `closing`;
- `closed` is terminal.

A fatal adapter error pauses the session with an explicit reason. It does not
silently close the session or fabricate recovery.

### 7.3 Work-unit state

```text
proposed
  -> agreed
  -> executing
  -> verifying
  -> completed
```

Nonterminal units may become:

- `paused`;
- `needs-reconcile`;
- `cancelled`;
- `failed`.

`needs-reconcile` can return to `agreed` with refreshed scope and baselines, or
move to `cancelled`. A unit is completed only after its required verification
has an observed result or the agreement explicitly defined a non-executable
review method.

### 7.4 Handoff

A handoff proposal has no authority effect. Acceptance:

1. stops admission of new mutating operations;
2. cancels operations that have not started;
3. waits for or reconciles started operations;
4. increments the authority epoch;
5. records the new owner and refreshed baseline;
6. resumes the unit or creates its successor.

An explicit human pause or takeover outranks every pending proposal.

## 8. Operating modes and collaboration techniques

The top-level choice is not which style sounds best. It is whether doing this
work personally has current learning value for the developer.

| Mode | Primary outcome | Default AI authority | Honest completion claim |
|---|---|---|---|
| Practice/Growth | Form or retain a development capability | Read-only navigator | Work verified and transfer checked, or learning left unverified |
| Pair | Deliver while both participants perform meaningful development work | Only the agreed AI-owned work unit | Product result verified and role history reported |
| Delivery | Complete familiar or low-learning-value work efficiently | Broad agreed work-unit ownership | Product result verified; no pairing or growth claim |

The developer selects the mode from a short learning agreement. Adaptive Pair
may recommend a mode from the stated goal, but it never assigns one from an
inferred ability tier.

### 8.1 Practice/Growth Mode

Use Growth Mode for an unfamiliar technology, a capability the developer wants
to form, or a skill they want to keep fluent.

Required behavior:

- the human is the only project-file edit owner;
- the AI is a read-only navigator;
- the human writes an initial approach from an empty or current starting point;
- the human observes their code fail when a failure is part of the task;
- the human initiates the relevant verification by default and sees its actual
  result;
- before a direct diagnosis, the human records a hypothesis or explicitly
  bypasses that step;
- the human performs the repair and observes the new result;
- the session ends with a small analogous or varied task without AI mutation or
  a target solution.

The AI uses a progressive hint ladder:

1. ask the developer to restate the goal, prediction, or current evidence;
2. point to the relevant concept, boundary, or source location;
3. provide a strategic hint or question;
4. provide pseudocode, a partial skeleton, or an analogous example;
5. reveal a target-specific solution only after an explicit developer action.

Before level 5, the AI cannot emit a complete target patch, complete the target
function, or use an edit tool. A solution reveal is preview-only. Applying it
requires switching to Pair or Delivery Mode with a new work-unit agreement.

The developer can always bypass an attempt or request the answer. The UI then
states that the work may still be completed, but independent growth has not
been verified. A new variation, not the revealed target, is used for any later
transfer check.

A Growth session reports five outcomes separately:

1. whether the developer generated a similar implementation without AI
   mutation;
2. whether they diagnosed and repaired a varied failure;
3. whether they explained the important behavior and design decision;
4. whether they authored meaningful code during the session;
5. whether the evidence supports offering less help next time.

Skipping an outcome is allowed and recorded as `not-assessed`, never converted
to success. Any recommendation to reduce help is a correctable proposal, not an
ability classification.

### 8.2 Pair Mode

Use Pair Mode when delivery and active participation both matter.

- Every work unit has one explicit driver and the other participant navigates.
- The navigator checks direction, assumptions, evidence, and the next step.
- Both participants may ask questions and challenge a decision immediately.
- AI work on a learning-relevant unit is followed by a related human-owned unit
  unless the developer explicitly reclassifies the sequence as Delivery.
- Across a learning-relevant sequence, one side must not silently own problem
  framing, design, test, implementation, diagnosis, repair, and verification
  end to end.
- Handoffs occur at a completed goal, a block, a useful demonstration, or an
  explicit request, not on a fixed timer.
- Typing share is not a participation or learning score.

The session can start with either participant driving. AI ownership requires an
agreed scope and a host capability that the runtime can enforce.

#### P1: policy contracts before authority changes

P1 is intentionally smaller than the full Pair Mode contract. It uses the
existing `WorkUnit`, `LearningAgreement`, and `PairRuntimeSnapshot` types to
answer three deterministic questions without changing those values:

- Is a proposed Pair work unit sufficiently specified, does it respect the
  agreement's human-owned capability categories, and is verified bounded-edit
  support available if AI ownership is requested?
- Does a proposed successor respect an outstanding related human work unit,
  and would a completed human unit with observed verification satisfy that
  requirement?
- Can a matching handoff proposal proceed to human/baseline review once new
  operation admission has stopped and outstanding operations are settled?

The decisions authorized and implemented for this pure-policy increment are:

1. A learning-relevant AI unit (`high` or `mixed`) creates a related human
   follow-up requirement. An explicitly related, learning-relevant human unit
   can be admitted; only its completed state plus observed passing verification
   satisfies the requirement. Admission, a handoff, or an AI-written claim
   alone does not. A low-learning mechanical unit cannot discharge or bypass
   an outstanding requirement. Cross-capability follow-up is allowed when the
   relationship is explicitly identified; capability equality is not used as
   a proxy for relatedness.
2. An AI-owned unit cannot claim a capability reserved to the human by the
   current agreement. Renegotiation is an explicit future runtime transition,
   not a conclusion inferred from `delegatableWork` prose.
3. Handoff preflight reports readiness for baseline and human review, never
   acceptance or a new epoch. Pending operations block readiness; unknown
   state-changing completion requires reconciliation. A paused session or
   stale proposal is not handoff-ready. Human editing and emergency pause
   remain available independently of this assessment.

Capability flags, relationship identifiers, stopped admission, and observed
verification are host/core facts, not model-editable policy arguments at a
public boundary. P1 tests may construct such facts, but those fixtures are not
host capability evidence. P2 must bind them to durable, revision-correlated
state before any public route can rely on the policy. P3 must prove the actual
edit boundary before advertising AI ownership.

P1 does not implement the full category-rotation ledger, action grants,
handoff state machine, baseline refresh, version migration, edit adapter,
Presence nudges, or Pair chat. Those remain allocated to the roadmap, and
Growth's current runtime and manifest behavior must remain unchanged.

### 8.3 Delivery Mode

Use Delivery Mode for work the developer already knows well or judges to have
low current learning value, including:

- boilerplate;
- repetitive transformations;
- familiar pattern expansion;
- mechanical documentation;
- routine tests whose design is already understood.

Delivery Mode may give the AI broader ownership and optimize for verified
throughput. It retains scope, approval, conflict, privacy, and verification
invariants, but it does not require human code generation or an independent
transfer check.

The interface labels the session as delegation-oriented. It never describes
Delivery Mode activity as Practice/Growth or balanced Pair work.

### 8.4 Guidance strategy

Questions, hints, instructions, demonstrations, and reflection are assistance
techniques inside Growth and Pair modes, not separate top-level products.

The strategy can adapt within the developer-approved hint ceiling. It does not
change edit ownership. Strong-Style provides useful practitioner ideas about
adjusting abstraction and keeping the learner's hands active, but v2 preserves
immediate questions, objections, pause, and takeover.

### 8.5 Ping-Pong TDD cadence

Ping-Pong is an optional Pair Mode cadence after v2.0. It is available only when
the test environment has been observed to run reliably.

```text
owner A writes one intended failing test
  -> pair observes the expected red
  -> owner B makes that test pass
  -> pair observes green
  -> pair refactors while green
  -> owner B writes the next failing test
```

An infrastructure failure, unrelated failure, flaky result, or ambiguous red
does not advance the cadence. The session pauses or returns to ordinary Pair
Mode while preserving the goal and workspace.

### 8.6 Mode switching

Switching mode:

- never changes edit ownership implicitly;
- preserves the confirmed goal and completed work;
- closes, pauses, or reconciles the current work unit;
- records the stated learning-value decision and who accepted it;
- starts a new work unit under the target mode;
- resets or tightens the hint ceiling when entering Growth.

Moving to Delivery is always explicit. The runtime never interprets difficulty,
silence, a slow edit, or repeated failure as permission to take over.

## 9. VS Code integration

### 9.1 Extension and distribution profiles

Adaptive Pair is one VS Code extension codebase. It produces two mutually
exclusive VSIX channel artifacts from the same Pair Runtime, tools, sensors,
storage, UI, and tests:

| Artifact | API surface | Entry | Distribution |
|---|---|---|---|
| `adaptive-pair-<version>-stable.vsix` | Stable VS Code APIs only | Pair Presence and `@pair`; optional custom-agent plugin | Marketplace candidate and ordinary VSIX |
| `adaptive-pair-<version>-insiders.vsix` | Stable APIs plus `chatSessionsProvider` | Pair Presence, `@pair`, and Adaptive Pair Session Target | Insiders proof and direct VSIX only |

Both artifacts use the same extension identifier and cannot be installed
side-by-side. Channel manifests are generated from one reviewed base manifest:

- Stable excludes `enabledApiProposals`, `contributes.chatSessions`, and the
  proposed provider registration;
- Insiders adds the proposal, target contribution, controller, and content
  provider;
- protocol, state, tool, privacy, and mode behavior is identical;
- tests fail if a channel changes shared Pair semantics.

The Agent Plugin is optional. It can make Adaptive Pair available under the
Agent control on compatible Stable targets or distribute portable skills, but
the extension remains complete without it. There is no required second
installation for Pair Presence, `@pair`, or the Insiders Session Target.

No standalone AHP process is part of v2.0.

### 9.2 Entry-point layers

VS Code exposes separate controls that must remain separate in Adaptive Pair:

| Control | Meaning | Adaptive Pair decision |
|---|---|---|
| Workspace / folder | Where development is happening | Pair Presence is enabled here and can outlive one task |
| Session Target | Which execution harness runs the agent: Local, Copilot, Claude, Codex, Cloud, or an experimental contributed type | Keep provider targets selectable; evaluate an Adaptive Pair target without making Stable depend on proposed API |
| Agent | Which instructions and tools shape behavior | Select the Adaptive Pair custom agent when the target supports it |
| Adaptive Pair mode | Whether the work is Growth, Pair, or Delivery | Stored and enforced by Pair Runtime |
| Language model | Which model reasons | User choice within the selected target |
| Permissions and isolation | Native approval and workspace boundary | Reused in addition to Pair authority |

The primary workspace entry is **Enable Pair Presence** or **Pair here**, not
the Session Target selector. On the stable integration path, the chat entry is
the **Adaptive Pair custom agent** under the Agent control. Selecting it
attaches the conversation to the existing workspace Presence and Pair Runtime
state, then asks for or restores the Growth, Pair, or Delivery mode.

If the selected target does not expose the custom agent or required extension
tools, `@pair` opens the controlled surface against the same state. The user
does not need to restart or reconstruct the task.

An Adaptive Pair Session Target is technically possible today through the
proposed `chatSessionsProvider` extension API:

- `contributes.chatSessions` adds an extension-contributed session type to the
  native target UI;
- `createChatSessionItemController` manages new and existing sessions plus
  provider option groups;
- `registerChatSessionContentProvider` supplies native history, streaming, and
  a request handler;
- the provider can offer model, agent, permission, and other session options.

This route is attractive because Adaptive Pair can own the complete
instruction, tool, restraint, and state loop while still using native chat UI.
It is not yet a Stable or Marketplace foundation: the API is proposed,
subject to change, supported for third-party development in VS Code Insiders,
and explicitly not recommended for published extensions. A shared VSIX also
requires launching Insiders with `--enable-proposed-api`.

The first executable POC has confirmed:

- extension-contributed target action registration;
- `onChatSession:<type>` activation;
- dynamic participant routing when participant ID equals the session type and
  `canDelegate` enables registration;
- a target-scoped custom model through the proposed `chatProvider` API;
- untitled-to-real session materialization;
- content-provider loading;
- request completion through the default dynamic participant.

The POC has not yet confirmed persisted history, Pair tool routing, native
interruption, complete target-list coexistence, or visual quality.

The v2 strategy is therefore dual-track:

1. harden the working Insiders `Adaptive Pair` Session Target POC through Pair
   tool, history, cancellation, and coexistence tests;
2. retain the Stable Pair Presence, Pair tools, and controlled `@pair`
   adapter in the same extension;
3. promote the target to the primary chat entry if the API stabilizes and the
   proof satisfies mode, Presence, tool, cancellation, and distribution
   contracts.

The test matrix and current evidence are tracked in the
[Session Target technical spike](spikes/platform-adaptive-pair-session-target-spike.md).

Pair Presence remains the primary workspace lifecycle even if the Session
Target becomes the preferred way to start a chat. The Pair Runtime remains
model- and provider-agnostic inside the target.

A full standalone AHP server is a separate option. AHP defines an open,
agent-agnostic protocol and publishes client SDKs, but its TypeScript package is
currently a 0.9 client and wire-types library; the VS Code Agent Host is the
reference server. Building and discovering a third-party persistent host is
substantially larger than the proposed extension-host target and is deferred.

Target compatibility is capability-based:

| Session Target | Intended v2 use |
|---|---|
| Adaptive Pair (proposed) | Target and native request flow proven in Insiders; conformance hardening required before promotion |
| Local | Baseline full local experience because VS Code and extension tools run in the extension host |
| Copilot | Full experience when client extension tools, custom agent, cancellation, and context boundaries pass conformance |
| Claude or Codex | Full or controlled experience only after target-specific tool and customization conformance |
| Cloud | Delivery-only candidate; no Growth or live Pair Presence claim without a connected local workspace |

### 9.3 Native Agent adapter

The Agent Plugin contributes one visible Adaptive Pair agent. Human-to-AI and
AI-to-human handoffs are Pair Runtime domain transitions inside that session;
they are not VS Code agent-to-agent handoffs and native handoff UI never grants
edit authority.

The custom agent gives the model:

- Adaptive Pair session, context, evidence, edit, and verification tools;
- explicitly selected non-workspace tools that cannot bypass pairing state.

Built-in workspace read, edit, and terminal tools are excluded because they
would bypass Pair Runtime scope, consent, budget, and authority checks. Pair
tools may remain visible in both driver states, but the core rejects mutation
unless AI owns the current work unit. Tool availability is not the authority
boundary.

Native mode is enabled only when a startup capability probe verifies:

- custom-agent tool restriction;
- extension-tool routing;
- implicit and explicit context-disclosure semantics;
- Growth Mode response and mutation restraint;
- workspace identity and document-version observation;
- cancellation propagation;
- result correlation;
- required review or approval behavior.

Preview hooks may provide defense in depth, but are not a correctness or
security boundary.

### 9.4 Controlled chat adapter

If native mode cannot preserve an invariant, the VSIX offers `@pair` using the
same session core, mode policies, restraint rules, evidence, journal, and tool
adapters.

This is an alternate surface, not a second product implementation. The
controlled adapter owns its model/tool loop and exposes only operations that
the core authorizes. It can use:

- the exact VS Code Chat model selected by the developer;
- a configured local model;
- an OpenAI-compatible provider.

### 9.5 Safe degraded mode

When neither adapter can guarantee AI mutation authority, Adaptive Pair remains
usable as Human Driver / AI Navigator. It explains the missing capability and
does not present itself as an AI driver.

### 9.6 Presence

An Agent Host can continue without a connected editor client, but a live pair
cannot. Losing the VS Code client pauses new pairing mutations. The session may
retain conversational state in the host, but it must reconcile with the Pair
Runtime before editing resumes.

### 9.7 Implementation-independent mode conformance

Every host, model, and agent adapter runs the same observable mode-conformance
suite:

- Growth remains read-only for AI;
- help does not exceed the authorized hint level;
- a human attempt or explicit bypass precedes direct rescue;
- one work unit remains bounded;
- a complete target solution does not appear before explicit reveal;
- Pair and Delivery authority follow their agreed contracts.

The design does not prescribe whether an adapter satisfies the contract through
configuration, permissions, tool mediation, structured output, or another
mechanism. That belongs to the implementation plan and adapter contract.

When an adapter cannot satisfy a mode, Adaptive Pair disables that mode for the
adapter and explains why. It does not weaken or rename the product value to fit
a particular coding agent.

### 9.8 Native capability mapping

Adaptive Pair reuses native infrastructure where it preserves the mode
contract, and wraps workspace capabilities where direct exposure would bypass
Pair state.

| Native capability | Integration | Pair Runtime responsibility |
|---|---|---|
| Model picker and streaming | Reuse | Bind model identity and consent to the session; validate response class |
| Agent session and transcript UI | Reuse | Keep Presence, mode, work unit, authority, and outcomes as separate source of truth |
| Custom agent and Agent Plugin | Reuse | Supply versioned static product instructions and require an initial Pair state tool |
| Extension Language Model Tools | Reuse | Generate mode-aware visibility and revalidate every invocation |
| Tool confirmation UI | Reuse | Provide mode, owner, scope, effect, and operation ID in `prepareInvocation`; core still decides |
| Workspace read and search | Wrap | Enforce root, scope, size, count, sensitivity, and consent bounds |
| File edit | Wrap | Enforce mode, AI ownership, path scope, expected version/hash, authority epoch, and result reconciliation |
| Testing API and Tasks | Wrap | Run only the agreed verification and return observed status; on Stable the selected-test bridge is capability-gated and declines with `testing-api-unavailable`, so package scripts are the observed path |
| Terminal | Exclude in Growth; structured check in Pair; explicit bounded command in Delivery | Classify side effects, require consent, record unknown completion, never auto-replay |
| Web and MCP tools | Opt-in by work unit | Use native URL/tool approval, treat results as untrusted, and keep network effects outside automatic retry |
| Diff, changes, and checkpoints | Reuse for presentation | Record applied/saved/reverted state independently in the operation ledger |
| Agent hooks | Defense in depth only | Never rely on Preview hooks as the sole mode or authority gate |
| Agent Host reconnect and handoff | Reuse for conversation continuity | Pause mutation on client loss and reconcile Pair state before resuming |

The native custom agent excludes built-in workspace tools that cannot be
mediated or proven equivalent. It receives Pair extension tools instead. This
preserves the native model loop and approval UX without allowing the model to
step around work-unit authority.

### 9.9 Pair tool set

The first complete tool catalog uses stable product-level capabilities:

| Tool | Class | Growth | Pair | Delivery |
|---|---|---:|---:|---:|
| `pair_get_state` | read | yes | yes | yes |
| `pair_capture_entry` | read | yes | yes | yes |
| `pair_confirm_learning` | state | briefing only | hidden | hidden |
| `pair_select_mode` | state | briefing only | briefing only | briefing only |
| `pair_read_scope` | read | yes | yes | yes |
| `pair_search_scope` | read | yes | yes | yes |
| `pair_record_attempt` | state | yes | optional | no |
| `pair_record_hypothesis` | state | yes | optional | no |
| `pair_request_hint` | response | yes | yes | no |
| `pair_reveal_solution` | response | explicit | explicit | unnecessary |
| `pair_propose_work_unit` | state | yes | yes | yes |
| `pair_agree_work_unit` | state | briefing only | briefing only | briefing only |
| `pair_accept_handoff` | state | no AI ownership | later task | later task |
| `pair_apply_edit` | mutation | never | AI-owned unit only | AI-owned unit only |
| `pair_run_verification` | verification | human-initiated by default | agreed owner | agreed owner |
| `pair_run_command` | external effect | never | never in v2.0 | explicit bounded unit only |
| `pair_record_transfer` | state | later task | later task | later task |
| `pair_close_session` | state | yes | yes | yes |

Tool visibility can use native contribution `when` clauses and mode-specific
tool sets for a better model and user experience. Tool handlers still query the
latest Pair snapshot and return a stable denial if the visible view became
stale. Briefing visibility must also stay phase-aware so the agent can move
from capture to learning confirmation, mode selection, work-unit proposal, and
work-unit agreement without exposing tools that the coordinator cannot route.

Sensitive state transitions use a one-shot user-action grant bound to the tool,
Pair runtime revision, and authority epoch. A native confirmation, command, or
explicit chat action may create the grant through the adapter; the model cannot
mint or reuse it.

Every tool result is structured:

```text
operation ID
Pair runtime revision and authority epoch
confirmed | failed | declined | cancelled | unknown
bounded human-readable summary
bounded model-readable observation
sensitive-data and partial-result flags
```

The model never receives an exception containing private filesystem or process
details.

### 9.10 Instruction and tool synchronization

Before each model turn:

1. capture the latest Pair snapshot;
2. compile the instruction envelope and tool view from the same revision;
3. include mode, owner, hint ceiling, scope, and stop condition;
4. require `pair_get_state` before a grounded project answer;
5. bind every tool call to the captured session and authority IDs and consume
   any required one-shot user-action grant;
6. reject the final response if the state changed while awaiting the model;
7. publish tool outcomes separately from model prose.

Repository instructions, source, diagnostics, web content, and tool results are
delimited as untrusted data. They cannot switch mode, accept a handoff, raise a
hint ceiling, grant consent, or expand scope.

Instruction and tool changes are reviewed together. A new instruction that
mentions an unavailable capability, or a new tool without a mode contract and
conformance case, is a release-blocking defect.

### 9.11 Additive integration and native UX contract

Adaptive Pair coexists with VS Code and other coding agents by contribution,
not interception.

It must never:

- modify another extension's files, storage, commands, participants, tools, or
  session data;
- write `chat.*`, `github.copilot.*`, Claude, Codex, model, permission,
  keybinding, or code-isolation settings;
- change the user's default Session Target, Agent, model, permission level, or
  workspace choice;
- automatically route an ordinary Copilot Chat request to `@pair`;
- intercept, proxy, rewrite, hide, or cancel another participant's request or
  response;
- replace native Chat, diff, confirmation, Source Control, or session-history
  UI with an incompatible clone;
- activate observation, read workspace content, call a model, or use the
  network before explicit Adaptive Pair enablement.

All public identifiers use the `adaptivePair` or `adaptive-pair` namespace.
Default keybindings are not required. Any optional keybinding is conflict-free,
user-removable, and scoped to an explicit Pair command.

The Adaptive Pair Session Target is additive:

- it appears beside existing targets;
- installation and upgrade do not select it automatically;
- leaving the target restores the prior native controls without mutation;
- uninstall removes its contributions and active behavior;
- **Disable and Clear Pair Data** deletes extension-owned persisted state before
  uninstall when the developer requests data removal.

When inactive, the extension has no document listeners, timers, model calls,
file reads, or network activity. Presence event handlers perform no
synchronous work longer than one animation frame; expensive analysis runs
asynchronously after bounded debounce and cancellation.

The extension uses native presentation wherever possible:

- Session Target and Agent controls;
- model, permission, and isolation pickers;
- Chat streaming and tool progress;
- confirmation dialogs;
- diff and changes views;
- Testing, Tasks, terminal, and diagnostics surfaces.

Custom UI is limited to Pair-specific state that native UI does not represent:
Presence status, mode, work-unit owner, hint boundary, learning outcome, and
explicit Pair controls.

## 10. Interaction flow

### 10.1 Enable Pair Presence

The developer explicitly enables Adaptive Pair for a trusted workspace. Local
bounded observation begins and the UI shows `observing`. No remote context is
shared and no mutation authority exists merely because Presence is enabled.

The developer can start in `quiet`, switch to `Stay quiet` at any time, pause
all observation, or turn Presence off and delete its local continuity state.

### 10.2 Start a new project

For a product idea or empty repository:

1. clarify the problem, user outcome, constraints, and first observable
   behavior;
2. decide which setup and implementation activities have learning value;
3. select Growth, Pair, or Delivery for the first work unit;
4. create files or run setup only under that mode's authority contract.

The AI does not turn a product idea into a complete repository before the mode
and first work unit are agreed.

### 10.3 Start in an existing project

Before proposing work, Adaptive Pair:

1. reads the repository's existing guidance through the host;
2. identifies the current branch and dirty-state summary;
3. inspects relevant current files and verification surfaces;
4. asks the developer to confirm the goal and protected work;
5. builds the learning agreement and first work unit.

Repository documents provide context, not permission or automatically approved
requirements.

### 10.4 Join work already in progress

Join-in-progress is observation-first:

1. create an `EntrySnapshot`;
2. treat all existing edits as developer-owned;
3. summarize current code, diagnostics, and known check results without
   claiming the task's intent;
4. ask the developer to confirm the current goal, what must not be changed,
   where they are stuck or continuing, and what kind of help they want;
5. select the mode and agree on the smallest next work unit;
6. acquire AI mutation authority only through a later explicit Pair or Delivery
   agreement.

Adaptive Pair can join before the first line, after several files have changed,
during debugging, or near verification. It does not require the developer to
restart or reconstruct the task in a special workflow.

### 10.5 Shared work loop

1. **Brief the task and learning value.** Confirm the goal, criteria,
   constraints, unfamiliar areas, known areas, human-owned practice, and
   delegatable mechanical work.
2. **Choose a mode.** Select Growth, Pair, or Delivery explicitly. The system
   explains the capability and completion contract before work begins.
3. **Agree on a work unit.** Show objective, capability category, learning
   value, scope, owner, verification, and stop condition.
4. **Attempt or work.** Growth waits for a human attempt. Pair follows its
   explicit driver. Delivery permits the agreed AI ownership.
5. **Encounter and diagnose.** When a failure is relevant to Growth, record the
   developer's prediction or explicit bypass before direct diagnosis.
6. **Verify.** Run the agreed check through an observed host operation. Record
   exit, result, and relevant bounded output.
7. **Transfer, hand off, continue, or pause.** Growth runs a varied independent
   check; Pair reconciles outstanding effects before ownership changes.
8. **Close.** Report product completion and capability verification
   separately, summarize unresolved work, and offer a profile reflection for
   explicit review.

The UI always distinguishes:

- a proposal;
- an authorized operation;
- an operation in progress;
- an applied edit;
- a saved edit;
- a check that actually ran;
- product work that is verified;
- growth that is verified, unverified, or explicitly skipped;
- an unknown or failed result.

## 11. Editing, commands, and concurrency

### Edit application

An AI edit request includes:

- session, work-unit, operation, and authority IDs;
- workspace root and relative target;
- expected document version or content hash;
- bounded replacement or patch;
- the authorized scope.

The host adapter rechecks every field immediately before applying. A mismatch
does not trigger a best-effort merge; it records a conflict and moves the work
unit to `needs-reconcile`.

Growth Mode rejects every AI project-file mutation regardless of the model,
prompt, approval setting, or available host tool. A target-specific solution
may be previewed only after explicit reveal and cannot be applied without a
mode switch and new agreement.

### Human edits

Human edits are never blocked. When they intersect pending AI scope:

- pending operations for the affected baseline are cancelled;
- already-started operations are reconciled;
- unrelated work can continue;
- the UI identifies the exact scope requiring agreement.

### Verification

Structured verification uses the safest available host capability in this
order:

1. VS Code Testing API;
2. a declared task;
3. an existing package validation script;
4. an explicitly approved command adapter.

Arbitrary commands are not inferred from repository prose. A state-changing
command requires explicit classification and approval.

On VS Code 1.136 stable this order is capability-gated. The public
`vscode.tests` namespace exposes provider-side `createTestController` but no
consumer-side API to execute another provider's selected test IDs and observe
their completion or results, and undocumented `testing.*` commands are not used.
The stable verification adapter therefore keeps the Testing seam injectable but
its default port reports itself unavailable: a Testing plan is declined with a
typed `testing-api-unavailable` reason and runs nothing. An existing root
package validation script is the complete observed Stable verification path; the
concrete selected-test bridge is deferred to the native-adapter plan, where a
capability-gated host can supply observed results.

### Retry policy

- read-only effects may retry within a bound;
- idempotent effects may retry only with the same operation key and adapter
  confirmation;
- state-changing effects with unknown completion never retry automatically.

## 12. Failure and recovery semantics

| Condition | Required behavior |
|---|---|
| Human pauses or takes over | Increment authority epoch, stop new AI mutations, cancel work that has not started |
| Late model or tool result | Ignore for mutation if its revision or epoch is stale; retain a bounded audit record |
| Edit baseline changed | Do not merge silently; mark the unit `needs-reconcile` |
| Connection closes after dispatch | Record `unknown`, inspect actual workspace, never auto-replay a state-changing effect |
| Duplicate command or event | Return the prior decision by opaque ID; do not apply twice |
| Client disconnects | Pause mutation authority until client presence and workspace are reconciled |
| Model fails or exceeds budget | Surface the failure; local evidence remains available |
| Store write fails | Do not report persistence; keep the session paused if durable ordering is uncertain |
| Profile write fails | Keep the session result, report profile failure separately, and never invent a saved preference |
| Resume after restart | Replay/migrate the journal, inspect the workspace, reconfirm goal and edit ownership |

Previously confirmed edits are not automatically removed during pause or
failure. Rollback is a separate, explicit user action.

## 13. Persistence

**Implemented preview:** authoritative runtime snapshots and domain events live
in the atomic `InMemoryJournal` for the current extension lifetime. The separate
host `LocalJournal` persists bounded edit-episode continuity under extension
storage. Restart reconciliation of those episodes is not restoration of a
session, edit authority, action grants, or operation ownership. Disable clears
that persisted continuity and the current in-memory session. This stabilization
does not implement P2 session/ownership persistence.

**Planned v2 persistence:** a durable store adapter will keep the authoritative
event journal and immutable snapshots under extension storage, not in the
repository, while preserving the same atomic commit contract.

Pair Presence keeps its high-frequency observation window in memory. Only
bounded semantic summaries needed for resume or an accepted session event may
enter the journal.

The planned authoritative journal stores:

- domain events;
- operation metadata and outcomes;
- relative or hashed resource references;
- bounded evidence summaries;
- consent and profile decisions.

It does not store raw source buffers, secrets, full diagnostics, terminal
transcripts, or complete model conversations.

The planned writes use sequence numbers and atomic snapshot replacement. Startup verifies
the last durable sequence, migrates supported schema versions, and reconciles
the workspace before restoring mutation authority.

Developers can inspect, export, and delete session and profile state. Retention
has finite defaults and configurable local limits.

## 14. Privacy and security

Adaptive Pair separates four data planes:

| Plane | Examples | Default |
|---|---|---|
| Workspace-local | source, paths, diagnostics, editor events | local only |
| Model-bound | approved excerpts, goal, tool results | session- and destination-scoped consent |
| Session journal | state transitions, operation outcomes | local, bounded retention |
| Portable profile | explicit preferences, accepted reflections | local; optional sync adapter |

Additional rules:

- identify the model vendor, model, root, and purpose before disclosure;
- treat repository text and tool output as untrusted data, not permissions;
- compile instructions and the tool view from one immutable Pair runtime
  revision;
- detect credentials and private local-resource references before truncation;
- keep automatic evidence local unless the session consent includes it;
- keep continuous Presence events local and never stream them directly to a
  remote model;
- keep background remote observation off by default;
- enforce per-session call, input, output, and time budgets;
- store provider credentials through the host secret store;
- do not derive a personal profile from Git history by default;
- allow correction and deletion without penalizing future recommendations;
- publish a threat model and security policy with the first release.

VS Code approvals and sandboxing are useful host controls, but the Pair Runtime
still enforces work-unit authority. Preview hooks are not trusted as the sole
gate.

## 15. Evaluation

Evaluation is a product component, not post-release telemetry.

### Product quality contract

Adaptive Pair must produce professionally reviewable software, not merely a
pedagogically constrained conversation.

Every mode evaluates:

- acceptance-criteria completion;
- observed test, type, lint, build, and runtime results where applicable;
- regression coverage for the changed behavior;
- maintainability and consistency with repository conventions;
- security and privacy impact;
- unintended or reverted changes;
- independent review and rework burden;
- elapsed time and developer effort.

Growth controls do not excuse an incorrect or incomplete result. If the
developer cannot finish within the selected assistance boundary, they may
request a stronger hint, reveal the solution, or switch mode. The product
outcome remains unverified until the agreed checks pass, and the growth outcome
records any bypass separately.

Pair and Delivery must not lower product quality relative to using the selected
native agent directly. Before a stable release, the same representative tasks
run through native baseline and Adaptive Pair. Every deterministic acceptance
case must pass in both. Human evaluation uses a pre-registered non-inferiority
margin for correctness and independent review quality, chosen before seeing
the confirmatory results.

No mode promises perfect output. The release promise is that failures,
uncertainty, and verification gaps are visible and never presented as success.

### Local metrics

The runtime can record locally:

- accepted completion criteria and observed verification results;
- mode, declared learning value, and human-owned capability categories;
- human attempts, diagnosis hypotheses, hint escalation, and solution reveals;
- independently generated solutions and varied debugging outcomes;
- explanation checks, meaningful human-authored work, and correctable
  assistance-reduction proposals;
- applied, rejected, reverted, and conflicting edits;
- handoff proposals and outcomes;
- pause and takeover latency;
- interventions accepted, dismissed, or marked unwanted;
- active task time and waiting time separately;
- voluntary ratings of naturalness, fatigue, confidence, and initiative;
- results of consensual explanation, variation, or debugging checks.

No event is uploaded by default. Developers may inspect and export a
privacy-reviewed JSON bundle that omits source, paths, prompts, and direct
identifiers.

### Product experiments

1. Compare default coding-agent use with Growth, Pair, and Delivery Mode in
   counterbalanced studies appropriate to each mode's intended outcome.
2. Separate familiar tasks from tasks involving an unfamiliar library or
   codebase.
3. Measure output quality, verified correctness, elapsed time, effort, review
   burden, and understanding separately.
4. Add delayed independent tasks when making learning or retention claims.
5. Compare hint levels and answer-reveal behavior within Growth Mode without
   treating observational usage patterns as randomized effects.
6. Pre-register hypotheses and perform a power analysis before confirmatory
   studies.

Typing share, number of handoffs, confidence alone, and an AI-generated ability
score are not outcome measures.

## 16. Testing strategy

### Pure core

- table-driven tests for every allowed and rejected transition;
- property tests for authority monotonicity, event idempotency, and terminal
  states;
- mode-contract tests that prevent Growth from writing, Pair from bypassing
  ownership, and Delivery from making a growth claim;
- model-based tests that generate long event sequences;
- journal replay and schema-migration tests;
- deterministic fake clock and ID source.

### Adapter contracts

Every host, model, store, and profile adapter runs the same contract suite for:

- cancellation;
- stale revisions;
- duplicate results;
- bounded input and output;
- explicit failure reporting;
- disposal and reconnect;
- sensitive-data handling.

### Harness conformance

Every supported agent and model combination is tested for:

- calling `pair_get_state` before a grounded answer;
- seeing only the mode-appropriate tool view;
- denial of a hidden or stale tool call;
- Growth write and premature-solution restraint;
- Pair and Delivery owner checks;
- tool input-schema rejection;
- repository prompt-injection attempts to switch mode, expand scope, or grant
  consent;
- instruction and tool revision mismatch;
- separation of model prose from observed tool outcomes.

### Fault injection

Tests interrupt each boundary:

- before dispatch;
- after dispatch but before acknowledgement;
- after edit application but before save confirmation;
- during persistence;
- during handoff;
- during client disconnect and reconnect.

### Coexistence regression

A clean-profile baseline is captured before installing Adaptive Pair and
compared after install, enable, disable, channel upgrade, and uninstall:

- existing Session Targets, Agents, models, permissions, and keybindings;
- Copilot, Claude, Codex, Local, and Cloud session visibility and history;
- user and workspace settings;
- commands, tools, participant routing, and default selections;
- extension-host idle CPU, timers, listeners, file reads, and network activity;
- native Chat, diff, Source Control, confirmation, and diagnostics behavior.

The only allowed default delta is the addition of namespaced Adaptive Pair
contributions. No existing item may disappear, change default, or route through
Adaptive Pair.

### Product quality regression

The evaluation fixture set includes greenfield, existing-project, and
join-in-progress tasks with deterministic acceptance tests and independent
review rubrics. It runs against:

- the selected native harness without Adaptive Pair;
- Stable Adaptive Pair;
- Insiders Adaptive Pair Session Target when available.

Failures are reported by mode and task type. Aggregate speed cannot hide a
correctness, security, data-loss, or review-quality regression.

### VS Code validation

- Extension Host tests on the oldest supported Stable and current Stable;
- an Insiders compatibility job that may warn without blocking release;
- native Agent capability tests;
- a published restraint conformance suite covering premature patches, direct
  diagnoses, skipped attempts, oversized work units, and takeover attempts;
- Stable/Insiders manifest parity and package-content tests;
- optional Agent Plugin compatibility tests;
- package-content and clean-profile installation tests;
- manual authenticated model and consent smoke tests before release.

No CI test consumes a production model quota.

## 17. Release gates

A stable v2 release requires all of the following:

### Functional

- Pair Presence can be enabled, quieted, paused, resumed, and turned off;
- greenfield, existing-project, join-in-progress, and restart entry paths
  converge on the same session and work-unit contracts;
- complete Growth, Pair, and Delivery sessions;
- Pair Mode with both possible edit owners;
- planning, attempt where required, edit, diagnosis, verification, handoff,
  pause, resume, reflection, independent check where required, and close;
- local persistence, inspection, export, and deletion.

### Capability preservation

- Growth enforces read-only AI behavior and the configured hint ceiling;
- a complete target solution cannot appear before explicit reveal;
- bypass and solution reveal are visible in the session result;
- product completion and independent growth verification are separate states;
- Growth reports similar-generation, varied-debugging, explanation,
  meaningful-authorship, and next-assistance outcomes independently;
- Pair reports which participant owned design, test, implementation, diagnosis,
  repair, and verification work;
- Delivery never emits a growth or balanced-pair claim.

### Safety and recovery

- all authority and late-result invariants pass;
- conflict and unknown-completion scenarios are covered;
- no model claim is presented as an observed tool result;
- profile and model privacy boundaries pass contract tests.

### Product quality

- every deterministic acceptance task passes with observed verification;
- Growth, Pair, and Delivery results remain professionally reviewable;
- no critical correctness, security, privacy, data-loss, or regression finding
  remains open;
- native-baseline comparison and independent review results are published;
- growth verification is never used to hide an unverified product result.

### Coexistence

- install adds Adaptive Pair without removing or changing existing targets,
  agents, models, settings, sessions, keybindings, or defaults;
- inactive mode performs no observation, file read, model call, network call,
  timer, or document-listener work;
- another participant's request and response never routes through Adaptive
  Pair;
- Stable/Insiders replacement and uninstall affect only Adaptive Pair
  contributions and state;
- native Chat, diff, confirmation, Source Control, Testing, Tasks, terminal,
  and diagnostics UX remains intact.

### Platform

- Stable VSIX works independently through Pair Presence, Pair tools, and
  `@pair`;
- Insiders VSIX adds the proposed Session Target without changing shared Pair
  behavior;
- both channel packages use one extension ID and have a tested replacement
  upgrade path;
- native Agent mode passes its capability gate where advertised;
- a missing or incompatible optional Agent Plugin does not reduce core
  functionality;
- installation succeeds in a clean VS Code profile.

### Harness

- every instruction layer has a version and a conformance case;
- every tool declares mode, owner, scope, approval, retry, sensitivity, and
  result contracts;
- native built-in tools cannot bypass Pair workspace controls;
- visible tool filtering and invocation-time authorization agree;
- supported model and host combinations publish their mode-conformance result.

### User experience

- developers can identify the goal, work-unit owner, scope, verification state,
  and pause control without reading documentation;
- developers can invite Adaptive Pair into an in-progress task without
  discarding or restating all existing work;
- Presence, quiet, engaged, and paused states are always visible;
- pilot users can complete and resume a session;
- unwanted interventions and fatigue are measured and reviewed.

### Open source

- source, build, tests, release workflow, protocol schemas, and evaluation
  tooling are public;
- dependency licenses are compatible;
- release artifacts include checksums and a software bill of materials;
- contribution, security, privacy, and governance documentation is present.

The project does not claim superior productivity, learning, or satisfaction
until an appropriate study supports that claim.

## 18. Relationship to v1

The historical implementation on
`feature/realtime-pair-vertical-slice` is a tested reference and comparison
baseline, not the v2 architecture.

Port with their tests where their contracts fit:

- edit-episode aggregation;
- TypeScript/JavaScript semantic evidence;
- evidence normalization and inline presentation;
- project-context parsing;
- privacy classification and bounded projections;
- token-budget and cancellation techniques;
- lifecycle and fault-injection test cases.

Do not carry forward as v2 core:

- a VS Code-specific monolithic runtime;
- chat history as session authority;
- a model or tool loop coupled directly to the presentation surface;
- v1's navigator-only product constraint;
- repository-scoped personal ability data;
- duplicated native Agent behavior without a capability reason.

The v2 implementation starts in the v2 workspace structure. A reusable v1
module moves together with its relevant tests and receives a v2 contract test
before use. The v1 branch remains runnable as an evaluation baseline until the
v2.0 mode and release gates pass.

## 19. Pre-implementation proofs

These proofs select an adapter path; they do not reopen the core architecture.

1. Run the v1 Extension Host and a real-model session to establish the behavior
   baseline.
2. Run the Growth restraint conformance suite against each proposed agent,
   model, and host adapter and record premature solution, diagnosis, and
   takeover failures.
3. Extend the working Insiders Session Target proof with persisted history,
   Pair tool routing, native interruption, target coexistence, and visual
   review.
4. Build the complete native capability matrix and identify every capability
   that is reused, wrapped, excluded, or deferred by mode.
5. Verify that a custom agent can exclude built-in workspace tools, apply
   dynamic `when` visibility, and route extension tools through the Agent Host.
6. Verify instruction and tool snapshots remain correlated across mode,
   handoff, goal, and consent changes.
7. Verify cancellation, client disconnect, document-version, and result
   correlation semantics.
8. Verify Stable and Insiders VSIX manifests, packages, upgrade paths, and
   shared protocol compatibility; test the optional Agent Plugin separately.
9. Verify target-specific behavior for Adaptive Pair, Local, Copilot, Claude,
   Codex, and Cloud without assuming one target's result applies to another.
10. Record each native capability as supported, wrapped, excluded,
   advisory-only, or unavailable.

If a native capability is unavailable, the controlled chat adapter supplies
the full pairing behavior. If safe AI mutation is unavailable in both
adapters, the product runs Human Driver / AI Navigator and states the
limitation.

## 20. Initial v2 architecture baseline

- v2 is a fresh, host-agnostic open-source core.
- the core value is preserving opportunities to form and maintain direct
  development capability when AI could otherwise outsource the whole loop.
- Pair Presence supports new projects, existing projects, in-progress work, and
  resume without requiring a special task origin.
- Presence is explicit, bounded, local-first, and independently quietable from
  the current task session.
- VS Code is the first host, not the owner of product state.
- Pair Presence is the primary workspace entry.
- the stable chat path selects Adaptive Pair under Agent behavior; an
  Adaptive Pair Session Target is an Insiders experiment and candidate primary
  chat entry after API stabilization.
- Stable v2.0 does not depend on a proposed VS Code API.
- one extension codebase produces Stable and Insiders VSIX profiles; the
  optional Agent Plugin and any future AHP host are not required installations.
- integration is additive and opt-in; Adaptive Pair never changes another
  target, extension, session, setting, default, or native UX surface.
- Local, Copilot, Claude, Codex, and Cloud remain separate execution choices
  with published capability results.
- one edit owner is enforced per work unit.
- Growth, Pair, and Delivery are the stable v2.0 operating modes.
- Growth keeps AI read-only, uses a hint ladder, and separates product
  completion from independent transfer.
- Pair uses explicit Driver/Navigator ownership and prevents silent
  whole-loop monopolization.
- Delivery permits explicit delegation and makes no pairing or growth claim.
- guidance is a mode-level strategy; Ping-Pong is an optional later cadence.
- mode contracts are implementation-independent; Codex, Copilot, local models,
  and future agents are examples of adapters, not product definitions.
- a versioned harness kernel compiles instructions and tool views from the same
  immutable Pair revision.
- native orchestration and review UX are reused, while workspace tools are
  wrapped whenever direct exposure would bypass mode, scope, consent, or
  recovery rules.
- tool visibility improves guidance; invocation-time core authorization remains
  mandatory.
- native Agent integration is capability-gated.
- `@pair` is a supported fallback surface using the same runtime.
- local deterministic observation is on only during an explicit session.
- remote background observation is off by default.
- state-changing operations with unknown completion are never auto-replayed.
- personal data is local, explicit, correctable, inspectable, and deletable;
  optional account sync is an adapter.
- evaluation is local-first and present in the first release.
- product correctness and independent review quality are release gates in every
  mode and are compared with the native harness baseline.
- the v1 implementation remains a baseline and tested source of compatible
  modules, not a codebase to merge wholesale.

This document is a complete initial v2 specification. The Stable Growth Mode
preview (Tasks 1–12) is now implemented and validated by unit, property,
contract, and clean-profile Extension Host tests, including a runtime
outbound-network probe and automated release-artifact verification. Product
verification and the five Growth fields are reported independently, and no
Growth outcome is claimed from a started transfer. P1 now implements and tests
the pure Pair policy contracts. Pair runtime/host integration and Delivery
remain specified-but-unimplemented and empirically unvalidated pending their
own approved plans and validation. P1 does not change the Growth-only extension
or establish Pair edit authority, learning efficacy, or release completeness.
