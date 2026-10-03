import { expect, it } from "vitest";
import { parsePairCommand } from "../src/index.js";
import {
  createAgreement,
  createEditOperation,
  createEntry,
  createWorkUnit,
} from "./commandFixtures.js";

const command = (type: string, actor: string, fields: Record<string, unknown> = {}) => ({
  protocolVersion: 1, commandId: `cmd-${type}`, expectedRevision: 0, actor, type, observedAt: 100, ...fields,
});

it.each([
  command("ObserveWorkspace", "host"),
  command("EnablePresence", "human", { workspaceId: "workspace-1" }),
  command("SetPresence", "ai", { status: "observing" }),
  command("StartSession", "host", { sessionId: "session-1" }),
  command("CaptureEntry", "human", { entry: createEntry("feature/v2-growth-foundation") }),
  command("ConfirmBrief", "human", { goal: "Ship the protocol surface", criteria: ["Ajv validation"] }),
  command("ConfirmLearning", "human", { agreement: createAgreement() }),
  command("SelectMode", "policy", { mode: "growth" }),
  command("ProposeWorkUnit", "human", { workUnit: createWorkUnit() }),
  command("AgreeWorkUnit", "ai", { workUnitId: "wu-1" }),
  command("RecordAttempt", "human", { workUnitId: "wu-1", summary: "Moved the guard", bypassed: false }),
  command("RecordHypothesis", "human", { workUnitId: "wu-1", summary: "Stale retry count", bypassed: false }),
  command("RequestHint", "human", { workUnitId: "wu-1", level: 2 }),
  command("AuthorizeSolutionReveal", "human", { workUnitId: "wu-1", previewOnly: true }),
  command("RequestEditOperation", "ai", createEditOperation()),
  command("PauseSession", "human", { reason: "handoff" }),
  command("ResumeSession", "human", { entry: createEntry("feature/v2-growth-foundation") }),
  command("CloseSession", "policy"),
  command("GrantUserAction", "human", { grantId: "grant-1", nativeToolName: "adaptive_pair_run_verification" }),
  command("AuthorizeOperation", "ai", {
    operationId: "op-1", toolName: "pair_run_verification", kind: "check",
    input: { plan: "npm test" }, userActionGrantId: "grant-1",
  }),
  command("ObserveOperationResult", "host", {
    operationId: "op-1", authorityEpoch: 0, status: "confirmed", summary: "Verification passed.",
    observation: { exitCode: 0 },
  }),
])("accepts the $type command variant", input => {
  expect(parsePairCommand(input)).toStrictEqual(input);
});

it("requires solution reveals to stay preview-only", () => {
  expect(() => parsePairCommand(command("AuthorizeSolutionReveal", "human", { workUnitId: "wu-1", previewOnly: false })))
    .toThrow("Invalid Pair command");
});

it("rejects unknown fields", () => {
  expect(() => parsePairCommand(command("EnablePresence", "human", { workspaceId: "workspace-1", permission: "write" })))
    .toThrow("Invalid Pair command");
});

it("rejects nested unknown fields at every object boundary", () => {
  expect(() => parsePairCommand(command("CaptureEntry", "human", { entry: { ...createEntry(), unexpected: true } })))
    .toThrow("Invalid Pair command");
});

it("rejects unsupported presence states for SetPresence", () => {
  expect(() => parsePairCommand(command("SetPresence", "human", { status: "engaged" })))
    .toThrow("Invalid Pair command");
});

it("accepts an entry snapshot with an omitted branch", () => {
  const parsed = parsePairCommand(command("CaptureEntry", "human", { entry: createEntry() }));
  if (parsed.type !== "CaptureEntry") throw new Error("Expected CaptureEntry");
  expect(parsed.entry).toMatchObject({ workspaceId: "workspace-1" });
  expect(parsed.entry).not.toHaveProperty("branch");
});
