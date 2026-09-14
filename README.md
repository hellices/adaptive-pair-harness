# Adaptive AI Pair Harness

Build with AI while staying an active developer.

Adaptive Pair is an open-source, VS Code-first project for real-time human–AI
pair programming. The goal is to help people ship real work while understanding,
shaping, and owning the important code—not simply reviewing a finished AI output.

## The proposed experience

Start with a shared goal, choose how to work together, and take turns on meaningful
steps. Both the developer and the AI can edit files. A step may span multiple
files, and the developer can ask questions, pause, or take over at any point.

The current design proposes three pairing patterns on one shared session core:

- **Driver/Navigator:** the default, with conversational, negotiated handoffs.
- **Guided Pairing:** optional, adjustable guidance inspired by Strong-Style
  pairing, with either the human or the AI leading.
- **Ping-Pong TDD:** optional test-driven turn-taking when the task and test
  environment support it.

Personal preferences and familiarity belong to the individual account. Project
conventions and domain knowledge remain with the repository's existing tools,
skills, and knowledge systems.

## Project status

This branch contains the **v2 design and research checkpoint**, not a runnable
v2 application or demo. The initial evidence review is complete; the proposed
pattern set, handoff experience, integration approach, and storage policy still
need design review. Implementation has not started on this branch.

VS Code Coding Agent picker integration is a desired entry point, not a verified
platform capability. An earlier implementation remains on
`feature/realtime-pair-vertical-slice`; it is not the proposed v2 implementation.

## Documentation

- [Product and system design](docs/design.md): requirements, proposed behavior,
  architecture, safety boundaries, and open decisions.
- [Research and design rationale](docs/research.md): evidence, limitations,
  pattern selection, and primary sources.
- [Historical v1 design](docs/archive/v1-design.md) and
  [implementation plan](docs/archive/v1-implementation-plan.md): background only,
  not current v2 requirements or an execution plan.

All repository documentation is maintained in English for an international
audience, including the planned global hackathon submission. Session notes are
integrated into the relevant document rather than published as a separate
documentation track.

## License

Licensed under the [Apache License 2.0](LICENSE).
