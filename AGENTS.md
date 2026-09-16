# Repository guidance

## Documentation

- Write all repository documentation in English for an international hackathon audience. Conversation with the user may follow their preferred language.
- Use `README.md` as the public entry point, `docs/design.md` for the current design and open decisions, and `docs/research.md` for evidence and rationale.
- Use `docs/implementation-plan.md` for the current reviewed implementation sequence; replace it deliberately when a later milestone receives its own plan rather than creating competing active plans.
- Use `docs/spikes/` only for time-boxed technical unknowns that need a prototype. Integrate the resulting decision into `docs/design.md` and keep the spike's measured evidence and status current.
- Use `docs/archive/` only for clearly labeled historical versions. Workflow defaults must not create tool-specific or recovery-specific documentation directories.
- Integrate useful session notes into the relevant design or research section instead of creating parallel handoff reports or duplicate drafts.
- Distinguish confirmed requirements, proposed design choices, verified evidence, and implemented behavior. Publishing a draft does not approve it or authorize implementation.
- Keep provenance traceable through Git history. Do not present an English synthesis as a verbatim copy of an earlier source, or copy local session logs, credentials, and machine-specific paths into public documentation.
- Preserve the historical v1 material as reference; do not execute its plan or carry its constraints into v2 without an explicit decision.

## Delivery workflow

- Start from the current `main` baseline and use a dedicated pull request branch. Do not push changes directly to `main` or disturb unrelated worktrees.
- Carry each authorized change through commit, push, pull request creation, and review rather than stopping at local implementation or validation.
- Verify review findings against the repository, make necessary fixes, and reply in each original review thread with the change and verification evidence or a reasoned explanation when no change is appropriate.
- Resolve a review thread only after its concern has been addressed. Recheck follow-up feedback and the final revision's required checks before reporting readiness.
- Notify the user when the pull request is ready to merge. Do not merge or enable auto-merge without explicit user direction.
- A documentation pull request does not itself authorize implementation of a draft design or the next milestone.

## Dependency and version maintenance

- Dependencies, tooling, package versions, protocol versions, and VS Code API versions are not frozen. Update them when needed for security, compatibility, or authorized work after checking current upstream stable releases and compatibility requirements.
- Inventory every active dependency graph, including isolated prototypes outside workspace globs, and audit each lockfile. Cross-check direct dependency metadata and upstream release records. An empty outdated report is not a complete inventory; document compatibility or availability reasons for retaining an older release.
- Keep manifests and lockfiles consistent, document material compatibility changes and migrations, and rerun the affected tests, host checks, and packaging checks. Do not dismiss an audit finding merely because it predates the current change.
- Version maintenance does not authorize unrelated product features or weaken package boundaries, permission contracts, additive integration, or inactive-zero behavior.

## Integration

- Adaptive Pair is additive and opt-in. Do not modify another extension, Session Target, participant, tool, session, setting, keybinding, default selection, or native VS Code UI behavior.
- Keep inactive behavior at zero: no document listeners, timers, workspace reads, model calls, or network activity before explicit Adaptive Pair enablement.
- Use native Chat, model, permission, isolation, diff, Source Control, Testing, Tasks, terminal, and diagnostics surfaces where they preserve Pair contracts.
- Treat product correctness and coexistence regressions as release blockers in every mode; learning outcomes are separate and never excuse an unverified product result.
