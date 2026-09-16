import { expect, it } from "vitest";
import { parsePairCommand } from "../src/index.js";
import {
  createAgreement,
  createEditOperation,
  createEntry,
  createWorkUnit,
} from "./commandFixtures.js";

it("parses a host workspace observation without exposing a model tool", () => {
  const command = {
    protocolVersion: 1,
    commandId: "observe-workspace",
    expectedRevision: 4,
    actor: "host",
    type: "ObserveWorkspace",
    observedAt: 100,
  };
  expect(parsePairCommand(command)).toEqual(command);
});

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
    entry: createEntry("feature/v2-growth-foundation"),
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
    commandId: "cmd-record-attempt",
    expectedRevision: 9,
    actor: "human",
    type: "RecordAttempt",
    workUnitId: "wu-1",
    summary: "Tried moving the guard but the test still failed.",
    bypassed: false,
    observedAt: 109,
  },
  {
    protocolVersion: 1,
    commandId: "cmd-record-hypothesis",
    expectedRevision: 10,
    actor: "human",
    type: "RecordHypothesis",
    workUnitId: "wu-1",
    summary: "The stale branch never updates retryCount.",
    bypassed: false,
    observedAt: 110,
  },
  {
    protocolVersion: 1,
    commandId: "cmd-request-hint",
    expectedRevision: 11,
    actor: "human",
    type: "RequestHint",
    workUnitId: "wu-1",
    level: 2,
    observedAt: 111,
  },
  {
    protocolVersion: 1,
    commandId: "cmd-authorize-solution-reveal",
    expectedRevision: 12,
    actor: "human",
    type: "AuthorizeSolutionReveal",
    workUnitId: "wu-1",
    previewOnly: true,
    observedAt: 112,
  },
  {
    protocolVersion: 1,
    commandId: "cmd-request-edit-operation",
    expectedRevision: 13,
    actor: "ai",
    type: "RequestEditOperation",
    ...createEditOperation(),
    observedAt: 113,
  },
  {
    protocolVersion: 1,
    commandId: "cmd-pause",
    expectedRevision: 14,
    actor: "human",
    type: "PauseSession",
    reason: "handoff",
    observedAt: 114,
  },
  {
    protocolVersion: 1,
    commandId: "cmd-resume",
    expectedRevision: 15,
    actor: "human",
    type: "ResumeSession",
    entry: createEntry("feature/v2-growth-foundation"),
    observedAt: 115,
  },
  {
    protocolVersion: 1,
    commandId: "cmd-close",
    expectedRevision: 16,
    actor: "policy",
    type: "CloseSession",
    observedAt: 116,
  },
  {
    protocolVersion: 1,
    commandId: "cmd-grant-user-action",
    expectedRevision: 17,
    actor: "human",
    type: "GrantUserAction",
    grantId: "grant-1",
    nativeToolName: "adaptive_pair_run_verification",
    observedAt: 117,
  },
  {
    protocolVersion: 1,
    commandId: "cmd-authorize-operation",
    expectedRevision: 18,
    actor: "ai",
    type: "AuthorizeOperation",
    operationId: "op-1",
    toolName: "pair_run_verification",
    kind: "check",
    input: {
      plan: "npm test -- packages/runtime/test/coordinator.test.ts",
    },
    userActionGrantId: "grant-1",
    observedAt: 118,
  },
  {
    protocolVersion: 1,
    commandId: "cmd-observe-operation",
    expectedRevision: 19,
    actor: "host",
    type: "ObserveOperationResult",
    operationId: "op-1",
    authorityEpoch: 0,
    status: "confirmed",
    summary: "Verification passed.",
    observation: {
      exitCode: 0,
    },
    observedAt: 119,
  },
])("accepts the %s command variant", command => {
  expect(parsePairCommand(command)).toMatchObject(command);
});

it("requires solution reveals to stay preview-only", () => {
  expect(() =>
    parsePairCommand({
      protocolVersion: 1,
      commandId: "cmd-invalid-reveal",
      expectedRevision: 0,
      actor: "human",
      type: "AuthorizeSolutionReveal",
      workUnitId: "wu-1",
      previewOnly: false,
      observedAt: 100,
    }),
  ).toThrow("Invalid Pair command");
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

it("rejects unknown fields on RequestEditOperation", () => {
  expect(() =>
    parsePairCommand({
      protocolVersion: 1,
      commandId: "cmd-edit-unknown",
      expectedRevision: 0,
      actor: "ai",
      type: "RequestEditOperation",
      ...createEditOperation(),
      unexpected: true,
      observedAt: 100,
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

it("accepts an entry snapshot with an omitted branch", () => {
  const parsed = parsePairCommand({
    protocolVersion: 1,
    commandId: "cmd-5",
    expectedRevision: 0,
    actor: "human",
    type: "CaptureEntry",
    entry: createEntry(),
    observedAt: 100,
  });

  expect(parsed).toMatchObject({
    type: "CaptureEntry",
    entry: {
      workspaceId: "workspace-1",
    },
  });

  if (parsed.type !== "CaptureEntry") {
    throw new Error("Expected CaptureEntry");
  }

  expect(parsed.entry).not.toHaveProperty("branch");
});

it("rejects a null branch in an entry snapshot", () => {
  expect(() =>
    parsePairCommand({
      protocolVersion: 1,
      commandId: "cmd-6",
      expectedRevision: 0,
      actor: "human",
      type: "CaptureEntry",
      entry: {
        ...createEntry("feature/v2-growth-foundation"),
        branch: null,
      },
      observedAt: 100,
    }),
  ).toThrow("Invalid Pair command");
});

it("rejects a non-string branch in an entry snapshot", () => {
  expect(() =>
    parsePairCommand({
      protocolVersion: 1,
      commandId: "cmd-7",
      expectedRevision: 0,
      actor: "human",
      type: "ResumeSession",
      entry: {
        ...createEntry("feature/v2-growth-foundation"),
        branch: 123,
      },
      observedAt: 100,
    }),
  ).toThrow("Invalid Pair command");
});
