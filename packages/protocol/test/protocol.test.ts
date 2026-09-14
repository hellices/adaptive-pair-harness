import { describe, expect, it } from "vitest";
import { parsePairCommand } from "../src/index.js";

const createEntry = () => ({
  workspaceId: "workspace-1",
  branch: "feature/v2-growth-foundation",
  dirtyPaths: ["packages/protocol/src/index.ts"],
  openPaths: ["packages/protocol/test/protocol.test.ts"],
  diagnostics: ["packages/protocol/src/index.ts:1:1 warning"],
  protectedPaths: [".env"],
  capturedAt: 200,
});

const createAgreement = () => ({
  learningGoals: ["Understand the protocol boundary"],
  familiarAreas: ["Task 1 toolchain"],
  humanOwnedCapabilities: ["problem-framing", "verification"] as const,
  delegatableWork: ["schema implementation"],
  maximumHintLevel: 2 as const,
  independentCheck: "Run targeted protocol tests before commit",
});

const createWorkUnit = () => ({
  id: "wu-1",
  objective: "Define the durable protocol contract",
  mode: "growth" as const,
  learningValue: "high" as const,
  capability: "design" as const,
  owner: "human" as const,
  allowedPaths: ["packages/protocol/src"],
  acceptanceChecks: ["npx vitest run packages/protocol/test/protocol.test.ts"],
  verificationPlan: "Run protocol tests and typecheck",
  stoppingCondition: "All command variants parse successfully",
  baseline: {
    "packages/protocol/src/index.ts": "abc123",
  },
  status: "agreed" as const,
});

describe("parsePairCommand", () => {
  it.each([
    {
      protocolVersion: 1,
      commandId: "cmd-enable",
      expectedRevision: 0,
      actor: "human",
      type: "EnablePresence",
      workspaceId: "workspace-1",
      observedAt: 100,
    },
    {
      protocolVersion: 1,
      commandId: "cmd-set-presence",
      expectedRevision: 1,
      actor: "ai",
      type: "SetPresence",
      status: "observing",
      observedAt: 101,
    },
    {
      protocolVersion: 1,
      commandId: "cmd-start",
      expectedRevision: 2,
      actor: "host",
      type: "StartSession",
      sessionId: "session-1",
      observedAt: 102,
    },
    {
      protocolVersion: 1,
      commandId: "cmd-capture-entry",
      expectedRevision: 3,
      actor: "human",
      type: "CaptureEntry",
      entry: createEntry(),
      observedAt: 103,
    },
    {
      protocolVersion: 1,
      commandId: "cmd-confirm-brief",
      expectedRevision: 4,
      actor: "human",
      type: "ConfirmBrief",
      goal: "Ship the Task 2 protocol surface",
      criteria: ["Ajv validation", "deep freeze"],
      observedAt: 104,
    },
    {
      protocolVersion: 1,
      commandId: "cmd-confirm-learning",
      expectedRevision: 5,
      actor: "human",
      type: "ConfirmLearning",
      agreement: createAgreement(),
      observedAt: 105,
    },
    {
      protocolVersion: 1,
      commandId: "cmd-select-mode",
      expectedRevision: 6,
      actor: "policy",
      type: "SelectMode",
      mode: "growth",
      observedAt: 106,
    },
    {
      protocolVersion: 1,
      commandId: "cmd-propose-work-unit",
      expectedRevision: 7,
      actor: "human",
      type: "ProposeWorkUnit",
      workUnit: createWorkUnit(),
      observedAt: 107,
    },
    {
      protocolVersion: 1,
      commandId: "cmd-agree-work-unit",
      expectedRevision: 8,
      actor: "ai",
      type: "AgreeWorkUnit",
      workUnitId: "wu-1",
      observedAt: 108,
    },
    {
      protocolVersion: 1,
      commandId: "cmd-pause",
      expectedRevision: 9,
      actor: "human",
      type: "PauseSession",
      reason: "handoff",
      observedAt: 109,
    },
    {
      protocolVersion: 1,
      commandId: "cmd-resume",
      expectedRevision: 10,
      actor: "human",
      type: "ResumeSession",
      entry: createEntry(),
      observedAt: 110,
    },
    {
      protocolVersion: 1,
      commandId: "cmd-close",
      expectedRevision: 11,
      actor: "policy",
      type: "CloseSession",
      observedAt: 111,
    },
  ])("accepts the %s command variant", command => {
    expect(parsePairCommand(command)).toMatchObject(command);
  });

  it("accepts a versioned enable-presence command", () => {
    expect(
      parsePairCommand({
        protocolVersion: 1,
        commandId: "cmd-1",
        expectedRevision: 0,
        actor: "human",
        type: "EnablePresence",
        workspaceId: "workspace-1",
        observedAt: 100,
      }),
    ).toMatchObject({ type: "EnablePresence", workspaceId: "workspace-1" });
  });

  it("rejects unknown fields", () => {
    expect(() =>
      parsePairCommand({
        protocolVersion: 1,
        commandId: "cmd-1",
        expectedRevision: 0,
        actor: "human",
        type: "EnablePresence",
        workspaceId: "workspace-1",
        observedAt: 100,
        permission: "write",
      }),
    ).toThrow("Invalid Pair command");
  });

  it("rejects nested unknown fields at every object boundary", () => {
    expect(() =>
      parsePairCommand({
        protocolVersion: 1,
        commandId: "cmd-2",
        expectedRevision: 0,
        actor: "human",
        type: "CaptureEntry",
        entry: {
          ...createEntry(),
          unexpected: true,
        },
        observedAt: 100,
      }),
    ).toThrow("Invalid Pair command");
  });

  it("rejects unsupported presence states for SetPresence", () => {
    expect(() =>
      parsePairCommand({
        protocolVersion: 1,
        commandId: "cmd-3",
        expectedRevision: 0,
        actor: "human",
        type: "SetPresence",
        status: "engaged",
        observedAt: 100,
      }),
    ).toThrow("Invalid Pair command");
  });

  it("returns a deep-frozen clone of accepted commands", () => {
    const workUnit = createWorkUnit();
    const input = {
      protocolVersion: 1,
      commandId: "cmd-4",
      expectedRevision: 0,
      actor: "human",
      type: "ProposeWorkUnit",
      workUnit: {
        ...workUnit,
        allowedPaths: [...workUnit.allowedPaths],
        acceptanceChecks: [...workUnit.acceptanceChecks],
        baseline: { ...workUnit.baseline } as Record<string, string>,
      },
      observedAt: 100,
    };

    const parsed = parsePairCommand(input);

    expect(parsed).not.toBe(input);
    expect(parsed).toEqual(input);
    expect(Object.isFrozen(parsed)).toBe(true);

    if (parsed.type !== "ProposeWorkUnit") {
      throw new Error("Expected ProposeWorkUnit");
    }

    expect(Object.isFrozen(parsed.workUnit)).toBe(true);
    expect(Object.isFrozen(parsed.workUnit.allowedPaths)).toBe(true);
    expect(Object.isFrozen(parsed.workUnit.acceptanceChecks)).toBe(true);
    expect(Object.isFrozen(parsed.workUnit.baseline)).toBe(true);

    input.workUnit.allowedPaths.push("packages/protocol/test");
    input.workUnit.baseline["packages/protocol/src/types.ts"] = "def456";

    expect(parsed.workUnit.allowedPaths).toEqual(["packages/protocol/src"]);
    expect(parsed.workUnit.baseline).toEqual({
      "packages/protocol/src/index.ts": "abc123",
    });
  });

  it("accepts an entry snapshot with an undefined branch", () => {
    expect(
      parsePairCommand({
        protocolVersion: 1,
        commandId: "cmd-5",
        expectedRevision: 0,
        actor: "human",
        type: "CaptureEntry",
        entry: {
          ...createEntry(),
          branch: undefined,
        },
        observedAt: 100,
      }),
    ).toMatchObject({
      type: "CaptureEntry",
      entry: {
        branch: undefined,
      },
    });
  });
});
