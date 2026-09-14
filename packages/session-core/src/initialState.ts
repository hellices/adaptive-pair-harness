import type {
  PairPresence,
  PairRuntimeSnapshot,
  PairSessionSnapshot,
} from "@adaptive-pair/protocol";

const freezeStrings = (values: readonly string[]): readonly string[] =>
  Object.freeze([...values]);

export const createPresence = (workspaceId: string): PairPresence =>
  Object.freeze({
    workspaceId,
    observationRevision: 0,
    status: "off",
    activeSessionId: undefined,
  });

export const createSession = (sessionId: string): PairSessionSnapshot =>
  Object.freeze({
    sessionId,
    authorityEpoch: 0,
    status: "inactive",
    mode: undefined,
    goal: undefined,
    criteria: freezeStrings([]),
    learningAgreement: undefined,
    entrySnapshot: undefined,
    workUnit: undefined,
    operations: Object.freeze([]),
  });

export const createRuntime = (workspaceId: string): PairRuntimeSnapshot =>
  Object.freeze({
    protocolVersion: 1,
    revision: 0,
    presence: createPresence(workspaceId),
    session: undefined,
  });
