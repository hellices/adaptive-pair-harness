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

The open-source Pair Runtime is the source of truth. A VSIX provides the
runtime, tools, local sensors, inline UI, and an `@pair` fallback. A coordinated
Agent Plugin provides the native VS Code Agent-picker experience.

Native model selection, streaming, confirmations, diffs, and session UX are
reused. Workspace read, edit, verification, terminal, web, and MCP tools are
wrapped or excluded whenever they could bypass the active mode, owner, scope,
consent, or recovery contract.

Native integration is capability-gated. When the host cannot enforce the
pairing invariants, Adaptive Pair uses its controlled surface or safely degrades
to Human Driver / AI Navigator instead of claiming unsupported AI edit control.

## VS Code entry

The `Copilot / Claude / Codex / Local` **Session Target** control chooses the
execution harness. Adaptive Pair does not replace that choice.

1. Enable **Pair Presence** for the workspace or select **Pair here** while
   already working.
2. Keep or choose the Session Target that should execute the agent.
3. Select **Adaptive Pair** under the separate Agent control when supported, or
   use `@pair` as the controlled fallback.
4. Select or restore Growth, Pair, or Delivery inside the Pair session.
5. Choose the model and native permission level independently.

This separation lets the same Pair state and learning contract work across
supported agents instead of binding the product to one harness.

Read the complete initial [product and system design](docs/design.md).
The first executable milestone is specified in the
[Foundation and Growth Mode implementation plan](docs/implementation-plan.md).

## Research

The [research and platform rationale](docs/research.md) covers:

- pair-programming evidence and its limits;
- human-AI programming productivity, skill, usability, and security studies;
- current VS Code Agent, custom-agent, tool, plugin, approval, and host APIs;
- the design decisions and evaluation hypotheses derived from that evidence.

The project does not claim that one pairing style is universally best, or that
AI universally improves speed, quality, learning, or satisfaction.

## Project status

This branch contains the first complete v2 design and its first implementation
plan. Every v2 decision is initial; implementation has not started.

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
