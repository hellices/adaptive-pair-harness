export const durableKey = (value: number): string => value.toString(16).padStart(32, "0");

const sessionKey = durableKey(3);
const workUnitKey = durableKey(4);
const operationKey = durableKey(5);

export const durableFacts = [
  { type: "PresenceRecorded", status: "observing" },
  { type: "SessionOpened", sessionKey },
  { type: "SessionStatusRecorded", sessionKey, status: "active" },
  {
    type: "LearningBoundaryRecorded", sessionKey,
    humanOwnedCapabilities: ["implementation", "verification"], maximumHintLevel: 3,
  },
  { type: "ModeRecorded", sessionKey, mode: "growth" },
  {
    type: "WorkUnitOpened", sessionKey, workUnitKey, mode: "growth",
    owner: "human", learningValue: "high", capability: "implementation",
  },
  { type: "WorkUnitStatusRecorded", sessionKey, workUnitKey, status: "agreed" },
  {
    type: "AssistanceRecorded", sessionKey, workUnitKey,
    attempt: "recorded", hypothesis: "none", hintLevel: null, solutionRevealed: false,
  },
  {
    type: "OperationOpened", sessionKey, workUnitKey, operationKey,
    kind: "check", status: "authorized",
  },
  { type: "OperationOutcomeRecorded", sessionKey, operationKey, status: "unknown" },
] as const;

export const durableCommit = (facts: readonly unknown[] = [durableFacts[0]], sequence = 0) => ({
  commitKey: durableKey(100 + sequence),
  expectedSequence: sequence,
  commandKeys: [durableKey(2_000 + sequence)],
  facts,
});

export const durableWire = (commits: readonly ReturnType<typeof durableCommit>[] = []) => ({
  format: "adaptive-pair-durable",
  version: 1,
  namespaceKey: durableKey(1),
  generationKey: durableKey(2),
  createdAt: 100,
  expiresAt: 200,
  headSequence: commits.reduce((total, commit) => total + commit.facts.length, 0),
  commits,
});

export const durableText = (facts: readonly unknown[] = []): string =>
  JSON.stringify(durableWire(facts.length === 0 ? [] : [durableCommit(facts)]));
