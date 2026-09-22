import { describe, expect, it, vi } from "vitest";
import { SessionController, harness } from "./presenceTestHarness.js";
import { WorkspaceContext } from "../src/workspaceContext.js";

describe("SessionController — authoritative state transitions", () => {
  it("accepts only one concurrent command at the same revision", async () => {
    const controller = new SessionController();
    const coordinator = controller.coordinator();
    const command = {
      protocolVersion: 1 as const,
      expectedRevision: 0,
      actor: "human" as const,
      observedAt: 1,
      type: "StartSession" as const,
      commandId: "start-first",
      sessionId: "session-first",
    };

    const results = await Promise.allSettled([
      coordinator.dispatch(command),
      coordinator.dispatch({
        ...command,
        commandId: "start-second",
        sessionId: "session-second",
      }),
    ]);

    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results[1]).toMatchObject({
      status: "rejected",
      reason: new Error("STALE_REVISION"),
    });
    expect(controller.snapshotNow().session?.sessionId).toBe("session-first");
    expect(await coordinator.dispatch(command)).toEqual(controller.snapshotNow());
  });

  it("does not restore a session when a prior command settles after Disable", async () => {
    const controller = new SessionController();
    const enabled = await controller.enablePresence();
    const pending = controller.coordinator().dispatch({
      protocolVersion: 1,
      commandId: "pending-start",
      expectedRevision: enabled.revision,
      actor: "human",
      observedAt: 1,
      type: "StartSession",
      sessionId: "pending-session",
    });

    await Promise.all([pending, controller.disablePresence()]);

    expect(controller.snapshotNow().presence.status).toBe("off");
    expect(controller.snapshotNow().session).toBeUndefined();
    expect(controller.snapshotNow().revision).toBeGreaterThan(enabled.revision);
  });

  it("preserves observations queued alongside a session command", async () => {
    const controller = new SessionController();
    const enabled = await controller.enablePresence();
    const pending = controller.coordinator().dispatch({
      protocolVersion: 1,
      commandId: "pending-start",
      expectedRevision: enabled.revision,
      actor: "human",
      observedAt: 1,
      type: "StartSession",
      sessionId: "pending-session",
    });

    await Promise.all([pending, controller.bumpObservationRevision()]);

    expect(controller.snapshotNow().session?.sessionId).toBe("pending-session");
    expect(controller.snapshotNow().presence.observationRevision).toBe(1);
    expect(controller.snapshotNow().revision).toBe(enabled.revision + 2);
  });

  it("ignores observations queued after Disable without resetting revisions", async () => {
    const controller = new SessionController();
    await controller.enablePresence();
    await controller.bumpObservationRevision();
    const before = controller.snapshotNow();

    await Promise.all([
      controller.disablePresence(),
      controller.bumpObservationRevision(),
    ]);

    expect(controller.snapshotNow().presence).toMatchObject({
      status: "off",
      observationRevision: 0,
    });
    expect(controller.snapshotNow().revision).toBeGreaterThan(before.revision);
  });
});

describe("SessionController — explicitly requested Growth entry", () => {
  const entry = {
    workspaceId: "file:///workspace", dirtyPaths: [],
    openPaths: ["src/retry.mjs"], diagnostics: [], protectedPaths: [], capturedAt: 100,
  };

  it("captures entry for a started session without selecting a mode or granting authority", async () => {
    const controller = new SessionController();
    await controller.startSession();
    vi.spyOn(WorkspaceContext.prototype, "capture").mockResolvedValue(entry);
    const result = await controller.prepareGrowthEntry(new AbortController().signal);
    expect(result.session).toMatchObject({
      status: "briefing", mode: undefined,
      entrySnapshot: { workspaceId: entry.workspaceId, openPaths: entry.openPaths, capturedAt: entry.capturedAt },
    });
    expect(result.session?.entrySnapshot?.branch).toBeUndefined();
    expect(result.session?.userActionGrants).toHaveLength(0);
  });

  it("refuses entry capture while disabled or untrusted", async () => {
    const controller = new SessionController();
    const capture = vi.spyOn(WorkspaceContext.prototype, "capture");
    await expect(controller.prepareGrowthEntry(new AbortController().signal)).rejects.toThrow();
    await controller.startSession();
    harness.state.workspaceTrusted = false;
    await expect(controller.prepareGrowthEntry(new AbortController().signal)).rejects.toThrow();
    expect(capture).not.toHaveBeenCalled();
  });

  it("combines user cancellation with the controller lifetime", async () => {
    const controller = new SessionController();
    await controller.startSession();
    const cancellation = new AbortController();
    vi.spyOn(WorkspaceContext.prototype, "capture").mockImplementation(signal => {
      cancellation.abort();
      expect(signal?.aborted).toBe(true);
      return Promise.resolve(entry);
    });
    await expect(controller.prepareGrowthEntry(cancellation.signal)).rejects.toThrow();
    expect(controller.snapshotNow().session?.entrySnapshot).toBeUndefined();
  });

  it("rejects a changed workspace after asynchronous capture", async () => {
    const controller = new SessionController();
    await controller.startSession();
    vi.spyOn(WorkspaceContext.prototype, "capture").mockImplementation(() => {
      harness.state.workspaceFolders = [{ uri: harness.createUri("/replacement") }];
      return Promise.resolve(entry);
    });
    await expect(controller.prepareGrowthEntry(new AbortController().signal)).rejects.toThrow();
    expect(controller.snapshotNow().session?.entrySnapshot).toBeUndefined();
  });
});
