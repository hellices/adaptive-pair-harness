import { describe, expect, it } from "vitest";
import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { createRuntime, createSession, decide, reduce } from "../src/index.js";

const createToolRuntime = (): PairRuntimeSnapshot => ({
  ...createRuntime("workspace-1"),
  presence: {
    workspaceId: "workspace-1",
    observationRevision: 0,
    status: "engaged",
    activeSessionId: "session-1",
  },
  session: {
    ...createSession("session-1"),
    status: "active",
    mode: "pair",
    workUnit: {
      id: "wu-1",
      objective: "Run the agreed verification",
      mode: "pair",
      learningValue: "mixed",
      capability: "verification",
      owner: "human",
      allowedPaths: ["packages/runtime"],
      acceptanceChecks: ["npx vitest run packages/runtime/test"],
      verificationPlan: "Run the runtime suite",
      stoppingCondition: "The runtime suite is green",
      baseline: {},
      status: "agreed",
    },
  },
});

describe("runtime operation transitions", () => {
  it("grants one-shot user actions at the next immutable revision", () => {
    const runtime = createToolRuntime();

    const decision = decide(runtime, {
      protocolVersion: 1,
      commandId: "cmd-grant",
      expectedRevision: runtime.revision,
      actor: "human",
      type: "GrantUserAction",
      grantId: "grant-1",
      nativeToolName: "adaptive_pair_run_verification",
      observedAt: 20,
    });

    expect(decision.events).toEqual([
      {
        protocolVersion: 1,
        eventId: "cmd-grant:0",
        commandId: "cmd-grant",
        actor: "human",
        revision: 1,
        recordedAt: 20,
        type: "UserActionGranted",
        grantId: "grant-1",
        nativeToolName: "adaptive_pair_run_verification",
        runtimeRevision: 1,
        authorityEpoch: 0,
      },
    ]);

    const next = reduce(runtime, decision.events);

    expect(next.session?.userActionGrants).toEqual([
      {
        id: "grant-1",
        nativeToolName: "adaptive_pair_run_verification",
        runtimeRevision: 1,
        authorityEpoch: 0,
        status: "available",
      },
    ]);
  });

  it("consumes a persisted grant atomically when authorizing an operation", () => {
    const granted = reduce(createToolRuntime(), [
      {
        protocolVersion: 1,
        eventId: "cmd-grant:0",
        commandId: "cmd-grant",
        actor: "human",
        revision: 1,
        recordedAt: 20,
        type: "UserActionGranted",
        grantId: "grant-1",
        nativeToolName: "adaptive_pair_run_verification",
        runtimeRevision: 1,
        authorityEpoch: 0,
      },
    ]);

    const decision = decide(granted, {
      protocolVersion: 1,
      commandId: "cmd-authorize",
      expectedRevision: granted.revision,
      actor: "ai",
      type: "AuthorizeOperation",
      operationId: "op-1",
      toolName: "pair_run_verification",
      kind: "check",
      input: {
        plan: "npx vitest run packages/runtime/test",
      },
      userActionGrantId: "grant-1",
      observedAt: 21,
    });

    expect(decision.events.map(event => event.type)).toEqual([
      "UserActionConsumed",
      "OperationAuthorized",
    ]);

    const next = reduce(granted, decision.events);

    expect(next.session?.userActionGrants).toEqual([
      {
        id: "grant-1",
        nativeToolName: "adaptive_pair_run_verification",
        runtimeRevision: 1,
        authorityEpoch: 0,
        status: "consumed",
      },
    ]);
    expect(next.session?.operations).toEqual([
      {
        id: "op-1",
        workUnitId: "wu-1",
        toolName: "pair_run_verification",
        kind: "check",
        input: {
          plan: "npx vitest run packages/runtime/test",
        },
        runtimeRevision: 3,
        authorityEpoch: 0,
        status: "authorized",
        summary: undefined,
        userActionGrantId: "grant-1",
      },
    ]);
  });

  it("rejects stale grants during final operation authorization", () => {
    const granted = reduce(createToolRuntime(), [
      {
        protocolVersion: 1,
        eventId: "cmd-grant:0",
        commandId: "cmd-grant",
        actor: "human",
        revision: 1,
        recordedAt: 20,
        type: "UserActionGranted",
        grantId: "grant-1",
        nativeToolName: "adaptive_pair_run_verification",
        runtimeRevision: 1,
        authorityEpoch: 0,
      },
      {
        protocolVersion: 1,
        eventId: "cmd-unrelated:0",
        commandId: "cmd-unrelated",
        actor: "ai",
        revision: 2,
        recordedAt: 21,
        type: "OperationAuthorized",
        operation: {
          id: "op-existing",
          workUnitId: "wu-1",
          toolName: "pair_read_scope",
          kind: "read",
          input: {
            path: "packages/runtime",
          },
          runtimeRevision: 2,
          authorityEpoch: 0,
          status: "authorized",
          summary: undefined,
          userActionGrantId: undefined,
        },
      },
    ]);

    expect(() =>
      decide(granted, {
        protocolVersion: 1,
        commandId: "cmd-authorize",
        expectedRevision: granted.revision,
        actor: "ai",
        type: "AuthorizeOperation",
        operationId: "op-1",
        toolName: "pair_run_verification",
        kind: "check",
        input: {
          plan: "npx vitest run packages/runtime/test",
        },
        userActionGrantId: "grant-1",
        observedAt: 22,
      }),
    ).toThrow("STALE_USER_ACTION_GRANT");
  });

  it("rejects mismatched grants during final operation authorization", () => {
    const granted = reduce(createToolRuntime(), [
      {
        protocolVersion: 1,
        eventId: "cmd-grant:0",
        commandId: "cmd-grant",
        actor: "human",
        revision: 1,
        recordedAt: 20,
        type: "UserActionGranted",
        grantId: "grant-1",
        nativeToolName: "adaptive_pair_request_hint",
        runtimeRevision: 1,
        authorityEpoch: 0,
      },
    ]);

    expect(() =>
      decide(granted, {
        protocolVersion: 1,
        commandId: "cmd-authorize",
        expectedRevision: granted.revision,
        actor: "ai",
        type: "AuthorizeOperation",
        operationId: "op-1",
        toolName: "pair_run_verification",
        kind: "check",
        input: {
          plan: "npx vitest run packages/runtime/test",
        },
        userActionGrantId: "grant-1",
        observedAt: 22,
      }),
    ).toThrow("USER_ACTION_MISMATCH");
  });

  it("cancels pending operations when the session pauses", () => {
    const runtime = reduce(createToolRuntime(), [
      {
        protocolVersion: 1,
        eventId: "cmd-authorize:0",
        commandId: "cmd-authorize",
        actor: "ai",
        revision: 1,
        recordedAt: 21,
        type: "OperationAuthorized",
        operation: {
          id: "op-1",
          workUnitId: "wu-1",
          toolName: "pair_run_verification",
          kind: "check",
          input: {
            plan: "npx vitest run packages/runtime/test",
          },
          runtimeRevision: 1,
          authorityEpoch: 0,
          status: "authorized",
          summary: undefined,
          userActionGrantId: undefined,
        },
      },
    ]);

    const decision = decide(runtime, {
      protocolVersion: 1,
      commandId: "cmd-pause",
      expectedRevision: runtime.revision,
      actor: "human",
      type: "PauseSession",
      reason: "take over the verification command",
      observedAt: 22,
    });

    expect(decision.events.map(event => event.type)).toEqual([
      "OperationObserved",
      "SessionPaused",
    ]);

    const next = reduce(runtime, decision.events);

    expect(next.session?.authorityEpoch).toBe(1);
    expect(next.session?.status).toBe("paused");
    expect(next.session?.operations).toEqual([
      {
        id: "op-1",
        workUnitId: "wu-1",
        toolName: "pair_run_verification",
        kind: "check",
        input: {
          plan: "npx vitest run packages/runtime/test",
        },
        runtimeRevision: 1,
        authorityEpoch: 0,
        status: "cancelled",
        summary: "Session paused before the operation completed.",
        userActionGrantId: undefined,
      },
    ]);
  });

  it("treats duplicate observed results as idempotent", () => {
    const runtime = reduce(createToolRuntime(), [
      {
        protocolVersion: 1,
        eventId: "cmd-authorize:0",
        commandId: "cmd-authorize",
        actor: "ai",
        revision: 1,
        recordedAt: 21,
        type: "OperationAuthorized",
        operation: {
          id: "op-1",
          workUnitId: "wu-1",
          toolName: "pair_run_verification",
          kind: "check",
          input: {
            plan: "npx vitest run packages/runtime/test",
          },
          runtimeRevision: 1,
          authorityEpoch: 0,
          status: "confirmed",
          summary: "Verification passed.",
          userActionGrantId: undefined,
        },
      },
    ]);

    const decision = decide(runtime, {
      protocolVersion: 1,
      commandId: "cmd-duplicate-observation",
      expectedRevision: runtime.revision,
      actor: "host",
      type: "ObserveOperationResult",
      operationId: "op-1",
      authorityEpoch: 0,
      status: "confirmed",
      summary: "Verification passed again.",
      observation: {
        duplicate: true,
      },
      observedAt: 22,
    });

    expect(decision.events).toEqual([]);
  });
});
