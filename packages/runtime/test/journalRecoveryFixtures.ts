import type { EntrySnapshot, OperationRecord, PairEvent, PairJournal, PairJournalCommit } from "@adaptive-pair/protocol";

type EventEnvelope = Pick<PairEvent, "protocolVersion" | "eventId" | "commandId" | "actor" | "revision" | "recordedAt">;
type EventPayload = {
  [EventType in PairEvent["type"]]: Omit<Extract<PairEvent, { type: EventType }>, keyof EventEnvelope>;
}[PairEvent["type"]];

export const journalEvent = (
  revision: number,
  payload: EventPayload,
  envelope: Partial<Omit<EventEnvelope, "protocolVersion" | "revision">> = {},
): PairEvent => ({
  protocolVersion: 1,
  eventId: `event-${revision}`,
  commandId: `command-${revision}`,
  actor: "human",
  revision,
  recordedAt: revision + 10,
  ...payload,
  ...envelope,
});

export const journalText = (
  commits: readonly PairJournalCommit[],
  overrides: Partial<Omit<PairJournal, "commits">> = {},
): string => JSON.stringify({
  formatVersion: 1,
  streamId: "stream-1",
  initialWorkspaceId: "workspace-1",
  headRevision: commits.reduce((count, commit) => count + commit.events.length, 0),
  commits,
  ...overrides,
});

export const historyText = (events: readonly PairEvent[]): string =>
  journalText(events.length === 0 ? [] : [{ expectedRevision: 0, events }]);

export const enabledEvents = (offset = 0, workspaceId = "workspace-1"): PairEvent[] => [
  journalEvent(offset + 1, { type: "PresenceEnabled", workspaceId }),
  journalEvent(offset + 2, { type: "WorkspaceObserved" }, { actor: "host" }),
];

export const enabledJournalText = (): string => historyText(enabledEvents());

export const journalEntry = (workspaceId = "workspace-1"): EntrySnapshot => ({
  workspaceId,
  dirtyPaths: [],
  openPaths: ["src/example.ts"],
  diagnostics: [],
  protectedPaths: [],
  capturedAt: 10,
});

export const briefingEvents = (offset = 0, workspaceId = "workspace-1"): PairEvent[] => [
  ...enabledEvents(offset, workspaceId),
  journalEvent(offset + 3, { type: "SessionStarted", sessionId: "session-1" }),
];

export const readyEvents = (offset = 0, workspaceId = "workspace-1"): PairEvent[] => [
  ...briefingEvents(offset, workspaceId),
  journalEvent(offset + 4, { type: "EntryCaptured", entry: journalEntry(workspaceId) }),
  journalEvent(offset + 5, {
    type: "LearningConfirmed",
    agreement: {
      learningGoals: ["Understand journal inspection"],
      familiarAreas: [],
      humanOwnedCapabilities: ["implementation"],
      delegatableWork: [],
      maximumHintLevel: 2,
      independentCheck: "Explain the result without assistance",
    },
  }),
  journalEvent(offset + 6, { type: "ModeSelected", mode: "growth" }),
  journalEvent(offset + 7, {
    type: "WorkUnitProposed",
    workUnit: {
      id: "unit-1",
      objective: "Inspect a complete journal",
      mode: "growth",
      learningValue: "high",
      capability: "implementation",
      owner: "human",
      allowedPaths: ["src/example.ts"],
      acceptanceChecks: ["npm test"],
      verificationPlan: "npm test",
      stoppingCondition: "The bounded inspection passes",
      baseline: {},
      status: "proposed",
    },
  }),
  journalEvent(offset + 8, { type: "WorkUnitAgreed", workUnitId: "unit-1" }),
];

export const authorizedEvent = (
  revision: number,
  overrides: Partial<OperationRecord> = {},
): PairEvent => journalEvent(revision, {
  type: "OperationAuthorized",
  operation: {
    id: "operation-1",
    workUnitId: "unit-1",
    toolName: "pair_check",
    kind: "check",
    input: { command: "npm test" },
    runtimeRevision: revision,
    authorityEpoch: 0,
    status: "authorized",
    summary: undefined,
    userActionGrantId: undefined,
    ...overrides,
  },
});

export const observedEvent = (
  revision: number,
  status: Extract<PairEvent, { type: "OperationObserved" }>["status"] = "confirmed",
  operationId = "operation-1",
): PairEvent => journalEvent(revision, {
  type: "OperationObserved", operationId, authorityEpoch: 0, status, summary: "Recorded result",
});

export const observationCommits = (sizes: readonly number[]): PairJournalCommit[] => {
  let revision = 1;
  const commits: PairJournalCommit[] = [{
    expectedRevision: 0,
    events: [journalEvent(1, { type: "PresenceEnabled", workspaceId: "workspace-1" })],
  }];
  for (const size of sizes) {
    const expectedRevision = revision;
    const events = Array.from({ length: size }, () => {
      revision += 1;
      return journalEvent(revision, { type: "WorkspaceObserved" }, { actor: "host" });
    });
    commits.push({ expectedRevision, events });
  }
  return commits;
};
