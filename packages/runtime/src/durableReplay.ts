import type { DurableFact, DurableJournal, PresenceStatus } from "@adaptive-pair/protocol";
import type {
  DurableOperationState, DurableSessionState, DurableState, DurableWorkUnitState,
} from "./durableTypes.js";

type Mutable<Value> = { -readonly [Field in keyof Value]: Value[Field] };
type UnitDraft = Mutable<DurableWorkUnitState>;
type OperationDraft = Mutable<DurableOperationState>;
type SessionDraft = Omit<Mutable<DurableSessionState>, "workUnits" | "operations"> & {
  workUnits: UnitDraft[];
  operations: OperationDraft[];
};

interface ReplayContext {
  presence: PresenceStatus;
  latestSession: SessionDraft | undefined;
  readonly sessions: Map<string, SessionDraft>;
  readonly workUnits: Map<string, UnitDraft>;
  readonly operations: Map<string, OperationDraft>;
}

const fail = (code: string): never => {
  throw new Error(`Invalid Pair durable journal: ${code}`);
};

const requireSession = (context: ReplayContext, key: string): SessionDraft =>
  context.sessions.get(key) ?? fail("INVALID_FACT_SEQUENCE");

const requireUnit = (context: ReplayContext, sessionKey: string, workUnitKey: string): UnitDraft => {
  const unit = context.workUnits.get(workUnitKey);
  if (unit?.sessionKey !== sessionKey) return fail("INVALID_FACT_SEQUENCE");
  return unit;
};

const openSession = (context: ReplayContext, key: string, sequence: number): void => {
  if (context.sessions.has(key)) return fail("DUPLICATE_LIFETIME_KEY");
  if (context.latestSession !== undefined && context.latestSession.status !== "closed") {
    return fail("INVALID_FACT_SEQUENCE");
  }
  const session: SessionDraft = {
    sessionKey: key, openedSequence: sequence, status: "briefing", mode: null,
    learningBoundary: null, workUnits: [], operations: [],
  };
  context.sessions.set(key, session);
  context.latestSession = session;
};

const openUnit = (
  context: ReplayContext, session: SessionDraft, fact: Extract<DurableFact, { type: "WorkUnitOpened" }>,
): void => {
  if (context.workUnits.has(fact.workUnitKey)) return fail("DUPLICATE_LIFETIME_KEY");
  const unit: UnitDraft = {
    sessionKey: fact.sessionKey, workUnitKey: fact.workUnitKey,
    mode: fact.mode, owner: fact.owner, learningValue: fact.learningValue, capability: fact.capability,
    status: "proposed", assistance: null,
  };
  context.workUnits.set(unit.workUnitKey, unit);
  session.workUnits.push(unit);
};

const openOperation = (
  context: ReplayContext, session: SessionDraft,
  fact: Extract<DurableFact, { type: "OperationOpened" }>, sequence: number,
): void => {
  if (context.operations.has(fact.operationKey)) return fail("DUPLICATE_LIFETIME_KEY");
  requireUnit(context, fact.sessionKey, fact.workUnitKey);
  const operation: OperationDraft = {
    sessionKey: fact.sessionKey, workUnitKey: fact.workUnitKey, operationKey: fact.operationKey,
    kind: fact.kind, openedSequence: sequence, status: fact.status,
  };
  context.operations.set(operation.operationKey, operation);
  session.operations.push(operation);
};

const applyFact = (context: ReplayContext, fact: DurableFact, sequence: number): void => {
  if (fact.type === "PresenceRecorded") {
    context.presence = fact.status;
    return;
  }
  if (fact.type === "SessionOpened") return openSession(context, fact.sessionKey, sequence);
  const session = requireSession(context, fact.sessionKey);
  switch (fact.type) {
    case "SessionStatusRecorded":
      if (session.status === "closed" && fact.status !== "closed") return fail("INVALID_FACT_SEQUENCE");
      session.status = fact.status;
      return;
    case "LearningBoundaryRecorded":
      session.learningBoundary = Object.freeze({
        humanOwnedCapabilities: Object.freeze([...fact.humanOwnedCapabilities]), maximumHintLevel: fact.maximumHintLevel,
      });
      return;
    case "ModeRecorded":
      session.mode = fact.mode;
      return;
    case "WorkUnitOpened":
      return openUnit(context, session, fact);
    case "WorkUnitStatusRecorded":
      requireUnit(context, fact.sessionKey, fact.workUnitKey).status = fact.status;
      return;
    case "AssistanceRecorded":
      requireUnit(context, fact.sessionKey, fact.workUnitKey).assistance = Object.freeze({
        attempt: fact.attempt, hypothesis: fact.hypothesis, hintLevel: fact.hintLevel,
        solutionRevealed: fact.solutionRevealed,
      });
      return;
    case "OperationOpened":
      return openOperation(context, session, fact, sequence);
    case "OperationOutcomeRecorded": {
      const operation = context.operations.get(fact.operationKey);
      if (operation?.sessionKey !== fact.sessionKey ||
          (operation.status !== "planned" && operation.status !== "authorized" && operation.status !== "started")) {
        return fail("INVALID_FACT_SEQUENCE");
      }
      operation.status = fact.status;
    }
  }
};

const freezeUnit = (unit: UnitDraft): DurableWorkUnitState => Object.freeze({
  sessionKey: unit.sessionKey, workUnitKey: unit.workUnitKey, mode: unit.mode,
  owner: unit.owner, learningValue: unit.learningValue, capability: unit.capability,
  status: unit.status, assistance: unit.assistance,
});

const freezeOperation = (operation: OperationDraft): DurableOperationState => Object.freeze({
  sessionKey: operation.sessionKey, workUnitKey: operation.workUnitKey, operationKey: operation.operationKey,
  kind: operation.kind, openedSequence: operation.openedSequence, status: operation.status,
});

const freezeSession = (session: SessionDraft): DurableSessionState => Object.freeze({
  sessionKey: session.sessionKey, openedSequence: session.openedSequence, status: session.status,
  mode: session.mode, learningBoundary: session.learningBoundary,
  workUnits: Object.freeze(session.workUnits.map(freezeUnit)),
  operations: Object.freeze(session.operations.map(freezeOperation)),
});

export const replayDurableJournal = (journal: DurableJournal): DurableState => {
  const context: ReplayContext = {
    presence: "off", latestSession: undefined, sessions: new Map(), workUnits: new Map(), operations: new Map(),
  };
  const commitKeys = new Set<string>();
  const commandKeys = new Set<string>();
  let sequence = 0;
  for (const commit of journal.commits) {
    if (commit.expectedSequence !== sequence) return fail("NON_CONTIGUOUS_SEQUENCE");
    if (commitKeys.has(commit.commitKey)) return fail("DUPLICATE_COMMIT_KEY");
    commitKeys.add(commit.commitKey);
    for (const key of commit.commandKeys) {
      if (commandKeys.has(key)) return fail("DUPLICATE_COMMAND_KEY");
      commandKeys.add(key);
    }
    for (const fact of commit.facts) {
      sequence += 1;
      applyFact(context, fact, sequence);
    }
  }
  if (sequence !== journal.headSequence) return fail("HEAD_SEQUENCE_MISMATCH");
  return Object.freeze({
    headSequence: sequence, presence: context.presence,
    sessions: Object.freeze([...context.sessions.values()].map(freezeSession)),
  });
};
