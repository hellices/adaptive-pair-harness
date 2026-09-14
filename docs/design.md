# Adaptive Pair v2: Product and System Design

- **Updated:** September 14, 2026
- **Status:** Working design, awaiting review; v2 implementation has not started.

This is the current design document. It combines the established product
requirements, the research-informed proposal, and the remaining decisions in
one place. The [research brief](research.md) separates empirical findings from
practitioner experience and product hypotheses.

The behavior and architecture below are proposals unless explicitly identified
as confirmed requirements. Publishing this checkpoint is not design approval.

## 1. Purpose

Help developers complete real work with AI while retaining understanding and
control. Pairing should extend from brainstorming and planning through
implementation, rather than starting only after the AI has produced a solution.

The intended experience is collaborative: both participants help shape the next
step, either can execute an agreed step, and the developer can change direction
without waiting for an entire task to finish.

## 2. Confirmed requirements

- **Real-time, bidirectional collaboration.** Human and AI work together during
  design, planning, and implementation. Upfront generation followed only by
  human review is not the target experience.
- **Both participants can edit.** Handoffs concern meaningful units of work,
  which may span multiple files. The v1 prohibition on project-file writes does
  not apply to v2.
- **Individualized support.** Adjust guidance and participation to the person
  and task. A short task briefing and subsequent observation can inform changes.
- **Individual account boundary.** Personal preferences and familiarity belong
  to the individual, not the shared repository.
- **External project knowledge.** Other skills, wikis, and harnesses own domain
  knowledge, conventions, and architecture information. Pair consumes that
  context rather than becoming its authoritative store.
- **Multiple pairing patterns.** Developers should be able to experience and
  learn different collaboration patterns, informed by evidence and practice.
- **A fresh v2 direction.** Continue in the same repository on the main-based
  `v2/adaptive-pair` branch while preserving the earlier implementation.

The VS Code Coding Agent picker is the desired product entry point. Supported
APIs and distribution constraints have not been verified. An alternative entry
point would require a separate design decision.

## 3. Recommended initial scope

**One human, one AI, one shared session core, three selectable patterns.**

| Approach | Benefit | Limitation | Recommendation |
|---|---|---|---|
| Shared core with three patterns | Supports different pairing experiences with consistent editing, handoff, and cancellation rules. | Requires pattern-specific guidance and transition design. | Recommended initial product scope. |
| Driver/Navigator only | Smallest way to validate natural bidirectional interaction. | Does not fulfill the multi-pattern experience requirement by itself. | Useful as a core-validation stage, not the complete proposed scope. |
| Automatically assign patterns from inferred ability | Could automate personalization later. | Risks restricting user choice before inference quality, consent, and effectiveness are validated. | Defer. |

This is a product-fit recommendation, not a research ranking. The reviewed
evidence does not establish a universally best pairing style.

### Driver/Navigator: default

Agree on the current small goal. One participant executes while the other helps
check direction, assumptions, and results. Conversational initiative is separate
from edit ownership: navigating does not require silence or delayed questions.

Propose handoffs when a goal is complete, someone is stuck, a short demonstration
would help, or the developer explicitly requests a turn. Do not enforce a fixed
timer or a target share of keystrokes. During brainstorming, participants can
alternate who leads the discussion without treating that as file-edit authority.

### Guided Pairing: optional

Adapt ideas from Strong-Style pairing rather than claiming to reproduce it
exactly. The AI can guide a developer who wants hands-on practice; the developer
can also explain an intended design while the AI edits. Neither participant is
permanently assigned the expert role by an ability tier.

Adjust hints, explanations, and demonstrations to the situation, then reduce
direction as understanding develops. A brief demonstration may lead to a human
attempt and reflection. Do not require blind trust in AI guidance, delayed
objections, or a quiz on every turn. Learning effectiveness remains a hypothesis
to test.

### Ping-Pong TDD: conditional opt-in

One participant writes a failing test; the other makes it pass. After joint
refactoring, the implementer writes the next failing test. The human should have
opportunities to take both roles rather than receiving a completed test-and-code
package from the AI.

Use this pattern when tests can run reliably and failures can be attributed to
the intended behavior. A broken test environment is not a successful handoff.
When TDD is unsuitable, return to Driver/Navigator while preserving the current
goal and changes.

### Outside the initial scope

- Multi-person Mob sessions.
- A separate engine for Expert–Expert collaboration; lower guidance can be a
  setting of the base interaction.
- Forced novice/expert-to-pattern mappings or automatic ability-based assignment.
- A separate repository knowledge platform or an autonomous task-to-PR product.

## 4. Shared interaction flow

1. **Brief the task.** Establish the goal, unfamiliar areas, time constraints,
   and what the developer wants to try personally. Avoid turning onboarding into
   a general ability test.
2. **Agree on the next work unit.** Share its purpose, edit scope, current owner,
   and verification method. A coherent unit may include several files.
3. **Work together.** When the AI owns the unit, it may make real edits within
   the agreed scope. Avoid both whole-task generation and per-keystroke approval
   bureaucracy. Renegotiate scope before expanding it.
4. **Observe and propose.** Prefer explicit requests and task context when
   suggesting guidance, next actions, or handoffs. Silence, vocabulary, one error,
   or commit counts alone must not determine ability or edit authority.
5. **Hand off or pause.** Share the changes, verification results, and remaining
   goal. An explicit human pause or takeover overrides an automatic suggestion.
6. **Close with a short reflection.** Identify what is understood, what remains,
   and where to resume. Let the developer review and correct any proposed
   personal-profile summary.

Observation can be an agreed, useful phase. Check whether someone has lost the
thread when that matters to the learning goal; do not treat every quiet interval
as failure or disengagement.

## 5. Editing and failure boundaries

These are proposed invariants, not implemented guarantees:

- Do not silently overwrite conflicting human edits. Pause AI application and
  reconcile the current state rather than locking the developer out of editing.
- Do not automatically apply a late AI result after a pause or takeover. Show
  what was already applied and what remains; do not automatically delete earlier
  accepted changes.
- Distinguish model completion, tool execution, and file application. A message
  saying an operation finished is not proof that the files changed.
- Do not automatically replay a state-changing operation whose completion is
  unknown after a connection failure.
- On resume, compare the last shared goal with the actual workspace state and
  reconfirm whether AI editing should continue.

The formal state machine, cancellation boundary, duplicate-event handling, and
conflict-detection mechanism still require design work.

## 6. Proposed component boundaries

| Component | Responsibility | Boundary |
|---|---|---|
| Session core | Shared goal, current unit, edit owner, pattern, handoff, pause, and resume state. | Independent of presentation and personal-storage providers. |
| Pattern policies | Pattern-specific guidance and proposed next actions or turn changes. | Cannot write files directly or override a human pause. |
| Host and editing adapter | Editor events, document versions, authorized edits, cancellation, and result presentation. | Must use capabilities actually supported by the host platform. |
| Personalization and profile boundary | Use declared preferences and limited observations to make recommendations. | Expose uncertainty and support inspection, correction, and deletion. Storage is undecided. |
| Project-context consumer | Read relevant context from existing skills, wikis, and harnesses. | Does not own project knowledge or mix personal ability data into the repository. |

## 7. Personal data and privacy

An account-scoped profile is a confirmed requirement; its backend is not.
Authentication, access control, encryption, synchronization, retention, and
deletion remain open decisions. Do not treat a secret Gist as an access-controlled
private profile store, or the earlier Gist suggestion as an approved choice.

Treat preferences and task- or language-specific familiarity as correctable
hypotheses, not a trained model that has measured the person's true ability.
GitHub commit and pull-request history is not approved default input. Any such
use needs a consent and minimization decision.

Proposed privacy limits:

- Keep raw code, paths, diagnostics, conversations, and secrets out of a remote
  personal profile.
- Keep the profile-storage policy separate from the policy governing task
  context sent to a model.
- Explain proposed profile updates and allow the developer to correct them.
- Consider session-only preferences for an initial interaction prototype, without
  dropping the eventual individual-account requirement.

## 8. Decisions changed by the evidence review

The [research brief](research.md#evidence-and-limitations) supplies the sources and
their limits. The following are design responses, not experimentally proven
product outcomes.

| Earlier assumption | Current proposal |
|---|---|
| Novices should always use AI-led Strong-Style; experts should always lead the AI. | Recommend from task goals and user choice, not fixed ability tiers. |
| Sharing the keyboard guarantees participation and learning. | Include questions, explanations, decisions, and debugging; do not use typing share as the sole proxy. |
| A silent observer is always an antipattern. | Allow agreed observation and thinking time; distinguish it from losing understanding. |
| Human Strong-Style rules transfer unchanged to AI. | Preserve immediate questions, objections, pauses, and takeovers. |
| An early profile-storage suggestion is already a design decision. | Keep the confirmed account boundary while evaluating storage and privacy separately. |

## 9. Validation goals

| Question | Proposed evaluation | Avoid |
|---|---|---|
| Does the developer retain initiative and want to continue? | Brief feedback on naturalness, fatigue, unwanted interventions, and handoffs. | Counting handoffs as satisfaction. |
| Does understanding develop or remain intact? | Consensual explanation, variation, or debugging tasks; later independent tasks when appropriate. | Treating typing share, confidence alone, or an AI-generated ability score as learning. |
| Is the work useful at an acceptable cost? | Evaluate output quality, verification results, elapsed time, and effort separately. | Calling speed alone an overall benefit. |
| Are editing and recovery controls trustworthy? | Test late results, conflicting edits, duplicate events, cancellation, and reconnection. | Equating a conversational success message with applied changes. |

These are future evaluation and implementation-test directions. They have not
been executed or passed. Long-term growth needs consented follow-up evaluation,
not just a post-session impression.

## 10. Open decisions and next steps

1. Review the proposed initial pattern set: default Driver/Navigator with optional
   Guided Pairing and Ping-Pong TDD.
2. Define the handoff experience: work-unit agreement, proposed switches,
   takeover, pause, and observation in conversation and the editor. Use visual
   comparisons when they help make a real design decision.
3. Verify the supported entry point, real-time events, edit/cancellation APIs,
   and distribution constraints. Review alternatives where the desired picker
   integration is not supported.
4. Specify session and editing state transitions, including late responses,
   conflicts, uncertain completion, and reconnects.
5. Decide profile storage, consent, access control, retention, correction, and
   deletion policies.
6. Review an implementation-ready specification for the first bounded scope,
   then write its implementation plan. Neither this draft nor the historical
   v1 plan authorizes starting implementation.

## 11. Development context and provenance

The v2 branch started from the minimal main revision
`52ccda3ffff77d30576d0f652a9e2bf0d0c79b3b`. The earlier implementation remains on
`feature/realtime-pair-vertical-slice`; starting v2 did not delete that code.

The [v1 design](archive/v1-design.md) and
[v1 implementation plan](archive/v1-implementation-plan.md) are historical
references. Their scope, constraints, and approval status do not transfer to v2.

The [initial v2 planning checkpoint](https://github.com/hellices/adaptive-pair-harness/tree/23959c5ef152cb6ad2e49471c33deb0316c7e558/docs)
preserves the original Korean drafts, collection audit, and session diagnostics.
This document is an English consolidation of the applicable requirements and
decisions, not a verbatim translation of every historical statement. Obsolete
claims are superseded explicitly rather than silently promoted into requirements.
