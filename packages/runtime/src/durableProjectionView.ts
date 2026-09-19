import type { DurableFact, PairEvent, PairRuntimeSnapshot, PresenceStatus } from "@adaptive-pair/protocol";
import type {
  DurableLearningBoundary, DurableOperationState, DurableSessionState, DurableWorkUnitState,
} from "./durableTypes.js";
import { failProjection } from "./durableProjectionIdentity.js";

interface UnitBinding { readonly key: string; readonly proposedAt: number }
interface OperationBinding { readonly key: string; readonly workUnitKey: string; readonly authorizedAt: number }
interface SessionBinding {
  readonly key: string;
  readonly units: Map<string, UnitBinding>;
  readonly operations: Map<string, OperationBinding>;
}

export type ProjectionBindings = Map<number, SessionBinding>;
export type ProjectionBindingChange =
  | { readonly kind: "session"; readonly revision: number; readonly key: string }
  | { readonly kind: "unit"; readonly revision: number; readonly sourceId: string; readonly binding: UnitBinding }
  | { readonly kind: "operation"; readonly revision: number; readonly sourceId: string; readonly binding: OperationBinding };

type OperationView = Omit<DurableOperationState, "openedSequence">;
interface SessionView {
  readonly sessionKey: string;
  readonly status: DurableSessionState["status"];
  readonly mode: DurableSessionState["mode"];
  readonly learningBoundary: DurableLearningBoundary | null;
  readonly workUnit: DurableWorkUnitState | null;
  readonly operations: readonly OperationView[];
}
export interface ProjectionView { readonly presence: PresenceStatus; readonly session: SessionView | null }

export const cloneProjectionBindings = (bindings: ProjectionBindings): ProjectionBindings => new Map(
  [...bindings].map(([revision, session]) => [revision, {
    key: session.key, units: new Map(session.units), operations: new Map(session.operations),
  }]),
);

export const applyBindingChange = (bindings: ProjectionBindings, change: ProjectionBindingChange): void => {
  if (change.kind === "session") {
    bindings.set(change.revision, { key: change.key, units: new Map(), operations: new Map() });
    return;
  }
  const session = bindings.get(change.revision) ?? failProjection("MISSING_LIFETIME_MAPPING");
  if (change.kind === "unit") session.units.set(change.sourceId, change.binding);
  else session.operations.set(change.sourceId, change.binding);
};

export const bindProjectionBirth = (
  bindings: ProjectionBindings, after: PairRuntimeSnapshot, event: PairEvent, issue: () => string,
): ProjectionBindingChange | undefined => {
  if (event.type === "SessionStarted") return { kind: "session", revision: event.revision, key: issue() };
  if (event.type !== "WorkUnitProposed" && event.type !== "OperationAuthorized") return undefined;
  const revision = after.session?.startedAtRevision ?? failProjection("MISSING_LIFETIME_MAPPING");
  const session = bindings.get(revision) ?? failProjection("MISSING_LIFETIME_MAPPING");
  if (event.type === "WorkUnitProposed") return {
    kind: "unit", revision, sourceId: event.workUnit.id,
    binding: Object.freeze({ key: issue(), proposedAt: event.revision }),
  };
  const unit = session.units.get(event.operation.workUnitId) ?? failProjection("MISSING_LIFETIME_MAPPING");
  return {
    kind: "operation", revision, sourceId: event.operation.id,
    binding: Object.freeze({ key: issue(), workUnitKey: unit.key, authorizedAt: event.revision }),
  };
};

const readUnit = (live: NonNullable<PairRuntimeSnapshot["session"]>, binding: SessionBinding): DurableWorkUnitState | null => {
  const unit = live.workUnit;
  if (unit === undefined) return null;
  const workUnitKey = binding.units.get(unit.id)?.key ?? failProjection("MISSING_LIFETIME_MAPPING");
  const assistance = live.assistance;
  return Object.freeze({
    sessionKey: binding.key, workUnitKey, mode: unit.mode, owner: unit.owner,
    learningValue: unit.learningValue, capability: unit.capability, status: unit.status,
    assistance: assistance === undefined ? null : Object.freeze({
      attempt: assistance.attempt === undefined ? "none" : assistance.attempt.bypassed ? "bypassed" : "recorded",
      hypothesis: assistance.hypothesis === undefined ? "none" : assistance.hypothesis.bypassed ? "bypassed" : "recorded",
      hintLevel: assistance.hint?.level ?? null, solutionRevealed: assistance.solutionReveal !== undefined,
    }),
  });
};

export const readProjectionView = (snapshot: PairRuntimeSnapshot, bindings: ProjectionBindings): ProjectionView => {
  const live = snapshot.session;
  if (live === undefined) return Object.freeze({ presence: snapshot.presence.status, session: null });
  const binding = bindings.get(live.startedAtRevision) ?? failProjection("MISSING_LIFETIME_MAPPING");
  if (live.status === "inactive") return failProjection("INVALID_CANDIDATE");
  const learning = live.learningAgreement;
  return Object.freeze({
    presence: snapshot.presence.status,
    session: Object.freeze({
      sessionKey: binding.key, status: live.status, mode: live.mode ?? null,
      learningBoundary: learning === undefined ? null : Object.freeze({
        humanOwnedCapabilities: Object.freeze([...learning.humanOwnedCapabilities]), maximumHintLevel: learning.maximumHintLevel,
      }),
      workUnit: readUnit(live, binding),
      operations: Object.freeze(live.operations.map(operation => {
        const reference = binding.operations.get(operation.id) ?? failProjection("MISSING_LIFETIME_MAPPING");
        return Object.freeze({
          sessionKey: binding.key, workUnitKey: reference.workUnitKey, operationKey: reference.key,
          kind: operation.kind, status: operation.status,
        });
      })),
    }),
  });
};

const same = (first: unknown, second: unknown): boolean => JSON.stringify(first) === JSON.stringify(second);

const unitFacts = (previous: DurableWorkUnitState | null, next: DurableWorkUnitState | null): DurableFact[] => {
  const facts: DurableFact[] = [];
  if (next === null) {
    if (previous !== null) return failProjection("INVALID_CANDIDATE");
    return facts;
  }
  const opened = previous?.workUnitKey !== next.workUnitKey;
  if (opened) facts.push({
    type: "WorkUnitOpened", sessionKey: next.sessionKey, workUnitKey: next.workUnitKey,
    mode: next.mode, owner: next.owner, learningValue: next.learningValue, capability: next.capability,
  });
  if (next.status !== (opened ? "proposed" : previous?.status)) facts.push({
    type: "WorkUnitStatusRecorded", sessionKey: next.sessionKey, workUnitKey: next.workUnitKey, status: next.status,
  });
  if (!same(opened ? null : previous?.assistance, next.assistance)) {
    if (next.assistance === null) return failProjection("INVALID_CANDIDATE");
    facts.push({
      type: "AssistanceRecorded", sessionKey: next.sessionKey, workUnitKey: next.workUnitKey,
      attempt: next.assistance.attempt, hypothesis: next.assistance.hypothesis,
      hintLevel: next.assistance.hintLevel, solutionRevealed: next.assistance.solutionRevealed,
    });
  }
  return facts;
};

const operationFacts = (previous: readonly OperationView[], next: readonly OperationView[]): DurableFact[] => {
  const facts: DurableFact[] = [];
  const earlier = new Map(previous.map(operation => [operation.operationKey, operation]));
  for (const operation of next) {
    const before = earlier.get(operation.operationKey);
    if (before === undefined) {
      const { status } = operation;
      if (status !== "planned" && status !== "authorized" && status !== "started") return failProjection("INVALID_CANDIDATE");
      facts.push({
        type: "OperationOpened", sessionKey: operation.sessionKey, workUnitKey: operation.workUnitKey,
        operationKey: operation.operationKey, kind: operation.kind, status,
      });
    } else if (before.status !== operation.status) {
      const { status } = operation;
      if (status === "planned" || status === "authorized" || status === "started") return failProjection("INVALID_CANDIDATE");
      facts.push({ type: "OperationOutcomeRecorded", sessionKey: operation.sessionKey, operationKey: operation.operationKey, status });
    }
    earlier.delete(operation.operationKey);
  }
  if (earlier.size > 0) return failProjection("INVALID_CANDIDATE");
  return facts;
};

export const projectionFacts = (previous: ProjectionView, next: ProjectionView): readonly DurableFact[] => {
  const facts: DurableFact[] = [];
  const opened = next.session !== null && next.session.sessionKey !== previous.session?.sessionKey;
  if (opened && next.session !== null) facts.push({ type: "SessionOpened", sessionKey: next.session.sessionKey });
  if (previous.presence !== next.presence) {
    if (next.presence === "off") return failProjection("INVALID_CANDIDATE");
    facts.push({ type: "PresenceRecorded", status: next.presence });
  }
  const session = next.session;
  if (session === null) {
    if (previous.session !== null) return failProjection("INVALID_CANDIDATE");
    return facts;
  }
  const before = opened ? null : previous.session;
  if (session.status !== (before?.status ?? "briefing")) facts.push({
    type: "SessionStatusRecorded", sessionKey: session.sessionKey, status: session.status,
  });
  if (session.mode !== (before?.mode ?? null)) {
    if (session.mode === null) return failProjection("INVALID_CANDIDATE");
    facts.push({ type: "ModeRecorded", sessionKey: session.sessionKey, mode: session.mode });
  }
  if (!same(session.learningBoundary, before?.learningBoundary ?? null)) {
    if (session.learningBoundary === null) return failProjection("INVALID_CANDIDATE");
    facts.push({
      type: "LearningBoundaryRecorded", sessionKey: session.sessionKey,
      humanOwnedCapabilities: session.learningBoundary.humanOwnedCapabilities,
      maximumHintLevel: session.learningBoundary.maximumHintLevel,
    });
  }
  facts.push(...unitFacts(before?.workUnit ?? null, session.workUnit));
  facts.push(...operationFacts(before?.operations ?? [], session.operations));
  return Object.freeze(facts);
};
