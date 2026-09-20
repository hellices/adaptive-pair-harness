import { parseDurableJournal, type DurableCommit, type DurableFact, type DurableJournal } from "@adaptive-pair/protocol";

export const durableKey = (value: number): string => value.toString(16).padStart(32, "0");
export const namespaceKey = durableKey(1);
export const generationKey = durableKey(2);
export const sessionKey = durableKey(3);
export const workUnitKey = durableKey(4);
export const operationKey = durableKey(5);
export const durableExpectation = Object.freeze({ namespaceKey, generationKey, now: 150 });

export const durableCommit = (facts: readonly DurableFact[], expectedSequence = 0): DurableCommit => ({
  commitKey: durableKey(100 + expectedSequence), expectedSequence,
  commandKeys: [durableKey(2_000 + expectedSequence)], facts,
});

export const durableWire = (commits: readonly DurableCommit[] = []): DurableJournal => ({
  format: "adaptive-pair-durable", version: 1, namespaceKey, generationKey,
  createdAt: 100, expiresAt: 200,
  headSequence: commits.reduce((total, commit) => total + commit.facts.length, 0), commits,
});

export const emptyDurableText = (): string => JSON.stringify(durableWire());

export const durableHistory = (...batches: readonly (readonly DurableFact[])[]): DurableJournal => {
  let sequence = 0;
  const commits = batches.map(facts => {
    const commit = durableCommit(facts, sequence);
    sequence += facts.length;
    return commit;
  });
  return parseDurableJournal(JSON.stringify(durableWire(commits)));
};

export const workUnitOpened = (unitKey = workUnitKey, ownerSession = sessionKey): DurableFact => ({
  type: "WorkUnitOpened", sessionKey: ownerSession, workUnitKey: unitKey,
  mode: "growth", owner: "human", learningValue: "high", capability: "implementation",
});

export const operationOpened = (key = operationKey, ownerSession = sessionKey, unitKey = workUnitKey): DurableFact => ({
  type: "OperationOpened", sessionKey: ownerSession, workUnitKey: unitKey,
  operationKey: key, kind: "read", status: "started",
});

export const durableBaseFacts: readonly DurableFact[] = [
  { type: "PresenceRecorded", status: "observing" },
  { type: "SessionOpened", sessionKey },
  { type: "PresenceRecorded", status: "engaged" },
  {
    type: "LearningBoundaryRecorded", sessionKey,
    humanOwnedCapabilities: ["implementation", "verification"], maximumHintLevel: 3,
  },
  { type: "ModeRecorded", sessionKey, mode: "growth" },
  workUnitOpened(),
  { type: "WorkUnitStatusRecorded", sessionKey, workUnitKey, status: "agreed" },
  {
    type: "AssistanceRecorded", sessionKey, workUnitKey,
    attempt: "none", hypothesis: "none", hintLevel: null, solutionRevealed: false,
  },
  { type: "SessionStatusRecorded", sessionKey, status: "ready" },
  operationOpened(),
];
