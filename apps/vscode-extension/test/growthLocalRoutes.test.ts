import { describe, expect, it } from "vitest";
import {
  FakeModel,
  FakeCoordinator,
  createResponseStream,
  createToken,
  createRequest,
  createContext,
  growthSnapshot,
  buildParticipant,
} from "./growthTestHarness.js";

describe("GrowthParticipant core-state reporting", () => {
  it("answers /brief from bounded core state without a model call", async () => {
    const coordinator = new FakeCoordinator(growthSnapshot({ runtimeRevision: 4 }));
    const model = new FakeModel([]);
    const { participant, evaluations } = buildParticipant(coordinator);
    const { stream, collected } = createResponseStream();

    await participant.handle(
      createRequest(model, { command: "brief", prompt: "" }),
      createContext(),
      stream,
      createToken(),
    );

    const text = collected.markdown.join("\n");
    expect(text).toContain("Implement one retry transition");
    expect(text).toContain("Practice retry behavior");
    expect(text).toContain("The retry test passes");
    expect(text).toContain("npm test");
    expect(text).toContain("src/retry.ts");
    expect(text).toContain("4");
    expect(coordinator.prepareInputs).toHaveLength(0);
    expect(coordinator.invokeCalls).toHaveLength(0);
    expect(model.sendCount).toBe(0);
    expect(evaluations.records).toHaveLength(0);
  });

  it("reports the absent brief honestly when no session is active", async () => {
    const coordinator = new FakeCoordinator({
      protocolVersion: 1,
      revision: 0,
      presence: {
        workspaceId: "workspace-1",
        observationRevision: 0,
        status: "off",
        activeSessionId: undefined,
      },
      session: undefined,
    });
    const model = new FakeModel([]);
    const { participant } = buildParticipant(coordinator);
    const { stream, collected } = createResponseStream();

    await participant.handle(
      createRequest(model, { prompt: "what is my current task?" }),
      createContext(),
      stream,
      createToken(),
    );

    expect(collected.markdown.join("\n").toLowerCase()).toContain("no adaptive pair session");
    expect(model.sendCount).toBe(0);
    expect(coordinator.prepareInputs).toHaveLength(0);
  });

  it("answers /session with separate product verification and all five Growth fields", async () => {
    const coordinator = new FakeCoordinator(
      growthSnapshot({
        runtimeRevision: 4,
        session: {
          assistance: {
            attempt: { summary: "tried", bypassed: false, recordedAt: 0 },
            hypothesis: undefined,
            hint: { level: 2, recordedAt: 0 },
            solutionReveal: undefined,
          },
        },
      }),
    );
    const model = new FakeModel([]);
    const { participant } = buildParticipant(coordinator);
    const { stream, collected } = createResponseStream();

    await participant.handle(
      createRequest(model, { command: "session", prompt: "" }),
      createContext(),
      stream,
      createToken(),
    );

    const text = collected.markdown.join("\n");
    expect(text).toContain("Product verification");
    expect(text).toContain("Similar generation");
    expect(text).toContain("Varied debugging");
    expect(text).toContain("Explanation");
    expect(text).toContain("Meaningful authorship");
    expect(text).toContain("Next-assistance proposal");
    expect(text.toLowerCase()).toContain("not assessed");
    expect(text.toLowerCase()).toContain("transfer: not started");
    expect(coordinator.prepareInputs).toHaveLength(0);
    expect(model.sendCount).toBe(0);
  });
});

describe("GrowthParticipant explicit verification", () => {
  it("runs the agreed verification plan on /check with an explicit user action and no model call", async () => {
    const snapshot = growthSnapshot({ runtimeRevision: 4 });
    const coordinator = new FakeCoordinator(snapshot, {
      resultFor: call =>
        call.name === "pair_run_verification"
          ? Object.freeze({
              operationId: "op-check",
              runtimeRevision: snapshot.revision,
              authorityEpoch: snapshot.session?.authorityEpoch,
              status: "confirmed" as const,
              summary: "npm run test exited 0",
              observation: Object.freeze({ passed: true, exitCode: 0 }),
              sensitiveData: false,
              partial: false,
            })
          : undefined,
    });
    const model = new FakeModel([]);
    const { participant } = buildParticipant(coordinator);
    const { stream, collected } = createResponseStream();

    await participant.handle(
      createRequest(model, { command: "check", prompt: "" }),
      createContext(),
      stream,
      createToken(),
    );

    expect(coordinator.grantCalls).toEqual(["pair_run_verification"]);
    expect(coordinator.invokeCalls).toHaveLength(1);
    expect(coordinator.invokeCalls[0]?.name).toBe("pair_run_verification");
    expect(coordinator.invokeCalls[0]?.input).toEqual({
      script: "test",
      targetPaths: ["src/retry.ts"],
    });
    expect(coordinator.invokeCalls[0]?.options?.userActionId).toBe(
      "grant-pair_run_verification",
    );
    expect(coordinator.prepareInputs).toHaveLength(0);
    expect(model.sendCount).toBe(0);

    const text = collected.markdown.join("\n");
    expect(text).toContain("passed");
    expect(text).toContain("npm run test exited 0");
  });

  it("reports an observed verification failure without calling it a success", async () => {
    const snapshot = growthSnapshot({ runtimeRevision: 4 });
    const coordinator = new FakeCoordinator(snapshot, {
      resultFor: call =>
        call.name === "pair_run_verification"
          ? Object.freeze({
              operationId: "op-check",
              runtimeRevision: snapshot.revision,
              authorityEpoch: snapshot.session?.authorityEpoch,
              status: "confirmed" as const,
              summary: "npm run test exited 1",
              observation: Object.freeze({ passed: false, exitCode: 1 }),
              sensitiveData: false,
              partial: false,
            })
          : undefined,
    });
    const { participant } = buildParticipant(coordinator);
    const { stream, collected } = createResponseStream();

    await participant.handle(
      createRequest(new FakeModel([]), { prompt: "run the verification please" }),
      createContext(),
      stream,
      createToken(),
    );

    const text = collected.markdown.join("\n").toLowerCase();
    expect(text).toContain("failed");
    expect(text).not.toContain("verified");
  });

  it("refuses /check when the agreed plan names no allowlisted package script", async () => {
    const coordinator = new FakeCoordinator(
      growthSnapshot({
        runtimeRevision: 4,
        session: {
          workUnit: {
            id: "unit-1",
            objective: "Implement one retry transition",
            mode: "growth",
            learningValue: "high",
            capability: "implementation",
            owner: "human",
            allowedPaths: ["src/retry.ts"],
            acceptanceChecks: ["The retry test passes"],
            verificationPlan: "ask a teammate to look at it",
            stoppingCondition: "One transition is green",
            baseline: {},
            status: "agreed",
          },
        },
      }),
    );
    const { participant } = buildParticipant(coordinator);
    const { stream, collected } = createResponseStream();

    await participant.handle(
      createRequest(new FakeModel([]), { command: "check", prompt: "" }),
      createContext(),
      stream,
      createToken(),
    );

    expect(coordinator.invokeCalls).toHaveLength(0);
    expect(coordinator.grantCalls).toHaveLength(0);
    expect(collected.markdown.join("\n")).toContain("ask a teammate to look at it");
    expect(collected.markdown.join("\n").toLowerCase()).toContain(
      "package script",
    );
  });
});

describe("GrowthParticipant stale verification", () => {
  it("does not report a successful check after the work unit changes", async () => {
    const snapshot = growthSnapshot({ runtimeRevision: 4 });
    const coordinator = new FakeCoordinator(snapshot, {
      resultFor: call =>
        call.name === "pair_run_verification"
          ? Object.freeze({
              operationId: "op-check",
              runtimeRevision: snapshot.revision,
              authorityEpoch: snapshot.session?.authorityEpoch,
              status: "confirmed" as const,
              summary: "npm run test exited 0",
              observation: Object.freeze({ passed: true, exitCode: 0 }),
              sensitiveData: false,
              partial: false,
            })
          : undefined,
    });
    const { participant } = buildParticipant(coordinator);

    await participant.handle(
      createRequest(new FakeModel([]), { command: "check", prompt: "" }),
      createContext(),
      createResponseStream().stream,
      createToken(),
    );

    coordinator.setSnapshot({
      ...snapshot,
      revision: 5,
      session: {
        ...snapshot.session!,
        workUnit: {
          ...snapshot.session!.workUnit!,
          id: "unit-2",
        },
      },
    });

    const { stream, collected } = createResponseStream();
    await participant.handle(
      createRequest(new FakeModel([]), { command: "session", prompt: "" }),
      createContext(),
      stream,
      createToken(),
    );

    expect(collected.markdown.join("\n").toLowerCase()).toContain(
      "no check observed in this session",
    );
  });

  it("does not report a successful check after the session changes", async () => {
    const snapshot = growthSnapshot({ runtimeRevision: 4 });
    const coordinator = new FakeCoordinator(snapshot, {
      resultFor: call =>
        call.name === "pair_run_verification"
          ? Object.freeze({
              operationId: "op-check",
              runtimeRevision: snapshot.revision,
              authorityEpoch: snapshot.session?.authorityEpoch,
              status: "confirmed" as const,
              summary: "npm run test exited 0",
              observation: Object.freeze({ passed: true, exitCode: 0 }),
              sensitiveData: false,
              partial: false,
            })
          : undefined,
    });
    const { participant } = buildParticipant(coordinator);

    await participant.handle(
      createRequest(new FakeModel([]), { command: "check", prompt: "" }),
      createContext(),
      createResponseStream().stream,
      createToken(),
    );

    coordinator.setSnapshot({
      ...snapshot,
      revision: 5,
      presence: {
        ...snapshot.presence,
        activeSessionId: "session-2",
      },
      session: {
        ...snapshot.session!,
        sessionId: "session-2",
      },
    });

    const { stream, collected } = createResponseStream();
    await participant.handle(
      createRequest(new FakeModel([]), { command: "session", prompt: "" }),
      createContext(),
      stream,
      createToken(),
    );

    expect(collected.markdown.join("\n").toLowerCase()).toContain(
      "no check observed in this session",
    );
  });
});
