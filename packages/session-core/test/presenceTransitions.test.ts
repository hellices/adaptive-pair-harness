import { describe, expect, it } from "vitest";
import type { Actor, PairCommand, PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { createRuntime, createSession, decide, reduce } from "../src/index.js";

const base = (snapshot: PairRuntimeSnapshot, actor: Actor = "human") => ({
  protocolVersion: 1 as const,
  commandId: `presence-${snapshot.revision}`,
  expectedRevision: snapshot.revision,
  actor,
  observedAt: 10,
});

const apply = (snapshot: PairRuntimeSnapshot, command: PairCommand): PairRuntimeSnapshot =>
  reduce(snapshot, decide(snapshot, command).events);

const enabled = (): PairRuntimeSnapshot => {
  const initial = createRuntime("placeholder");
  return apply(initial, {
    ...base(initial),
    type: "EnablePresence",
    workspaceId: "workspace-1",
  });
};

describe("authoritative presence transitions", () => {
  // Presence control and observation each guard one required actor, so one wrong actor covers the branch.
  it("rejects AI presence control", () => {
    const initial = createRuntime("workspace-1");
    expect(() => decide(initial, {
      ...base(initial, "ai"), type: "EnablePresence", workspaceId: "workspace-1",
    })).toThrow("HUMAN_ACTION_REQUIRED");
    expect(() => decide(initial, { ...base(initial, "ai"), type: "SetPresence", status: "quiet" }))
      .toThrow("HUMAN_ACTION_REQUIRED");
  });

  it("keeps Quiet enabled without an unnecessary resume or revision", () => {
    const initial = createRuntime("workspace-1");
    const quiet = apply(initial, { ...base(initial), type: "SetPresence", status: "quiet" });
    expect(quiet.presence.status).toBe("quiet");
    expect(decide(quiet, {
      ...base(quiet), type: "EnablePresence", workspaceId: "workspace-1",
    }).events).toEqual([]);
  });

  it("pauses an operational session through authority invalidation", () => {
    const current: PairRuntimeSnapshot = {
      ...enabled(),
      session: { ...createSession("session-1"), status: "active", authorityEpoch: 3 },
    };
    const decision = decide(current, { ...base(current), type: "SetPresence", status: "paused" });
    expect(decision.events.at(-1)?.type).toBe("SessionPaused");
    const paused = reduce(current, decision.events);
    expect(paused.session).toMatchObject({ status: "paused", authorityEpoch: 4 });
    expect(paused.presence.status).toBe("paused");
    for (const status of ["observing", "quiet"] as const) {
      expect(decide(paused, { ...base(paused), type: "SetPresence", status }).events).toEqual([]);
    }
    expect(decide(paused, {
      ...base(paused), type: "EnablePresence", workspaceId: "workspace-1",
    }).events).toEqual([]);
  });

  it("clears continuity on Disable without resetting the runtime revision", () => {
    const current: PairRuntimeSnapshot = {
      ...enabled(),
      revision: 20,
      presence: { ...enabled().presence, observationRevision: 5, activeSessionId: "session-1" },
      session: createSession("session-1"),
    };
    const disabled = apply(current, { ...base(current), type: "SetPresence", status: "off" });
    expect(disabled).toMatchObject({
      revision: 21,
      presence: { status: "off", observationRevision: 0, activeSessionId: undefined },
      session: undefined,
    });
    expect(decide(disabled, { ...base(disabled), type: "SetPresence", status: "off" }).events).toEqual([]);
  });

  it("increments observations only while presence is observing", () => {
    const current = enabled();
    const observed = apply(current, { ...base(current, "host"), type: "ObserveWorkspace" });
    expect(observed.revision).toBe(current.revision + 1);
    expect(observed.presence.observationRevision).toBe(1);
    for (const status of ["off", "paused"] as const) {
      const inactive = apply(observed, { ...base(observed), type: "SetPresence", status });
      expect(decide(inactive, { ...base(inactive, "host"), type: "ObserveWorkspace" }).events).toEqual([]);
    }
  });

  it("rejects AI workspace observations", () => {
    const current = createRuntime("workspace-1");
    expect(() => decide(current, { ...base(current, "ai"), type: "ObserveWorkspace" })).toThrow("HOST_ACTION_REQUIRED");
  });
});
