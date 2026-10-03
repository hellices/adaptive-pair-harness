import type {
  Actor,
  EntrySnapshot,
  PairCommand,
  PairEvent,
  PairPresence,
  PairRuntimeSnapshot,
  PairSessionSnapshot,
} from "@adaptive-pair/protocol";
import { expect } from "vitest";
import { createRuntime, createSession, decide, reduce } from "../src/index.js";

type CommandOf<Type extends PairCommand["type"]> = Extract<PairCommand, { type: Type }>;
type EventOf<Type extends PairEvent["type"]> = Extract<PairEvent, { type: Type }>;
type CommandFields<Type extends PairCommand["type"]> = Omit<
  CommandOf<Type>, "protocolVersion" | "commandId" | "expectedRevision" | "actor" | "type" | "observedAt"
>;
type EventFields<Type extends PairEvent["type"]> = Omit<
  EventOf<Type>, "protocolVersion" | "eventId" | "commandId" | "actor" | "revision" | "recordedAt" | "type"
>;
interface Envelope { readonly commandId?: string; readonly actor?: Actor; readonly at?: number }

// Fixture time follows the revision a command produces: revision N is recorded at N + 9.
const command = <Type extends PairCommand["type"]>(
  type: Type,
  expectedRevision: number,
  fields: CommandFields<Type>,
  { commandId = "cmd", actor = "human", at = expectedRevision + 10 }: Envelope = {},
): CommandOf<Type> => ({
  protocolVersion: 1, commandId, expectedRevision, actor, type, observedAt: at, ...fields,
}) as unknown as CommandOf<Type>;

const event = <Type extends PairEvent["type"]>(
  type: Type,
  revision: number,
  fields: EventFields<Type>,
  { commandId = "cmd", actor = "human", at = revision + 9 }: Envelope = {},
): EventOf<Type> => ({
  protocolVersion: 1, eventId: `${commandId}:0`, commandId, actor, revision, recordedAt: at, type, ...fields,
}) as unknown as EventOf<Type>;

const expectDecisionAndReplayRejection = (
  runtime: PairRuntimeSnapshot,
  rejected: PairCommand,
  replayed: PairEvent,
  code: string,
): void => {
  expect(() => decide(runtime, rejected)).toThrow(code);
  expect(() => reduce(runtime, [replayed])).toThrow(code);
};

const createSessionRuntime = (
  session: Partial<PairSessionSnapshot> = {},
  presence: Partial<PairPresence> = {},
): PairRuntimeSnapshot => ({
  ...createRuntime("workspace-1"),
  presence: {
    ...createRuntime("workspace-1").presence,
    status: "engaged",
    activeSessionId: "session-1",
    ...presence,
  },
  session: { ...createSession("session-1"), status: "active", ...session },
});

const createActiveRuntime = (): PairRuntimeSnapshot => createSessionRuntime();

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

const growthSetupEvents = (agreement = createGrowthAgreement()): PairEvent[] => [
  event("SessionStarted", 1, { sessionId: "session-1" }),
  event("EntryCaptured", 2, { entry: createEntrySnapshot() }),
  event("LearningConfirmed", 3, { agreement }),
  event("ModeSelected", 4, { mode: "growth" }),
  event("WorkUnitProposed", 5, { workUnit: createGrowthWorkUnit() }),
  event("WorkUnitAgreed", 6, { workUnitId: "growth-wu-1" }),
];

const createGrowthRuntime = (agreement = createGrowthAgreement()): PairRuntimeSnapshot =>
  reduce(createRuntime("workspace-1"), growthSetupEvents(agreement));

export {
  command,
  createActiveRuntime,
  createEditOperationRequest,
  createEntrySnapshot,
  createGrowthAgreement,
  createGrowthRuntime,
  createGrowthWorkUnit,
  createSessionRuntime,
  createWorkUnit,
  event,
  expectDecisionAndReplayRejection,
  growthSetupEvents,
};
