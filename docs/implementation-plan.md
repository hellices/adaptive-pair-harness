# Pair Mode P1: Policy Contracts Implementation Plan

> **For agentic workers:** After written-plan approval, use
> `superpowers:executing-plans` to implement this plan task by task. Use
> `superpowers:subagent-driven-development` only if delegation is explicitly
> selected. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build tested, side-effect-free Pair work-unit, human-follow-up, and
handoff-preflight policies in `@adaptive-pair/modes`, without enabling Pair in
the Stable extension.

**Architecture:** The existing protocol supplies immutable input types; the
modes package assesses those inputs and returns data. The session core remains
the only future authority owner. Runtime integration, durable transitions, and
host edits belong to subsequent increments, not hidden wiring in this plan.

**Tech Stack:** Node.js 24, TypeScript 6.0.3, npm workspaces, Vitest 5.0.0,
Fast-Check 4.9.0, ESLint 10.10.0, and the existing version-1 Pair protocol.
No dependency, protocol-version, package-version, or VS Code API change.

## Global Constraints

- Status: **P1 execution authorized; pure policies implemented and locally
  verified; pull request review remains open**.
- This plan is M2/P1 in the
  [sequential delivery roadmap](design.md#sequential-delivery-roadmap).
- The P1 policy choices are recorded in
  [the Pair design](design.md#p1-policy-contracts-before-authority-changes).
  The owner authorized this increment on September 16, 2026 after PR #4 review;
  writing or merging a plan alone does not authorize its implementation.
- P1 produces a useful open-core policy contract, not a usable Pair preview.
- Start from the reviewed `main` baseline and use a dedicated pull request
  branch. Keep unrelated worktrees untouched and do not push directly to `main`.
- Carry the authorized increment through commit, push, PR review, verified
  fixes, thread replies, and resolution of addressed feedback. Notify the user
  when ready to merge; do not merge or enable auto-merge implicitly.
- No package under `packages/` may import `vscode` or a model-vendor SDK.
- Add no runtime dependency and no production import of a test fixture.
- Pair policies perform no I/O, timers, listeners, model calls, or network work.
- Do not modify another extension, target, participant, tool, setting,
  keybinding, default, or native VS Code UI behavior.
- Inactive Adaptive Pair retains zero document listeners, timers, workspace
  reads, model calls, or network activity.
- Growth retains human-only editing and its existing hint/reveal semantics.
- A policy assessment is not permission, a user-action grant, an accepted
  handoff, a new authority epoch, or proof of a completed edit.
- Host capability and observation inputs are trusted facts supplied by the
  future core/adapter, never model-authored public tool parameters.
- Keep completed product verification separate from Growth demonstrations.
  P1 does not populate any Growth or evaluation outcome.
- Use red-green-refactor for each policy task. Keep every task reviewable and
  stop after its checks if a contract or scope question remains unresolved.
- Preserve the existing preview manifest, storage formats, protocol schema,
  core behavior, runtime behavior, and public tool contributions.
- Do not copy this plan to another active-plan directory. The completed
  Foundation plan is retained in Git at
  `ae1f095:docs/implementation-plan.md`; historical v1 material stays untouched.

## Baseline and Scope Boundary

The runtime baseline is `ae1f095`, the merged Foundation and Growth preview.
P1 execution starts from `f28de5f`, the merge of reviewed documentation PR #4;
application source is unchanged between those baselines.
The existing `WorkUnit` already contains mode, owner, capability, scope,
verification plan, baseline, and status. `PairRuntimeSnapshot` already contains
revision, authority epoch, and operations. At the execution baseline, the modes
package exported only Growth policy. Handoff remains hidden and the Stable edit
effect remains unimplemented after P1.
See [implementation evidence](research.md#implementation-evidence-for-the-next-pair-increment).

P1 deliberately does **not** add:

- Pair commands/events or new persisted snapshot fields;
- an ownership/history ledger, completion command, or accepted handoff;
- migration of the current protocol or journal;
- admission barriers, cancellation, baseline refresh, or reconciliation effects;
- guarded edits, a Pair participant route, a mode selector, or new public tools;
- Delivery, cross-mode switching, Growth transfer completion, or evaluation UI.

P2 must bind these policies to durable state and prove their use at every
authority-changing boundary. It must also define explicit resolution of
unknown state-changing operations, correlation of human confirmation with
revision/epoch, and the whole capability-ownership history. P3 proves and
implements the host edit boundary and full Stable Pair flow. Neither follows
automatically from P1 passing.

The baseline core's `SelectMode` guard requires an agreement only for Growth;
that is not a complete Pair entry policy. P2 must enforce the proposed
required-agreement contract before admitting Pair work or handoff. An optional
`PairSessionSnapshot.learningAgreement` represents incomplete state; it does
not authorize substituting an empty agreement. This plan changes neither the
current guard nor the snapshot representation.

## Interface Map

All interfaces below are **implemented P1 exports** in `@adaptive-pair/modes`.
They have no runtime or host integration.

| File | Responsibility | Public interface |
|---|---|---|
| `packages/modes/src/pairWorkUnit.ts` | Assess a proposed Pair unit and its declared owner | `PairEditCapability`, `PairWorkUnitPolicyContext`, `PairWorkUnitRejection`, `PairWorkUnitAssessment`, `assessPairWorkUnit(workUnit, context)` |
| `packages/modes/src/pairFollowUp.ts` | Describe and assess a related human follow-up without storing or clearing it | `PairHumanFollowUp`, `PairSuccessorAssessment`, `PairObservedVerification`, `humanFollowUpFor(workUnit)`, `assessPairSuccessor(workUnit, requirement, relatedToWorkUnitId)`, `isPairHumanFollowUpSatisfied(workUnit, requirement, relatedToWorkUnitId, verification)` |
| `packages/modes/src/pairHandoff.ts` | Assess readiness for baseline/human review, not acceptance | `PairHandoffProposal`, `PairHandoffContext`, `PairHandoffAssessment`, `assessPairHandoff(context)` |
| `packages/modes/src/index.ts` | Export these contracts alongside the unchanged Growth policy | Existing Growth export plus the three new modules |
| `packages/modes/test/pairFixtures.ts` | Typed test-only facts built from existing protocol types | `pairWorkUnit`, `pairAgreement`, `pairPolicyContext`, then `pairRuntime`, `pairOperation`, and `pairHandoffContext` in Task 3 |
| `packages/modes/test/pairWorkUnit.test.ts` | Admission examples, reserved capabilities, and non-mutation | Task 1 selector |
| `packages/modes/test/pairFollowUp.test.ts` | Relatedness, distinct identity, observed completion, and no mechanical bypass | Task 2 selector |
| `packages/modes/test/pairHandoff.test.ts` | Identity, revision, quiescence, pending/unknown operations, and no authority changes | Task 3 selector |

### Facts, assessments, and authority

`verified` edit capability means a future adapter has passed its capability
gate for the relevant workspace and revision. P1 does not discover, cache,
persist, or advertise that capability. Tests may construct it as a fixture.
It is neither consent nor permission to apply an edit.

`PairHumanFollowUp` is a pure projection, not a second session state
machine. A future core derives it from accepted AI work and persists its
outstanding status. A helper result must never create an obligation from a
mere model proposal or clear an existing obligation because a later mechanical
unit returns `undefined`.

Lifecycle status alone is not evidence of acceptance. A cancelled or failed
unit is a valid `humanFollowUpFor` input only when the core has established
that the same unit was previously accepted. Raw proposed/decoded units must
not enter this projection solely because their status changed. P2 must test
that entry precondition and preserve the existing outstanding requirement;
P1 neither validates a journal nor manufactures acceptance evidence.

`passed` verification is a future host/core observation correlated with the
completed human work unit and all its agreed checks. It can represent the
agreed executable check or an explicitly agreed, non-executable review method;
P2 must define the trusted source and correlation in either case. A chat
message, model assertion, or check from another unit cannot supply it.
Satisfying Pair participation does not prove learning. The runtime binding of
these facts is a mandatory P2 gate.

`ready-for-baseline-review` is intentionally weaker than handoff acceptance.
P2 still needs the human action, refreshed scope/baseline, transactional
revalidation, authority-epoch change, and durable owner transition. Human
typing and emergency pause are never blocked by this helper.

## Execution Preparation

**Baseline prerequisite R0 — verified:** the unchanged baseline passed all 17
isolated host smoke tests on VS Code 1.137.0 on 2026-09-16, with runner exit
code 0. Non-host and package checks also passed. Read the
[evidence checkpoint](research.md#implementation-evidence-for-the-next-pair-increment)
for the complete rerun and earlier incomplete attempts. No source fix is
claimed. This checkpoint clears R0, but does not replace fresh baseline checks
at execution time or authorize implementation.

Confirm written approval for **P1**, not the whole remaining roadmap. Check
`git status --short --branch` before changing anything and preserve unrelated
work. Use the repository's existing Node.js 24 toolchain; if only another Node
major is installed, use a process-local Node 24 environment rather than
changing global settings.

Run the baseline:

```sh
node --version
npm ci
npm run check
npm run test:host
```

Expected: Node 24 and successful typecheck, lint, the existing test suite, and
a complete isolated-host smoke run.
Record the observed count; do not replace evidence with a hard-coded count.
An unrelated failure is a reported baseline issue, not permission to broaden
this plan. The paths in the following code labels are part of the executable
examples: `Create` writes a new file and `Append` adds to the named existing
file without replacing its earlier contents.

---

### Task 1: Pair Work-Unit Admission

**Deliverable:** a pure admission assessment that respects the declared human
practice boundary and refuses unsupported AI ownership. This does not grant a
work unit or change the existing core's behavior.

**Files:**
- Create: `packages/modes/src/pairWorkUnit.ts`
- Create: `packages/modes/test/pairFixtures.ts`
- Create: `packages/modes/test/pairWorkUnit.test.ts`
- Modify: `packages/modes/src/index.ts`

**Interfaces:** consumes the existing `WorkUnit` and `LearningAgreement`.
Produces the exact exported types and `assessPairWorkUnit` implementation in
Step 3. Callers must still perform scope resolution, input-schema validation,
consent checks, and invocation-time authorization in P2/P3.

- [x] **Step 1: Write the typed fixtures and failing tests.**

**Create: `packages/modes/test/pairFixtures.ts`**

```typescript
import type { LearningAgreement, WorkUnit } from "@adaptive-pair/protocol";
import type { PairWorkUnitPolicyContext } from "../src/pairWorkUnit.js";

export const pairWorkUnit = (overrides: Partial<WorkUnit> = {}): WorkUnit => ({
  id: "unit-pair-1",
  objective: "Implement a bounded retry transition",
  mode: "pair",
  learningValue: "high",
  capability: "implementation",
  owner: "human",
  allowedPaths: ["src/retry.ts"],
  acceptanceChecks: ["The retry transition test passes"],
  verificationPlan: "npm test",
  stoppingCondition: "One transition is verified",
  baseline: {},
  status: "proposed",
  ...overrides,
});

export const pairAgreement = (
  overrides: Partial<LearningAgreement> = {},
): LearningAgreement => ({
  learningGoals: ["Implement and diagnose retry behavior"],
  familiarAreas: [],
  humanOwnedCapabilities: ["diagnosis"],
  delegatableWork: ["Mechanical test setup"],
  maximumHintLevel: 4,
  independentCheck: "Implement a distinct timeout transition",
  ...overrides,
});

export const pairPolicyContext = (
  overrides: Partial<PairWorkUnitPolicyContext> = {},
): PairWorkUnitPolicyContext => ({
  learningAgreement: pairAgreement(),
  editCapability: "unavailable",
  ...overrides,
});
```

**Create: `packages/modes/test/pairWorkUnit.test.ts`**

```typescript
import type { WorkUnit } from "@adaptive-pair/protocol";
import { describe, expect, it } from "vitest";
import { assessPairWorkUnit } from "../src/index.js";
import { pairPolicyContext, pairWorkUnit } from "./pairFixtures.js";

describe("Pair work-unit policy", () => {
  it("admits a human owner without an AI edit capability", () => {
    expect(assessPairWorkUnit(pairWorkUnit(), pairPolicyContext())).toEqual({
      admissible: true,
      navigator: "ai",
      requiresHumanFollowUp: false,
    });
  });

  it("refuses AI ownership when bounded edits are unavailable", () => {
    expect(assessPairWorkUnit(
      pairWorkUnit({ owner: "ai" }),
      pairPolicyContext(),
    )).toEqual({ admissible: false, reason: "PAIR_EDIT_CAPABILITY_REQUIRED" });
  });

  it.each(["high", "mixed"] as const)("describes the human unit after %s-value AI work", learningValue => {
    expect(assessPairWorkUnit(
      pairWorkUnit({ owner: "ai", learningValue }),
      pairPolicyContext({ editCapability: "verified" }),
    )).toEqual({
      admissible: true,
      navigator: "human",
      requiresHumanFollowUp: true,
    });
  });

  it("does not classify mechanical AI work as a new learning obligation", () => {
    expect(assessPairWorkUnit(
      pairWorkUnit({ owner: "ai", learningValue: "low" }),
      pairPolicyContext({ editCapability: "verified" }),
    )).toEqual({
      admissible: true,
      navigator: "human",
      requiresHumanFollowUp: false,
    });
  });

  it("does not let capability support override human-reserved practice", () => {
    expect(assessPairWorkUnit(
      pairWorkUnit({ owner: "ai", capability: "diagnosis" }),
      pairPolicyContext({ editCapability: "verified" }),
    )).toEqual({ admissible: false, reason: "PAIR_HUMAN_CAPABILITY_RESERVED" });
  });

  const invalidUnits: readonly [Partial<WorkUnit>, string][] = [
    [{ mode: "growth" }, "PAIR_MODE_REQUIRED"],
    [{ mode: "delivery" }, "PAIR_MODE_REQUIRED"],
    [{ status: "agreed" }, "PAIR_PROPOSAL_REQUIRED"],
    [{ id: "" }, "PAIR_WORK_UNIT_ID_REQUIRED"],
    [{ id: " " }, "PAIR_WORK_UNIT_ID_REQUIRED"],
    [{ objective: " " }, "PAIR_OBJECTIVE_REQUIRED"],
    [{ allowedPaths: [] }, "PAIR_SCOPE_REQUIRED"],
    [{ allowedPaths: [" "] }, "PAIR_SCOPE_REQUIRED"],
    [{ acceptanceChecks: [] }, "PAIR_ACCEPTANCE_REQUIRED"],
    [{ acceptanceChecks: [" "] }, "PAIR_ACCEPTANCE_REQUIRED"],
    [{ verificationPlan: " " }, "PAIR_VERIFICATION_REQUIRED"],
    [{ stoppingCondition: " " }, "PAIR_STOPPING_CONDITION_REQUIRED"],
  ];

  it.each(invalidUnits)("rejects an incomplete or non-Pair proposal %j", (override, reason) => {
    expect(assessPairWorkUnit(pairWorkUnit(override), pairPolicyContext()))
      .toEqual({ admissible: false, reason });
  });

  it("does not change the unit, agreement, or capability facts", () => {
    const workUnit = pairWorkUnit();
    const context = pairPolicyContext();
    const before = JSON.stringify({ workUnit, context });
    Object.freeze(workUnit.allowedPaths);
    Object.freeze(workUnit.acceptanceChecks);
    Object.freeze(workUnit);
    Object.freeze(context.learningAgreement.humanOwnedCapabilities);
    Object.freeze(context.learningAgreement);
    Object.freeze(context);
    assessPairWorkUnit(workUnit, context);
    expect(JSON.stringify({ workUnit, context })).toBe(before);
  });
});
```

- [x] **Step 2: Run the focused red test.**

```sh
npm exec -- vitest run packages/modes/test/pairWorkUnit.test.ts
```

Expected: failure because `assessPairWorkUnit` is not exported/implemented.
Do not weaken the tests or alter Growth behavior to obtain a green result.

- [x] **Step 3: Implement the complete pure assessment and export it.**

**Create: `packages/modes/src/pairWorkUnit.ts`**

```typescript
import type { LearningAgreement, WorkUnit } from "@adaptive-pair/protocol";

export type PairEditCapability = "unavailable" | "verified";

export interface PairWorkUnitPolicyContext {
  readonly learningAgreement: LearningAgreement;
  readonly editCapability: PairEditCapability;
}

export type PairWorkUnitRejection =
  | "PAIR_MODE_REQUIRED"
  | "PAIR_PROPOSAL_REQUIRED"
  | "PAIR_WORK_UNIT_ID_REQUIRED"
  | "PAIR_OBJECTIVE_REQUIRED"
  | "PAIR_SCOPE_REQUIRED"
  | "PAIR_ACCEPTANCE_REQUIRED"
  | "PAIR_VERIFICATION_REQUIRED"
  | "PAIR_STOPPING_CONDITION_REQUIRED"
  | "PAIR_HUMAN_CAPABILITY_RESERVED"
  | "PAIR_EDIT_CAPABILITY_REQUIRED";

export type PairWorkUnitAssessment =
  | {
      readonly admissible: true;
      readonly navigator: "human" | "ai";
      readonly requiresHumanFollowUp: boolean;
    }
  | { readonly admissible: false; readonly reason: PairWorkUnitRejection };

export const assessPairWorkUnit = (
  workUnit: WorkUnit,
  context: PairWorkUnitPolicyContext,
): PairWorkUnitAssessment => {
  if (workUnit.mode !== "pair") {
    return { admissible: false, reason: "PAIR_MODE_REQUIRED" };
  }
  if (workUnit.status !== "proposed") {
    return { admissible: false, reason: "PAIR_PROPOSAL_REQUIRED" };
  }
  if (workUnit.id.trim() === "") {
    return { admissible: false, reason: "PAIR_WORK_UNIT_ID_REQUIRED" };
  }
  if (workUnit.objective.trim() === "") {
    return { admissible: false, reason: "PAIR_OBJECTIVE_REQUIRED" };
  }
  if (workUnit.allowedPaths.length === 0 ||
      workUnit.allowedPaths.some(path => path.trim() === "")) {
    return { admissible: false, reason: "PAIR_SCOPE_REQUIRED" };
  }
  if (workUnit.acceptanceChecks.length === 0 ||
      workUnit.acceptanceChecks.some(check => check.trim() === "")) {
    return { admissible: false, reason: "PAIR_ACCEPTANCE_REQUIRED" };
  }
  if (workUnit.verificationPlan.trim() === "") {
    return { admissible: false, reason: "PAIR_VERIFICATION_REQUIRED" };
  }
  if (workUnit.stoppingCondition.trim() === "") {
    return { admissible: false, reason: "PAIR_STOPPING_CONDITION_REQUIRED" };
  }
  if (workUnit.owner === "ai" &&
      context.learningAgreement.humanOwnedCapabilities.includes(workUnit.capability)) {
    return { admissible: false, reason: "PAIR_HUMAN_CAPABILITY_RESERVED" };
  }
  if (workUnit.owner === "ai" && context.editCapability !== "verified") {
    return { admissible: false, reason: "PAIR_EDIT_CAPABILITY_REQUIRED" };
  }
  return {
    admissible: true,
    navigator: workUnit.owner === "human" ? "ai" : "human",
    requiresHumanFollowUp: workUnit.owner === "ai" && workUnit.learningValue !== "low",
  };
};
```

**Append: `packages/modes/src/index.ts`**

```typescript
export * from "./pairWorkUnit.js";
```

This checks that a scope and verification plan are specified, not that a path
is safe or a command is approved. Actual canonical path resolution, root
identity, consent, content versions, and process classification remain at the
future runtime/effect boundary. Do not add a second path-authority mechanism
to this pure policy.

- [x] **Step 4: Verify the policy and unchanged Growth behavior.**

```sh
npm exec -- vitest run packages/modes/test/pairWorkUnit.test.ts packages/modes/test/growthMode.test.ts
npm run typecheck
npm run lint
```

Expected: all selectors, typecheck, and lint pass. Review the diff: only the
Task 1 files change and `growthMode.ts` remains unchanged. Commit only if the
user explicitly requests one.

---

### Task 2: Related Human Follow-Up

**Deliverable:** deterministic descriptions of a follow-up requirement,
successor admissibility, and satisfaction by an observed completed human unit.
The functions never persist, clear, or authorize anything.

**Files:**
- Create: `packages/modes/src/pairFollowUp.ts`
- Create: `packages/modes/test/pairFollowUp.test.ts`
- Modify: `packages/modes/src/index.ts`

**Interfaces:** consumes existing `WorkUnit` and `CapabilityCategory`.
Produces `PairHumanFollowUp`, `PairSuccessorAssessment`,
`PairObservedVerification`, and the three functions below. `undefined` is not
an instruction to clear an existing requirement. The future core combines
these assessments with Task 1 and records accepted decisions separately.

- [x] **Step 1: Write the failing follow-up cases.**

**Create: `packages/modes/test/pairFollowUp.test.ts`**

```typescript
import type { WorkUnit } from "@adaptive-pair/protocol";
import { describe, expect, it } from "vitest";
import {
  assessPairSuccessor,
  humanFollowUpFor,
  isPairHumanFollowUpSatisfied,
} from "../src/index.js";
import { pairWorkUnit } from "./pairFixtures.js";

const requirement = Object.freeze({
  sourceWorkUnitId: "ai-unit-1",
  capability: "implementation" as const,
});

describe("Pair human follow-up policy", () => {
  it.each(["high", "mixed"] as const)("describes a requirement for agreed %s-value AI work", learningValue => {
    expect(humanFollowUpFor(pairWorkUnit({
      id: "ai-unit-1", owner: "ai", status: "agreed", learningValue,
    }))).toEqual(requirement);
  });

  it("also retains the requirement after interrupted or failed accepted AI work", () => {
    for (const status of ["paused", "needs-reconcile", "cancelled", "failed"] as const) {
      expect(humanFollowUpFor(pairWorkUnit({
        id: "ai-unit-1", owner: "ai", status,
      }))).toEqual(requirement);
    }
  });

  it("does not create a requirement from a mere proposal, human unit, or mechanical work", () => {
    const units = [
      pairWorkUnit({ owner: "ai", status: "proposed" }),
      pairWorkUnit({ owner: "human", status: "completed" }),
      pairWorkUnit({ owner: "ai", learningValue: "low", status: "completed" }),
      pairWorkUnit({ owner: "ai", mode: "delivery", status: "completed" }),
    ];
    for (const workUnit of units) {
      expect(humanFollowUpFor(workUnit)).toBeUndefined();
    }
  });

  it("admits the first unit without fabricating a predecessor", () => {
    expect(assessPairSuccessor(pairWorkUnit(), undefined, undefined))
      .toEqual({ admissible: true });
  });

  it.each(["growth", "delivery"] as const)("does not admit a %s successor through Pair policy", mode => {
    expect(assessPairSuccessor(pairWorkUnit({ mode }), undefined, undefined))
      .toEqual({ admissible: false, reason: "PAIR_MODE_REQUIRED" });
  });

  it("does not treat an existing unit as a new successor proposal", () => {
    expect(assessPairSuccessor(pairWorkUnit({ status: "completed" }), undefined, undefined))
      .toEqual({ admissible: false, reason: "PAIR_PROPOSAL_REQUIRED" });
  });

  it("does not allow an AI or mechanical unit to bypass the outstanding human unit", () => {
    for (const workUnit of [
      pairWorkUnit({ owner: "ai" }),
      pairWorkUnit({ owner: "human", learningValue: "low" }),
      pairWorkUnit({ owner: "ai", learningValue: "low" }),
    ]) {
      expect(assessPairSuccessor(workUnit, requirement, "ai-unit-1"))
        .toEqual({ admissible: false, reason: "PAIR_HUMAN_FOLLOW_UP_REQUIRED" });
    }
  });

  it("requires an explicit relationship rather than guessing from the objective", () => {
    expect(assessPairSuccessor(pairWorkUnit(), requirement, undefined))
      .toEqual({ admissible: false, reason: "PAIR_RELATED_UNIT_REQUIRED" });
    expect(assessPairSuccessor(pairWorkUnit(), requirement, "other-ai-unit"))
      .toEqual({ admissible: false, reason: "PAIR_RELATED_UNIT_REQUIRED" });
  });

  it("requires a distinct human unit", () => {
    expect(assessPairSuccessor(
      pairWorkUnit({ id: "ai-unit-1" }), requirement, "ai-unit-1",
    )).toEqual({ admissible: false, reason: "PAIR_RELATED_UNIT_REQUIRED" });
  });

  it("allows explicitly related work in another capability category", () => {
    expect(assessPairSuccessor(
      pairWorkUnit({ capability: "repair" }), requirement, "ai-unit-1",
    )).toEqual({ admissible: true });
  });

  it("does not discharge the requirement at admission or from a failed check", () => {
    expect(isPairHumanFollowUpSatisfied(
      pairWorkUnit(), requirement, "ai-unit-1", "passed",
    )).toBe(false);
    expect(isPairHumanFollowUpSatisfied(
      pairWorkUnit({ status: "completed" }), requirement, "ai-unit-1", "failed",
    )).toBe(false);
    expect(isPairHumanFollowUpSatisfied(
      pairWorkUnit({ status: "completed" }), requirement, "ai-unit-1", "not-run",
    )).toBe(false);
  });

  it("recognizes a completed, observed, learning-relevant human successor", () => {
    expect(isPairHumanFollowUpSatisfied(
      pairWorkUnit({ status: "completed", capability: "repair" }),
      requirement,
      "ai-unit-1",
      "passed",
    )).toBe(true);
    expect(requirement.sourceWorkUnitId).toBe("ai-unit-1");
  });

  const nonSatisfying: readonly Partial<WorkUnit>[] = [
    { owner: "ai" },
    { learningValue: "low" },
    { mode: "growth" },
    { mode: "delivery" },
    { id: "ai-unit-1" },
  ];

  it.each(nonSatisfying)("does not count an invalid human successor %j", override => {
    expect(isPairHumanFollowUpSatisfied(
      pairWorkUnit({ status: "completed", ...override }),
      requirement,
      "ai-unit-1",
      "passed",
    )).toBe(false);
  });

  it("requires a real outstanding requirement and matching relationship", () => {
    expect(isPairHumanFollowUpSatisfied(
      pairWorkUnit({ status: "completed" }), undefined, "ai-unit-1", "passed",
    )).toBe(false);
    expect(isPairHumanFollowUpSatisfied(
      pairWorkUnit({ status: "completed" }), requirement, "other-unit", "passed",
    )).toBe(false);
  });

  it("does not change the proposed unit or requirement", () => {
    const workUnit = Object.freeze(pairWorkUnit());
    const before = JSON.stringify({ workUnit, requirement });
    assessPairSuccessor(workUnit, requirement, "ai-unit-1");
    expect(JSON.stringify({ workUnit, requirement })).toBe(before);
  });
});
```

- [x] **Step 2: Observe the focused red result.**

```sh
npm exec -- vitest run packages/modes/test/pairFollowUp.test.ts
```

Expected: the new follow-up exports do not exist. Task 1 stays green.

- [x] **Step 3: Implement the pure follow-up functions.**

**Create: `packages/modes/src/pairFollowUp.ts`**

```typescript
import type { CapabilityCategory, WorkUnit } from "@adaptive-pair/protocol";

export interface PairHumanFollowUp {
  readonly sourceWorkUnitId: string;
  readonly capability: CapabilityCategory;
}

export type PairSuccessorAssessment =
  | { readonly admissible: true }
  | {
      readonly admissible: false;
      readonly reason:
        | "PAIR_MODE_REQUIRED"
        | "PAIR_PROPOSAL_REQUIRED"
        | "PAIR_HUMAN_FOLLOW_UP_REQUIRED"
        | "PAIR_RELATED_UNIT_REQUIRED";
    };

export type PairObservedVerification = "passed" | "failed" | "not-run";

export const humanFollowUpFor = (
  workUnit: WorkUnit,
): PairHumanFollowUp | undefined => {
  if (workUnit.mode !== "pair" || workUnit.owner !== "ai" ||
      workUnit.learningValue === "low" || workUnit.status === "proposed") {
    return undefined;
  }
  return Object.freeze({
    sourceWorkUnitId: workUnit.id,
    capability: workUnit.capability,
  });
};

export const assessPairSuccessor = (
  workUnit: WorkUnit,
  requirement: PairHumanFollowUp | undefined,
  relatedToWorkUnitId: string | undefined,
): PairSuccessorAssessment => {
  if (workUnit.mode !== "pair") {
    return { admissible: false, reason: "PAIR_MODE_REQUIRED" };
  }
  if (workUnit.status !== "proposed") {
    return { admissible: false, reason: "PAIR_PROPOSAL_REQUIRED" };
  }
  if (requirement === undefined) {
    return { admissible: true };
  }
  if (workUnit.owner !== "human" || workUnit.learningValue === "low") {
    return { admissible: false, reason: "PAIR_HUMAN_FOLLOW_UP_REQUIRED" };
  }
  if (relatedToWorkUnitId !== requirement.sourceWorkUnitId ||
      workUnit.id === requirement.sourceWorkUnitId) {
    return { admissible: false, reason: "PAIR_RELATED_UNIT_REQUIRED" };
  }
  return { admissible: true };
};

export const isPairHumanFollowUpSatisfied = (
  workUnit: WorkUnit,
  requirement: PairHumanFollowUp | undefined,
  relatedToWorkUnitId: string | undefined,
  verification: PairObservedVerification,
): boolean =>
  requirement !== undefined &&
  workUnit.mode === "pair" &&
  workUnit.owner === "human" &&
  workUnit.learningValue !== "low" &&
  workUnit.status === "completed" &&
  workUnit.id !== requirement.sourceWorkUnitId &&
  relatedToWorkUnitId === requirement.sourceWorkUnitId &&
  verification === "passed";
```

**Append: `packages/modes/src/index.ts`**

```typescript
export * from "./pairFollowUp.js";
```

P2 must derive `humanFollowUpFor` inputs from accepted work-unit history. An
unaccepted proposal later marked cancelled must not be mistaken for an
accepted AI unit. For accepted units, interruption/failure does not silently
erase the requirement. A `true` satisfaction assessment still requires the
core to record the correlated observation and any requirement-clearing event;
this helper changes no state and reports no Growth outcome.

- [x] **Step 4: Run both policy suites and review the boundary.**

```sh
npm exec -- vitest run packages/modes/test/pairWorkUnit.test.ts packages/modes/test/pairFollowUp.test.ts packages/modes/test/growthMode.test.ts
npm run typecheck
npm run lint
```

Expected: all checks pass, including the unchanged Growth tests. No runtime,
evaluation, or protocol file changes. Do not invent a persistence format in
order to make this policy task look like a full collaboration loop.

---

### Task 3: Handoff Preflight Without Authority Transfer

**Deliverable:** a deterministic assessment of whether a proposal may proceed
to baseline and human review. It cannot stop admission, cancel an operation,
accept a proposal, increment an epoch, or change an owner.

**Files:**
- Create: `packages/modes/src/pairHandoff.ts`
- Create: `packages/modes/test/pairHandoff.test.ts`
- Modify: `packages/modes/test/pairFixtures.ts`
- Modify: `packages/modes/src/index.ts`

**Interfaces:** consumes existing `PairRuntimeSnapshot`, `OperationRecord`,
and `WorkUnit`, plus Task 1's admission types. Produces the exact proposal,
context, and assessment types below. Only settled operations are ready; an
unknown read is not an unknown mutation, while an unknown `edit` or `check`
requires reconciliation. P2 must classify partial state changes conservatively
and bind the stopped-admission fact to an actual serialized admission barrier.

- [x] **Step 1: Add typed runtime fixtures and failing preflight cases.**

The additional type imports below are appended with the new fixture functions;
they may be grouped with the earlier imports during refactoring.

**Append: `packages/modes/test/pairFixtures.ts`**

```typescript
import type { OperationRecord, PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import type { PairHandoffContext } from "../src/pairHandoff.js";

export const pairRuntime = (
  workUnit: WorkUnit = pairWorkUnit({ status: "agreed" }),
  operations: readonly OperationRecord[] = [],
): PairRuntimeSnapshot => ({
  protocolVersion: 1,
  revision: 12,
  presence: {
    workspaceId: "workspace-1",
    observationRevision: 1,
    status: "engaged",
    activeSessionId: "session-1",
  },
  session: {
    sessionId: "session-1",
    authorityEpoch: 3,
    status: "ready",
    mode: "pair",
    goal: "Implement retry behavior together",
    criteria: ["The retry check passes"],
    learningAgreement: pairAgreement(),
    entrySnapshot: {
      workspaceId: "workspace-1",
      dirtyPaths: [],
      openPaths: ["src/retry.ts"],
      diagnostics: [],
      protectedPaths: [],
      capturedAt: 0,
    },
    workUnit,
    assistance: undefined,
    operations,
    userActionGrants: [],
  },
});

export const pairOperation = (
  overrides: Partial<OperationRecord> = {},
): OperationRecord => ({
  id: "operation-1",
  workUnitId: "unit-pair-1",
  toolName: "pair_apply_edit",
  kind: "edit",
  input: {},
  runtimeRevision: 12,
  authorityEpoch: 3,
  status: "authorized",
  summary: undefined,
  userActionGrantId: undefined,
  ...overrides,
});

export const pairHandoffContext = (
  overrides: Partial<PairHandoffContext> = {},
): PairHandoffContext => ({
  snapshot: pairRuntime(),
  proposal: {
    sessionId: "session-1",
    workUnitId: "unit-pair-1",
    fromOwner: "human",
    toOwner: "ai",
    runtimeRevision: 12,
    authorityEpoch: 3,
  },
  operationAdmission: "stopped",
  editCapability: "verified",
  ...overrides,
});
```

**Create: `packages/modes/test/pairHandoff.test.ts`**

```typescript
import type { OperationRecord } from "@adaptive-pair/protocol";
import { describe, expect, it } from "vitest";
import {
  assessPairHandoff,
  type PairHandoffProposal,
} from "../src/index.js";
import {
  pairHandoffContext,
  pairOperation,
  pairRuntime,
  pairWorkUnit,
} from "./pairFixtures.js";

describe("Pair handoff preflight", () => {
  it.each(["agreed", "executing", "verifying", "completed"] as const)(
    "reports only readiness for baseline and human review of a %s unit",
    status => {
      expect(assessPairHandoff(pairHandoffContext({
        snapshot: pairRuntime(pairWorkUnit({ status })),
      }))).toEqual({ status: "ready-for-baseline-review" });
    },
  );

  it("allows human takeover preflight without claiming AI edit support", () => {
    const context = pairHandoffContext();
    expect(assessPairHandoff({
      ...context,
      snapshot: pairRuntime(pairWorkUnit({ owner: "ai", status: "agreed" })),
      proposal: { ...context.proposal, fromOwner: "ai", toOwner: "human" },
      editCapability: "unavailable",
    })).toEqual({ status: "ready-for-baseline-review" });
  });

  const mismatches: readonly [Partial<PairHandoffProposal>, string][] = [
    [{ sessionId: "other-session" }, "PAIR_HANDOFF_IDENTITY_MISMATCH"],
    [{ workUnitId: "other-unit" }, "PAIR_HANDOFF_IDENTITY_MISMATCH"],
    [{ fromOwner: "ai", toOwner: "human" }, "PAIR_HANDOFF_OWNER_MISMATCH"],
    [{ toOwner: "human" }, "PAIR_HANDOFF_OWNER_MISMATCH"],
    [{ runtimeRevision: 11 }, "PAIR_STALE_HANDOFF"],
    [{ authorityEpoch: 2 }, "PAIR_STALE_HANDOFF"],
  ];

  it.each(mismatches)("rejects a mismatched proposal %j", (override, reason) => {
    const context = pairHandoffContext();
    expect(assessPairHandoff({
      ...context,
      proposal: { ...context.proposal, ...override },
    })).toEqual({ status: "blocked", reason });
  });

  it("cannot substitute a policy result for stopped operation admission", () => {
    expect(assessPairHandoff(pairHandoffContext({ operationAdmission: "open" })))
      .toEqual({ status: "blocked", reason: "PAIR_ADMISSION_OPEN" });
  });

  const pendingStatuses: readonly OperationRecord["status"][] = [
    "planned", "authorized", "started",
  ];

  it.each(pendingStatuses)("waits for a %s operation to settle", status => {
    expect(assessPairHandoff(pairHandoffContext({
      snapshot: pairRuntime(undefined, [pairOperation({ status })]),
    }))).toEqual({ status: "blocked", reason: "PAIR_OPERATIONS_PENDING" });
  });

  it.each(["edit", "check"] as const)("requires reconciliation of an unknown %s", kind => {
    expect(assessPairHandoff(pairHandoffContext({
      snapshot: pairRuntime(undefined, [pairOperation({
        kind,
        toolName: kind === "edit" ? "pair_apply_edit" : "pair_run_verification",
        status: "unknown",
      })]),
    }))).toEqual({ status: "blocked", reason: "PAIR_RECONCILIATION_REQUIRED" });
  });

  it("does not discard an unresolved mutation from an earlier unit or epoch", () => {
    expect(assessPairHandoff(pairHandoffContext({
      snapshot: pairRuntime(undefined, [pairOperation({
        workUnitId: "earlier-unit", authorityEpoch: 2, status: "unknown",
      })]),
    }))).toEqual({ status: "blocked", reason: "PAIR_RECONCILIATION_REQUIRED" });
  });

  it("does not treat an unknown read as a completed or unknown mutation", () => {
    expect(assessPairHandoff(pairHandoffContext({
      snapshot: pairRuntime(undefined, [pairOperation({
        kind: "read", toolName: "pair_read_scope", status: "unknown",
      })]),
    }))).toEqual({ status: "ready-for-baseline-review" });
  });

  it.each(["confirmed", "failed", "declined", "cancelled"] as const)(
    "allows review after a terminal %s result",
    status => {
      expect(assessPairHandoff(pairHandoffContext({
        snapshot: pairRuntime(undefined, [pairOperation({ status })]),
      }))).toEqual({ status: "ready-for-baseline-review" });
    },
  );

  it("does not become ready while paused or awaiting reconciliation", () => {
    for (const status of ["paused", "reconciling", "closed"] as const) {
      const snapshot = pairRuntime();
      if (snapshot.session === undefined) {
        throw new Error("Missing test session");
      }
      expect(assessPairHandoff(pairHandoffContext({
        snapshot: { ...snapshot, session: { ...snapshot.session, status } },
      }))).toEqual({ status: "blocked", reason: "PAIR_NOT_OPERATIONAL" });
    }
  });

  it("rejects inactive or observing Presence and a different Presence session", () => {
    const snapshot = pairRuntime();
    for (const presence of [
      { ...snapshot.presence, status: "off" as const },
      { ...snapshot.presence, status: "paused" as const },
      { ...snapshot.presence, status: "observing" as const },
      { ...snapshot.presence, activeSessionId: "other-session" },
    ]) {
      expect(assessPairHandoff(pairHandoffContext({
        snapshot: { ...snapshot, presence },
      }))).toEqual({ status: "blocked", reason: "PAIR_NOT_OPERATIONAL" });
    }
  });

  it.each(["proposed", "paused", "needs-reconcile", "cancelled", "failed"] as const)(
    "does not hand off a non-operational %s unit",
    status => {
      expect(assessPairHandoff(pairHandoffContext({
        snapshot: pairRuntime(pairWorkUnit({ status })),
      }))).toEqual({ status: "blocked", reason: "PAIR_NOT_OPERATIONAL" });
    },
  );

  it("does not mistake missing or non-Pair session state for readiness", () => {
    const snapshot = pairRuntime();
    const session = snapshot.session;
    if (session === undefined) {
      throw new Error("Missing test session");
    }
    for (const candidate of [
      undefined,
      { ...session, workUnit: undefined },
      { ...session, mode: "growth" as const },
    ]) {
      expect(assessPairHandoff(pairHandoffContext({
        snapshot: { ...snapshot, session: candidate },
      }))).toEqual({ status: "blocked", reason: "PAIR_MODE_REQUIRED" });
    }
  });

  it("preserves a quiet developer's operational Pair session", () => {
    const snapshot = pairRuntime();
    expect(assessPairHandoff(pairHandoffContext({
      snapshot: { ...snapshot, presence: { ...snapshot.presence, status: "quiet" } },
    }))).toEqual({ status: "ready-for-baseline-review" });
  });

  it("does not grant AI ownership without the reviewed agreement and capability", () => {
    expect(assessPairHandoff(pairHandoffContext({ editCapability: "unavailable" })))
      .toEqual({ status: "blocked", reason: "PAIR_EDIT_CAPABILITY_REQUIRED" });
    expect(assessPairHandoff(pairHandoffContext({
      snapshot: pairRuntime(pairWorkUnit({ capability: "diagnosis", status: "agreed" })),
    }))).toEqual({ status: "blocked", reason: "PAIR_HUMAN_CAPABILITY_RESERVED" });
    const snapshot = pairRuntime();
    if (snapshot.session === undefined) {
      throw new Error("Missing test session");
    }
    expect(assessPairHandoff(pairHandoffContext({
      snapshot: {
        ...snapshot,
        session: { ...snapshot.session, learningAgreement: undefined },
      },
    }))).toEqual({ status: "blocked", reason: "PAIR_LEARNING_AGREEMENT_REQUIRED" });
  });

  it("refuses Growth and Delivery handoff assessments", () => {
    for (const mode of ["growth", "delivery"] as const) {
      expect(assessPairHandoff(pairHandoffContext({
        snapshot: pairRuntime(pairWorkUnit({ mode, status: "agreed" })),
      }))).toEqual({ status: "blocked", reason: "PAIR_MODE_REQUIRED" });
    }
  });

  it("does not change ownership, epoch, operations, or the proposal", () => {
    const context = pairHandoffContext();
    const before = JSON.stringify(context);
    Object.freeze(context.proposal);
    Object.freeze(context.snapshot.session?.workUnit);
    Object.freeze(context.snapshot.session?.operations);
    Object.freeze(context.snapshot.session);
    Object.freeze(context.snapshot);
    Object.freeze(context);
    expect(assessPairHandoff(context))
      .toEqual({ status: "ready-for-baseline-review" });
    expect(JSON.stringify(context)).toBe(before);
  });
});
```

- [x] **Step 2: Run the focused red test.**

```sh
npm exec -- vitest run packages/modes/test/pairHandoff.test.ts
```

Expected: `assessPairHandoff` is not exported/implemented. Do not expose
`pair_accept_handoff` or change a coordinator method to make this test pass.

- [x] **Step 3: Implement the complete preflight assessment.**

**Create: `packages/modes/src/pairHandoff.ts`**

```typescript
import type {
  OperationRecord,
  PairRuntimeSnapshot,
  WorkUnit,
} from "@adaptive-pair/protocol";
import {
  assessPairWorkUnit,
  type PairEditCapability,
  type PairWorkUnitRejection,
} from "./pairWorkUnit.js";

export interface PairHandoffProposal {
  readonly sessionId: string;
  readonly workUnitId: string;
  readonly fromOwner: WorkUnit["owner"];
  readonly toOwner: WorkUnit["owner"];
  readonly runtimeRevision: number;
  readonly authorityEpoch: number;
}

export interface PairHandoffContext {
  readonly snapshot: PairRuntimeSnapshot;
  readonly proposal: PairHandoffProposal;
  readonly operationAdmission: "open" | "stopped";
  readonly editCapability: PairEditCapability;
}

export type PairHandoffAssessment =
  | { readonly status: "ready-for-baseline-review" }
  | {
      readonly status: "blocked";
      readonly reason:
        | PairWorkUnitRejection
        | "PAIR_NOT_OPERATIONAL"
        | "PAIR_HANDOFF_IDENTITY_MISMATCH"
        | "PAIR_HANDOFF_OWNER_MISMATCH"
        | "PAIR_STALE_HANDOFF"
        | "PAIR_ADMISSION_OPEN"
        | "PAIR_OPERATIONS_PENDING"
        | "PAIR_RECONCILIATION_REQUIRED"
        | "PAIR_LEARNING_AGREEMENT_REQUIRED";
    };

const isSettledOperation = (operation: OperationRecord): boolean =>
  operation.status === "confirmed" ||
  operation.status === "failed" ||
  operation.status === "declined" ||
  operation.status === "cancelled" ||
  operation.status === "unknown";

export const assessPairHandoff = (
  context: PairHandoffContext,
): PairHandoffAssessment => {
  const { snapshot, proposal } = context;
  const session = snapshot.session;
  const workUnit = session?.workUnit;
  if (session?.mode !== "pair" || workUnit?.mode !== "pair") {
    return { status: "blocked", reason: "PAIR_MODE_REQUIRED" };
  }
  if ((session.status !== "ready" && session.status !== "active") ||
      (snapshot.presence.status !== "engaged" && snapshot.presence.status !== "quiet") ||
      snapshot.presence.activeSessionId !== session.sessionId ||
      (workUnit.status !== "agreed" && workUnit.status !== "executing" &&
       workUnit.status !== "verifying" && workUnit.status !== "completed")) {
    return { status: "blocked", reason: "PAIR_NOT_OPERATIONAL" };
  }
  if (proposal.sessionId !== session.sessionId || proposal.workUnitId !== workUnit.id) {
    return { status: "blocked", reason: "PAIR_HANDOFF_IDENTITY_MISMATCH" };
  }
  if (proposal.fromOwner !== workUnit.owner || proposal.fromOwner === proposal.toOwner) {
    return { status: "blocked", reason: "PAIR_HANDOFF_OWNER_MISMATCH" };
  }
  if (proposal.runtimeRevision !== snapshot.revision ||
      proposal.authorityEpoch !== session.authorityEpoch) {
    return { status: "blocked", reason: "PAIR_STALE_HANDOFF" };
  }
  if (context.operationAdmission !== "stopped") {
    return { status: "blocked", reason: "PAIR_ADMISSION_OPEN" };
  }
  if (session.operations.some(operation =>
    operation.kind !== "read" && operation.status === "unknown")) {
    return { status: "blocked", reason: "PAIR_RECONCILIATION_REQUIRED" };
  }
  if (session.operations.some(operation => !isSettledOperation(operation))) {
    return { status: "blocked", reason: "PAIR_OPERATIONS_PENDING" };
  }
  if (session.learningAgreement === undefined) {
    return { status: "blocked", reason: "PAIR_LEARNING_AGREEMENT_REQUIRED" };
  }
  const proposedOwner = assessPairWorkUnit(
    { ...workUnit, owner: proposal.toOwner, status: "proposed" },
    { learningAgreement: session.learningAgreement, editCapability: context.editCapability },
  );
  if (!proposedOwner.admissible) {
    return { status: "blocked", reason: proposedOwner.reason };
  }
  return { status: "ready-for-baseline-review" };
};
```

**Append: `packages/modes/src/index.ts`**

```typescript
export * from "./pairHandoff.js";
```

The assessment deliberately blocks unresolved state-changing operations even
if their epoch or unit differs. P2 must add explicit reconciliation semantics;
deleting an operation, relabeling `unknown` as `failed`, or ignoring an old
epoch to obtain readiness would bypass the contract. Terminal failed/declined/
cancelled results are safe inputs only when the future adapter has positively
classified their completion; ambiguous partial changes remain `unknown`.

A completed unit can be ready for successor review, but must not be reopened
by changing its owner in place. P2 owns successor creation, relationship
binding, the follow-up requirement, and durable history. Preflight readiness
alone does not satisfy any of those transitions.

- [x] **Step 4: Run all policy tests and verify the fixed protocol boundary.**

```sh
npm exec -- vitest run packages/modes/test
npm run typecheck
npm run lint
git diff --stat
```

Expected: all checks pass. There are no changes under `packages/protocol`,
`packages/session-core`, `packages/runtime`, `packages/harness`, or
`apps/vscode-extension`. No policy result is added to a journal or an export.

---

### Task 4: Contract Review and Unchanged Preview Gate

**Deliverable:** a reviewed P1 diff and fresh regression evidence, with no new
claim that Pair is available in the extension. This task verifies the completed
library; it does not add a new feature or a second implementation plan.

**Files:** no production files beyond Tasks 1–3. After implementation checks,
update the P1 status in `docs/design.md` and this plan, the observed evidence in
`docs/research.md`, and the project-status wording in `README.md`. Preserve
draft/approval/implementation distinctions for P2 and P3.

- [x] **Step 1: Review every contract against this acceptance matrix.**

| Contract | Required case | Owner |
|---|---|---|
| Human editing remains available without AI capability | Human proposal is admissible; human-target preflight does not require AI edit support | Tasks 1, 3 |
| AI support is not consent or authority | AI proposal needs a capability fact, but no result changes owner, revision, or grants | Tasks 1, 3 |
| Accepted human-owned capabilities are respected | A verified edit capability cannot override a human-reserved category | Tasks 1, 3 |
| An agreement and explicit scope are required | Incomplete work units and handoff without an agreement are rejected | Tasks 1, 3 |
| AI work is followed by related human work | New AI/mechanical work cannot bypass an outstanding requirement | Task 2 |
| Relatedness is explicit and does not demand the same category | Missing/wrong/self identity is rejected; explicitly related repair after implementation is admissible | Task 2 |
| Acceptance is not meaningful completion | Only a completed related human unit with observed passing verification satisfies the requirement | Task 2 |
| Interrupted work does not erase participation obligations | Previously accepted AI units retain the requirement after failure/interruption; a mere proposal creates none | Task 2; provenance binding in P2 |
| Handoff is not automatic | Identity, owner, revision, epoch, and stopped admission are checked; a review-ready result has no authority payload | Task 3 |
| Started work settles before acceptance | Pending operations block; unknown edits/checks require reconciliation | Task 3; real cancellation/reconciliation in P2 |
| Pause outranks handoff | Paused/reconciling sessions and Presence outside `engaged`/`quiet` cannot become ready | Task 3; emergency control stays outside this policy |
| Growth and other surfaces are unchanged | Existing Growth, manifest, runtime, package, and isolated-host checks pass | This task |

No complete Pair Mode, runtime concurrency, filesystem-safety, model-behavior,
or learning-efficacy claim can be inferred from this matrix. Review P1 as a
pure contract milestone and leave P2/P3 gates open.

- [x] **Step 2: Run the full existing quality and distribution checks.**

```sh
npm run check
npm exec -- vitest run packages/modes --reporter=json
npm run package
node scripts/verify-vsix.mjs
npm run test:host
git diff --check
```

Expected: successful typecheck, lint, all tests, a verified Stable VSIX, and
successful isolated Extension Host checks on the observed host version.
Record actual versions and results. If a host check cannot run, report it as
unverified, not passed. Do not replace an isolated test profile with the user's
profile. Do not upgrade dependencies or fix unrelated defects as part of P1.

Use the JSON reporter's `testResults[].assertionResults` to report per-file
case counts. Parameterized `it.each` rows are separate cases; multiple
assertions or ordinary loop iterations inside one `it` are not. Keep those
counts separate from additional assertion coverage and temporary review tests.

- [x] **Step 3: Update canonical status only from observed results.**

Record P1 as implemented only after its code exists and all required checks
pass. Record human approval separately; tests do not approve a design. Keep
README and the preview guide explicit that the extension remains Growth-only.
Do not publish a duplicate handoff report or copy local test logs, personal
paths, or credentials into documentation.

- [ ] **Step 4: Complete the pull request review loop.**

Commit and push the scoped changes on the dedicated branch, open a pull request
against `main`, and request review. Verify each finding against the policy
contracts before editing. Make necessary fixes with regression coverage and
rerun the affected checks. Reply in each original review thread with the fix
and evidence, or explain why no change is appropriate. Resolve only addressed
threads, check follow-up feedback, and verify the required checks on the final
revision. Report when ready to merge; wait for the user's merge decision.

- [ ] **Step 5: Stop for P2 scope review.**

Summarize changed files and fresh results. Ask for review of the policy
decisions before designing the P2 protocol/runtime changes. A new P2 plan must
replace this one deliberately after scope review, with its own persistence,
grant, authority, replay, concurrency, and reconciliation tests. Do not merge,
start P2, or expose Pair controls without the required user direction. A
documentation PR does not itself authorize implementing the proposed policies.

## Completion and Approval Record

- [x] Inspect the committed interfaces and document the P1 boundary.
- [x] Assign known preview gaps and remaining release gates in the design roadmap.
- [x] Complete plan-example validation and internal consistency review.
- [x] Complete baseline host revalidation (17 smoke tests; runner exit code 0).
- [x] Obtain user review of the written P1 design and implementation plan.
- [ ] Implement and verify Tasks 1–4 after approval.

The repository owner authorized P1 on September 16, 2026 by requesting the
merge of reviewed PR #4 and continuation with the next increment. This is
separate from the plan's earlier publication and does not approve P2 or P3.

Tasks 1–3 are now implemented in repository source. Each new suite failed
before its policy exports existed, then staged runs passed 23, 44, and 79
tests with forced typecheck and lint. The final modes suite comprises 19
admission, 21 follow-up, 35 handoff, and four unchanged Growth cases; fixture
type imports were grouped without changing the contracts or case counts.
Full validation passed 43 files and 671 tests, Stable VSIX verification, and
all 17 isolated host smoke tests on VS Code 1.137.0 with runner exit code 0.
Task 4's pull request review loop remains open; its final-head checks and
follow-up findings must be verified before reporting merge readiness.

These results establish pure P1 contracts and unchanged-preview regression
coverage, not Pair runtime/host conformance, accepted handoff, edit authority,
or learning efficacy. The earlier temporary-example evidence remains in
`docs/research.md`; no duplicate active plan is created.
