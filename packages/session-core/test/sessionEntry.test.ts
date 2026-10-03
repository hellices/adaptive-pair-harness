import { expect, it } from "vitest";
import { createRuntime, decide, reduce } from "../src/index.js";
import {
  command,
  createEntrySnapshot,
  createSessionRuntime,
  createWorkUnit,
  event,
  expectDecisionAndReplayRejection,
  growthSetupEvents,
} from "./sessionCoreFixtures.js";

it("captures entry snapshots only during briefing and preserves protections", () => {
  const briefing = reduce(createRuntime("workspace-1"), growthSetupEvents().slice(0, 1));
  const capturedEntry = {
    workspaceId: "workspace-1",
    dirtyPaths: ["src/a.ts"],
    openPaths: ["src/a.ts"],
    diagnostics: ["diag-1", "diag-2"],
    protectedPaths: ["docs/notes.md", "src/a.ts"],
    capturedAt: 11,
  };

  const firstDecision = decide(briefing, command("CaptureEntry", 1, {
    entry: createEntrySnapshot({
      dirtyPaths: ["src/a.ts", "src/a.ts"],
      openPaths: ["src/a.ts"],
      protectedPaths: ["docs/notes.md"],
      diagnostics: ["diag-1", "diag-1", "diag-2"],
      capturedAt: 11,
    }),
  }));
  expect(firstDecision.events).toEqual([event("EntryCaptured", 2, { entry: capturedEntry })]);

  const captured = reduce(briefing, firstDecision.events);
  const second = reduce(captured, [event("EntryCaptured", 3, {
    entry: createEntrySnapshot({
      dirtyPaths: ["src/b.ts"],
      openPaths: ["src/b.ts", "src/flow.ts"],
      protectedPaths: ["README.md"],
      capturedAt: 12,
    }),
  })]);

  expect(captured.session?.status).toBe("briefing");
  expect(captured.session?.entrySnapshot).toEqual(capturedEntry);
  expect(second.session?.entrySnapshot?.protectedPaths).toEqual([
    "README.md",
    "docs/notes.md",
    "src/a.ts",
    "src/b.ts",
  ]);
});

it("rejects entry capture outside briefing in decisions and direct events", () => {
  const invalidStates = [
    createRuntime("workspace-1"),
    createSessionRuntime(),
    createSessionRuntime({ status: "paused" }, { status: "paused" }),
  ];

  for (const runtime of invalidStates) {
    expectDecisionAndReplayRejection(
      runtime,
      command("CaptureEntry", runtime.revision, { entry: createEntrySnapshot() }),
      event("EntryCaptured", runtime.revision + 1, { entry: createEntrySnapshot() }),
      "SESSION_NOT_BRIEFING",
    );
  }
});

it("resumes paused sessions into reconciling without lowering authority", () => {
  const runtime = createSessionRuntime({
    authorityEpoch: 3,
    status: "paused",
    entrySnapshot: createEntrySnapshot({
      dirtyPaths: ["src/dirty.ts"],
      openPaths: ["src/dirty.ts"],
      protectedPaths: ["docs/notes.md"],
      capturedAt: 9,
    }),
    workUnit: createWorkUnit(),
  }, { status: "paused" });
  const resumedEntry = {
    workspaceId: "workspace-1",
    branch: "feature/task-4",
    dirtyPaths: ["src/current.ts"],
    openPaths: ["src/current.ts", "src/helper.ts"],
    diagnostics: ["src/current.ts:1:1 warning"],
    protectedPaths: ["README.md", "docs/notes.md", "src/current.ts", "src/dirty.ts"],
    capturedAt: 20,
  };

  const decision = decide(runtime, command("ResumeSession", 0, {
    entry: createEntrySnapshot({
      branch: "feature/task-4",
      dirtyPaths: ["src/current.ts"],
      openPaths: ["src/current.ts", "src/helper.ts"],
      protectedPaths: ["README.md"],
      capturedAt: 20,
    }),
  }, { at: 20 }));
  expect(decision.events).toEqual([event("SessionResumed", 1, { entry: resumedEntry }, { at: 20 })]);

  const resumed = reduce(runtime, decision.events);
  expect(resumed.session).toMatchObject({
    sessionId: "session-1",
    authorityEpoch: 3,
    status: "reconciling",
    workUnit: { ...createWorkUnit(), status: "needs-reconcile" },
    entrySnapshot: resumedEntry,
  });
  expect(resumed.presence.status).toBe("engaged");
  expect(resumed.presence.activeSessionId).toBe("session-1");
});

it("rejects resuming sessions that are not paused in decisions and direct events", () => {
  const invalidStates = [
    createRuntime("workspace-1"),
    createSessionRuntime({ status: "briefing" }),
    createSessionRuntime({ status: "reconciling" }),
  ];

  for (const runtime of invalidStates) {
    expectDecisionAndReplayRejection(
      runtime,
      command("ResumeSession", runtime.revision, { entry: createEntrySnapshot() }),
      event("SessionResumed", runtime.revision + 1, { entry: createEntrySnapshot() }),
      "SESSION_NOT_PAUSED",
    );
  }
});

it("blocks work-unit agreement while reconciling", () => {
  expectDecisionAndReplayRejection(
    createSessionRuntime({ status: "reconciling", workUnit: { ...createWorkUnit(), status: "needs-reconcile" } }),
    command("AgreeWorkUnit", 0, { workUnitId: "wu-1" }),
    event("WorkUnitAgreed", 1, { workUnitId: "wu-1" }),
    "SESSION_RECONCILING",
  );
});
