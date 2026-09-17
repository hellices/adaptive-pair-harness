import { describe, expect, it } from "vitest";
import { SessionController } from "./presenceTestHarness.js";

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
