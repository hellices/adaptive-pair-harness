# Adaptive AI Pair Harness Design

- Date: 2026-09-11
- Status: Approved design, pending written-spec review
- Primary surface: Visual Studio Code
- Initial ecosystem: TypeScript and JavaScript
- Distribution: Fully open source

## 1. Executive Summary

The Adaptive AI Pair Harness is a VS Code-first, open-source pair-programming
system for developers who want to finish real products while becoming more
capable engineers.

It is neither a coding tutor separated from real work nor an autonomous
ticket-to-PR agent. The user remains an active developer. The pair observes the
current goal and evolving code, asks about intent, challenges risky direction
with repository-grounded evidence, works on complementary tasks, and negotiates
bounded driver/navigator handoffs.

The product optimizes for:

> Verified product outcome x human ownership x willingness to continue building

Growth does not mean using less AI. It means that, after a development cycle,
the user can explain, modify, test, and extend the important parts of the work
and can connect them to adjacent code and architecture.

The harness is tool-first and LLM-last. Language services, AST analysis,
compiler diagnostics, repository conventions, tests, linters, runtime output,
and GitHub artifacts produce the evidence. Models turn selected evidence into
timely dialogue, explanation, and bounded implementation help.

The harness also assumes that Copilot, Superpowers, Cline, Claude Code, and
other development harnesses may be active. It coordinates or falls back to
observe-only behavior rather than assuming exclusive control of the workspace.

## 2. Origin and Product Philosophy

The idea is motivated by Chris Piech's argument that learning and personal
growth remain essential even when AI can generate code. The referenced
[EO Korea interview](https://www.youtube.com/watch?v=_qYUwrJ_XHo) describes
Code in Place and emphasizes motivation, logical thinking, and growth in the AI
era.

The harness therefore follows these principles:

1. AI assistance is expected and remains available.
2. The user must participate in product decisions and implementation.
3. The pair should preserve momentum rather than impose school-like gates.
4. The system should help the user operate near the edge of current ability.
5. Engineering principles are contextual tools, not dogmatic scoring rules.
6. Evidence from the repository and development toolchain outranks model
   intuition.
7. Personal growth data belongs to the user.

## 3. Target User and Positioning

### Primary user

The first target is a global, English-first junior developer who:

- has a product idea and wants to build it in a real GitHub repository;
- wants to contribute to an established repository more confidently;
- already expects to use AI but does not want to become a project manager who
  only specifies and reviews generated work;
- wants to understand and own the code produced during each cycle.

The system must also adapt to uneven profiles. An architect may understand
system boundaries but lack implementation fluency. An implementation-focused
developer may code quickly but need help with architecture, testing, or Git.

### Positioning

> Build real products with an AI pair that helps you understand and own every
> important part.

The product should not lead with "education," "assessment," or "clean-code
scoring." It should lead with shipping real software through a better form of
pair programming.

## 4. Market and Competitive Assessment

This assessment reflects official product and repository information reviewed
on 2026-09-11.

### Demand signals

The [2025 Stack Overflow Developer Survey](https://survey.stackoverflow.co/2025/ai)
reported:

- 84% of respondents use or plan to use AI tools in development;
- 46% distrust AI-tool accuracy, compared with 33% who trust it;
- 66% are frustrated by solutions that are almost right;
- 45.2% report that debugging AI-generated code takes more time;
- 20% report reduced confidence in their own problem-solving;
- 16.3% find it hard to understand how or why generated code works.

GitHub's
[2024 survey of 2,000 respondents](https://github.blog/news-insights/research/survey-ai-wave-grows/)
reported that 60-71% perceived AI tools as making new languages or existing
codebases easier to understand. This is vendor research and is directional
rather than independent market proof.

The [DORA 2025 report](https://dora.dev/research/2025/dora-report/) characterizes
AI as an amplifier of an organization's existing strengths and weaknesses.
This supports a product focused on the surrounding work system rather than
model access alone.

### Competitive landscape

| Product group | Strength | Gap relative to this design |
|---|---|---|
| [GitHub Copilot and VS Code Agents](https://code.visualstudio.com/docs/agents/overview), Cursor, Amazon Q | IDE integration, planning, editing, commands, background agents | No user-approved capability model, continuous pedagogical navigator, or ownership pass |
| Qodo and SonarQube for IDE | As-you-code review and deterministic diagnostics | Review-oriented; no negotiated role switching or longitudinal growth memory |
| Cline, OpenCode, and [Pochi](https://github.com/TabbyML/pochi) | Interactive agent UX, approvals, BYOK, repository work | Primarily request-to-execution systems rather than adaptive apprenticeship |
| [Factory Missions](https://factory.ai/news/missions), Devin, and Augment | Goal decomposition, parallel work, validation, and PR delivery | The human tends to become a project manager rather than an active developer |
| DeepWiki, CodeTour, GitLens, and repository explainers | Codebase tours, history, and passive understanding | Weak connection to the live implementation and ownership cycle |

Useful open-source building blocks include:

- [Pochi](https://github.com/TabbyML/pochi) for a VS Code agent pattern;
- [Cline](https://github.com/cline/cline) and
  [OpenCode](https://github.com/anomalyco/opencode) for interaction and
  permission patterns;
- [Serena](https://github.com/oraios/serena) for symbol-aware repository
  retrieval;
- [GitHub Agentic Workflows](https://github.com/github/gh-aw) for secure,
  repository-native execution patterns;
- [OpenHands](https://github.com/OpenHands/OpenHands) for a self-hosted control
  plane;
- [Microsoft CodeTour](https://github.com/microsoft/codetour),
  [DeepWiki-Open](https://github.com/AsyncFuncAI/deepwiki-open), and
  [GitHub Skills](https://github.com/skills) for onboarding and progressive
  practice patterns.

No reviewed product combines all of the following:

1. continuous VS Code observation while the human writes;
2. proactive, evidence-backed direction checks;
3. inline dialogue and complementary live work;
4. negotiated driver/navigator transitions;
5. a multidimensional, user-approved capability model;
6. issue, branch, PR, review, and CI continuity;
7. human ownership verification;
8. progressive adjacent-architecture understanding;
9. local-first instrumentation and user-owned memory.

### Market decision

The decision is **Conditional Go**.

The opportunity is real only if the project remains an adaptive pair harness.
It should not compete on generated code volume, model quality, autonomous
swarming, or ticket-to-PR speed. Those capabilities are rapidly commoditized
and already have well-funded incumbents.

## 5. Core Development Cycle

### 5.1 Project and user setup

The harness:

1. connects or initializes a GitHub repository;
2. identifies the product goal and cycle completion criteria;
3. discovers the repository toolchain and applicable packs;
4. asks the user to self-assess separate capability dimensions;
5. loads approved personal and project memory;
6. confirms privacy, model, token, and command policies.

The initial capability dimensions are:

- architecture;
- domain understanding;
- implementation;
- debugging;
- testing;
- Git and contribution workflow.

Self-assessment is an initial hypothesis, not a score.

### 5.2 Pair choreography

The default state is:

> Human Driver / AI Navigator

The pair maintains a live working agreement rather than a static task split.
For example:

- the pair writes the first failing test;
- the human owns the production behavior and architectural decision;
- the pair watches transaction-boundary risk and test feedback;
- the pair interprets the failure together.

Available states are:

1. **Human Driver / AI Navigator** - the user edits while the pair asks,
   retrieves evidence, and challenges direction.
2. **Co-driver** - the pair proposes one conceptual change as a small diff that
   the user can edit and approve line by line.
3. **AI Driver / Human Navigator** - the pair performs a bounded demonstration,
   repetitive change, or familiar mechanical step.
4. **Ownership Checkpoint** - the user explains, traces, verifies, modifies, and
   connects the completed work.

The AI never takes control silently. A handoff states:

- the files and symbols it may touch;
- the intended change;
- the validation method;
- the stopping condition;
- how the user takes control back.

## 6. Real-Time Pair Loop

### 6.1 The system does not infer thoughts

The harness cannot know whether a user is thinking or stuck. It observes local
behavioral signals and asks a non-judgmental question when a combination of
signals makes assistance plausibly useful.

Signals include:

- time since a meaningful edit, save, or navigation action;
- editor and window focus;
- cursor and selection movement;
- repeated navigation across the same symbols;
- edit and revert cycles;
- repeated diagnostics or test failures;
- repeated commands;
- recurring debugger stops;
- explicit controls such as `Thinking`, `Need a hint`, and `Stay quiet`.

Internal working states are:

- editing;
- exploring;
- thinking;
- possibly blocked;
- away.

The UI reports observations, not mental-state claims:

> This test failed twice at the same frame, and this block has been unchanged
> for a while. Trace it together, get one hint, or keep thinking?

Pause thresholds, cooldowns, and intervention intensity are personal settings.
A declined intervention does not reduce the user's capability profile.

### 6.2 Incremental semantic analysis

The primary loop is not lint-after-completion or test-after-implementation.

```text
short edit burst
  -> 300-800 ms debounce
  -> confirm a syntactically stable statement or block
  -> incrementally update AST, types, symbols, and dependency graph
  -> compare with the current intent, plan, and repository patterns
  -> decide whether local presence, a question, or deeper reasoning is useful
```

The analyzer looks for:

- new dependencies that cross an established boundary;
- reinvention of an existing repository implementation;
- a function growing toward multiple responsibilities;
- public type changes with broader impact than expected;
- incomplete promise, resource, transaction, or state lifecycles;
- missed error paths and invariants;
- global dependencies that reduce testability;
- scope expanding beyond the approved plan;
- a task that has become too large for the current challenge target.

It waits while a line is incomplete and favors questions over declarations when
the user's intent is uncertain.

### 6.3 Inline experience

VS Code APIs are combined rather than replaced:

- Comment Threads for range-anchored dialogue and replies;
- CodeLens for `Why?`, `Show precedent`, and `Pair here`;
- Inlay Hints for low-noise presence and status;
- Hover content for evidence and reference links;
- Code Actions for bounded fixes and examples;
- Inline Completion for user-requested short suggestions;
- a sidebar for the persistent goal, hypothesis, role, and longer dialogue.

The pair can work on a complementary artifact while the user edits. For
example, the pair may add a failing test in another tab while the user writes
the production behavior. The UI shows both activities and makes the handoff
explicit.

## 7. Tool-First, LLM-Last Architecture

### 7.1 Evidence priority

Evidence is considered in this order:

1. compiler and type checker;
2. repository tests and runtime behavior;
3. configured linter, static analyzer, and security scanner;
4. repository rules, ADRs, CI, and historical review decisions;
5. framework and language documentation;
6. LLM inference.

Models explain and connect evidence. They do not override deterministic failure
results or invent successful validation.

This is the authority order when sources conflict, not the interaction cadence.
Incremental semantic analysis and inline dialogue begin while code is being
written; full lint, test, build, and CI checks remain checkpoint validation.

### 7.2 Toolchain discovery

At repository setup, the harness detects:

- package scripts and workspaces;
- TypeScript configuration;
- lint and formatting configuration;
- test frameworks and test locations;
- build tools;
- Git hooks and staged-file tooling;
- GitHub Actions and required checks;
- coverage, security, and secret scanners;
- repository-specific task runners;
- run and debug configurations;
- repository guidance and ADRs.

The reviewed result is represented in a versioned repository configuration:

```yaml
checks:
  onEditDebounced:
    - typescript:changed-symbols
  onSave:
    - eslint:changed-files
  beforeHandoff:
    - test:related
  beforeCommit:
    - typecheck
    - lint:staged
    - test:related
  beforePullRequest:
    - build
    - test:all
    - github:required-checks
```

The harness may propose missing tool configuration but never installs packages
or overwrites configuration without showing and receiving approval for the
exact change.

### 7.3 Hook registry

Pack adapters can register for:

- `onEditDebounced`;
- `onSave`;
- `onDiagnosticChange`;
- `onUserPause`;
- `beforePairPatch`;
- `afterPairPatch`;
- `onTestFailure`;
- `beforeCommit`;
- `beforePush`;
- `beforePullRequest`;
- `onCIResult`;
- `onReviewComment`.

Each adapter normalizes results into:

```text
tool
severity
file and range
message
rule or test identifier
raw evidence reference
suggested next check
confidence
```

### 7.4 Terminal and navigation bridge

For pair-run commands, the harness records command, working directory, exit
code, duration, and structured output. It publishes navigable diagnostics and
keeps the complete raw output in the terminal or an Output Channel.

For user-run commands, it uses VS Code shell integration when available and
parses known tool formats. A Terminal Link Provider turns locations such as
`src/foo.ts:42:7` into links. Unknown logs are not uploaded wholesale.

Navigation responsibilities are:

- Terminal: complete live command output;
- Problems and Test Results: canonical, clickable failure index;
- inline thread: explanation and paired correction at the affected code;
- Output Channel: retained structured output for pair-run commands.

The terminal API cannot reliably scroll an external UI to every historical
terminal line, so navigable diagnostics and the Output Channel are the durable
evidence index.

## 8. Pack Architecture

### 8.1 Core Engineering Pack

The core pack is language and framework independent. It covers:

- cohesion, coupling, and responsibility;
- module and dependency boundaries;
- state and data flow;
- error and failure models;
- testability;
- changeability and complexity;
- concurrency, performance, and security risk;
- naming, readability, and duplication;
- debugging hypotheses and evidence;
- reviewable commits and changes.

### 8.2 Language Pack

The first deep language pack supports TypeScript and JavaScript:

- type modeling and narrowing;
- package and module boundaries;
- async behavior and the event loop;
- mutation and data modeling;
- error semantics;
- language idioms and tooling;
- TypeScript compiler and language-service evidence.

### 8.3 Framework Context Adapters

React, Node.js, Jest, Vitest, and build-tool adapters provide:

- official lifecycle and API constraints;
- framework-idiomatic patterns;
- build, lint, test, and debug commands;
- detected project structure;
- version-appropriate documentation.

Adapters do not impose an architecture.

### 8.4 Repository Profile

Repository context has priority over generic pattern advice:

- actual dependency direction and folder structure;
- ADRs and contribution guidance;
- established code conventions;
- testing strategy;
- historical review decisions;
- accepted technical debt and constraints.

Advice follows this order:

```text
correctness and security
  > explicit product requirements and repository decisions
  > codebase consistency
  > current cost and team constraints
  > general engineering principles
  > textbook pattern purity
```

SOLID, design patterns, and Clean Architecture are trade-off vocabularies rather
than scorecards. The pair should recommend the smallest context-appropriate
improvement and explain when a more formal pattern would become worthwhile.

## 9. Challenge Curve and Growth

Each issue or development cycle selects one or two growth targets.

- Familiar work may be delegated or completed together quickly.
- Slightly unfamiliar work keeps the user as driver and increases scaffolding
  progressively.
- Overwhelming work is reduced, or the pair demonstrates one bounded portion
  before returning control.
- High-risk work receives explicit review regardless of capability.

The hint ladder is:

```text
question
  -> directional hint
  -> related symbol or link
  -> small example
  -> pseudocode
  -> partial demonstration
  -> paired completion
```

Repeated struggle is a signal to resize or scaffold the task, not evidence of
reduced ability. The objective is a sequence of real, motivating wins that
build confidence to work directly in the code.

Growth evidence includes:

- correct design and implementation decisions;
- falsifiable debugging hypotheses;
- meaningful test design;
- accurate explanation of behavior and trade-offs;
- rejecting an incorrect AI suggestion;
- a small follow-up modification;
- applying prior review feedback;
- understanding an adjacent module or flow.

Accepted AI patches, copied explanations, elapsed time, keystrokes, and lines of
code are not direct evidence of understanding.

## 10. Memory Architecture

### 10.1 Session working memory

Local and temporary:

- current goal and hypothesis;
- open code and active evidence;
- raw event buffer;
- terminal and tool output;
- unresolved questions.

Raw events use a short in-memory retention period. Only a reviewed summary
survives the session.

### 10.2 Personal growth memory

User-owned and private:

- approved capability evidence;
- preferred interaction frequency and explanation style;
- concepts handled independently, paired, or demonstrated;
- recurring mistakes the user has agreed to retain;
- cross-repository debugging, testing, and Git experience;
- project-specific architecture and domain understanding.

The user can accept, adjust, reject, export, and delete every profile update.

### 10.3 GitHub project memory

GitHub issues, PRs, commits, reviews, checks, and CI remain the source artifacts.
The harness stores references and structured summaries rather than copies.

Supported persistence modes are:

- local SQLite or files for raw session state;
- an optional, user-owned private GitHub memory repository for approved
  personal records and cross-device continuity;
- the product repository for explicitly shared ADRs and project knowledge;
- URLs and SHAs linking memory to original GitHub artifacts.

Local-only use remains fully supported. GitHub memory synchronization requires
explicit opt-in. Personal weaknesses are never committed to the product
repository.

### 10.4 Memory merge

The active context combines:

```text
GitHub issue, PR, review, commit, and CI evidence
  + repository architecture and conventions
  + approved personal capability and interaction preferences
  -> the appropriate role, challenge, and support for this user and task
```

Global capabilities and repository-specific knowledge remain separate.

## 11. Provenance and Privacy

### 11.1 Session provenance

The harness tracks only:

- `user-supplied`: typed, pasted, imported, or otherwise placed by the user;
- `pair-generated`: applied by the current pair session.

This is session provenance, not a claim of original authorship. User-supplied
code is not automatically counted as understood.

### 11.2 Data boundaries

Local by default:

- raw edits and unsaved history;
- repository index;
- terminal raw output;
- unapproved capability evidence;
- credentials and secrets.

Eligible for user-approved sync:

- goals, plans, and decisions;
- commit, PR, check, and test references;
- verified outcome summaries;
- approved capability updates;
- user-authored reflection;
- adjacent architecture coverage.

The project separates consent for:

1. product synchronization;
2. model inference;
3. anonymous diagnostic telemetry.

## 12. Model Router and Token Control

### 12.1 Role-based model slots

```yaml
models:
  realtime:
    provider: default
    profile: fast-pair
    targetFirstTokenMs: 700
    maxOutputTokens: 180
  deepReasoning:
    provider: user-selected
    trigger: explicit-or-high-risk
  implementation:
    provider: user-selected
    requireApproval: true
  summarization:
    provider: local
```

The project publishes a default routing policy and recommended profiles. Users
can replace any slot with a better model without changing the pair policy,
memory, or permissions.

Initial adapters cover:

- OpenAI-compatible endpoints;
- Anthropic;
- Gemini;
- Ollama and LM Studio;
- VS Code Language Model API.

The common provider contract covers streaming, cancellation, structured output,
tool calls, context limits, usage reporting, latency, privacy, and prompt
caching.

### 12.2 Immediate interaction

Target flow:

```text
0-100 ms: local presence or evidence candidate
100-300 ms: related-symbol and repository retrieval
300 ms onward: real-time model begins streaming when needed
```

If continued editing invalidates a request, it is cancelled. Multiple events
are coalesced into the latest semantic state.

### 12.3 Token budget

Interaction frequency and model-call frequency are independent.

The local layer handles:

- debounce and AST updates;
- diagnostics;
- dependency changes;
- repository pattern retrieval;
- pause and revert states;
- tool-output parsing;
- duplicate detection and caching.

LLM levels are:

1. local presence and links, with no call;
2. short question from structured evidence;
3. deeper explanation after user interaction;
4. bounded implementation after explicit handoff.

A configurable budget controls:

- proactive calls per interval;
- input and output tokens per call;
- cooldown;
- selected model per level;
- explicit approval for implementation calls.

Context is limited to changed symbols, one-hop dependencies, selected evidence,
and structured session state. Unchanged context is cached, and repeated evidence
is content-hashed.

Budget exhaustion degrades to the local navigator. It never silently exceeds
the configured limit or fabricates model output.

## 13. Coexistence and Interoperability

### 13.1 Control states

The harness never assumes it is the only controller of the repository.

```text
Observe Only
Human Driver
Pair Driver
External Driver
Conflict Paused
```

- **Observe Only** explains and reviews without writing.
- **Human Driver** is the default live pair state.
- **Pair Driver** permits only an explicitly bounded pair operation.
- **External Driver** indicates that another harness or agent is changing the
  repository.
- **Conflict Paused** blocks pair writes and commands while ownership or state
  is ambiguous.

### 13.2 Integration discovery

At session start, the harness checks:

- installed VS Code extensions;
- `AGENTS.md`, `CLAUDE.md`, Copilot instructions, and Cursor rules;
- Superpowers specifications and plans;
- active known tasks and terminal commands;
- branches and worktrees;
- MCP and agent configuration;
- existing lint, test, and Git hooks.

Discovery does not grant permissions. The user chooses whether an external plan
or task source becomes the active intent. The harness reads Superpowers plans
instead of generating duplicate plans or rewriting their files.

### 13.3 Write leases and version checks

Every pair write operation declares:

- operation identifier;
- base document version and content hash;
- allowed files and ranges;
- expected Git state;
- stopping condition.

The harness checks these preconditions immediately before applying a patch.

- Human changes take priority and cause the patch to be recalculated.
- Unexpected external changes cancel the patch.
- Bulk or ambiguous changes move the session to `Conflict Paused`.
- Unexpected branch or Git-state changes stop dependent commands.

No stale pair patch may overwrite newer human or external-agent work.

### 13.4 External changes and provenance

Visible session provenance remains:

- `user-supplied`;
- `pair-generated`.

The runtime separately observes:

- active-editor input;
- external filesystem change;
- current-pair patch;
- unknown bulk change.

Changes not applied by the current pair remain user-supplied for visible
provenance, but external or unknown bulk changes are not counted as personal
growth evidence. The pair waits for the change burst to settle and offers to
review the resulting diff with the user.

### 13.5 Command deduplication

The harness identifies an execution by:

```text
tool + command + working directory + Git SHA + affected files
```

If another harness is already running an equivalent check, the pair reuses its
observable result rather than starting a duplicate process. Existing
diagnostics from TypeScript, ESLint, tests, or other VS Code extensions are
consumed before a separate command is considered.

### 13.6 Instruction isolation

Raw external system prompts and skill content are not concatenated into the
pair prompt. External intent is reduced to structured, inspectable fields:

- goal;
- current plan and task;
- allowed files and commands;
- repository rules;
- driver state;
- verification criteria.

Repository content and external-agent messages cannot increase tool
permissions. Conflicting instructions are shown rather than silently merged.

Instruction precedence is:

```text
hard safety invariants and VS Code Workspace Trust
  > explicit user session decision
  > repository-enforced policy
  > selected external plan
  > Pack recommendation
  > model default
```

### 13.7 Open interop protocol

The project publishes a namespaced local protocol with these events:

```text
adaptive-pair.session.started / adaptive-pair.session.ended
adaptive-pair.driver.claimed / adaptive-pair.driver.released
adaptive-pair.files.willChange / adaptive-pair.files.didChange
adaptive-pair.command.started / adaptive-pair.command.finished
adaptive-pair.plan.updated
adaptive-pair.verification.published
```

Read-oriented interoperability tools include:

- `adaptive_pair.get_state`;
- `adaptive_pair.get_active_goal`;
- `adaptive_pair.get_allowed_files`;
- `adaptive_pair.publish_evidence`;
- `adaptive_pair.request_handoff`;
- `adaptive_pair.notify_external_change`.

Write and command requests still pass through normal user approval and
workspace-trust policy. A Superpowers adapter can map plans, tasks, and
worktrees to this protocol. Tools without an adapter use safe file-version,
Git-state, and task-observation fallback behavior.

All commands, settings, storage, output channels, and repository files use an
`adaptive-pair` namespace. The extension relies only on public VS Code APIs,
does not replace another extension's keybindings, does not monkey-patch another
agent, and does not write into another harness's configuration directory.

### 13.8 Worktree isolation

Autonomous or long-running external work should use a separate Git worktree:

- the active VS Code worktree remains the human and Adaptive Pair workspace;
- an external worktree contains large or asynchronous agent changes;
- completed work returns as a commit or diff for paired review.

If isolation is unavailable, external-driver detection and write leases provide
the fallback. Ambiguous ownership always disables automatic writes.

## 14. Error Handling and Safety

Intervention levels are:

1. quiet signal;
2. inline question;
3. evidence-backed suggestion;
4. role-switch proposal;
5. blocking gate for secrets, destructive commands, and explicitly configured
   security boundaries only.

Every intervention supports:

- show evidence;
- keep working;
- show a smaller example;
- delegate this bounded step;
- reduce this advice category;
- mark the judgment as wrong.

Failure behavior:

| Failure | Behavior |
|---|---|
| Model timeout or provider failure | Continue local analysis and show model state; never simulate a reply |
| Stale documentation conflicts with code | Show both sources and mark the decision uncertain |
| Pack does not support the detected stack deeply | Enter generic mode and disclose the limitation |
| Command or patch approval is denied | Make no change and return control |
| Validation cannot run | Mark the cycle unverified |
| GitHub memory conflict | Preserve both versions and request an explicit merge |
| Workspace is untrusted | Allow read-only exploration; block commands and patches |
| Intervention fatigue | Apply cooldown and per-category frequency controls |
| Profile inference is rejected | Remove it from active memory and do not reuse it |
| Fallback model requires a different provider | Request approval before sending any context |

## 15. Open-Source Structure

All core components are public:

- VS Code extension;
- pair policy and role state machine;
- incremental semantic analyzer;
- Core, Language, and Framework Pack SDK;
- tool and provider adapters;
- memory schema and GitHub integration;
- local and self-hosted web companion;
- evaluation fixtures and conformance tests.

The recommended project license is Apache-2.0 to provide a clear patent grant
and allow broad personal and organizational use. Third-party components remain
subject to their own licenses.

Long-term defensibility comes from:

- the pair-policy and challenge-curve evaluation corpus;
- the open Pack ecosystem;
- a portable, user-owned memory standard;
- repository-grounded evidence patterns;
- community trust and transparent privacy behavior.

## 16. MVP Scope

### Included

- VS Code extension;
- TypeScript and JavaScript Language Pack;
- Core Engineering Pack;
- thin React, Node.js, Jest, Vitest, and tool adapters;
- repository scan and reviewed harness configuration;
- incremental semantic navigator;
- inline pair conversation and personalized frequency;
- driver/navigator role state machine;
- failing-test scaffolds and small approved patches;
- GitHub issue-to-branch-to-draft-PR continuity;
- cycle ownership pass;
- personal private GitHub memory repository;
- local or self-hosted web companion;
- model router, local mode, BYOK, and token budgets.
- external-harness discovery, control states, write leases, and version checks;
- a Superpowers plan/worktree adapter and the initial open interop protocol.

### Excluded

- autonomous multi-agent swarms;
- a cloud IDE;
- shallow support for every language;
- long-running ticket-to-PR delegation;
- employee ranking or hiring assessment;
- keystroke and LOC productivity scoring;
- mandatory quizzes;
- proprietary hosted memory.

## 17. Verification Strategy

### 17.1 Automated tests

- event aggregation and semantic checkpoint detection;
- incremental AST, type, symbol, and dependency updates;
- pair-state transitions, cancellation, and hand-back;
- user-supplied and pair-generated provenance;
- toolchain discovery and Pack compatibility;
- provider conformance, cancellation, streaming, and usage metering;
- token budget and cache behavior;
- local-to-GitHub memory sync and conflict handling;
- secret redaction and no-upload guarantees;
- VS Code Extension Host fixtures for editing, diagnostics, tasks, tests, Git,
  terminal links, comments, and code actions.
- concurrent human, pair, and external-agent edits;
- stale patch cancellation, command deduplication, and branch changes;
- Superpowers plan updates and isolated worktree result review.

### 17.2 Scenario evaluation

Fixtures cover:

- a pattern that is appropriate;
- the same pattern as overengineering in a small codebase;
- repository conventions that differ from textbook architecture;
- an implementation-focused user;
- an architecture-focused user with weak coding fluency;
- pair-written tests with human-written implementation;
- pasted user code and pair-generated code;
- stale documentation that conflicts with runtime evidence;
- repeated pauses that mean reading, thinking, being away, and being blocked.
- an external harness editing the same and different files;
- an external task producing reusable validation evidence;
- conflicting repository and external-plan instructions.

Evaluation measures:

- required interventions caught;
- unnecessary interventions avoided;
- evidence accuracy and navigability;
- challenge and explanation appropriateness;
- user agency preserved;
- useful interventions per model token.

### 17.3 User validation

Initial pilots include junior developers building TypeScript products and
developers contributing to established open-source repositories.

Hypotheses:

1. The inline pair feels more collaborative than chat or autonomous agent mode.
2. Users can accurately explain the critical flow, test, and trade-off after a
   cycle.
3. Users confidently re-enter the area for a related change.
4. Evidence-backed interventions are more useful than distracting.
5. Approved memory improves support and challenge fit in later sessions.
6. Repository-contextual advice is trusted more than generic pattern advice.

Initial product gates:

- at least 70% of inline interventions rated useful or appropriate;
- fewer than 15% rated clearly unnecessary or wrong;
- at least 70% of users accurately explain the critical change, test, and
  trade-off at the ownership checkpoint;
- at least 60% confidently perform a small adjacent change 24-72 hours later;
- at least half voluntarily begin a second issue or feature cycle;
- zero source, terminal, or profile transfers without the configured consent;
- model usage remains within the visible session budget.

These are experiment gates, not public product guarantees.

## 18. Principal Risks

### Incumbent copying

Copilot, Cursor, and other IDE agents can add mentoring features. Mitigation is
to establish a model-independent open standard for pair policy, evidence packs,
and user-owned memory rather than relying on a proprietary UI feature.

### Intervention fatigue

False positives can destroy trust. The product must treat silence, cooldown,
questions, and confidence as primary capabilities.

### Dogmatic architecture advice

Generic clean-code rules can produce harmful overengineering. Repository
context, cost, and the smallest useful improvement outrank pattern purity.

### Privacy and inferred weakness

Capability data is sensitive. It remains user-controlled, is excluded from
employer ranking, and is never committed to a product repository by default.

### Platform limitations

VS Code does not expose perfect edit provenance or arbitrary inline UI.
Session-level provenance and official Comments, CodeLens, Inlay Hint, Hover,
Code Action, and terminal-link APIs define the supported experience.

### External harness conflicts

External tools may edit files, change branches, or run commands without using
the interop protocol. The safe fallback is observe-only behavior, versioned
write preconditions, command deduplication, and `Conflict Paused`, with
worktrees preferred for autonomous work.

### Token and latency growth

An always-present pair cannot mean an always-running remote model. Local
incremental analysis, event coalescing, model routing, cancellation, caching,
and explicit budgets are product requirements rather than later optimization.

## 19. Decision Summary

Proceed with an open-source, VS Code-first Adaptive AI Pair Harness.

The first implementation should prove one loop:

> Observe a stable semantic edit locally, understand the user's current intent,
> retrieve repository and tool evidence, start a timely inline conversation,
> negotiate a bounded complementary action, verify the result, confirm human
> ownership, and carry approved learning into the next development cycle.

If this loop cannot feel like a trusted senior developer pairing beside the
user without excessive false positives, tokens, or surveillance, broader
language support and autonomous features should not be pursued.
