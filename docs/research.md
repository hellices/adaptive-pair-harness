# Pair Programming: Evidence and Design Rationale

**Review date:** September 14, 2026. Initial design brief complete; product proposals await review.

This bounded review informs the [v2 design](design.md). It distinguishes experiments,
observational studies, practitioner experience, and product hypotheses. It is not
a systematic review, an exhaustive survey of recent work, or proof of a universal
best style. Human–human results do not transfer automatically to human–AI pairing.

## Patterns and tradeoffs

| Pattern | Roles and rhythm | Fit and limits | Evidence type |
|---|---|---|---|
| Driver/Navigator | One participant implements the current goal; the other helps check direction, errors, and next steps. Roles change. | General development and exploration. Avoid reducing navigation to after-the-fact review or micromanagement. | Practitioner guidance [8]; observed role switching [3]. |
| Strong-Style | Ideas are implemented through the other participant's hands; guidance is adjusted to that person. | A knowledge-transfer option, with risks of excessive direction and fatigue. Not proven universally best for novices. | Originator's account [7]; practitioner guidance [8]. |
| Ping-Pong TDD | A writes a failing test; B implements; both refactor; B writes the next test. | Requires a suitable task and reliable tests. Alternation does not guarantee equal time or learning. | Practitioner guidance [8]. |
| Mob | Several people work together on the same task. | Team experience, not direct evidence for one-human/one-AI pairing. Do not treat Mob and Swarming as interchangeable. | Team experience report [9]. |

Expert–Expert describes participants, not a distinct turn-taking rule. Unstructured,
Backseat Navigator, and Tour Guide remain outside the initial library: this review
did not establish sufficiently clear independent definitions and comparative evidence.

## Evidence and limitations

- **Quality, duration, and effort — Hannay et al. (2009), meta-analysis [1].**
  Pair-versus-solo studies show tradeoffs between quality, elapsed time, and total
  effort, with task complexity, variation between studies, and publication bias
  affecting interpretation. This is not a comparison of the three named styles
  or evidence of their learning superiority.
- **Confidence, enjoyment, and persistence — McDowell et al. (2006), educational
  comparison [2].** Data from 554 introductory-course students show positive
  pairing results for confidence, enjoyment, program quality, and academic
  persistence. Individual final-exam means among course completers were not
  significantly different. Cohort and assignment differences limit inference;
  individuals were not randomly assigned. “Retention” means continued study,
  not demonstrated memory retention.
- **Participation and switching — Plonka et al. (2011), field observation [3].**
  Across 21 professional sessions, keyboard use was unequal, substantial
  interaction happened without typing, and handoffs varied. Typing share alone
  is not a defensible measure of participation or learning, nor does this study
  establish an optimal switching timer.
- **Observation and disengagement — Plonka et al. (2012), qualitative study [4].**
  Distinguish agreed temporary non-participation from harmful loss of understanding.
  Quiet observation is not automatically an antipattern; losing the thread still
  matters when learning is the goal.
- **Knowledge transfer — Plonka et al. (2015), interaction analysis [5].**
  Experts used different strategies, including direct guidance, questions, hints,
  and demonstrations. This motivates adjustable support but does not establish
  long-term superiority of a named style. Related observational corpora may
  overlap; do not count them as independent controlled replications.
- **Human–AI learning — Shen and Tamkin (2026), randomized experiment [6].**
  Fifty-two participants familiar with Python but new to Trio completed a short
  task. Immediate assessment means were approximately 50% with AI versus 67%
  without: a 17-percentage-point difference. Completion-time differences were
  not statistically significant. The unfamiliar library, short task, and chat
  interface limit generalization; this was not long-term follow-up. Differences
  between conceptual questioning and wholesale delegation came from observational
  subgroup analysis, not separately randomized usage patterns.

Within this search, we found no direct comparison establishing a universal
ranking of Driver/Navigator, Strong-Style, and Ping-Pong for satisfaction or
long-term growth. Confidence, assessment performance, speed, and keyboard share
are different outcomes. Absence from this review is not proof that no relevant
study exists.

## Product recommendation

The following order reflects product fit, not a research leaderboard:

1. **Default Driver/Navigator.** Use shared goals and negotiated handoffs across
   brainstorming, planning, and implementation. It covers the intended workflow
   with few additional constraints—not because it has proven superior outcomes.
2. **Optional Guided Pairing.** Adapt Strong-Style ideas for either participant
   to guide. Combine brief demonstrations, attempts, and reflection, with support
   reduced when appropriate. Label this an AI adaptation, not the original method.
3. **Conditional Ping-Pong TDD.** Offer an explicit rhythm when tests fit the task.
   Do not let the AI complete both sides and hand over only the finished result.

Use one shared session/editing core. Defer Mob beyond the initial one-human/one-AI
scope and express more flexible expert collaboration through guidance settings.

## Adapting the evidence to AI

Preserve shared goals, questions, explanations, mutual checking, and meaningful
handoffs. AI-assisted programming is not identical to human pairing [10].

Allow real AI edits within an agreed work unit, potentially across files. Keep
human questions, pauses, and takeovers available; a suggestion does not itself
grant edit authority. These are product interaction and safety proposals.

Do not enforce novice-to-mode assignments, blind trust, 50:50 typing, or mandatory
quizzes. Use occasional, consensual explanation or variation checks instead
[3–8]. Evaluate naturalness, fatigue, initiative, independent understanding,
output quality, and time separately. Long-term learning, profile accuracy, and
the effectiveness of these modes remain to be tested.

## Source history and review boundary

The earlier collection log contained **33 attempts: 20 explicit failures and
13 other responses**. Some responses were loading pages, placeholders, or search
snippets—not full papers. Follow-up primary-source checking produced this brief;
the earlier collection must not be presented as a completed literature review.

The full audit and original Korean notes remain in the
[initial v2 planning checkpoint](https://github.com/hellices/adaptive-pair-harness/tree/23959c5ef152cb6ad2e49471c33deb0316c7e558/docs).
Their usable findings and limitations are consolidated here rather than maintained
as a separate handoff document. This English synthesis preserves the distinction
between source findings and product proposals; it is not a verbatim transcript.

## References

Dates refer to the papers or original pages, not search crawl dates. Items [7–9]
are practitioner accounts, not controlled effectiveness studies.

1. Hannay, Dybå, Arisholm, and Sjøberg (2009). *The effectiveness of pair programming: A meta-analysis.* Information and Software Technology 51, 1110–1122. [Paper](https://www.ic.unicamp.br/~wainer/outros/systrev/30.pdf).
2. McDowell, Werner, Bullock, and Fernald (2006). *Pair programming improves student retention, confidence, and program quality.* Communications of the ACM 49(8), 90–95. [Full text](https://www.researchgate.net/publication/220422564_Pair_programming_improves_student_retention_confidence_and_program_quality).
3. Plonka, Segal, Sharp, and van der Linden (2011). *Collaboration in Pair Programming: Driving and Switching.* XP 2011, 43–59. [Institutional copy](https://oro.open.ac.uk/28909/1/XP2011PlonkaSegalSharpVanderLinden.pdf).
4. Plonka, Sharp, and van der Linden (2012). *Disengagement in pair programming: Does it matter?* ICSE 2012. [Full text](https://www.researchgate.net/publication/254041569_Disengagement_in_pair_programming_Does_it_matter).
5. Plonka, Sharp, van der Linden, and Dittrich (2015). *Knowledge transfer in pair programming: An in-depth analysis.* International Journal of Human-Computer Studies 73, 66–78. [Manuscript](https://oro.open.ac.uk/41032/8861/41032ORO.pdf); [publication record](https://pure.itu.dk/en/publications/knowledge-transfer-in-pair-programming-an-in-depth-analysis/).
6. Shen and Tamkin (2026). *How AI Impacts Skill Formation.* arXiv:2601.20245v1, submitted January 28, 2026. [Paper](https://arxiv.org/html/2601.20245v1); [researchers' account](https://www.anthropic.com/research/AI-assistance-coding-skills).
7. Falco (2014). *Llewellyn's strong-style pairing.* [Originator's account](https://llewellynfalco.blogspot.com/2014/06/llewellyns-strong-style-pairing.html).
8. Böckeler and Siessegger (January 15, 2020). *On Pair Programming.* [Practitioner guide](https://martinfowler.com/articles/on-pair-programming.html). Hosted by Martin Fowler, not authored by him.
9. Zuill (2014). *Mob Programming — A Whole Team Approach.* Agile 2014 experience report. [Original](https://www.agilealliance.org/resources/experience-reports/mob-programming-agile2014/).
10. Sarkar et al. (2022). *What is it like to program with artificial intelligence?* [Paper](https://www.microsoft.com/en-us/research/uploads/prod/2022/08/sarkar_2022_programming_AI.pdf). Conceptual and experience analysis, not a controlled three-style comparison.
