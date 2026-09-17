import type { Actor, PairCommand, PairEvent, PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { expect, it } from "vitest";
import { createRuntime, decide, reduce } from "../src/index.js";
import { createGrowthRuntime } from "./sessionCoreFixtures.js";

const base = (snapshot: PairRuntimeSnapshot, actor: Actor = "human") => ({
  protocolVersion: 1 as const,
  commandId: `workspace-boundary-${snapshot.revision}`,
  expectedRevision: snapshot.revision,
  actor,
  observedAt: 20,
});

const apply = (snapshot: PairRuntimeSnapshot, command: PairCommand): PairRuntimeSnapshot =>
  reduce(snapshot, decide(snapshot, command).events);

const authoritySnapshot = (): PairRuntimeSnapshot => {
  let current = createGrowthRuntime();
  current = apply(current, { ...base(current, "host"), type: "ObserveWorkspace" });
  current = apply(current, {
    ...base(current), type: "RecordAttempt", workUnitId: "growth-wu-1",
    summary: "An attempt in the original workspace.", bypassed: false,
  });
  current = apply(current, {
    ...base(current, "ai"), type: "AuthorizeOperation", operationId: "old-operation",
    toolName: "pair_read_scope", kind: "read", input: { path: "src/current.ts" },
  });
  return apply(current, {
    ...base(current), type: "GrantUserAction", grantId: "old-grant",
    nativeToolName: "adaptive_pair_run_verification",
  });
};

const enabledEvent = (snapshot: PairRuntimeSnapshot, workspaceId: string): PairEvent => ({
  protocolVersion: 1, eventId: "replayed-enable:0", commandId: "replayed-enable",
  actor: "human", recordedAt: 20, revision: snapshot.revision + 1,
  type: "PresenceEnabled", workspaceId,
});

it("makes direct workspace rebinding a traceable disable-and-enable decision", () => {
  const current = authoritySnapshot();
  const before = reduce(current, []);
  const command: PairCommand = {
    ...base(current), type: "EnablePresence", workspaceId: "workspace-2",
  };
  const decision = decide(current, command);

  expect(decision.events).toEqual([
    {
      protocolVersion: 1, eventId: `${command.commandId}:0`, commandId: command.commandId,
      actor: "human", recordedAt: 20, revision: current.revision + 1,
      type: "PresenceChanged", status: "off",
    },
    {
      protocolVersion: 1, eventId: `${command.commandId}:1`, commandId: command.commandId,
      actor: "human", recordedAt: 20, revision: current.revision + 2,
      type: "PresenceEnabled", workspaceId: "workspace-2",
    },
  ]);
  const next = reduce(current, decision.events);
  expect(next).toEqual({
    ...createRuntime("workspace-2"), revision: current.revision + 2,
    presence: { ...createRuntime("workspace-2").presence, status: "observing" },
  });
  expect(current).toEqual(before);
  expect(() => decide(next, {
    ...base(next, "ai"), type: "AuthorizeOperation", operationId: "new-operation",
    toolName: "pair_run_verification", kind: "check", input: { plan: "npm test" },
    userActionGrantId: "old-grant",
  })).toThrow("SESSION_NOT_STARTED");
  expect(() => decide(next, {
    ...base(next, "host"), type: "ObserveOperationResult", operationId: "old-operation",
    authorityEpoch: current.session?.authorityEpoch ?? 0, status: "confirmed", summary: "Too late.",
  })).toThrow("SESSION_NOT_STARTED");
});

it.each(["engaged", "observing", "quiet", "paused", "off"] as const)(
  "clears all retained workspace state when rebinding from %s", status => {
    const initial = authoritySnapshot();
    const current = { ...initial, presence: { ...initial.presence, status } };
    const next = apply(current, {
      ...base(current), type: "EnablePresence", workspaceId: "workspace-2",
    });

    expect(next.session).toBeUndefined();
    expect(next.presence).toEqual({
      workspaceId: "workspace-2", status: "observing", observationRevision: 0,
      activeSessionId: undefined,
    });
    expect(next.revision).toBe(current.revision + 2);
  },
);

it.each([
  ["a live session", authoritySnapshot()],
  ["enabled presence", {
    ...createRuntime("workspace-1"),
    presence: { ...createRuntime("workspace-1").presence, status: "observing" as const },
  }],
  ["disabled observations", {
    ...createRuntime("workspace-1"),
    presence: { ...createRuntime("workspace-1").presence, observationRevision: 3 },
  }],
  ["a disabled active-session link", {
    ...createRuntime("workspace-1"),
    presence: { ...createRuntime("workspace-1").presence, activeSessionId: "old-session" },
  }],
] as const)("rejects a replayed workspace rebind retaining %s", (_label, current) => {
  const before = reduce(current, []);
  expect(() => reduce(current, [enabledEvent(current, "workspace-2")])).toThrow("WORKSPACE_RESET_REQUIRED");
  expect(current).toEqual(before);
});

it.each(["engaged", "quiet", "paused"] as const)(
  "preserves valid same-workspace %s state for direct commands and replay", status => {
    const initial = authoritySnapshot();
    const current = status === "engaged" ? initial : apply(initial, {
      ...base(initial), type: "SetPresence", status,
    });
    expect(decide(current, {
      ...base(current), type: "EnablePresence", workspaceId: "workspace-1",
    }).events).toEqual([]);
    expect(reduce(current, [enabledEvent(current, "workspace-1")])).toEqual({
      ...current, revision: current.revision + 1,
    });
  },
);

it("allows initial workspace binding from a clean disabled snapshot in one event", () => {
  const current = createRuntime("placeholder");
  const decision = decide(current, {
    ...base(current), type: "EnablePresence", workspaceId: "workspace-1",
  });
  expect(decision.events).toHaveLength(1);
  expect(reduce(current, decision.events)).toEqual({
    ...createRuntime("workspace-1"), revision: 1,
    presence: { ...createRuntime("workspace-1").presence, status: "observing" },
  });
});
