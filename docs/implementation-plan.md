# Event Validation Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` for this coupled
> protocol change and `superpowers:requesting-code-review` before delivery.
> Keep progress in this canonical plan and Git history, not parallel plans.

**Goal:** Validate the existing version-1 event format at a host-independent
boundary without implementing persistence, replay, or authority restoration.

**Architecture:** Add `parsePairEvent(unknown): PairEvent` beside the command
parser. Reuse bounded payload schemas and JSON safety/snapshot helpers, with
separate event schemas and explicit wire-to-memory normalization. The parser
does not call the runtime, a store, the host, or a model.

**Tech stack:** Existing TypeScript workspaces, Ajv, Vitest, ESLint, and the
existing build, packaging, and isolated-host checks. No new library is needed.

## Authorization and baseline

- The owner approved the proposed event-format/version validation increment
  and its tests by directing development to continue after PR #8.
- PR #8 is merged at `ad4b570d5526138f9afa6fa3e13dde624244b345`. Its completed
  runtime-boundary refactoring plan remains in that revision; this document
  deliberately replaces it as the single active implementation sequence.
- Refreshed `main` is clean at that revision. A forced workspace typecheck and
  all 37 existing protocol tests pass before this increment.
- Work on `feat/protocol-event-validation`, without disturbing unrelated
  worktrees or the preserved pre-rollback stash.
- This approval does not authorize durable storage, journal/reducer wiring,
  replay, recovery, ownership/handoff, P2/P3, new UI, or a protocol-major change.
- The previous merge direction applied to PR #8. Deliver this increment through
  review and notify the owner when it is ready; do not merge or enable auto-merge.

## Global constraints

- Preserve the 21 existing `PairEvent` variants and public command/event types.
- Accept only protocol version `1`; reject unknown variants, unexpected fields,
  missing required fields, and invalid nested values without coercion or defaults.
- Revision and authority-epoch counters are nonnegative safe integers. Clock
  timestamps remain finite numbers, including fractional timestamps.
- Accept JSON-compatible plain data, not JSON text, accessors, exotic objects,
  hidden/symbol properties, sparse arrays, cycles, or non-finite numbers.
- Capture own descriptors into a detached null-prototype validation view before
  Ajv reads data. Validate and copy that same view; never re-read caller values.
- Bound event values to depth 64 (root zero) and 10,000 expanded nodes, counting
  repeated references per occurrence. Do not impose these limits on commands.
- Proxy reflection traps are not sandboxed; only the captured descriptors are
  data. External integrations should deserialize JSON before invoking the parser.
- The wire representation omits undefined-valued fields. Reject explicit
  `undefined` and `null` in those positions, rather than silently stripping them.
- Only the existing required-but-possibly-undefined memory fields are restored
  as own `undefined` properties after validation: `UserActionGranted.authorityEpoch`
  and `OperationAuthorized.operation.summary` / `userActionGrantId`. This restores
  a data shape, not live grants, epoch authority, or runtime state.
- Return a detached, deeply frozen event; accepted dictionaries remain open
  only where existing types explicitly declare a record (`baseline`, operation
  `input`, and optional `observation`).
- Preserve command parser behavior, including the `Invalid Pair command:`
  error prefix. Event failures use `Invalid Pair event:`.
- Keep production/config/release code below 400 effective lines per file and
  100 per function; tests/fixtures stay below 600/200. Do not suppress lint rules.
- Preserve package boundaries, additive opt-in behavior, and inactive-zero.
  Do not introduce listeners, timers, workspace reads, model/network calls,
  host SDK imports, frameworks, or implicit enablement.
- Inventory and audit both active dependency graphs and both lockfiles; compare
  direct dependencies with registry metadata and upstream stable release records.
- Write repository documentation and GitHub review replies in English.

## Task 1: Event format and shared schemas

**Files:**
- Add `packages/protocol/src/eventSchemas.ts` for the closed event-schema map.
- Add `packages/protocol/src/parseEvent.ts` for validation and shape normalization.
- Add `packages/protocol/src/payloadSchemas.ts` for existing shared payload schemas.
- Add `packages/protocol/src/jsonValidation.ts` for descriptor capture and budgets.
- Update `packages/protocol/src/schemas.ts`, `jsonSnapshot.ts`, and `index.ts`.
- Add `packages/protocol/test/eventFixtures.ts`, `events.test.ts`, and
  `eventPayloadValidation.test.ts`.

**Interface:**

```ts
export const parsePairEvent: (value: unknown) => PairEvent;
```

- [x] Write exhaustive typed fixtures for the 21 variants, then assert that each
  serialized event parses back to the existing in-memory shape:

  ```ts
  it.each(Object.values(createEventFixtures()))("parses $type", (event) => {
    const wire = toWireEvent(event);
    expect(parsePairEvent(wire)).toStrictEqual(event);
  });
  ```

- [x] Add rejection cases for every envelope/required payload field, unknown
  versions and types, enum values, nested required/unknown fields, invalid
  counters, and invalid record values. Prove the tests fail because the parser
  does not exist before implementation:

  ```sh
  npx vitest run packages/protocol/test/events.test.ts packages/protocol/test/eventPayloadValidation.test.ts
  ```

- [x] Move the existing reusable payload schemas without changing their command
  semantics. Add a closed, exhaustively keyed event-schema map compiled by Ajv
  with `allErrors: true`, `strict: true`, and `ownProperties: true`; leave data coercion/default insertion
  disabled. Validate wire omissions explicitly before normalizing memory fields.
- [x] Test optional metadata both present and omitted, reject explicit undefined
  and null, and retain every accepted value without mutating the caller.
- [x] Run the focused protocol tests and forced workspace typecheck to GREEN.

## Task 2: Safe immutable event boundary

**Files:** `packages/protocol/src/jsonValidation.ts`, `jsonSnapshot.ts`,
`parseEvent.ts`, `schemas.ts`, and the new `packages/protocol/test/eventJsonSafety.test.ts`,
`prototypeBoundary.test.ts`, and `eventTraversalLimits.test.ts`.

**Interface:** `jsonValidationSnapshot(value, kind, limits?)` captures safe own
data with the selected error context and optional event-only depth/node budgets.
Both parsers validate the resulting detached view. Normalize only validated
event data, then use `immutableJsonSnapshot` to produce a plain, frozen result.

- [x] Write and run tests proving JSON hazards are rejected before getters or
  conversion hooks execute, including hazards inside open record payloads:

  ```ts
  const observation = { result: Number.NaN };
  expect(() => parsePairEvent({ ...wireEvent, observation }))
    .toThrow(/^Invalid Pair event:/);
  ```

- [x] Cover shared references, caller mutation, nested freezing, unusual array
  prototypes, and safe dictionary keys. Verify the parsed snapshot contains
  exactly the accepted data and does not preserve caller-owned identities.
- [x] Run command-parser regressions alongside event tests to keep existing
  rejection behavior and diagnostics intact.
- [x] Reproduce review findings for inherited properties, Proxy/accessor reads
  after validation, deep JSON, and exponential shared-reference expansion.
  Run `npx vitest run packages/protocol/test/prototypeBoundary.test.ts packages/protocol/test/eventTraversalLimits.test.ts`:
  15 failing cases and one passing command-depth control become 16 passing cases
  after descriptor capture and event-specific budgets replace the two-pass boundary.

## Task 3: Verification and reviewed delivery

**Files:** `README.md`, `docs/design.md`, this plan, and the implementation/test
files listed above. Do not add parallel status or recovery documents.

- [x] Update the public plan link and protocol/persistence sections to distinguish
  the implemented validation boundary from still-unimplemented durable recovery.
- [x] Inventory both dependency graphs, audit both lockfiles including development
  dependencies, and record compatibility/availability reasons for retained versions.
  Update the obtainable `@types/node` 24.13.4 patch in both graphs with matching
  manifests and lockfiles; retain the reviewed major/host floors and unavailable
  upstream patches for the explicit reasons recorded in `docs/research.md`.
- [x] Run affected checks using Node.js 24, building workspace exports before
  extension tests because they consume compiled package exports:

  ```sh
  npm run typecheck -- --force
  npm run lint
  npm test
  npm run build
  npm run package
  node scripts/verify-vsix.mjs
  npm --prefix poc/session-target run check
  npm --prefix poc/session-target run package
  npm audit --audit-level=low
  npm --prefix poc/session-target audit --audit-level=low
  ```

- [x] Run isolated Stable hosts `1.136.2` and `1.137.0`, plus the separate POC host:

  ```sh
  env -u VSCODE_EXECUTABLE_PATH ADAPTIVE_PAIR_HOST_VERSION=1.136.2 npm run test:host
  env -u VSCODE_EXECUTABLE_PATH ADAPTIVE_PAIR_HOST_VERSION=1.137.0 npm run test:host
  env -u VSCODE_EXECUTABLE_PATH npm --prefix poc/session-target run test:host
  ```

Implementation and local verification are complete. PR #9 tracks live review
and final-head CI status; the owner's merge decision remains outstanding.
The following delivery gates must hold for its current revision rather than
being inferred from a checkbox or an older successful CI run:

- Obtain an independent specification/code-quality review, commit and push
  the increment, create its PR against `main`, and request repository review.
- Check each finding against the code, fix and test real issues, reply in
  every original thread with evidence, and resolve only addressed concerns.
- Recheck follow-up reviews and every final-head CI step, including actual
  Insiders results despite that job's allowed-failure setting. Report readiness
  without merging, enabling auto-merge, or starting another milestone.
