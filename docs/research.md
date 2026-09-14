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
| Session Target | VS Code documents Local, Copilot, Claude, Codex, and Cloud as execution harness or target choices, separately from Agent, model, permissions, and isolation controls. [32] | Keep the underlying execution harness user-selectable; do not place Adaptive Pair's product modes in this selector. |
| Chat participant | The Chat Participant API provides an `@`-mentioned assistant that owns its request flow and receives the model selected in Chat. [17][18] | Keep `@pair` as a controlled, model-selecting fallback surface. |
| Extension tools | Language Model Tools can be contributed by Marketplace extensions, included in custom agents, restricted with `when` clauses, and given confirmation behavior. [19] | Expose Pair Runtime operations through mode-aware extension tools and revalidate every call. |
| Custom agents | `.agent.md` files define instructions, model choice, tools, visibility in the agent picker, and agent-to-agent handoffs. [20] | Use an Agent Plugin for the native picker surface. Keep human-to-AI edit handoff in the Pair Runtime. |
| Agent plugins | Plugins package skills, MCP servers, and Copilot-specific custom agents, hooks, and commands for marketplace or repository installation. [21] | Distribute the picker customization separately from, but versioned with, the VSIX. |
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
- the combined Agent Plugin and VSIX installation experience.

The architecture does not wait on these answers. A capability gate selects the
native adapter only when it passes. The controlled VSIX surface remains the
complete fallback.

Current public documentation describes first-party Agent Host adapters and
extension points for tools, MCP, custom agents, and chat participants. It does
not document a stable Marketplace contribution point for registering an
arbitrary third-party Session Target beside Copilot, Claude, and Codex. AHP is
open and agent-agnostic, but Agent Host integration is still under active
development.

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
execution harness. The Adaptive Pair custom agent selects its instructions and
tools. Growth, Pair, or Delivery selects the capability contract.

Combining these into one harness dropdown would couple the product value to an
execution provider and prevent the same Pair state from spanning supported
targets.

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

### Explicit and correctable personalization

Task briefing and declared preferences outrank inferred expertise. Any proposed
reflection requires review before persistence. No single error, pause, typing
rate, vocabulary choice, or repository history creates an ability label.

### Verification and calibrated confidence

Applied files and observed checks are displayed independently from model prose.
Evaluation compares confidence with correctness instead of treating confidence
as success.

### Evaluation from the first release

Growth, Pair, and Delivery are all hypotheses. They ship with local metrics and
mode-specific completion claims rather than holding one mode to a stricter
standard than another.

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
