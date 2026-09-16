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
- `@types/node` 24.13.3 is the latest available Node 24 type release. The registry
  advertises 26.5.0, but the types must describe the supported Node 24 host floor,
  not silently allow APIs that require Node 26.
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
