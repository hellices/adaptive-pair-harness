import type { EntrySnapshot, PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { createRuntime, createSession, reduce } from "../src/index.js";

const createActiveRuntime = (): PairRuntimeSnapshot => ({
  ...createRuntime("workspace-1"),
  presence: {
    ...createRuntime("workspace-1").presence,
    status: "engaged",
    activeSessionId: "session-1",
  },
  session: {
    ...createSession("session-1"),
    status: "active",
  },
});

const createEntrySnapshot = (
  overrides: Partial<EntrySnapshot> = {},
): EntrySnapshot => ({
  workspaceId: "workspace-1",
  dirtyPaths: ["src/current.ts"],
  openPaths: ["src/current.ts"],
  diagnostics: ["src/current.ts:1:1 warning"],
  protectedPaths: ["README.md"],
  capturedAt: 12,
  ...overrides,
});

const createWorkUnit = () => ({
  id: "wu-1",
  objective: "Reconcile paused work",
  mode: "pair" as const,
  learningValue: "mixed" as const,
  capability: "implementation" as const,
  owner: "ai" as const,
  allowedPaths: ["src"],
  acceptanceChecks: ["npm test"],
  verificationPlan: "Run focused tests",
  stoppingCondition: "Work is reconciled",
  baseline: { "src/current.ts": "abc123" },
  status: "agreed" as const,
});

const createGrowthAgreement = (
  overrides: Partial<{
    learningGoals: readonly string[];
    familiarAreas: readonly string[];
    humanOwnedCapabilities: readonly ("implementation" | "verification")[];
    delegatableWork: readonly string[];
    maximumHintLevel: 0 | 1 | 2 | 3 | 4 | 5;
    independentCheck: string;
  }> = {},
) => ({
  learningGoals: ["Practice retry-state debugging"],
  familiarAreas: ["test harness"],
  humanOwnedCapabilities: ["implementation", "verification"] as const,
  delegatableWork: ["search for related tests"],
  maximumHintLevel: 2 as const,
  independentCheck: "Solve one similar retry bug without AI edits",
  ...overrides,
});

const createGrowthWorkUnit = () => ({
  id: "growth-wu-1",
  objective: "Repair the retry guard",
  mode: "growth" as const,
  learningValue: "high" as const,
  capability: "implementation" as const,
  owner: "human" as const,
  allowedPaths: ["src/current.ts"],
  acceptanceChecks: ["npm test -- retry"],
  verificationPlan: "Run the retry suite",
  stoppingCondition: "one retry behavior is green",
  baseline: { "src/current.ts": "abc123" },
  status: "proposed" as const,
});

const createEditOperationRequest = (
  overrides: Partial<{
    commandId: string;
    expectedRevision: number;
    actor: "human" | "ai";
    workUnitId: string;
    operationId: string;
    targetPath: string;
    description: string;
    observedAt: number;
  }> = {},
) => ({
  protocolVersion: 1 as const,
  commandId: "cmd-edit-operation",
  expectedRevision: 0,
  actor: "ai" as const,
  type: "RequestEditOperation" as const,
  workUnitId: "growth-wu-1",
  operationId: "op-1",
  targetPath: "src/current.ts",
  description: "Apply the agreed retry-guard edit",
  observedAt: 16,
  ...overrides,
});

const createGrowthRuntime = (
  agreement = createGrowthAgreement(),
): PairRuntimeSnapshot =>
  reduce(createRuntime("workspace-1"), [
    {
      protocolVersion: 1,
      eventId: "cmd-start:0",
      commandId: "cmd-start",
      actor: "human",
      revision: 1,
      recordedAt: 10,
      type: "SessionStarted",
      sessionId: "session-1",
    },
    {
      protocolVersion: 1,
      eventId: "cmd-entry:0",
      commandId: "cmd-entry",
      actor: "human",
      revision: 2,
      recordedAt: 11,
      type: "EntryCaptured",
      entry: createEntrySnapshot(),
    },
    {
      protocolVersion: 1,
      eventId: "cmd-learning:0",
      commandId: "cmd-learning",
      actor: "human",
      revision: 3,
      recordedAt: 12,
      type: "LearningConfirmed",
      agreement,
    },
    {
      protocolVersion: 1,
      eventId: "cmd-mode:0",
      commandId: "cmd-mode",
      actor: "human",
      revision: 4,
      recordedAt: 13,
      type: "ModeSelected",
      mode: "growth",
    },
    {
      protocolVersion: 1,
      eventId: "cmd-propose:0",
      commandId: "cmd-propose",
      actor: "human",
      revision: 5,
      recordedAt: 14,
      type: "WorkUnitProposed",
      workUnit: createGrowthWorkUnit(),
    },
    {
      protocolVersion: 1,
      eventId: "cmd-agree:0",
      commandId: "cmd-agree",
      actor: "human",
      revision: 6,
      recordedAt: 15,
      type: "WorkUnitAgreed",
      workUnitId: "growth-wu-1",
    },
  ]);

export { createActiveRuntime,createEditOperationRequest,createEntrySnapshot,createGrowthAgreement,createGrowthRuntime,createGrowthWorkUnit,createWorkUnit };
