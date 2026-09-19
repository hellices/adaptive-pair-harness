# Adaptive Pair v2: Research and Platform Rationale

**Review date:** September 14, 2026

This review supports the decisions in [design.md](design.md). It separates:

- product values supplied for the initial v2 plan;
- controlled evidence;
- observational evidence;
- practitioner guidance;
- current platform documentation;
- product hypotheses that still require evaluation.

It is a bounded evidence review, not a systematic review. Results from
human-human pairing do not automatically transfer to human-AI pairing, and
results from one model, task, population, or year do not establish a universal
effect.

## 1. Decision summary

The evidence supports:

- keeping the developer cognitively and operationally involved;
- preserving opportunities to generate, fail, diagnose, repair, and retrieve
  knowledge rather than only review completed output;
- adapting assistance to the task and declared preference;
- grounding claims in observed code and verification;
- treating productivity, quality, confidence, effort, and learning as separate
  outcomes;
- preserving immediate questions, objections, pause, and takeover;
- using local deterministic signals to complement model reasoning.

The evidence does not establish:

- a universal best pairing pattern;
- an optimal role-switch timer;
- a 50:50 typing target;
- automatic ability classification;
- guaranteed learning from Strong-Style or Ping-Pong;
- a claim that general learning-science effects transfer unchanged to coding;
- a universal productivity gain from coding AI;
- account-scale personal profiling as necessary for a useful first release.

## 2. Capability formation and the assistance boundary

The initial v2 product value is that coding agents can shift what a developer
practices:

| Direct development practice | Agent-centered practice that can replace it |
|---|---|
| Decompose the problem | Decompose the request |
| Generate an implementation | Read generated code |
| Encounter and diagnose an error | Review the agent's diagnosis |
| Build language and library fluency | Build agent-steering fluency |
| Internalize design decisions | Choose among generated proposals |
| Persist through a block | Call an agent when blocked |

The second column contains real and increasingly important capabilities. The
product claim is not that agent use causes no learning. It is that the two
columns are not interchangeable, especially for code generation, debugging,
and unfamiliar concepts.

### Why a coding agent differs from a calculator

A calculator usually offloads a bounded operation inside a larger reasoning
process. A coding agent can perform problem interpretation, solution choice,
code generation, error detection, debugging, test writing, and explanation.
It can therefore remove the entire attempt-feedback-repair loop that would
otherwise provide practice.

This comparison is a product risk model, not an empirical estimate that coding
agents are uniformly harmful.

### Relevant learning science

General learning research is indirect evidence for programming, but it helps
define what to test.

| Source | Finding | Limit | v2 implication |
|---|---|---|---|
| Slamecka and Graf (1978) [27] | Across five experiments, memory for participant-generated words exceeded memory for words that were only read. | Verbal-memory tasks, not programming or problem solving. | Do not assume reading an AI solution exercises the same capability as generating one. |
| Koedinger and Aleven (2007) [28] | The assistance dilemma asks when an instructional system should provide information and when it should elicit learner effort. | Cognitive tutors and education, not coding agents. | Make help escalation an explicit policy rather than always answering maximally. |
| Sinha and Kapur (2021) [29] | Meta-analysis of 53 studies and 166 comparisons found a moderate overall advantage for problem solving followed by instruction over instruction followed by problem solving, with important moderator and age limits. | Broad educational tasks; productive failure requires designed support and does not imply unguided struggle is always better. | In Growth Mode, obtain an attempt before targeted instruction while retaining progressive help. |
| Roediger and Karpicke (2006) [30] | Retrieval testing improved delayed retention more than repeated study, despite study increasing confidence. | Prose learning, not code production. | Use a later independent variation or debugging task and distinguish confidence from demonstrated transfer. |

These findings do not justify withholding help indefinitely. Minimal guidance
can also fail, particularly for novices [31]. Growth Mode therefore uses a
bounded hint ladder and an explicit answer escape hatch rather than unassisted
discovery.

### Coding-specific support

Shen and Tamkin [16] provide the closest direct evidence in this review.
Random assignment was to AI access, not to the six observed usage patterns.
The AI group scored lower on the immediate Trio assessment; participants whose
observed use emphasized conceptual questions or explanations had higher scores
than participants who relied on code and debugging completion. This supports
testing cognitive engagement and direct practice, but does not prove that a
particular interaction policy causes better learning.

The stable product requirement is therefore not "make the model educational."
It is to make the selected assistance boundary visible, testable, and
enforceable.

## 3. Pair programming evidence

| Source | Design and result | Limits | v2 implication |
|---|---|---|---|
| Hannay et al. (2009) [1] | Meta-analysis of pair-versus-solo studies found conditional trade-offs among quality, elapsed time, and total effort. | Heterogeneous tasks and study designs; publication bias; not a comparison of named pairing styles. | Evaluate quality, time, and effort separately. |
| McDowell et al. (2006) [2] | A 554-student course comparison reported higher confidence, enjoyment, program quality, and persistence; final-exam means among completers were not significantly different. | Non-random assignment and cohort differences; educational context. | Confidence and continued participation matter, but are not proof of understanding. |
| Umapathy and Ritzhaupt (2017) [3] | Educational meta-analysis of 18 manuscripts, 28 independent effect sizes, and 3,308 students found positive results in three of four domains, excluding affective measures. | Human-human classroom pairing; aggregate modes; no AI partner. | Pairing is plausible, but v2 must test its own interaction. |
| Plonka et al. (2011) [4] | Observation of 21 professional sessions found unequal keyboard use, substantial non-typing participation, and varied switching. | Observational and small; no optimal switch rule. | Do not score participation by typing share or force a timer. |
| Plonka et al. (2012) [5] | Qualitative work distinguished agreed observation from harmful loss of understanding. | Human-human setting and qualitative interpretation. | Quiet thinking is allowed; loss of the thread is handled through a question, not mind-reading. |
| Plonka et al. (2015) [6] | Interaction analysis found experts used direct guidance, questions, hints, and demonstrations for knowledge transfer. | Related observational corpora may overlap; no named-style efficacy ranking or long-term outcome. | Growth and Pair guidance can vary its scaffold without claiming superiority. |

### Practitioner techniques

Bockeler and Siessegger [7] describe Driver/Navigator, Ping-Pong, and
Strong-Style as practical techniques. Falco [8] describes Strong-Style from
long practitioner experience. These sources provide useful operating
definitions, not controlled comparisons.

These techniques sit below v2's operating modes:

1. Pair Mode uses Driver/Navigator as its default ownership technique.
2. Growth and Pair modes use questions, hints, instructions, demonstrations,
   and reflection without requiring blind trust or delayed objections.
3. Ping-Pong is a later Pair Mode cadence, conditional on a reliable test
   environment and an observed, intended failure.

## 4. Human-AI programming evidence

| Source | Design and result | Limits | v2 implication |
|---|---|---|---|
| Sarkar et al. (2022) [9] | Conceptual and experience analysis found LLM-assisted programming shares properties with compilation, search/reuse, and pair programming but is a distinct interaction form. | Not a controlled style comparison. | Do not copy human pairing rules unchanged; specify AI-specific authority and failure semantics. |
| Vaithilingam et al. (2022) [10] | Within-subject study with 24 participants found Copilot did not necessarily improve completion time or success; understanding, editing, and debugging generated code caused friction. | Small study and early tool generation. | Explanation, traceability, and actual verification are core, not optional tutoring. |
| Peng et al. (2023) [11] | Randomized experiment with 95 Upwork developers on a JavaScript HTTP server task found the Copilot group completed the task 55.8% faster. | One bounded task, early Copilot, recruited freelance population; preprint. | AI can accelerate suitable tasks; do not generalize the magnitude. |
| Barke et al. (2023) [12] | Grounded analysis of 20 participants across four languages found two interaction modes: acceleration when the programmer knew the next step and exploration when they did not. | Observational, small, early Copilot. | Adapt to current task state and intent rather than a fixed global ability tier. |
| Perry et al. (2023) [13] | A 47-participant security study found AI-assisted participants produced less secure code and were more likely to believe their code was secure. | Security tasks and an older model; not all programming work. | Separate confidence from verified correctness and retain deterministic checks. |
| METR (2025) [14] | Randomized 246 real issues from 16 experienced maintainers; early-2025 AI use increased completion time by an estimated 19%, despite perceived speedup. | Narrow expert OSS population, specific tools and period. The authors now label it out of date. | Real-repository effects can differ from benchmark or simple-task gains. |
| METR (2026) [15] | Follow-up estimates suggested possible speedup, but non-participation, task selection, lower pay, and concurrent-agent time measurement made the signal unreliable. | Severe selection and measurement effects; authors do not give a reliable current effect size. | Do not optimize or market v2 around a universal speed claim. |
| Shen and Tamkin (2026) [16] | Randomized 52 experienced-Python participants new to Trio, 26 per condition. AI assistance reduced immediate evaluation score by about 17 percentage points and did not significantly accelerate the main task. Explanation and conceptual-query patterns were associated with higher scores. | One unfamiliar library, one short task, chat interface, immediate assessment. The usage-pattern comparison was observational, not randomized. Preprint. | Preserve independent thinking, explanation, debugging, and later evaluation; do not claim a named mode causes learning. |

### Synthesis

The productivity findings are heterogeneous rather than contradictory:

- a bounded, familiar implementation task can benefit substantially;
- unfamiliar concepts can impose query, comprehension, and debugging costs;
- experienced maintainers on large repositories face context and review costs
  absent from simple tasks;
- user belief about speed or security can diverge from observed outcomes.

Adaptive Pair should therefore optimize a vector:

```text
verified product outcome
x developer initiative and control
x sufficient understanding to inspect and change the work
x willingness to continue
```

No single scalar score replaces the separate measures.

## 5. VS Code platform findings

The v2 checkpoint originally treated Coding Agent picker integration as
unverified. Current official documentation now establishes several usable
surfaces.

| Capability | Current platform evidence | Architectural decision |
|---|---|---|
| Session Target | VS Code documents Local, Copilot, Claude, Codex, and Cloud as execution harness or target choices, separately from Agent, model, permissions, and isolation controls. [32] | Keep Growth, Pair, and Delivery as mode contracts even if Adaptive Pair gains its own target. |
| Contributed Session Target | The proposed `chatSessionsProvider` API and `contributes.chatSessions` can register an extension-owned session type with native history, streaming, request handling, and provider option groups. A local Insiders POC confirmed target action, scoped model, session materialization, provider loading, and participant request completion. [33] | Continue conformance hardening; do not make Stable or Marketplace delivery depend on it. |
| Chat participant | The Chat Participant API provides an `@`-mentioned assistant that owns its request flow and receives the model selected in Chat. [17][18] | Keep `@pair` as a controlled, model-selecting fallback surface. |
| Extension tools | Language Model Tools can be contributed by Marketplace extensions, included in custom agents, restricted with `when` clauses, and given confirmation behavior. [19] | Expose Pair Runtime operations through mode-aware extension tools and revalidate every call. |
| Custom agents | `.agent.md` files define instructions, model choice, tools, visibility in the agent picker, and agent-to-agent handoffs. [20] | Offer an optional Stable Agent entry where compatible. Keep human-to-AI edit handoff in Pair Runtime. |
| Agent plugins | Plugins package skills, MCP servers, and Copilot-specific custom agents, hooks, and commands for marketplace or repository installation. [21] | Use only as optional custom-agent or skill distribution; do not make it a required second installation. |
| Agent sessions | Native sessions provide shared context, pause/resume, checkpoints, multiple surfaces, and handoff. [22] | Reuse presentation/session UX, but keep pairing authority in the open core. |
| Approvals | Manual, assisted, and allow-all permission levels plus per-tool settings exist. Specific tools can be marked ineligible for auto-approval. [23] | Integrate with native controls; do not rely on them as the only edit-authority gate. |
| Hooks | `PreToolUse` can deterministically inspect and deny operations. Hooks remain Preview. [24] | Use only as defense in depth, never as the sole product invariant. |
| Agent Host and AHP | Agent Host owns long-running native sessions; AHP uses synchronized immutable state, reducers, and reconciliation. Both remain under active development. [25][26] | Follow compatible state principles without making an unstable host protocol the product core. |

### Remaining platform risks

Official support for a feature does not prove it preserves Adaptive Pair's
semantics. The implementation must still verify:

- that a custom agent excludes built-in workspace read, mutation, and terminal
  tools that would bypass Pair Runtime controls;
- that implicit host context follows the declared consent boundary;
- that extension-tool results correlate with the correct session and work unit;
- how cancellation and late results propagate;
- how document conflicts appear;
- how a client disconnect affects an Agent Host turn;
- Stable and Insiders manifest/package parity and channel upgrade behavior;
- the optional Agent Plugin installation experience.

The architecture does not wait on these answers. A capability gate selects the
native adapter only when it passes. The Stable VSIX remains complete through
Pair Presence, Pair tools, and the controlled `@pair` surface.

Current stable public documentation describes first-party Agent Host adapters
and extension points for tools, MCP, custom agents, and chat participants. The
third-party Session Target path is proposed: VS Code registers `chatSessions`
contributions only when the `chatSessionsProvider` proposal is enabled.
Proposed APIs are Insiders-only for third-party development, subject to change,
and should not be used in Marketplace-published extensions [34].

AHP is open and agent-agnostic, but Agent Host integration is still under
active development. The TypeScript AHP package is currently a 0.9 client and
wire-types library, while VS Code's Agent Host is the reference server.

## 6. Design decisions derived from the evidence

### Open core, optional host

The product's defining behavior is authority, pairing rhythm, recovery, and
evaluation. Those rules remain open-source and host-agnostic. Native VS Code
features are adapters, not the source of truth.

### One edit owner

The human remains conversationally active in every mode, but a work unit has
one edit owner. This makes handoff, stale-result rejection, and conflict
handling explicit without using a keyboard lock.

### Three honest operating modes

- Growth protects direct capability practice and keeps AI read-only.
- Pair alternates meaningful work under explicit Driver/Navigator ownership.
- Delivery permits broad delegation and makes no learning or balanced-pair
  claim.

This separation is a product decision, not a research ranking. It prevents a
task-completion agent from silently behaving like Delivery while the interface
calls the experience Growth or Pair.

### Restraint is a behavioral contract

Codex, Copilot, and other coding agents are examples of systems that can
outsource the full development loop. The product value does not depend on one
agent or on whether a particular implementation uses configuration, tools, or
another control mechanism.

Every adapter must demonstrate the same observable Growth, Pair, and Delivery
contracts. An adapter that cannot preserve a mode does not expose that mode.

### Instructions and tools form one harness contract

Instructions alone are probabilistic guidance. A tool list alone can still be
misleading or unsafe if it is stale, too broad, or inconsistent with the
current owner. v2 therefore compiles both from the same immutable Pair state.

Native model selection, streaming, session UI, confirmation, diffs, and
checkpoints are valuable infrastructure. Workspace read, edit, test, terminal,
web, and MCP capabilities are reused directly only when their scope and
failure semantics match the mode contract; otherwise they are wrapped or
excluded. Invocation-time core authorization remains mandatory even when the
native UI hid the tool correctly.

### Presence, target, agent, and mode are separate choices

Pair Presence is the workspace-level lifecycle. Session Target selects the
execution harness. On the stable path, the Adaptive Pair custom agent selects
its instructions and tools. Growth, Pair, or Delivery selects the capability
contract.

An experimental Adaptive Pair target can own the complete agent loop without
changing those distinctions. Pair Presence and the mode contracts remain
portable state rather than becoming incidental chat-provider state.

### Local, low-noise observation

The v1 evidence engine is useful as a background sensor, but intervention
frequency is not proof of value. Local deterministic analysis can recommend
questions; remote background model observation is off by default.

### Ambient presence without ambient surveillance

The product must be able to start with an idea, an existing repository, or work
already in progress. A workspace-level Presence layer maintains bounded local
continuity and makes the AI available beside normal development. It does not
stream raw activity to a remote model, infer mental state from silence, or
acquire edit authority from observation.

### Additive integration, not workspace takeover

Adaptive Pair's value does not require changing the user's existing VS Code or
GitHub Copilot Chat defaults. It contributes its own Presence, participant,
tools, optional agent, and experimental target. Existing targets, sessions,
settings, models, permissions, keybindings, and native review UI remain owned
by their products and the developer.

This is both a product and evaluation requirement: a clean-profile coexistence
baseline must show that installing, enabling, disabling, upgrading, and
uninstalling Adaptive Pair changes only its own namespaced behavior.

### Explicit and correctable personalization

Task briefing and declared preferences outrank inferred expertise. Any proposed
reflection requires review before persistence. No single error, pause, typing
rate, vocabulary choice, or repository history creates an ability label.

### Verification and calibrated confidence

Applied files and observed checks are displayed independently from model prose.
Evaluation compares confidence with correctness instead of treating confidence
as success.

VS Code 1.136 stable constrains how observed checks can be produced. The public
`vscode.tests` namespace exposes provider-side `createTestController` but no
consumer-side API to execute another provider's selected test IDs and observe
their completion or results, and undocumented `testing.*` commands must not be
relied upon. The verified Stable path for observed checks is therefore an
existing root package validation script executed with explicit confirmation and
observed exit metadata; the concrete selected-test bridge is deferred to the
native-adapter plan, gated behind a host that can supply observed results.

### Product quality remains a co-primary outcome

Capability preservation does not compensate for broken software. Every mode
measures verified correctness, regression coverage, maintainability, security,
review burden, time, and effort. Growth and product outcomes remain separate,
and Adaptive Pair is compared with the underlying native harness on the same
tasks.

### Evaluation from the first release

Growth, Pair, and Delivery are all hypotheses. They ship with local metrics and
mode-specific completion claims rather than holding one mode to a stricter
standard than another.

### Implementation evidence for the next Pair increment

This is a code-and-test checkpoint, not a new learning-science result or a
revalidation of the platform references. It separates the `ae1f095` Foundation
and Growth baseline, the reviewed documentation examples, and the subsequent
P1 implementation evidence. The documentation merge `f28de5f` changes no
application source. Locally verified P1 contracts are not treated as a released
or usable Pair Mode experience.

| Evidence in the baseline | What it establishes | What it does not establish |
|---|---|---|
| `packages/protocol/src/types.ts` defines `pair`, work-unit owner, capability category, revision, and authority epoch | Pair has shared vocabulary to build on | A complete Pair lifecycle, handoff protocol, or participation history |
| `packages/modes/src/index.ts` exports only Growth policy | A host-independent policy package already exists | An implemented Pair policy |
| `packages/session-core/src/decide.ts` declines `RequestEditOperation`, and `packages/harness/src/toolCatalog.ts` hides handoff | Mutation and handoff declarations are forward-looking | Permission to advertise either operation as usable |
| `apps/vscode-extension/src/stableEffectPort.ts` implements scoped reads and observed verification, not mutation | The Stable preview has bounded effect seams | A guarded host edit implementation |
| The preview's `/transfer` records a start and its export adapter has no user command | Limited preview behavior is explicitly documented | Completed transfer, demonstrated Growth, complete metric aggregation, or a usable export flow |

The planning inference is to test pure Pair policies first, then bind them to
the durable runtime, and only then enable a proven host edit route. This is an
engineering sequencing proposal, not evidence that a policy-only library is
already safe as an authority boundary. The assignments and review status are
maintained in [the delivery roadmap](design.md#sequential-delivery-roadmap).

The proposed relationship rule uses explicit work-unit identity rather than
typing share, elapsed time, or guessed semantic similarity. Completing an
observed related unit can satisfy a Pair participation requirement, but does
not prove learning or populate any Growth demonstration field. These limits
must survive the later runtime and adapter integration.

#### Reviewed documentation checkpoint

Observed validation of this documentation checkpoint used Node.js 24.20.0 and
the repository's pinned tools. Application source, manifests, lockfile, and
test harness were unchanged from the baseline:

| Check | Observed result | Interpretation |
|---|---|---|
| Reviewed P1 code examples assembled outside the repository with unchanged TypeScript, Vitest, and ESLint configurations and the existing dependency layout | Three missing-export failures followed by green task runs of 23, 44, and 79 tests; every stage typechecked and passed ESLint | The final 79 comprise 19 admission, 21 follow-up, 35 handoff, and four existing Growth cases: 75 proposed policy cases, none installed into repository source |
| `npm run check` | Typecheck and lint passed; 40 test files and 596 tests passed | Existing non-host regression checks remain green, not proof that Pair is implemented |
| `npm run package` and `node scripts/verify-vsix.mjs` | Stable VSIX built and passed artifact verification | The existing Growth preview packages correctly; this does not verify future Pair behavior |
| `npm run test:host` on installed VS Code 1.137.0 | Complete isolated rerun passed all 17 smoke tests on 2026-09-16 and the runner exited with code 0 | Current baseline host revalidation is complete; no application source or harness change was needed |

Review reproduced missing-global type and lint errors in the original
immutability examples; the earlier isolated check had not established
compatibility with the modes package's compiler scope. The reviewed examples
use JSON snapshots rather than `structuredClone`, without adding ambient Node
declarations or changing package configuration. The original runtime count of
78 was reproducible (18 admission, 21 follow-up, 35 handoff, four Growth); the
additional empty-ID case brings the reviewed total to 79. Separate red/green
counterexamples also verified the corrected ID rejection reason and rejection
of handoff readiness while Presence is only `observing`.

These counts come from Vitest's JSON `assertionResults`, not a manual count of
assertions. The `observing` scenario was added to an ordinary loop inside an
existing handoff test, so handoff remains 35 test cases. Only the added
empty-ID `it.each` row increases the published case count.

Two earlier isolated attempts ended with runner exit code 1 before the full
suite completed. Their host logs recorded renderer-requested termination and
host exit code 0, without a reported Mocha assertion failure. The initiating
cause remains unconfirmed; those attempts are incomplete, not passes. The
complete unchanged-baseline rerun closes R0 without claiming a source fix.
Retain the interrupted-run artifacts locally rather than publishing logs or
machine-specific paths, and rerun the regression gates during implementation.

#### P1 implementation validation

On September 16, 2026, the repository owner authorized the next P1 increment
after reviewing PR #4 and requesting its merge and continuation. Execution
started from the merged `main` baseline `f28de5f` on a dedicated PR branch.
This approval covers pure policies only; it does not authorize P2/P3 authority,
persistence, host edits, or new extension controls.

The implementation adds three pure modules and three policy test suites in
`packages/modes`, typed test fixtures, and public exports alongside unchanged
Growth policy. The reviewed contracts are preserved; the fixture's type
imports are grouped at the top of the file. The initial P1 implementation
changed no protocol, runtime, session-core, harness, extension, manifest,
dependency, version, or lockfile. The separately reviewed maintenance below
was subsequently merged into `main` in PR #7 and integrated into P1.

The initial implementation checks used Node.js 24.20.0 and the repository's
then-pinned configurations:

| Check | Observed result | Interpretation |
|---|---|---|
| Execution baseline: `npm ci`, `npm run check`, and `npm run test:host` | Typecheck/lint, 40 files and 596 tests, and 17 isolated host tests passed before policy changes | Distinguishes the existing Growth baseline from P1 additions |
| Task 1 admission red/green | 19 tests failed because the export was absent; admission plus Growth then passed 23 tests, forced typecheck, and lint | Admission assesses declared scope, agreement reservations, and trusted edit capability without authorizing edits |
| Task 2 follow-up red/green | 21 tests failed because the exports were absent; cumulative modes tests then passed 44 tests, forced typecheck, and lint | Explicit relatedness, meaningful observed completion, and no mechanical bypass are pure assessments |
| Task 3 preflight red/green | 35 tests failed because the export was absent; cumulative modes tests then passed 79 tests, forced typecheck, and lint | Identity, revision, operational Presence, stopped admission, and settled operations gate review readiness, not authority transfer |
| Initial implementation `npm run check` | Typecheck and lint passed; 43 test files and 671 tests passed | 75 new Pair policy cases preserve the 596-test baseline |
| Modes JSON report | 19 admission, 21 follow-up, 35 handoff, and four Growth cases; 79 passed, zero failed | Counts are measured from `assertionResults`; ordinary assertion loops do not add cases |
| `npm run package` and `node scripts/verify-vsix.mjs` | Stable VSIX built and verified with seven archive entries | Packaging remains the Growth-only preview; there is no Pair edit route |
| `npm run test:host` on VS Code 1.137.0 | All 17 isolated smoke tests passed; runner exited with code 0 | Additive activation, zero inactive activity, Growth behavior, and coexistence remain verified |

Independent AI review of all 12 changed files at `0f2c85f` found no material
implementation defect or plan inconsistency. It independently passed the 79
modes cases, fresh compiler diagnostics across 14 projects, and lint. Its
broader read-only run passed 668 cases and intentionally skipped three
repository-writing cases; that result is separate from the author's complete
671-test and 17-host-test runs, not a substitute for them or human approval.

The PR #6 checkpoint at `2364b41` passed all four CI jobs and had no unresolved
threads or pending review requests. The initial checklist-clarity finding was
fixed and resolved with an original-thread evidence reply. Copilot's follow-up
recommended approval with two non-blocking test-title grammar notes; the
titles and matching plan examples were corrected without changing assertions
or case counts. Later revisions still require their own fresh review and CI
before merge readiness; the live PR records that evidence.

The original `f28de5f` dependency installation reported three audit advisories
(one low, one moderate, one high) and deprecation warnings. The P1 policy code
did not resolve them; the separately reviewed PR #7 maintenance below did.
Those original findings are historical evidence, not the maintained graph's
current audit result. Existing Vite and isolated-host diagnostics are not
claimed to be fixed by that maintenance.

The API's trusted-input conditions remain essential: the future core must
derive accepted-work provenance, preserve outstanding follow-up requirements,
correlate observed verification with the agreed unit, and enforce admission
barriers and authority transitions. P1 neither proves those runtime bindings
nor validates filesystem safety, complete Pair collaboration, or learning
efficacy. The PR review loop and final-revision CI are tracked separately from
these local results; P2 requires its own scope review and approved plan.

#### P1 post-maintenance integration

On September 16, 2026, the owner requested merging maintenance PR #7 and
continuing. PR #7 was merged into `main` at `79d75ab`. The existing P1 branch
integrates that baseline through a normal merge, preserving its published
history, the maintenance policy, and both dependency-audit gates. The adjacent
P1 and maintenance evidence sections were both retained when resolving the
documentation conflict. The three policy modules, public exports, fixtures,
and tests are unchanged from the previously reviewed P1 head `7732bb1`.

Fresh validation used process-local Node.js 24.20.0 and npm 10.9.4 without
changing the machine's default runtime or registry configuration:

| Check | Observed result | Interpretation |
|---|---|---|
| Maintained `main` baseline: `npm run check` | Typecheck, lint, 40 files and 598 tests passed before integration | Includes the two audit-contract cases added by PR #7 |
| Integrated P1: clean install, forced typecheck, and `npm run check` | Typecheck, lint, 43 files and 673 tests passed | Preserves 598 baseline cases plus the same 75 P1 cases; no new product behavior |
| Modes JSON report | 19 admission, 21 follow-up, 35 handoff, and four Growth cases passed | The policy suite still contains 79 cases, counted from `assertionResults` |
| Separate root and POC clean installs, installed-tree checks, full audits, and production-only audits | Both installed trees are valid; all four audits report zero findings | Includes development dependencies in the full audits; manifests and both lockfiles match maintained `main` |
| Stable packaging and archive verification | Passed with seven entries | The shipped extension remains the Growth-only preview |
| Main isolated host on VS Code 1.137.0 | 17 cases passed; runner exit code 0 | Revalidates the existing inactive-zero, Growth, and coexistence behavior |
| Separate POC compilation, unit tests, and packaging | Four files and six unit cases passed; eight-entry VSIX built | These cases are not added to the workspace's 673 cases |
| Separate POC isolated Insiders host | One case passed; runner exit code 0 | Native target/provider smoke only, not completion of the open spike |

The first POC host attempt stopped before test execution because DNS lookup
for `update.code.visualstudio.com` returned `ENOTFOUND`. A subsequent DNS probe
succeeded and the unchanged `npm --prefix poc/session-target run test:host`
command passed on retry. The failed attempt is not counted as a pass and no
source or test workaround was applied. The downloader reported identifier
`07b4ff1883f94da91f6d698744fc7c3638b59720`; the tested application's bundled
metadata reported version `1.139.0-insider` and commit
`c74ba73b780a4a33173c006e52560d61432f53d6`. These are distinct observations,
not interchangeable build identifiers or a claim to have tested all Insiders
versions.

At that integration checkpoint, local validation did not approve or merge the
revision; PR #6 remained the record for final-head CI, reviews, original-thread
responses, and resolutions. The owner subsequently directed its merge, recorded
at `9eebbf19e201b0ff6642868728ef217738ad31f7`. That merge does not authorize
P2/P3, change the Stable host floor, or expose Pair runtime or editing controls.

#### Runtime boundary stabilization

After P1 merged, the owner authorized pragmatic architecture refactoring before
the next product increment and explicitly required bounded code units. The
canonical implementation plan replaces the completed P1 plan; this is not P2
implementation or new evidence of learning effectiveness.

The audit reproduced defects despite a green 673-test baseline: the production
store could acknowledge two commands at the same revision while retaining only
one result; direct snapshot replacement let a pending command undo Disable or
overwrite an observation. The implementation replaces split append/save and
out-of-band replacement with one queued, atomic core transition path. Tests use
the same store contract rather than a more permissive substitute.

The Growth response-release workflow and model contracts move inward to the
runtime. Independent AI review caught a new extraction regression: an await
between final validation and Markdown/evaluation publication allowed Pause to
commit before stale output was displayed. A second review reproduced an earlier
gap: awaiting a final snapshot can return state captured before a queued Pause
commits. Both plain and runtime-bearing model results then appeared delivered
while the authoritative store was paused. Those two full-participant regressions
failed before replacing the async final read with a required synchronous live
view of the same store. Asynchronous request work now ends before that read;
finalization, evaluation, and Markdown publication stay in one continuation.
The two incoming-snapshot regressions and all eight existing publication
interleavings pass, retaining their live-state and delivered-output assertions.

Review also reproduced obsolete host intent, stale listener/status projections,
and workspace capture continuing after Disable. Twelve focused lifecycle cases
now cover trust waits, deferred Enable/Disable completion, stale callbacks,
disposal, and capture interrupted by Disable/Pause/dispose. Independent AI
re-review reported 360 passing Disable interleavings, delayed projection and
stale-callback probes, and cancellation checks across metadata and native
filesystem waits. This is engineering verification, not human approval or a
replacement for final-branch CI and host checks.

Typed ESLint existed before this work, but file/function size rules did not.
Ten code-size policy cases failed before the rules were enabled, then passed.
Production/release files and functions are limited to 400/100 effective lines;
tests, fixtures, and host cases use 600/200. A further negative probe exposed
ESLint's default exemption for immediately invoked functions; explicit `IIFEs`
enforcement closes it in both rule configurations. Inline suppression is disabled
and warnings fail lint. Large modules and suites are split by responsibility while
preserving their assertions. The isolated POC is also linted; its Promise-based
completion and immediate streaming behavior are characterized separately.

The same ESLint blank/comment accounting measures these reductions against the
merged P1 baseline; extracted responsibilities remain subject to the same limits:

| Module | Before | After (effective lines) |
|---|---:|---:|
| Growth participant | 947 | 106 |
| Model adapter | 598 | 255 |
| Verification adapter | 866 | 207 |
| Core decision dispatcher | 578 | 61 |
| Core event reducer dispatcher | 522 | 69 |
| Runtime coordinator | 644 | 266 |

The dependency checker has negative fixtures for forbidden/undeclared imports,
project-reference mismatches, deep/relative package escapes, and graph cycles.
It reproduced the extension's missing direct protocol declaration before that
manifest and the lockfile were corrected. Independent integration review found
two further gaps: reference-only edges lacked declaration/direction checks, and
authored host fixtures plus root/POC configurations escaped lint. Thirteen added
cases failed before these fixes. The final guard suites contain 22 architecture
and 22 code-size tests; all pass, including actual oversized fixture/configuration
and IIFE probes. Standalone configurations and intentionally incomplete host
fixtures use syntactic lint, not type-aware checks; the size/suppression rules
remain enforced. Fixture-only unused function parameters preserve the deliberate
bug exercised by the unchanged host scenarios. The original reviewer rechecked
both fixes and reported specification and quality passes.

Separate independent reviews preserved all 17 host scenario names/order and 100
assertions, all 28 verification exports and their original test cases, and the
POC's immediate Promise-executor behavior. Verification extraction review matched
512 baseline/candidate traces; core/runtime extraction review matched 8,426
decision and 3,411 reducer comparisons. These are bounded differential probes,
not an exhaustive proof or a substitute for the repository PR review.

The only lockfile changes add the extension's protocol edge and runtime's
restraint edge; external versions are unchanged.

Pre-PR local refactoring validation, run with Node.js 24.20.0 after the guard
follow-ups, completed successfully:

- Clean installation of both dependency graphs, forced workspace typecheck,
  expanded lint, and **834 tests across 70 files**.
- Stable bundle and VSIX creation/inspection, with **7 archive entries**.
- **17 isolated host scenarios on each of VS Code 1.136.2 and 1.137.0**, both
  exiting 0. The tests retain inactive-zero, production-wiring, and coexistence
  assertions; they never use the developer's profile.
- Separate POC compilation, **8 unit tests across 4 files**, a **9-entry VSIX**,
  and **1 Insiders host test** exiting 0. The cached application reports
  `1.139.0-insider`; the downloader's build identifier is not its application
  commit or an additional tested host.
- Both installed dependency trees validate, and all four full/production-only
  audits return zero vulnerabilities.

The existing native Vite configuration-loader warning and host diagnostics were
not suppressed. These are local execution and independent AI-review results,
not claims about a future PR revision. The PR's review/check history remains
the record of repository review, follow-up handling, and final-head CI. The
owner explicitly authorized merging this refactoring after those gates pass,
then proceeding to the next reviewed increment.

PR #8's initial four CI jobs passed at `41d9af7`, but its first repository review
requested changes. Follow-up probes reproduced the open-buffer filesystem
identity bypass, cancelled publication, stale human-action grants, late model
completion, malformed package scripts, and process-ID reuse. A second repository
review identified inconsistent binary rejection for dirty scope buffers and a
missing-file alias gap in verification's dirty-buffer check. Passing baseline
tests did not disprove those findings, and out-of-date review locations were not
treated as resolved concerns.

Open-document context now resolves filesystem identities before reading buffer
content. Missing/new files resolve through existing ancestors; dangling links,
escaping identities, and secret aliases remain excluded. Twelve authored cases
include ten pre-fix failures and two positive controls. Scope reads additionally
apply the disk path's NUL-content rejection to dirty buffers, including safe
symlink aliases; six cases failed before that correction, with five controls
preserving text, byte-limit precedence, and binary disk rejection.

Growth publication and explicit-action tests first reproduced twenty failures
with five controls. Independent re-review then found a separate transfer
continuation after the initial publication; four more timing cases failed before
the continuation gained its own cancellation guard. The independent reviewer
reported all 98 final timing/intent probes passing, including pre-abort
publication, late-cancellation controls, and all 28 grant-binding probes. Native
Chat tokens and models were simulated; this is not a host-test claim.

Model transport probes distinguish stream completion, final token accounting,
and model dispatch. Four initial late-success failures led to completion gates;
independent review exposed that the timer cancelled a derived signal while those
gates still consulted the caller's signal. Four additional cases reproduced
clock-rollback success and dispatch after input-accounting cancellation. The
derived timer reason is now latched and checked throughout the turn. Four more
cases verify that rejected input/output token accounting retains time-cap or
user-cancellation classification instead of leaking a provider error.
Independent re-review reported all 46 model tests, 35 additional transport probes,
and 120 actually token-cancelled real-clock trials passing; ordinary provider
errors and timer/listener cleanup were also checked.

Verification manifest validation rejects every non-string script value before
confirmation or execution. The first Windows correction replaced a permanent
PID set with weak child-object keys. It addressed retention and PID reuse, not
proof of tree exit; the third reassessment below supersedes that confirmation
mechanism. Eleven pre-fix failures
and 21 controls pass after the fixes. Independent verification reported 57
additional manifest/lifecycle probes passing and collection of 10,000 released
child objects, compared with retention under a strong-set mutation. Windows
system calls were mocked; native Windows execution was not tested.

Deleted/new dirty verification buffers now resolve through the nearest existing
canonical ancestor, retaining safe alias membership without inventing a usable
identity for dangling links or unavailable roots. Fourteen cases failed before
this correction and four controls already passed. The 18 authored cases use
temporary real filesystem trees; access-denial faults use the existing identity
seam. Construction remains lazy and performs no identity lookup.

Runtime follow-ups dispatch a clone of the persisted operation input, check
cancellation across grant snapshot/queue/load boundaries, and remove parent abort
listeners when an invocation settles. Eight pre-fix failures led to those
corrections. Independent review found no ordinary-invocation admission race in
198 schedules per revision, but reproduced a concurrent-reconciliation escape:
an aborted read could be redispatched through an unlinked recovery controller.
Ten additional failing cases and two controls led to queued fresh recovery
admission, in-flight exclusion, and registered cancellation, with effects still
outside the mutation queue. The recovery tests also preserve safe orphaned-read
retry, failure cleanup, and no automatic replay of unknown mutations.

Archive end-record boundary probes did not reproduce a defect. Independent
review rejected 193 short-buffer variants with the typed archive error and
accepted 12 valid boundary archives, including maximum-length ZIP comments. The
parser is unchanged; the permanent short-buffer/comment tests characterize its
existing behavior rather than claiming a speculative parser fix.

After these follow-ups, local validation on the frozen source/test tree with
Node.js 24.20.0 completed successfully:

- Forced workspace typecheck, full enforced lint, and **972 tests across 81
  files**.
- Stable bundle, **7-entry VSIX**, and explicit archive verification.
- **17 isolated host scenarios on each of VS Code 1.136.2 and 1.137.0**, both
  exiting 0 with inactive-zero and coexistence assertions intact.
- Separate POC compilation, **8 unit tests across 4 files**, **9-entry VSIX**,
  and **1 Insiders host test** exiting 0. Application metadata again identifies
  the tested Insiders cache as `1.139.0-insider` at
  `c74ba73b780a4a33173c006e52560d61432f53d6`.
- Both installed dependency trees valid and all four full/production-only
  audits at zero findings; external versions and both lockfiles are unchanged
  by these review follow-ups.

That checkpoint was committed as `8fd60be`; all four CI jobs passed, and the
three original inline concerns received evidence replies and were resolved.
The subsequent repository assessment still identified five concerns. Existing
Vite and native host diagnostics remain visible rather than suppressed.

##### Second PR reassessment

Review `5226378228` publishes three summary-only composition findings: transfer
intent changing during consent, agreed aliases rejected by the canonical result
check, and missing dirty buffers rejected before they can be read. Its logs name
two additional runtime locations without publishing their complete bodies. The
review response requests those bodies; independently verified defects are not
presented as reconstructed reviewer text.

Cancellation of local commands during snapshot, queue, or validation waits
first produced 14 failures with four controls. Passing an abort signal through
the existing transition queue now preserves uncommitted grants/state and retains
already committed actions. Independent review passed 68 relevant tests and 24
additional in-memory probes on its frozen patch, including queue recovery and
effect cancellation. The public coordinator dispatch API is unchanged.

Transfer captures intent before consent and carries it through runtime
preparation/finalization and the accepted result's later state/note continuation.
The 35 real-coordinator cases initially had 18 failures and 17 controls;
same-intent revision advances remain supported. Scope access and its effect
runner now share a canonical per-operation permission snapshot. Real-filesystem
composition tests initially produced 19 failures with 17 controls, then exposed
one additional regular-file-ancestor defect. The corrected suite retains
unagreed child-link rejection, missing-buffer safety, cancellation, and UTF-8
limits instead of accepting arbitrary lexical result paths.

The state-query investigation independently reproduced diagnostics, source
paths, operation input, and available grant identifiers reaching both the native
tool response and a later Growth model request. An accumulated response exceeded
the catalog's 8,000-character limit while reporting non-sensitive, non-partial
data. No model-side grant bypass was established: native confirmation, Growth
direct-action restrictions, and the harness's object-bound grant checks remained
effective. Data disclosure, not an invented privilege escalation, is the defect.

The replacement is a small runtime-owned, frozen allowlist projection. Raw text,
paths, operation records, and grants stay internal; safe bounded identifiers and
status/hint/verification metadata remain available. Unsafe identifiers are
omitted and flagged partial, not truncated into new identities. Verification
counts only the actual verification tool for the current work unit and authority.
Twenty-one authored runtime/native/Growth cases failed before the correction and
pass after it, including long input histories, unsafe identifiers, unknown
future fields, grant preservation, and one-shot reuse rejection.

Independent state-projection review passes on its frozen patch: the real
coordinator/native-tool/Growth-loop reproduction removes seven private canaries
from model-visible results while preserving them internally. A 10,000-operation
fixture produces a 683-character state result. The reviewer also checks 144
identifier cases, three mixed-ID controls, 196 hint-policy combinations, pending
verification settlement, recursive freezing, and native confirmation/one-shot
controls. Its 166 scoped tests, no-emit typecheck, and typed lint pass. Output
size is bounded, but verification aggregation still scans history; operation
settlement is not a claim that product assertions passed. Native host/model
interfaces are doubled in these independent probes.

The initial integrated second-round source/test checkpoint passes forced typecheck,
enforced lint, and **1,083 workspace tests across 87 files** under Node.js
24.20.0. Stable build/7-entry packaging and the separate POC's 8 unit tests and
9-entry package pass. All 17 isolated host scenarios pass on each Stable matrix
version (1.136.2 and 1.137.0), and the POC's Insiders host case passes. Both
Stable application commits are unchanged from the earlier checkpoint; the
freshly downloaded POC host's application metadata is `1.139.0-insider` at
`4dbe1643e6189ba7b1bbe542cc0e56a94d9ff132`, rather than the download log's older
archive label. Both installed dependency trees are valid and all four
full/production-only audits
report zero findings. Independent transfer/scope/projection reviews, repository
reassessment, and final-head CI remain gates; this checkpoint is not a
prospective merge approval.

Independent review then found an identical-session recreation case: Disable and
a new `SessionStarted` can reuse all IDs and agreement values while resetting the
epoch to zero. Six transfer probes failed despite the initial 35 tests passing.
The correction derives `startedAtRevision` from committed event metadata and
adds it to the transfer intent. It preserves harmless observation advances and
existing epoch/command/event semantics instead of relying on user-supplied IDs,
wall time, or an adapter-local counter. The new lifecycle cases and core snapshot
assertion produced nine failures with 43 controls; all 52 pass after correction,
along with forced typecheck and full lint. Replay checks respect the existing
journal's deliberate pruning of history before Disable.

Scope review also reproduced four valid-operation regressions caused by an
unrelated stale dirty document whose ancestor became a regular file. The
structural not-a-directory outcome now retains `ENOTDIR`: dirty-buffer matching
skips the impossible candidate, but requested-path normalization propagates the
error. Four new regressions failed before this correction; eight additional
controls preserve EACCES and cancellation handling. The 49 composition cases
and all 164 related scope tests pass without lexical fallback or weakened
requested-path rejection.

Independent scope re-review passes all 164 supplied cases, the prior 59
adversarial probes, and 18 additional invalid-target, real EACCES/ELOOP, and
cancellation-precedence controls. The four original stale-buffer regressions
fail on the previous patch and pass on the correction. Its pinned no-emit
typecheck, typed lint, and size checks pass; VS Code is mocked and native Windows
execution is not part of that verdict.

After the lifecycle and stale-buffer corrections, a fresh integrated run passes
**1,105 tests across 89 files**, forced workspace typecheck, full enforced lint,
Stable build and explicit **7-entry VSIX** verification, and **17 isolated host
scenarios each on VS Code 1.136.2 and 1.137.0**. The isolated POC and dependency
graphs are unchanged from their recorded second-round checks. The final Growth
lifecycle reassessment subsequently passes, alongside cancellation, disclosure,
and scope review. All four CI jobs pass at `d84c4fe`, including the Insiders
test step. Repository review `5227383478` then requests additional changes;
neither the scoped approvals nor successful CI clear those new findings.

#### Third review: consent lifetime, tool boundaries, and termination evidence

Real coordinator Disable/recreation tests reuse the same session and work-unit
IDs. Twelve initial failures with one control expose a model-only consent cache
and lifetime-unaware transfer/check records, including deferred consent. The
fix binds destination grants and transient state to workspace, session ID, and
committed `startedAtRevision`; it preserves repeated consented requests within
one lifetime. Three additional failures expose a confirmed check being rendered
after recreation, pause, or an observation commits; synchronous final publication
now rejects those stale results without assigning them to the new state.

Independent route review later finds three publication/admission gaps: a
`/session` continuation can display expired cached outcomes, reveal confirmation
can open after admission changes, and a declined modal can write after Chat
cancellation. The 58 focused reproduction/control cases are promoted into the
repository: 25 fail before correction and all 58 pass afterward. Ordinary
coordinator scheduling reproduces 14 of the failures without a snapshot mock.
Session display now uses the live synchronous snapshot; reveal is fenced before
confirmation; neither declined modal writes after cancellation. Two existing
transfer controls also require a non-cancelled decline to remain neutral across
lifecycle changes. They initially expose an overly broad stale-intent check;
the corrected cancellation gate preserves those assertions rather than changing
them. The combined route/transfer-intent checkpoint passes all 101 cases,
forced typecheck, and full lint. Native dialogs and models are still simulated.

Fourteen mode/intent failures with four controls show non-Growth routes opening
dialogs or dispatching, a reveal modal adopting replacement state, and a model
returning a different workspace's runtime boundary. The context-consent adapter
captures the original Growth intent before any dialog, and the pure runtime
checks the workspace as well as session/work-unit lifetime during finalization.

Ten model-tool/use-case failures establish unsupported mode selection,
same-response and follow-up reuse of an outdated tool view, unadvertised calls,
and incorrect outcome classification. The correction limits host mode selection
to Growth and ends a confirmed state-contract turn before further model work.
It keeps the committed action but asks for freshly prepared context and tools;
that transition records neither a hint outcome nor a restraint failure.
The combined Growth, accounting, and guarded-use-case checkpoint passes
**260 tests across 18 files**, forced typecheck, and enforced scoped lint.
Native model APIs are simulated in these focused tests.

Scope regressions first produce seven canonical/alias discovery failures and
four oversized 12,025-character observations. The same 86 focused cases pass
after prefix normalization and shared exact-query/observation budgeting.
The worker's 201 related scope cases pass with typed lint and size limits;
independent whole-boundary review then identifies two remaining defects.

An agreed file alias and its canonical file can have overlapping parent
prefixes. Choosing the first rather than longest prefix duplicates the nested
directory. Four reproductions fail before correction; the expanded 30-case
pattern suite covers both orders without widening canonical permissions.

Observation-only budgeting also misses result metadata and the Growth trust
prefix. An exact 11,975-character query produces a 12,000-character observation
but a 12,211-character native result and 12,238-character Growth text. A short
query with many matches can overflow the complete representation too. Thirteen
additional failures with 16 controls exercise complete effect, runtime, native,
and Growth result limits. These layers now reject oversized representations
without truncating queries or identifiers; an already committed operation is
not rolled back. The combined result-envelope and prefix checkpoint passes
59 tests across five files, forced typecheck, and full enforced lint. Independent
reassessment subsequently reports specification and quality passes: 54
policy-adjusted original probes, 62 additional boundary probes, 223 supplied
cases, and 89 surrounding runtime/adapter controls pass. Its unchanged original
replay is explicitly retained as 50 passes and four failures: two formerly
accepted oversized queries now decline before discovery, and crowded-match
cases stop at 34 unchanged matches with `partial: true`. A separate policy copy
asserts those bounded outcomes rather than silently dropping the four cases.
Exact-boundary probes preserve committed operations and accept a 12,000-character
Growth text representation while refusing one additional character. Filesystem
evidence is native macOS; VS Code/model APIs are simulated.

The Windows regression suite first has 14 failures and eight controls. Successful
`taskkill` delivery had been cached as termination, so parent close or escalation
could falsely confirm a still-unknown tree exit. The correction removes that
inference: known-PID Windows cancellation remains unconfirmed without liveness
proof, including after `/F` succeeds. All 22 platform tests and 118 verification
tests pass. Independent review passes the same 118 cases, 18 additional probes,
two RED/GREEN false-confirmation reproductions, and a native macOS descendant
exercise. Windows syscalls remain mocked. A one-second helper timeout is requested,
but `spawnSync` waiting for helper exit is not a proven hard wall-clock bound.

The initial third-round integrated checkpoint passes **1,194 tests across 94
files**, forced typecheck, full lint, Stable build and **7-entry VSIX** inspection,
and **17 isolated host scenarios on each of VS Code 1.136.2 and 1.137.0**. The
unchanged isolated POC passes its eight unit tests, nine-entry package, and one
Insiders host case. Both installed dependency trees validate; all four full and
production-only audits report zero findings.

After the overlapping-prefix and complete-result corrections, fresh integrated
validation passes **1,216 tests across 97 files**, forced typecheck, and full
enforced lint. Stable build/package/explicit verification again produces seven
VSIX entries, and each Stable host version passes all 17 isolated scenarios.
The separate POC again passes its eight unit cases, nine-entry package, and one
Insiders host case. Both installed dependency trees validate and all four full
and production-only audits again report zero findings. The existing Vite native
configuration warning remains visible; it is not suppressed or a passing lint
exception.

After the route-publication/modal corrections and neutral-decline controls,
fresh forced typecheck, full lint, and **1,274 tests across 99 files** pass.
Stable build, seven-entry VSIX verification, and both Stable hosts' 17 scenarios
also pass again. The isolated POC and both installed dependency graphs remain
unchanged from the successful checks above; those commands are not claimed as
rerun by this route-only checkpoint.

Independent consent/route reassessment now reports specification and quality
passes on the corrected frozen artifact. All 58 original probes pass without
assertion changes, as do 101 promoted/transfer-intent cases and 226 focused/prior
regressions. The model-transition review separately passes 120 independent
probes and its 288-case related suite. Together with the Windows and
complete-result/prefix reviews, each third-round correction has a scoped
independent pass. These are AI technical reviews, not a native-host guarantee
or whole-product certification.

The third-round correction is committed as `6236a06`. Both original inline
threads have evidence replies and are resolved, and all four CI jobs pass,
including the actual Insiders test step. Review `5228345791` then requests five
more corrections; the green checks do not clear those findings.

#### Fourth review: workspace authority and useful bounded results

Two inline findings expose the same workspace-rebinding defect: changing the
Presence workspace preserves an existing session and authority epoch. Sixteen
new failures with seven controls establish the lifecycle cases, followed by two
reused-ID result-admission failures. The correction emits an atomic disable/enable
batch, rejects a replayed rebind without a reset, and correlates late results with
their original authorization revision. All 25 focused cases and 424 core/runtime
cases pass. Independent review of cancellation and cleanup compositions remains
a separate gate; cancellation cannot undo an external action already performed.

Multi-root pattern tests produce 20 failures with 38 controls. A pattern qualified
by one agreed root was incorrectly searched relative to other roots. The fix
classifies qualification across all canonical/lexical scopes before discovery;
58 pattern cases and 238 related scope/context cases pass, including physical and
aliased workspace roots and the existing permission/binary/cancellation controls.

Eight failing native/runtime/Growth cases with six controls show that capping
only read text or verification output still overflows complete representations.
Shared runtime result assembly and Growth text serialization now drive prefix
selection with metadata overhead reserved, including escaped identities and
large numeric revisions. Truncation preserves code-point boundaries and keeps
ordinary large reads/checks useful instead of replacing them with size failures.
Two legacy body-only exact-length assertions are deliberately replaced with
complete-result bounds, nonempty prefix checks, and truncation flags, retaining
their byte-limit and sensitivity assertions. Additional immutable-identity cases
retain the bounded-failure backstop without falsifying IDs or undoing committed
operations. The 176-case combined result/scope checkpoint, forced typecheck, and
full lint pass. These tests simulate host/model APIs.

The initial integrated fourth-round source tree passes **1,343 tests across 102
files**, forced typecheck, full lint, Stable build/seven-entry VSIX verification,
and 17 isolated cases on each Stable host. Independent re-review and the eventual
committed head's repository review/checks remain required; this checkpoint does
not pre-approve merge or a later source revision.

The independent cancellation review then reproduces a pending-registry ownership
defect. An abort-resistant old invocation or recovered read can settle after a
replacement reuses its operation ID. Its unconditional cleanup deletes the new
entry, so later Pause/Disable misses the replacement controller and explicit
reconciliation can dispatch a duplicate read. Promoting the review's regressions
and controls produces 20 failures with 28 passes before the correction. Both
cleanup paths now compare controller identity before deleting an entry, while
still unlinking and aborting their own controller. All 48 maintained cases and
68 surrounding workspace/lifecycle/recovery cases pass with forced typecheck
and scoped lint. Independent specification and quality re-review passes 235
cases across 18 files: 64 unchanged original probes, 25 workspace cases, the
48 promoted cases, 82 surrounding controls, and 16 additional parent-signal
probes. The promoted cases overlap the original probes, rather than representing
48 new independent scenarios. All 20 previously failing cases pass unchanged;
old cleanup preserves the replacement's listener for shared or distinct parent
signals. This evidence uses the real coordinator/journal with deferred effects,
not a native-host execution claim.

Independent result-envelope review passes 47 additional serialization probes,
14 actual Growth-loop probes, 187 supplied tests, and 158 surrounding controls
on its frozen scope. It also identifies two pattern-selection defects: a root
file's implicit dot parent incorrectly qualifies relative patterns globally,
and a missing permitted file loses its parent-prefix qualification. Four new
regressions and six residual cases fail; the observed wrong selections remain
within the allowed-path union, not demonstrated escapes beyond that union.
The main-tree reproduction confirms ten failures with 70 passing controls after
promoting these cases and relative-pattern union controls. The correction excludes
the implicit dot parent from global qualification and retains missing-target
prefixes only after safe identity and containment checks. Missing files constrain
selection but are not newly enumerated. Independent specification and quality
re-review freshly reproduces the ten failures on the previous artifact, then
passes all 36 original probes unchanged on the final source. Another 28 probes
cover missing ancestors, exact-file aliases, ENOTDIR, dangling links, real
filesystem EACCES, fallback-await cancellation/failure, and outside-root
retargeting. Together with 47 envelope probes, 14 Growth probes, 209 supplied
tests, and 158 surrounding controls, 492 final-artifact test executions pass.
Pinned no-emit typecheck and scoped lint pass. These tests use the real macOS
filesystem and mocked host/process APIs, not native Windows evidence or an
exhaustive proof of filesystem interleavings.

Fresh integrated validation after the ownership and qualifier corrections passes
**1,413 tests across 104 files**, forced typecheck, full enforced lint, Stable
build/seven-entry VSIX verification, and 17 isolated cases on each Stable host
version. The unchanged POC is freshly checked too: eight tests across four files,
a nine-entry package, and one Insiders host case pass. Both installed dependency
trees validate and their four full/production audits report zero findings. These
local results and scoped independent passes do not replace original-thread
responses, repository review, or final-head CI.

The fourth-round corrections are committed as `db98654`. Original-thread replies
and resolutions, the summary-only response, and CI `35156743700` are recorded in
PR #8. All four CI jobs and their actual steps pass, including Insiders. A fifth
repository assessment still requests further corrections.

#### Fifth review: close settlement, validated values, and non-raw publication

Review `5228948895` identifies delayed cancellation settlement after child close
when Windows tree exit is unobservable. Fifteen failures with 27 controls reproduce
the delay, including grace/confirmation boundaries and synchronous close inside
signal delivery. The corrected port represents unknown separately from observed
alive and proven stopped. Unknown aborted close settles promptly and unconfirmed,
without leaving a later PID-targeted signal or reinstalled timer. Known-live
POSIX groups and children that never close retain bounded escalation. The 56-case
process checkpoint and scoped lint pass. Seventeen legacy expectations deliberately
change from unknown-as-alive or post-close Windows escalation to the new explicit
semantics; no-close and known-live controls remain active. These Windows syscalls
are mocked, not native execution evidence.

Two value-propagation comments are addressed by capturing `previewOnly` once,
validating it, and carrying the captured value into the event and reduced state.
The current protocol still requires literal true. Ten characterization cases pass
before and after the behavior-preserving cleanup, including invalid values and
read-once accessors; they are not presented as previously failing bug tests.

The final broad integration review of `db98654` independently passes 293 maintained
tests, full lint/typecheck, and Stable build/seven-entry package verification, but
finds two residual gaps. Real coordinator scheduling lets `/brief` print a cleared
agreement after Disable; input/output tokenizer errors can retain their supplied
private text in in-memory evaluation reasons. No persistence or exfiltration is
established. Promoted probes reproduce three failures with three controls; expanded
sync/async input, response-text, and tool-call accounting cases produce seven
failures with three controls. `/brief` now uses the final synchronous live snapshot,
and accounting errors become a stable code after lifecycle checks. All ten cases
and 18 local/publication controls pass with forced typecheck and full lint. The
independent process/preview and broad-correction reassessments remain required.

The independent process/preview re-review subsequently reports specification and
quality passes on the exact seven-file overlay. It repeats the 15-failure/27-control
RED, all 56 process cases, 99 combined cases, ten before/after characterizations,
forced typecheck, and full lint. All 218 additional adversarial probes pass. The
review explicitly justifies the 17 changed legacy expectations and verifies all
out-of-scope tracked files unchanged. In a native Darwin probe, the descendant
remains alive after parent close, receives escalation at approximately 5.003
seconds, and settles confirmed at 5.256 seconds with zero residual groups. This
native evidence covers POSIX, not Windows.

The independent publication/privacy re-review also reports specification and
quality passes on the exact final source overlay. It replays the original six
probes unchanged and passes 279 cases across 17 files, forced root typecheck,
and full lint. Additional real-participant compositions cover initial and
follow-up accounting, response text, serialized calls, and completed-tool input,
with no retained provider message or cause. Cancellation/deadline priority,
dispatch stopping, and deterministic core reason codes remain intact. This is a
bounded re-review, not a second whole-branch inventory or an independent rerun of
host/package/audit gates. Accounting probes settle or reject; they do not prove
a hard completion bound for an indefinitely unresponsive provider.

The integrated fifth-round source checkpoint passes **1,448 tests across 108
files**, forced root typecheck, full enforced lint, Stable build and seven-entry
VSIX verification, and 17 isolated host cases on each of 1.136.2 and 1.137.0.
The separate POC passes eight unit tests across four files, its nine-entry package,
and one Insiders host case. Both installed dependency trees validate, and all four
full/production-only audits report zero findings. The existing Vite native-config
warning remains visible. These results describe this local source checkpoint,
not an unreviewed future commit or a substitute for final-head CI.

#### Sixth review: explicit signal-failure handling

The fifth-round source and evidence are committed as `e83d872`. All three original
threads have evidence replies and are resolved. CI `35160931543` passes all four
jobs and every actual step, including 17 Insiders host cases. Review `5229268443`
adds no inline findings, but its body identifies a redundant conditional in the
process-group signal catch and recommends closer review of the overall change
size. A completed review job is not approval.

The catch now explicitly returns false for signal failure without inspecting an
error code that could not change its result. This does not alter the separate
tri-state liveness observation, Windows taskkill, or no-PID fallback paths. The
same 56 process cases pass before and after the cleanup, including ESRCH, EPERM,
EACCES, and EIO signal/probe distinctions. These are characterization passes,
not previously failing regressions.

Fresh integrated validation on the cleanup source again passes 1,448 tests across
108 files, forced root typecheck, full lint, Stable build/seven-entry package
verification, and 17 isolated cases on each Stable host. The separate POC again
passes eight tests, nine-entry packaging, and one Insiders host case. Both
installed dependency trees validate and all four full/production audits report
zero findings. Bounded independent review subsequently passes specification and
quality on the exact one-file overlay, independently repeats the same 56 cases
before/after, and passes extension/reference compilation and changed-file lint.
It does not claim a new native or whole-branch run. The summary-only response and
new committed head's repository review/checks remain separate merge gates.

#### Seventh review: POC controller construction ordering

The sixth correction is committed as `6a591ff`; its summary response is posted
and CI `35161728080` passes all four jobs and every actual step. Review
`5229347240` identifies a POC `ReferenceError` if the item-controller factory
invokes its refresh callback before returning the controller. Thirteen focused
tests plus the eight existing POC cases reproduce seven failures with 14 controls.
The failures originate from the real binding's uninitialized `controller`, not
from a compile or mock-resolution error. Native synchronous callback invocation
is not established; the reproduction supplies an eager host double.

The correction defers only the refresh body with a resolved-Promise continuation.
It checks cancellation after construction and reads the current records before
replacing items. Reverting to the old unassigned `let` variable alone would not
solve construction ordering. Ordinary refresh, status/resource/title/timing
mapping, cancelled refresh, refresh errors, repeated initial calls, immediate
new-session creation, and its cancellation contract are tested. All 21 POC cases
and full repository lint pass without changes to existing assertions or vendored
declarations; other POC provider behavior and the Stable dependency graph are
unchanged.

Fresh integration passes 1,448 root tests across 108 files, forced root typecheck,
full lint, Stable build/seven-entry VSIX verification, and 17 cases on each Stable
host. The separate POC passes 21 tests across five files, nine-entry packaging,
and one native Insiders host case. Both installed dependency trees validate and
all four full/production audits report zero findings. The native host pass does
not turn the eager-callback double into a reproduced native failure. Bounded
independent re-review subsequently passes specification and quality on the exact
two-file overlay. Identical tests independently reproduce seven failures with
14 controls before and all 21 passes after; forced root typecheck, POC compilation,
full lint, and effective size rules pass. No native invocation, upstream lookup,
or whole-branch retest is attributed to that re-review. The summary response and
final committed-head repository review/checks remain separate gates.

#### Eighth review: common Growth failure serialization

The POC correction is committed as `4409905`. Its summary response is posted and
CI `35163305028` passes all four jobs and every actual step. Review `5229519835`
adds one inline finding: the shared `growthFailureReason` still returns arbitrary
`Error.message` text, despite the provider adapter's earlier accounting fix.

The common-boundary reproduction yields 29 failures and 29 controls across two
new test files. Coverage includes model/factory, snapshot/preparation/finalization,
consent, optional validation, malformed typed codes, and throwing error accessors
or prototypes. Real participant evaluations retain the private sentinel before
the correction. This establishes in-memory retention, not disk persistence or
exfiltration. The provider-specific `GROWTH_MODEL_ERROR` mapping remains intact.

A private closed catalog now admits the same 15 typed model codes and 70 literal
core/runtime/tool-policy codes, checked against their existing source definitions.
Unknown failures become the existing `GROWTH_UNKNOWN_ERROR` without returning
raw text. Adding a new code requires explicit admission; uppercase format and
prefix matching are deliberately insufficient. The public model-failure type
derives from its unchanged 15-code catalog. Core hint prerequisites and typed
cancellation/stale/reprepare behavior remain distinct.

An initial core-only catalog causes 11 unchanged stale-user-action controls to
lose `STALE_TOOL_VIEW`. The runtime/policy catalog is completed rather than
weakening those assertions; six direct code controls are also added. The final
focused checkpoint passes 81 cases, including all 64 new cases and 17 existing
user-action cases. Only two legacy expectations deliberately change: untyped
`MODEL_UNAVAILABLE` and the test-only thrown `TRANSFER_VALIDATION_FAILED` now
produce the stable unknown code. All other assertions remain.

Fresh integration on the complete patch passes 1,512 tests across 110 files,
forced root typecheck, full lint, Stable build/seven-entry VSIX verification,
and 17 isolated cases on each Stable host. The unchanged POC again passes
21 tests, nine-entry packaging, and one Insiders host case. Both installed
dependency trees validate and all four full/production audits report zero
findings. A final local forced typecheck, full lint, and all 1,512 tests also pass
on the same source tree.

Independent specification/quality review passes on the exact five-file overlay.
The same 64 new cases reproduce 29 failures/35 controls on `4409905` and all pass
after the correction. The original 53 guarded-turn controls pass on that base;
118 affected regression cases, forced root compilation, and full lint pass on
the fixed tree. All 70 admitted boundary literals have production producers,
and the 15-code model union is unchanged. This is not a claim that every runtime
message is admitted: the generic non-Error storage wrapper `STORE_COMMIT_FAILED`
also becomes the unknown reason at the Growth boundary. Both intentional
expectation changes are justified, and all stale-user-action assertions remain
unchanged. No whole-branch, host, package, or audit rerun is attributed to this
bounded review. Original-thread response/resolution and the new committed head's
repository assessment/checks remain separate merge gates.

Current authoritative session state remains in memory; the durable edit-episode
journal is a separate continuity feature, not proof of session or ownership
recovery.

### Dependency and tooling maintenance evidence (September 16, 2026)

The owner authorized removing the blanket dependency and version freeze and
applying necessary updates. This maintenance starts from the reviewed `main`
baseline `f28de5f`, independently of the P1 implementation PR. It does not
implement Pair runtime behavior or begin a new product milestone.

Release selection cross-checks direct metadata for all 16 distinct external
dependencies and upstream stable release records. All 16 tracked manifests
were inspected: 14 root/workspace/POC manifests and two fixture/scripts
manifests without external dependencies. Both active lockfiles are included:
the root workspace graph and the isolated `poc/session-target` graph. The
initial `npm outdated --json --workspaces --include-workspace-root` query
reported two packages and returned `{}` after the first update. Review exposed
its incomplete coverage: direct metadata still reported a newer linter, and
GitHub reported a Mocha patch absent from the configured registry. An empty
outdated report is not treated as proof of a complete upstream inventory. A
follow-up review also identified the active POC outside the workspace globs;
its eight direct dependencies are now included in the inventory. Its additional
`@vscode/dts` dependency remains at 0.4.1, matching both registry metadata and
the upstream package manifest.

| Component | Previous | Selected stable release |
| --- | --- | --- |
| Mocha | 11.8.0 | [12.0.0](https://github.com/mochajs/mocha/releases/tag/v12.0.0) |
| VSCE | 3.9.2 | [4.0.0](https://github.com/microsoft/vscode-vsce/releases/tag/v4.0.0) |
| typescript-eslint | 8.69.0 | [8.70.0](https://github.com/typescript-eslint/typescript-eslint/releases/tag/v8.70.0) |
| Checkout action | v4 | [7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) |
| Setup Node action | v4 | [7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0) |
| Upload Artifact action | v4 | [7.0.1](https://github.com/actions/upload-artifact/releases/tag/v7.0.1) |

The following retentions are explicit compatibility or availability decisions,
not a reinstatement of the version freeze:

- TypeScript 6.0.3 is the latest published 6.x version available in the registry.
  TypeScript 7.0.2 is available, but typescript-eslint 8.70.0 declares the peer
  range `>=4.8.4 <6.1.0`; upgrading the compiler would leave the supported lint
  toolchain range.
- `@types/node` 24.13.3 was selected on the Node 24 type line rather than allowing
  APIs that require Node 26. The subsequent event-validation audit below
  supersedes the earlier latest-patch claim and updates both graphs to 24.13.4.
- Upstream [Mocha 12.0.1](https://github.com/mochajs/mocha/releases/tag/v12.0.1)
  was published on September 11, 2026, but an exact registry lookup returns
  `E404`. Retain the obtainable 12.0.0 release with the patched
  `serialize-javascript` 7.1.1 resolution, rather than substituting an untested
  Git snapshot. Recheck the patch when registry availability changes.

The isolated POC keeps the same validated TypeScript and Node type line as the
repository rather than introducing an independent major-version toolchain.
This does not change its existing Node.js 22.13 minimum or vendored proposed-API
declarations.

The CI actions are pinned to their verified release commit SHAs and run on
Node.js 24. Mocha and VSCE support the repository's Node.js 24 baseline. VSCE 4
raises its minimum to Node.js 22 and replaces several legacy dependencies;
the existing packaging CLI path remains compatible. No product or protocol
version bump, runtime source change, or higher VS Code API floor was needed.

Before the update, the root `npm audit --audit-level=low --json` exited 1 and
reported three vulnerable package entries: one low, one moderate, and one high. The
Mocha dependency graph now resolves `diff` 9.0.0 instead of 7.0.0 and
`serialize-javascript` 7.1.1 instead of 6.0.2. After a clean `npm ci`, the same
full workspace audit and the production-only audit both exited 0 with zero
findings.
There are no forced audit fixes, dependency overrides, or severity exclusions.
CI now runs separate clean installs and full audits for both active dependency
graphs as required steps in its build-and-package job. The POC uses
`npm --prefix poc/session-target`, so its lockfile cannot silently fall outside
the root workspace audit. POC compilation, unit tests, and packaging also run
in that job. Neither audit omits development dependencies.
These are point-in-time audit results, not a guarantee against undiscovered
vulnerabilities.

The CI workflow contract gained two tests that require each complete audit
immediately after its own installation. The initial named-step-only guard
incorrectly passed with an intervening unnamed `run` step; the new POC case
first failed because its installation and audit were absent. Both guards now
recognize unnamed `run` and `uses` entries, including bare-dash forms. Fifteen
temporary mutations cover a missing, late, or production-only audit and the
four unnamed step forms for each graph, plus a POC audit missing its directory
prefix. Each mutation produced one failed and five passed CI contract tests.
The proposed workflow was restored byte-for-byte after every mutation; the
normal workflow passed all six cases. These mutation runs do not add extra
cases to the full-suite count.

Local validation used Node.js 24.20.0. The baseline and initial dependency
refresh passed 40 files and 596 tests. After the review-driven tests and linter
update, typecheck, lint, all 40 test files, and 598 tests passed. Stable VSIX
packaging and archive verification passed with seven entries. The isolated
VS Code 1.137.0 Extension Host passed all 17 smoke tests with runner exit code
0, including additive activation and inactive-zero assertions. All five
external production dependencies retain their previous versions and integrity
values, including the nested `ajv` and `json-schema-traverse` packages under
`packages/protocol/node_modules`; the audit's total dependency count fell from
601 to 401. The clean installation emitted no deprecation warnings. Existing
Vite and isolated-host diagnostics are not claimed to be fixed by this
maintenance.

The isolated POC already had zero audit findings before its VSCE 3.9.2 to 4.0.0
update. After regenerating its lockfile and a clean install, both its full and
production-only audits still reported zero findings; its audit dependency
count fell from 406 to 257. Under Node.js 24.20.0, POC compilation, four unit-test
files with six cases, the isolated Insiders host's one case, and an eight-entry
VSIX all passed. The Insiders build was `07b4ff1883f94da91f6d698744fc7c3638b59720`.
POC checks and packaging also passed under the existing Node.js 22.22.1 runner.
These six unit cases and one host case are separate from the workspace's test
counts. No POC runtime source or vendored API declaration changed, and its
unimplemented history, Pair tools, cancellation, and broader coexistence work
remain open rather than being claimed as completed by dependency maintenance.

Local verification is separate from PR approval. The published PR records the
final revision's CI, review feedback, fixes, and thread resolutions; these
local results alone do not establish merge readiness.

### Event-increment dependency inventory (September 17, 2026 UTC)

The follow-up audit inventories all 16 tracked manifests, both active lockfiles,
and all 24 direct external dependency declarations across 16 distinct packages.
The root workspace graph and independent `poc/session-target` graph are both
included; fixture/scripts manifests contain no additional external graph.
Registry metadata is cross-checked with upstream release records or maintained
package-source history, not inferred from `npm outdated` alone.

| Direct package | Maintained graph | Selected version | Disposition |
| --- | --- | --- | --- |
| `@eslint/js` | Root | 10.0.1 | Current obtainable stable |
| `@types/mocha` | Both | 10.0.10 | Current obtainable stable |
| `@types/node` | Both | 24.13.4 | Update from 24.13.3; keep Node 24 API floor |
| `@types/vscode` | Root | 1.136.0 | Keep supported VS Code 1.136 API floor, not 1.137 declarations |
| `@vitest/coverage-v8` | Root | 5.0.0 | Keep paired with Vitest; exact 5.0.1 registry request returns E404 |
| `@vscode/dts` | POC | 0.4.1 | Current obtainable stable |
| `@vscode/test-electron` | Both | 3.1.0 | Current obtainable stable |
| `@vscode/vsce` | Both | 4.0.0 | Current obtainable stable |
| `ajv` | Root | 8.20.0 | Current obtainable stable |
| `esbuild` | Root | 0.28.2 | Current obtainable stable |
| `eslint` | Root | 10.10.0 | Current obtainable stable |
| `fast-check` | Root | 4.9.0 | Upstream 4.10.1 and 4.10.0 exact registry requests return E404 |
| `mocha` | Both | 12.0.0 | Upstream 12.0.2 and 12.0.1 exact registry requests return E404 |
| `typescript` | Both | 6.0.3 | 7.0.2 is outside the linter's `>=4.8.4 <6.1.0` peer range |
| `typescript-eslint` | Root | 8.70.0 | Current obtainable stable |
| `vitest` | Both | 5.0.0 | Upstream 5.0.1 exact registry request returns E404 |

The Node type patch is verified by an exact online lookup, installed in both
graphs, and recorded consistently in both manifests and lockfiles. Only that
package's version, artifact, and integrity entries change in the lockfiles.
The newer registry `@types/node` 26.5.1 would describe a different runtime
floor and is not selected. No product/protocol version or host API floor changes.

Exact lookup and availability claims apply to the configured Microsoft registry
proxy: direct public npm transport is unavailable in this environment. They
do not claim that those upstream releases are unpublished globally. Network
checks explicitly disable the cached Node launcher's inherited npm offline
setting; offline cache misses are not treated as upstream availability evidence.
Both full audits, including development dependencies, pass with zero findings
before and after the patch, and both installed dependency trees match their
manifests/locks. These are point-in-time results from the configured advisory
endpoint, not a guarantee against undiscovered vulnerabilities.

### Version-1 event validation evidence

The approved post-refactoring increment starts from PR #8's merged revision
`ad4b570d5526138f9afa6fa3e13dde624244b345`. The baseline forced typecheck and
37 protocol tests pass. Before implementing the event parser, 448 new cases
fail because `parsePairEvent` is missing: 257 envelope/version/variant cases
and 191 payload/JSON-safety cases. With the implementation in place, all 485
protocol cases pass together, including the unchanged command regressions.

The fixtures exhaustively cover the 21 current `PairEvent` discriminants.
Checks distinguish wire omissions from explicit undefined/null, verify the
three required-but-possibly-undefined memory fields, reject malformed nested
payloads and unsafe counters, and retain the event-only `engaged` presence
status. JSON-safety tests exercise accessors and conversion hooks without
invoking them, exotic/hidden/symbol data, cycles, sparse/decorated arrays,
shared references, safe dictionary keys, and detached recursive freezing.
These tests establish structural behavior, not actor authority, event-sequence
validity, persistence, recovery, or policy approval of a well-shaped event.

Initial local checks use Node.js 24.20.0: forced workspace typecheck, full lint, **1,960
tests in 113 files**, deterministic Stable build, seven-entry Stable VSIX and
archive verification, plus **17 isolated host cases on each of 1.136.2 and
1.137.0**. The separately maintained POC passes **21 unit cases in five files**,
its one Insiders host case, and nine-entry packaging. Those POC and host cases
are separate from the workspace unit-test total. Existing Vite and clean-profile
host diagnostics remain visible rather than being suppressed.

Review reproductions found two ways for the original validate-then-copy path
to depart from the JSON contract: Ajv could read inherited required/optional
fields, and a Proxy could report safe descriptors before a later property read
returned a caller-owned function. Own-property-only Ajv checks alone are not
enough to prevent getter reads; the installed implementation reads the value
before its own-property guard. Both parsers now capture and validate one
detached descriptor view whose objects have no prototype, without later reads
from caller objects. Reflection traps themselves are not sandboxed.

A 4,000-level parsed JSON object also produced a raw stack overflow, and a
small shared binary graph expanded exponentially. Event capture now bounds
depth to 64 (root zero) and expanded values to 10,000. Tests include the exact
inclusive depth/node boundaries, shared-data support, and an 80-level command
control that remains accepted without imposing event budgets on commands.
The 16 review regression cases first produced **15 failures and one passing
control**; all 16 then passed, and the combined protocol suite reached **501
tests across eight files**. A later regression first failed when an inherited
descriptor `value` disguised an accessor; descriptor metadata now also requires
an own data property. Three further cases cover maximum-length sparse arrays
with zero, bounded, and over-budget populated prefixes. An isolated probe of
the empty maximum-length array rejects at index zero with 14 own-property
checks: the hole loop throws at the first missing index, not after walking the
declared length. No speculative length preflight is needed to correct that
reported concern. The final local protocol suite passes **505 cases**, and
forced typecheck, full lint, and **1,980 workspace tests in 115 files** pass.
Review disposition and final-head CI evidence are recorded in the PR rather
than treating an older successful run as final evidence.

The implementation adds no new dependency, public event-type change, host route,
runtime journal integration, or storage/recovery code. Source and tests pass
the existing size and package-boundary guards. Local checks are not a PR
approval: final-head CI and review evidence belong to the published PR.

### Journal and recovery planning checkpoint

On September 18, 2026, after PR #9 merged at `469cb93`, the owner selected a
smaller journal/recovery foundation **design and plan PR**, rather than planning
all of P2 at once. At that checkpoint, authorization covered documentation
review, not P2a execution, and the proposed complete-journal parser and inspection
APIs were not installed. The canonical implementation plan replaced the
completed event plan retained at the merge revision. This planning evidence
remains historical; separately authorized implementation is recorded below.

The following are source-inspection findings from that baseline, not results
from an implemented recovery system:

| Verified source fact | Evidence | Consequence for the proposed boundary |
| --- | --- | --- |
| Events are structurally parsed and frozen, not authenticated or restored | [`parsePairEvent`](../packages/protocol/src/parseEvent.ts) | Reuse the event parser, but distinguish well-shaped data from legal command admission and fresh consent |
| A store commit may contain multiple commands and one command may emit multiple events | [`setPresence`](../packages/runtime/src/coordinator.ts) and [journal tests](../packages/runtime/test/journal.test.ts) | Preserve atomic commit boundaries; reject command reuse across commits, not repetition within one commit |
| A stream key may differ from its workspace identity | [workspace-boundary tests](../packages/runtime/test/workspacePresenceBoundary.test.ts) | Carry the initial workspace separately; compare expected stream and final workspace independently |
| Disable truncates the in-memory event prefix without resetting the revision or command-ID history | [`InMemoryJournal.commit`](../packages/runtime/src/journal.ts) | Do not call `events()` a complete durable export or accept its compacted tail as a revision-zero journal |
| `BriefConfirmed` is in the event union but has no reducer route | [event types](../packages/protocol/src/events.ts) and [reducer dispatch](../packages/session-core/src/reduce.ts) | Shape acceptance does not promise replay support; reject explicitly instead of adding an unrelated core transition |
| Close and Presence reset are not proof that an external operation terminated | [session](../packages/session-core/src/reducers/session.ts) and [Presence reducers](../packages/session-core/src/reducers/presence.ts) | Keep unfinished-operation warnings across lifecycle boundaries in the supplied complete history, keyed by start revision and operation ID |
| Event payloads include diagnostics, operation inputs, and free-form summaries | [protocol types](../packages/protocol/src/types.ts) | Bounded input is not automatically safe to persist; actual disk serialization/data minimization needs a later design |

The proposed 1,048,576-text-code-unit, 1,024-commit, and 1,024-event limits are
policy choices for a bounded inspection API. They are not measured latency,
capacity, filesystem byte bounds, or a promise that all existing in-memory
sessions fit. Rejecting unsupported data is preferable to returning a misleading
partial recovery. An empty or otherwise valid report never authorizes resume,
restores an action grant, or automatically dispatches a recorded effect.

Unchanged application source was checked with Node.js 24.20.0 after clean
installation of both maintained graphs. Forced workspace typecheck and full
ESLint pass; the root suite passes **1,980 tests in 115 files**. The separately
installed POC compiles and passes **21 unit cases in five files**. Both installed
dependency trees match their manifests/locks. These are baseline checks, not
new P2a tests. The existing Vite native-config warning remains visible. Final
documentation-head CI, packaging, host results, and review disposition were
recorded in PR #10; they are not implementation validation.

The plan's **11 TypeScript reference blocks** were checked as virtual source
files with the installed compiler, existing package imports, and each package's
original library/type options: four protocol and seven runtime virtual files
produce zero diagnostics. Nothing was emitted or installed into product source.
This checks reference type consistency, not the proposed acceptance matrix or
runtime behavior. All **34 local documentation links/anchors** also resolve.

#### Planning dependency recheck

The documentation checkpoint inventories **16 manifests, two lockfiles, and
24 direct external declarations across 16 packages**, including the isolated
Session Target POC. Both online full-lockfile audits, including development
dependencies, return **zero findings** from the configured advisory endpoint.
No manifest, lockfile, runtime floor, or VS Code API floor changed in
documentation-only PR #10; this was not a version freeze or a security guarantee.

All direct packages were checked against current registry metadata and their
available upstream release/source records. The earlier
[event-increment inventory](#event-increment-dependency-inventory-september-17-2026-utc)
remains a dated record, not a substitute for the following new observations:

| Recheck | Observation and disposition |
| --- | --- |
| fast-check | Upstream latest is [4.10.1](https://github.com/dubzzz/fast-check/releases/tag/v4.10.1). Exact 4.10.1 metadata still returns E404 from the configured registry, but **4.10.0 now resolves**. Retaining 4.9.0 here preserves the expressly documentation-only scope; no incompatibility is claimed. Reassess/update at the separately authorized implementation baseline, rather than repeat the obsolete 4.10.0 availability reason. |
| Vitest and coverage | Upstream [5.0.1](https://github.com/vitest-dev/vitest/releases/tag/v5.0.1) exists; exact requests for both 5.0.1 packages still return E404. Registry metadata and the installed pair remain 5.0.0. |
| Mocha | Upstream [12.0.2](https://github.com/mochajs/mocha/releases/tag/v12.0.2) exists; exact 12.0.2 and 12.0.1 requests still return E404. Both graphs retain 12.0.0. |
| TypeScript and linter | Registry TypeScript latest is 7.0.2, outside typescript-eslint 8.70.0's declared `>=4.8.4 <6.1.0` range. Retain 6.0.3. Upstream [typescript-eslint 8.70.0](https://github.com/typescript-eslint/typescript-eslint/releases/tag/v8.70.0) matches the installed linter. |
| API declarations | Latest obtainable Node 24 declarations remain 24.13.4; the 26.5.1 latest tag is a different runtime line. Retain VS Code 1.136.0 declarations for the supported host floor rather than latest-tag 1.137.0. DefinitelyTyped's rolling source versions (`24.13.9999`, `1.138.9999`, and Mocha `10.0.9999`) are not published patch-version evidence. |
| Other direct packages | Registry metadata still matches `@eslint/js` 10.0.1, `@types/mocha` 10.0.10, `@vscode/dts` 0.4.1, `@vscode/test-electron` 3.1.0, `@vscode/vsce` 4.0.0, Ajv 8.20.0, esbuild 0.28.2, and ESLint 10.10.0. Accessible Ajv, esbuild, and ESLint release records agree with their selected releases. |
| Upstream access limit | Authenticated GitHub release lookups for the Microsoft VS Code tooling and TypeScript repositories return HTTP 403 with an organization SAML requirement. No fresh upstream-release confirmation is claimed for those entries, and no alternate credential or route was used to bypass that restriction. Registry metadata remains independently available. |

These availability observations concern the configured registry, not worldwide
publication or verified tarball installation. Online lookups explicitly disable
the cached Node launcher's inherited offline setting. Future execution must
repeat the inventory and compatibility checks; a documentation review cannot
settle later dependency availability or waive an audit finding.

### P2a implementation evidence

On September 18, 2026, the owner explicitly authorized merging documentation
PR #10 and executing its reviewed P2a plan. The documentation PR merged at
`83dc8e8`; implementation starts from that refreshed `main` baseline on a
dedicated PR branch. The unchanged baseline again passed clean installs of both
dependency graphs, forced typecheck, lint, **1,980 root tests in 115 files**, and
the separate POC compile plus **21 tests in five files** with Node.js 24.20.0.

The implementation adds no store/host integration or new package dependency
edge. It reuses the existing event parser and reducer unchanged:

| Implemented boundary | New tests and observed evidence |
| --- | --- |
| [Bounded journal parser](../packages/protocol/src/parseJournal.ts) | [108 cases](../packages/protocol/test/journal.test.ts): primitive text only, exact inclusive budgets, own closed fields, nonempty envelope event/command IDs, all 21 event shapes, wire omissions, per-event traversal limits, nested freezing, sanitized errors, and no partial output |
| [Private replay](../packages/runtime/src/journalReplay.ts) | [72 cases](../packages/runtime/test/journalReplay.test.ts): revision-zero and atomic commit semantics, global event/command identity, all 20 supported reducer routes, explicit unsupported-event rejection, and lifetime-aware warnings through close/disable/rebind |
| [Public inspection report](../packages/runtime/src/journalRecovery.ts) | [37 cases](../packages/runtime/test/journalRecovery.test.ts): expected identities, empty envelope event/command ID rejection, exact metadata keys, frozen nested data, always-false authority/replay flags, private-data sentinel exclusion, call isolation, and an unchanged live journal/grants |

These are **217 new root test cases**, not 217 additional host scenarios. Six
replay properties each run 100 generated histories, comparing accepted histories
with the current reducer and separately corrupting revisions, IDs, commit
boundaries, and the declared head. Their generated trials are not added to the
test-case total. Before implementation, the parser and public report seed tests
failed for missing exports and the replay suite failed for its missing private
module. The complete parser/report matrices were also observed failing before
their implementation. The initial combined protocol, runtime, core, and
architecture selection passed **1,085 tests in 39 files**, followed by forced
workspace typecheck and lint. The four later empty-identifier regressions are
included in the current suite counts and full validation below.

This verifies bounded read-only inspection, not authentic consent, privacy-safe
disk serialization, a durable store, working resume, authority restoration, or
effect replay. A recorded unknown operation remains a warning; close and disable
do not rewrite it as cancelled. Root, isolated POC, and host results are kept
separate. Final P2a delivery gates and review disposition remain in Git at
`133c7a8:docs/implementation-plan.md`; the canonical plan may then be deliberately
replaced for the next reviewed increment.

#### P2a dependency maintenance

The implementation re-inventoried **16 manifests and both active lockfiles**,
including the isolated POC outside the workspace globs and the dependency-free
host fixture/scripts manifests. There are **49 declarations: 25 internal and
24 external**, covering 16 distinct external packages. All internal version
pins and package edges remain unchanged. An outdated report alone was not used
as an inventory: exact declarations, stable registry tags, compatible ranges,
and primary upstream release/source records were compared on September 18, 2026.

| External package | Selected version | Registry/upstream comparison and disposition |
| --- | --- | --- |
| `@eslint/js` | 10.0.1 | Matches the registry stable tag and the [ESLint 10.10.0 tagged manifest](https://github.com/eslint/eslint/blob/v10.10.0/packages/js/package.json); its ESLint peer accepts the selected linter. |
| `@types/mocha` | 10.0.10 | Latest published registry version; the extension's caret range and POC pin resolve identically. DefinitelyTyped's `10.0.9999` source line is not a released patch or the Mocha runtime version. |
| `@types/node` | 24.13.4 | Latest obtainable Node 24-line declarations. Registry latest 26.5.1 targets a different runtime line; retain the Node 24 verification baseline rather than broaden its type-visible APIs. |
| `@types/vscode` | 1.136.0 | Retains the extension's declared API floor instead of registry latest 1.137.0. A rolling `1.138.9999` source snapshot is not a published version or permission to raise that floor. |
| `@vitest/coverage-v8` | 5.0.0 | Matches obtainable Vitest and its exact peer. Upstream [5.0.1](https://github.com/vitest-dev/vitest/releases/tag/v5.0.1) exists, but its exact registry metadata request still returns E404. |
| `@vscode/dts` | 0.4.1 | Registry stable tag agrees. Microsoft release API access remains SAML-blocked; no independently confirmed upstream release or proposal refresh is claimed. |
| `@vscode/test-electron` | 3.1.0 | Registry stable tag agrees across root, extension, and POC; its Node requirement accepts Node 24. Microsoft release API access remains SAML-blocked. |
| `@vscode/vsce` | 4.0.0 | Registry stable tag agrees; `4.0.1-0` is a prerelease, not a stable upgrade. The canonical Microsoft release endpoint remains SAML-blocked; Node 24 is supported. |
| `ajv` | 8.20.0 | Matches the registry and [upstream release](https://github.com/ajv-validator/ajv/releases/tag/v8.20.0). Its direct protocol installation is nested; validation did not assume every direct dependency was hoisted. |
| `esbuild` | 0.28.2 | Matches the registry and [upstream release](https://github.com/evanw/esbuild/releases/tag/v0.28.2); no bundler/API migration. |
| `eslint` | 10.10.0 | Matches the registry and [upstream release](https://github.com/eslint/eslint/releases/tag/v10.10.0), with compatible Node and linter peer ranges. |
| `fast-check` | **4.10.0, from 4.9.0** | The exact release is now obtainable, matches the registry stable tag and [upstream 4.10.0](https://github.com/dubzzz/fast-check/releases/tag/v4.10.0), and its tarball integrity matches the regenerated lock entry. Upstream 4.10.1 still returns E404 from the configured registry. |
| `mocha` | 12.0.0 | Preserves the extension range and POC pin. Upstream [12.0.2](https://github.com/mochajs/mocha/releases/tag/v12.0.2) exists, but exact 12.0.1/12.0.2 registry requests remain E404. |
| `typescript` | 6.0.3 | Highest obtainable compatible 6.0.x. Registry latest 7.0.2 is outside typescript-eslint's declared `>=4.8.4 <6.1.0` range; root lint also covers POC code, so their compiler pins remain aligned. Microsoft upstream release API access is SAML-blocked. |
| `typescript-eslint` | 8.70.0 | Matches the registry and [tagged upstream manifest](https://github.com/typescript-eslint/typescript-eslint/blob/v8.70.0/packages/typescript-eslint/package.json), including the TypeScript and ESLint peer constraints. |
| `vitest` | 5.0.0 | Matches the coverage package and registry stable tag in both graphs. Exact upstream 5.0.1 metadata remains unavailable at the configured registry. |

Only the root manifest's fast-check pin and its lockfile metadata change. No
transitive dependency version, dependency edge, runtime floor, host API, or POC
manifest/lock changes. Existing and new property tests use the ordinary
`assert`/`property`/array/arbitrary APIs; the new optional plugin support requires
no migration for these consumers. No registry replacement, peer override, or
credential/access workaround was used. Registry availability is not a claim
about worldwide publication, and a rolling source manifest is not release proof.

Fresh Node 24 installs subsequently reconciled the lock-only metadata with both
installed graphs. Installed fast-check and the root hidden lock agree on
**4.10.0**; both full installed-tree checks pass. Full-lockfile audits include
development, optional, and peer dependencies: the root graph has **401** audit
dependencies and the POC **257**, with **zero findings at every severity** from
the configured advisory endpoint. Audit categories overlap and are not summed.
This is a dated audit result, not a vulnerability-free guarantee.

#### P2a post-maintenance validation

After the dependency update, clean installation, and empty-identifier review
fix, forced workspace typecheck, full ESLint, **2,197 root tests in 118 files**,
and the separate POC compile plus
**21 tests in five files** pass. The coverage run independently passes the same
2,197 root cases: statements **91.04%**, branches **84.89%**, functions **92.80%**,
and lines **91.04%**. Generated property trials and POC tests are not added to
the root total. Stable build/package and the seven-entry archive verifier pass;
the isolated POC also compiles and packages successfully.

The new runtime entry-point export makes the existing Ajv-backed event parser
reachable during module initialization. An in-memory esbuild comparison under
the same installed graph, substituting only the previous runtime entry point,
measures **260,822 bytes** before versus **536,711 bytes** after for the production
bundle. The added graph is the existing protocol validator and its dependencies,
not a host inspection route or an effect dispatcher. The packaging tool reports
the larger bundle; this cost is recorded rather than hidden by changing package
side-effect metadata or rewriting the reviewed, unchanged event parser. This
does not claim zero allocation or zero CPU at import time: inactive-zero concerns
document listeners, timers, workspace reads, models, and network activity before
explicit enablement. The existing Vite native-config advisory also remains
visible and unsuppressed.

Isolated Stable-extension host smoke passes **17 cases each** on VS Code
**1.136.2**, **1.137.0**, and **Insiders**, including inactive-zero and unchanged
native/coexistence baselines. These counts are not added to root unit coverage
or the independently installed Session Target POC, whose separate Insiders
host registration/action test also passes (**one case**). All four host runners
exit zero and use disposable profiles rather than the developer's profile.
The local documentation
check resolves all **46 relative links and anchors** across the four canonical
documents. Initial independent task-scoped specification/code-quality reviews
found no actionable issues in the parser, private replay, or public report changes.

Repository review subsequently identified a stale authorization paragraph and
accepted empty event/command IDs. The paragraph now distinguishes the approved
P2a scope from unapproved remaining P2/P3 work and the separate merge decision.
For the identifier defect, two parser cases and two public inspection cases
first failed because no error was thrown. Journal parsing now rejects either
empty envelope ID with the fixed `INVALID_EVENT` error before publishing a
journal or report. All **217 journal cases** pass after rebuilding workspace
exports. The regression also verifies that standalone event parsing still
accepts those strings: neither event schemas nor reducer/command semantics
changed, and no new rule was imposed on unrelated payload identifiers.
Independent full-branch and focused follow-up reviews found no actionable
issues. At implementation checkpoint `1a5d6a5`,
[CI run 35356824845](https://github.com/hellices/adaptive-pair-harness/actions/runs/35356824845)
passes all four jobs and all **47 actual steps**, including the allowed-failure
Insiders job's steps. Logs confirm the 2,197 root cases, separate POC checks,
both audits, Stable packaging, and all three 17-case host runs.
[Repository re-review 5248987849](https://github.com/hellices/adaptive-pair-harness/pull/11#pullrequestreview-5248987849)
reports zero new comments after reviewing 16 of 17 changed files. Its formal
state is `COMMENTED`, not approval, and it explicitly requests final human
review. Both prior findings received linked replies to their original reviews;
there were no inline threads to resolve. Any final documentation-only revision
still requires same-head CI/review checks on the PR before readiness is
reported. The owner subsequently authorized the merge; PR #11 merged on
September 18, 2026 at `133c7a895abd217d9e63aae1d74b5fc190c34e33`. Final-head
CI run **35357471177** and post-merge main CI run **35358366256** both pass all
four jobs and all 47 actual steps, including the allowed-failure Insiders
steps. Final repository review **5249044377** reports no new comments; its
formal `COMMENTED` status is not relabeled as approval. This completed P2a
checkpoint does not authorize P2b implementation.

### P2b persistence contract planning

**Scope and provenance, September 19, 2026:** after authorizing PR #11's merge,
the owner selected a storage/recovery design-and-plan PR, then selected a
dedicated privacy-minimized durable event/snapshot contract over a warning-only
memo. Work starts from merged `main` at `133c7a8` on a dedicated documentation
branch. The earlier P2a implementation plan is preserved in that commit, not
copied into another active plan. That initial selection authorized documentation
only. After reviewing the written boundaries, the owner explicitly expanded the
request to actual implementation and continued progress toward a usable product.
The executable increment is the reviewed pure P2b contract; host integration
and later product phases still need concrete plans and verification, and the
new PR's merge still requires explicit direction.

#### Repository findings

| Verified current behavior | Consequence for the proposed contract |
| --- | --- |
| `PairStore.load` returns a full runtime snapshot and seen command IDs; `commit` atomically accepts a revisioned event batch | A minimized durable loader cannot implement this interface by fabricating missing fields; a separate port and later explicit integration are necessary |
| `InMemoryJournal` discards the prefix on disable while retaining revision and command-ID history | `events()` is not a durable export; do not use it to construct a complete log or assume persisted deduplication |
| v1 events retain entry diagnostics, paths, work-unit prose/baselines, arbitrary operation input, and free-form outcomes | Bounds, encryption, or string sanitization alone do not establish data minimization; construct a different closed schema |
| v1 workspace/session/command/operation IDs are caller-visible strings | Treating every identifier as safe metadata would still leak private content; a future trusted issuer must supply new opaque lifetime keys |
| Existing read reconciliation can re-execute eligible authorized read operations | Never hydrate that path from a recovered journal; the new restart boundary prohibits automatic replay of reads as well as mutations |
| P2a flags always deny authority/replay and retains unsettled operations across lifecycle changes | Preserve these guarantees while replaying a different, minimized state; neither reports nor historical outcomes are permissions |
| `BriefConfirmed` is shape-valid but unsupported by the current reducer | A projection must reject this unsupported source route rather than quietly add a new session transition |

These findings were established from the merged protocol, reducers, runtime
store, and tool executor before P2b implementation. The pure contract code and
its validation are separate evidence, not retroactive proof of a disk adapter.

#### Alternatives and limits

The selected direction gives an event journal exact authority over an explicitly
smaller durable domain. Omitted goals, paths, baselines, inputs, and grants must
be recollected after restart. This is a deliberate product trade-off, not a
claim to recover the existing runtime snapshot losslessly. A warning-only memo
would be smaller but leave the authoritative durable-state contract unsettled.
Whole-v1 persistence would preserve reducer inputs but violate the exclusion
of source, diagnostics, sensitive inputs, and free-form text, including when
encrypted or bounded. Neither alternative is silently treated as implemented.

Official API documentation establishes useful limits, not an adapter proof:

- [VS Code ExtensionContext](https://code.visualstudio.com/api/references/vscode-api#ExtensionContext)
  describes workspace-scoped `storageUri`, which can be undefined when no
  workspace is open, and notes that the directory may not exist. Its existence
  is not an atomic-commit, trust, ownership, or crash-recovery guarantee.
- [VS Code FileSystem](https://code.visualstudio.com/api/references/vscode-api#FileSystem)
  and [FileSystemProvider](https://code.visualstudio.com/api/references/vscode-api#FileSystemProvider)
  expose write/rename operations and errors across providers, but no portable
  transaction, compare-and-swap, or directory-flush contract. Requiring one
  writer and a tested supported-provider matrix is a design inference, not a
  promise of the VS Code API.
- [Node.js 24 file-system documentation](https://nodejs.org/docs/latest-v24.x/api/fs.html)
  warns against overlapping writes to one file and documents optional file
  flushing through `FileHandle.sync()`. That file-flush primitive does not
  establish atomic multi-file publication, writer exclusion, directory-entry
  durability, or uniform power-loss behavior for an arbitrary provider.

These sources were checked for API semantics on September 19, 2026. No system
crash, power-loss, filesystem, multi-process-lock, or deletion experiment was
run for P2b. Seven-day logical expiry, one-MiB encoded-byte bounds, 1,024-fact
limits, and the content-free deletion fence are **policy choices**, not
performance or filesystem measurements. The pure contracts enforce their
bounded representations; physical cleanup while inactive is explicitly not promised.
An adapter prototype, if needed, requires its own authorized time-boxed spike;
planning text is not evidence that a platform satisfies the contract.

#### P2b baseline and dependency maintenance

Before new contract code, both graphs installed cleanly on Node.js 24.20.0.
Forced workspace typecheck, lint, all **2,197 root tests in 118 files**, coverage
(91.04% statements/lines, 84.89% branches, 92.80% functions), the separate POC's
compile and **21 tests in five files**, build, and seven-entry Stable VSIX
verification passed. An initial validation command mistakenly requested a POC
`test` script; the actual `test:unit` script was then run successfully. This was
a command-selection error, not a product fix or an unrun test counted as passing.

On September 19, the inventory again covered **16 manifests, 49 declarations
(25 internal / 24 external), 16 external packages, and both active lockfiles**.
Selected and registry-stable metadata, engines/peers, and accessible primary
upstream records were compared, including the isolated POC outside workspace
globs. Before maintenance, both explicit audits reported zero findings (401
root graph entries and 257 POC entries). An outdated report was not the inventory.

| Package/tool | Current decision and evidence |
| --- | --- |
| Mocha | Update both maintained graphs from 12.0.0 to obtainable **12.0.1**, preserving the extension's caret range and the POC's exact pin. Registry metadata agrees with the [upstream 12.0.1 release](https://github.com/mochajs/mocha/releases/tag/v12.0.1), including dependency/configuration fixes; its Node range accepts the host baselines. Upstream 12.0.2 exists but the exact registry lookup still returns E404. Both manifests and lockfiles are updated together. |
| Node.js verification runtime | Move local subsequent verification to obtainable **24.21.0**, checked against the [official 24.21.0 release](https://nodejs.org/en/blog/release/v24.21.0). The repository's Node >=24 engine contract and package boundaries do not change. |
| Vitest and coverage-v8 | Retain the matching 5.0.0 pair; exact 5.0.1 registry lookups remain E404 despite the upstream release. |
| fast-check | Retain 4.10.0; upstream 4.10.1 remains unobtainable from the configured registry (exact E404). |
| TypeScript / typescript-eslint | Retain 6.0.3 / 8.70.0; registry-latest TypeScript 7.0.2 is outside the linter's `>=4.8.4 <6.1.0` peer range. Root lint also covers the POC. |
| Declaration floors | Retain @types/node 24.13.4 for Node 24 and @types/vscode 1.136.0 for the declared host API floor, rather than the unrelated latest tags 26.5.1 and 1.137.0. @types/mocha remains 10.0.10. |
| Other direct packages | Stable registry metadata still agrees with @eslint/js 10.0.1, @vscode/dts 0.4.1, @vscode/test-electron 3.1.0, @vscode/vsce 4.0.0, Ajv 8.20.0, esbuild 0.28.2, and ESLint 10.10.0. Accessible tagged source/release records agree; no package edge or protocol/API migration is introduced. |
| Upstream access limits | Microsoft TypeScript and VS Code-tooling release API requests still return an organization SAML restriction. No alternate credential/path was used to bypass it, and no independent release confirmation is claimed for those endpoints. Registry metadata is separately available. |

After the Mocha update, both installations report zero audit findings,
workspace typecheck and the POC compile/unit suite pass on Node.js 24.21.0.
This maintenance checkpoint is not a substitute for final changed-code,
isolated-host, packaging, and exact-PR-head CI verification.

#### P2b implementation evidence

The implementation is deliberately separate from the current event log, live
store, coordinator, and host journal. The closed `adaptive-pair-durable` codec
retains only opaque keys, finite classifications/assistance flags, bounded
sequences/times, and recorded phases. Its private reducer reconstructs the
complete minimized domain, including unsettled operations in closed sessions.
The cache is derived from that full replay and cannot salvage a missing or
corrupt prefix/suffix. The public inspection API always denies authority and
automatic replay; expiry returns no historical payload and requests erasure,
not an assertion that effects stopped.

The projector uses command-admitted, deeply frozen candidate objects. Weak
in-process identities distinguish exact retries without serializing or strongly
retaining raw events/snapshots/operation inputs. An explicit resolution of the
pending commit key is necessary: equal durable/live counters alone cannot prove
which candidate committed. Candidate-local event identity/grouping checks also
reject two distinct admitted commands that reuse one source command ID in their
first batch. Omitted batches acquire no durable command receipt. The retained
source-ID budget conservatively counts repeated occurrences across separately
prepared candidates, including definitively noncommitted attempts; exhaustion
never evicts retry evidence. These are construction/ordering guarantees within
the trusted live-source boundary, not provenance or consent inferred from
minimized-payload equality.

Independent review produced concrete corrections before delivery: complete
retained side-effect projection (including active assistance status, resume
reconciliation, and entry-capture presence); a persisted cleanup gate that also
blocks replacement creation; cross-commit aggregate-budget and unmasked safe
counter tests; same-batch source-command reuse rejection; and resolution-enum
validation before idempotence. A separate RED/GREEN regression corrected
under-counting repeated source-ID text. The original review concerns and their
verification were answered in their respective review conversations.

Storage-model review additionally exposed missing fence framing, unbounded
pre-serialization traversal of rejected request graphs, and accumulated copies
and retired-generation metadata. The corrected model validates closed request
fields before traversing their values, accounts for encoding before stringifying,
keeps bounded payload/cache/staging slots, and never evicts retired tokens to
admit a reused generation. Behavioral RED/GREEN tests cover shared/deep graphs,
repeated publication failures, cold reconstruction, and the exact 1,024-token
retirement boundary. These are finite model policies, not provider measurements.

Integrated local verification on Node.js **24.21.0** passes forced workspace
typecheck, full ESLint, and **2,725 root tests in 131 files**. The 528 added
cases comprise 210 protocol, 75 replay/cache, 47 projection, 146 storage-model,
and 50 recovery/public-contract tests. Property-test trials are not counted as
additional test cases. Root coverage is **91.55% statements, 85.84% branches,
93.45% functions, and 91.74% lines**. The isolated POC separately passes
**21 unit cases in five files**, compile, and packaging.

The built Stable VSIX passes the existing seven-entry verification policy;
its production bundle measures **539,516 bytes**, compared with **536,711 bytes**
for merged P2a. No source map, host test, test-only store, or POC contribution
is shipped. Isolated extension hosts pass **17 cases each** on VS Code
**1.136.2**, **1.137.0**, and **Insiders**; the POC passes its separate one-case
Insiders host suite. These verify unchanged inactive-zero/coexistence and the
existing Growth preview, not disk persistence or live restart. The known Vite
native-config-loader warning remains visible and no suppression was added.

The maintained dependency inventory was refreshed again after implementation:
**16 manifests, 49 declarations (25 internal/24 external), 16 external
packages, and both lockfiles**. Both full-graph audits remain at **zero**
findings (root: 407 audited dependencies; isolated POC: 257). The retained
version/availability and TypeScript peer-compatibility decisions in the table
above remain current. The Mocha patch changes the resolved transitive graph,
not the product's direct package boundaries. GitHub Actions pins also match
their checked stable releases: checkout 7.0.1, setup-node 7.0.0, and
upload-artifact 7.0.1; no workflow action update is required. The Microsoft
release-API SAML restrictions remain unchanged and were not bypassed.

## 7. Evaluation hypotheses

The first studies test separate hypotheses:

1. Growth Mode users are more able to generate a similar solution and debug a
   varied failure without AI mutation than users of a default coding agent.
2. The hint ladder reduces premature target-solution exposure without
   unacceptable abandonment or fatigue.
3. Pair Mode reduces unreviewed or reverted AI changes and preserves initiative
   without requiring equal typing time.
4. Delivery Mode improves verified throughput on familiar or mechanical work
   without being misreported as capability growth.
5. Local evidence interventions help on relevant events without creating more
   unwanted interruption than accepted assistance.
6. Installing and enabling Adaptive Pair leaves existing VS Code and Copilot
   Chat defaults, sessions, routing, and native workflows unchanged.
7. Adaptive Pair is non-inferior to the selected native harness on verified
   correctness and independent review quality for the same representative
   tasks.

Results from one mode are not attributed to another.

## 8. Research quality rules

Future documentation must:

- name study design and population;
- distinguish randomized treatment effects from observational subgroups;
- label preprints and vendor-authored studies;
- report null and adverse findings;
- avoid treating practitioner experience as a controlled trial;
- avoid converting an immediate assessment into long-term retention;
- preserve superseded results with their date and later correction;
- cite a primary or official source whenever available.

## References

1. Hannay, Dyba, Arisholm, and Sjoberg (2009).
   *The effectiveness of pair programming: A meta-analysis.*
   https://doi.org/10.1016/j.infsof.2009.02.001
2. McDowell, Werner, Bullock, and Fernald (2006).
   *Pair programming improves student retention, confidence, and program
   quality.* https://doi.org/10.1145/1145287.1145293
3. Umapathy and Ritzhaupt (2017).
   *A Meta-Analysis of Pair-Programming in Computer Programming Courses.*
   https://doi.org/10.1145/2996201
4. Plonka, Segal, Sharp, and van der Linden (2011).
   *Collaboration in Pair Programming: Driving and Switching.*
   https://doi.org/10.1007/978-3-642-20677-1_4
5. Plonka, Sharp, and van der Linden (2012).
   *Disengagement in pair programming: Does it matter?*
   https://www.researchgate.net/publication/254041569_Disengagement_in_pair_programming_Does_it_matter
6. Plonka, Sharp, van der Linden, and Dittrich (2015).
   *Knowledge transfer in pair programming: An in-depth analysis.*
   https://doi.org/10.1016/j.ijhcs.2014.09.001
7. Bockeler and Siessegger (2020). *On Pair Programming.*
   https://martinfowler.com/articles/on-pair-programming.html
8. Falco (2014). *Llewellyn's strong-style pairing.*
   https://llewellynfalco.blogspot.com/2014/06/llewellyns-strong-style-pairing.html
9. Sarkar et al. (2022).
   *What is it like to program with artificial intelligence?*
   https://www.microsoft.com/en-us/research/publication/what-is-it-like-to-program-with-artificial-intelligence/
10. Vaithilingam, Zhang, and Glassman (2022).
    *Expectation vs. Experience: Evaluating the Usability of Code Generation
    Tools Powered by Large Language Models.*
    https://doi.org/10.1145/3491101.3519665
11. Peng, Kalliamvakou, Cihon, and Demirer (2023).
    *The Impact of AI on Developer Productivity: Evidence from GitHub Copilot.*
    https://arxiv.org/abs/2302.06590
12. Barke, James, and Polikarpova (2023).
    *Grounded Copilot: How Programmers Interact with Code-Generating Models.*
    https://doi.org/10.1145/3586030
13. Perry, Srivastava, Kumar, and Boneh (2023).
    *Do Users Write More Insecure Code with AI Assistants?*
    https://doi.org/10.1145/3576915.3623157
14. METR (2025).
    *Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer
    Productivity.* https://arxiv.org/abs/2507.09089
15. METR (2026). *Updated AI uplift results.*
    https://metr.org/blog/2026-02-24-uplift-update/
16. Shen and Tamkin (2026). *How AI Impacts Skill Formation.* Preprint.
    https://arxiv.org/html/2601.20245
17. VS Code. *Chat Participant API.*
    https://code.visualstudio.com/api/extension-guides/ai/chat
18. VS Code. *Language Model API.*
    https://code.visualstudio.com/api/extension-guides/ai/language-model
19. VS Code. *Language Model Tool API.*
    https://code.visualstudio.com/api/extension-guides/ai/tools
20. VS Code. *Custom agents.*
    https://code.visualstudio.com/docs/agent-customization/custom-agents
21. VS Code. *Agent plugins.*
    https://code.visualstudio.com/docs/agent-customization/agent-plugins
22. VS Code. *Agent sessions and handoff.*
    https://code.visualstudio.com/docs/agents/concepts/sessions
23. VS Code. *Approvals and permissions.*
    https://code.visualstudio.com/docs/agents/run/approvals
24. VS Code. *Agent hooks.* Preview.
    https://code.visualstudio.com/docs/agent-customization/hooks
25. VS Code. *Agent Host.* Under active development.
    https://code.visualstudio.com/docs/agents/concepts/agent-host
26. Microsoft. *Agent Host Protocol.*
    https://microsoft.github.io/agent-host-protocol/
27. Slamecka and Graf (1978). *The generation effect: Delineation of a
    phenomenon.* https://doi.org/10.1037/0278-7393.4.6.592
28. Koedinger and Aleven (2007). *Exploring the Assistance Dilemma in
    Experiments with Cognitive Tutors.*
    https://doi.org/10.1007/s10648-007-9049-0
29. Sinha and Kapur (2021). *When Problem Solving Followed by Instruction
    Works: Evidence for Productive Failure.*
    https://doi.org/10.3102/00346543211019105
30. Roediger and Karpicke (2006). *Test-Enhanced Learning.*
    https://doi.org/10.1111/j.1467-9280.2006.01693.x
31. Kirschner, Sweller, and Clark (2006). *Why Minimal Guidance During
    Instruction Does Not Work.*
    https://doi.org/10.1207/s15326985ep4102_1
32. VS Code. *Choose and use an agent harness.*
    https://code.visualstudio.com/docs/agents/run/agent-harnesses
33. VS Code. *Proposed Chat Sessions Provider API.*
    https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.chatSessionsProvider.d.ts
34. VS Code. *Using Proposed API.*
    https://code.visualstudio.com/api/advanced-topics/using-proposed-api
