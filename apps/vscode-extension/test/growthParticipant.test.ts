import { describe, expect, it, vi } from "vitest";
import { nativeToolName } from "@adaptive-pair/harness";
import { type PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import {
  ModelConsentRegistry,
  WITHHELD_RESPONSE_MESSAGE,
  FakeModel,
  asModel,
  FakeCoordinator,
  realCoordinator,
  createResponseStream,
  createToken,
  createRequest,
  createContext,
  growthSnapshot,
  buildParticipant,
} from "./growthTestHarness.js";

describe("GrowthParticipant workspace consent", () => {
  it("does not send task context before model-specific workspace consent", async () => {
    const snapshot = growthSnapshot({ runtimeRevision: 4 });
    const coordinator = new FakeCoordinator(snapshot);
    const model = new FakeModel([
      { text: JSON.stringify({ level: 1, kind: "question", text: "What have you tried?" }) },
    ]);
    const { participant, evaluations } = buildParticipant(coordinator, {
      requestWorkspaceConsent: () => Promise.resolve(false),
    });
    const { stream, collected } = createResponseStream();

    await participant.handle(
      createRequest(model, { prompt: "walk me through this bug" }),
      createContext([{ prompt: "prior repository detail leaks here" }]),
      stream,
      createToken(),
    );

    // Decline must short-circuit: no compiled turn, no model dispatch, no
    // token accounting, and no assistance state transition.
    expect(coordinator.prepareInputs).toHaveLength(0);
    expect(coordinator.invokeCalls).toHaveLength(0);
    expect(model.sendCount).toBe(0);
    expect(model.countTokensCount).toBe(0);
    expect(collected.markdown.join("\n").toLowerCase()).toContain("private");
    expect(evaluations.records).toHaveLength(0);
  });

  it("does not dispatch on a hint request when consent is declined", async () => {
    const snapshot = growthSnapshot({
      runtimeRevision: 4,
      session: {
        status: "active",
        mode: "growth",
        assistance: {
          attempt: { summary: "tried", bypassed: false, recordedAt: 0 },
          hypothesis: undefined,
          hint: { level: 1, recordedAt: 0 },
          solutionReveal: undefined,
        },
      },
    });
    const coordinator = new FakeCoordinator(snapshot);
    const model = new FakeModel([
      { text: JSON.stringify({ level: 2, kind: "hint", text: "clue" }) },
    ]);
    const { participant } = buildParticipant(coordinator, {
      requestWorkspaceConsent: () => Promise.resolve(false),
    });
    const { stream } = createResponseStream();

    await participant.handle(
      createRequest(model, { prompt: "give me a hint" }),
      createContext(),
      stream,
      createToken(),
    );

    // No hint escalation state transition and no model turn on decline.
    expect(
      coordinator.invokeCalls.some(call => call.name === "pair_request_hint"),
    ).toBe(false);
    expect(coordinator.prepareInputs).toHaveLength(0);
    expect(model.sendCount).toBe(0);
    expect(model.countTokensCount).toBe(0);
  });

  it("does not reveal or dispatch when consent is declined on a reveal", async () => {
    const snapshot = growthSnapshot({
      runtimeRevision: 4,
      session: {
        status: "active",
        mode: "growth",
        assistance: {
          attempt: { summary: "tried", bypassed: false, recordedAt: 0 },
          hypothesis: undefined,
          hint: { level: 4, recordedAt: 0 },
          solutionReveal: undefined,
        },
      },
    });
    const coordinator = new FakeCoordinator(snapshot);
    const model = new FakeModel([
      { text: JSON.stringify({ level: 5, kind: "solution-preview", text: "answer" }) },
    ]);
    const { participant } = buildParticipant(coordinator, {
      requestWorkspaceConsent: () => Promise.resolve(false),
      confirmSolutionReveal: () => Promise.resolve(true),
    });
    const { stream } = createResponseStream();

    await participant.handle(
      createRequest(model, { command: "reveal", prompt: "show me the answer" }),
      createContext(),
      stream,
      createToken(),
    );

    // No reveal/hint state transition and no model turn on decline.
    expect(
      coordinator.invokeCalls.some(call => call.name === "pair_reveal_solution"),
    ).toBe(false);
    expect(
      coordinator.invokeCalls.some(call => call.name === "pair_request_hint"),
    ).toBe(false);
    expect(coordinator.prepareInputs).toHaveLength(0);
    expect(model.sendCount).toBe(0);
    expect(model.countTokensCount).toBe(0);
  });

  it("does not let consent for one model authorize a different model", async () => {
    const snapshot = growthSnapshot({ runtimeRevision: 4 });
    const coordinator = new FakeCoordinator(snapshot);
    const modelA = new FakeModel([
      { text: JSON.stringify({ level: 1, kind: "question", text: "ok" }) },
    ]);
    const modelB = new FakeModel([
      { text: JSON.stringify({ level: 1, kind: "question", text: "ok" }) },
    ]);
    // modelB has a different identity so consent must not transfer.
    Object.defineProperty(modelB, "id", { value: "other-model-id" });
    const consent = new ModelConsentRegistry();
    consent.grant(asModel(modelA), coordinator.snapshotNow());
    const { participant } = buildParticipant(coordinator, {
      consent,
      requestWorkspaceConsent: () => Promise.resolve(false),
    });
    const { stream } = createResponseStream();

    await participant.handle(
      createRequest(modelB, { prompt: "walk me through this bug" }),
      createContext([{ prompt: "prior repository detail" }]),
      stream,
      createToken(),
    );

    expect(coordinator.prepareInputs).toHaveLength(0);
    expect(modelB.sendCount).toBe(0);
    expect(modelB.countTokensCount).toBe(0);
  });
});

describe("GrowthParticipant consented guidance", () => {
  it("delivers a response grounded by its own authorized read tool", async () => {
    const snapshot = growthSnapshot({ runtimeRevision: 4 });
    const coordinator = realCoordinator(snapshot);
    const model = new FakeModel([
      {
        toolCalls: [
          {
            callId: "call-read",
            name: nativeToolName("pair_read_scope"),
            input: { path: "src/retry.ts" },
          },
        ],
      },
      {
        text: JSON.stringify({
          level: 1,
          kind: "question",
          text: "What evidence changed after the bounded read?",
        }),
      },
    ]);
    const consent = new ModelConsentRegistry();
    consent.grant(asModel(model), coordinator.snapshotNow());
    const { participant, evaluations } = buildParticipant(coordinator, {
      consent,
    });
    const { stream, collected } = createResponseStream();

    await participant.handle(
      createRequest(model, { prompt: "read the scoped file and guide me" }),
      createContext(),
      stream,
      createToken(),
    );

    expect(collected.markdown.join("\n")).toContain(
      "What evidence changed after the bounded read?",
    );
    expect(evaluations.records.at(-1)?.outcome).toBe("delivered");
  });

  it("sends task context once consent is granted for the model", async () => {
    const snapshot = growthSnapshot({ runtimeRevision: 4 });
    const coordinator = new FakeCoordinator(snapshot);
    const model = new FakeModel([
      { text: JSON.stringify({ level: 1, kind: "question", text: "What have you tried?" }) },
    ]);
    const { participant } = buildParticipant(coordinator, {
      requestWorkspaceConsent: () => Promise.resolve(true),
    });
    const { stream } = createResponseStream();

    await participant.handle(
      createRequest(model, { prompt: "walk me through this bug" }),
      createContext([{ prompt: "prior conversation detail" }]),
      stream,
      createToken(),
    );

    expect(coordinator.prepareInputs[0]?.repositoryContext).toContain(
      "prior conversation detail",
    );
  });
});

describe("GrowthParticipant response restraint", () => {
  it("withholds a level-3 hint response that contains a target patch", async () => {
    const snapshot = growthSnapshot({
      runtimeRevision: 4,
      session: {
        status: "active",
        mode: "growth",
        assistance: {
          attempt: { summary: "tried", bypassed: false, recordedAt: 0 },
          hypothesis: undefined,
          hint: { level: 2, recordedAt: 0 },
          solutionReveal: undefined,
        },
      },
    });
    const coordinator = new FakeCoordinator(snapshot);
    const model = new FakeModel([
      {
        text: JSON.stringify({
          level: 3,
          kind: "hint",
          text: "```diff\n+export function retry() { return 3; }\n```",
        }),
      },
    ]);
    const consent = new ModelConsentRegistry();
    consent.grant(asModel(model), coordinator.snapshotNow());
    const { participant, evaluations } = buildParticipant(coordinator, { consent });
    const { stream, collected } = createResponseStream();

    await participant.handle(
      createRequest(model, { prompt: "give me a hint" }),
      createContext(),
      stream,
      createToken(),
    );

    expect(collected.markdown.join("\n")).toContain(WITHHELD_RESPONSE_MESSAGE);
    const record = evaluations.records.at(-1);
    expect(record?.outcome).toBe("withheld");
    expect(JSON.stringify(evaluations.records)).not.toContain("export function retry");
  });

  it("withholds a response one level above the currently authorized hint", async () => {
    const snapshot = growthSnapshot({
      runtimeRevision: 4,
      session: {
        status: "active",
        mode: "growth",
        assistance: {
          attempt: { summary: "tried", bypassed: false, recordedAt: 0 },
          hypothesis: undefined,
          hint: { level: 2, recordedAt: 0 },
          solutionReveal: undefined,
        },
      },
    });
    const coordinator = new FakeCoordinator(snapshot);
    const model = new FakeModel([
      {
        text: JSON.stringify({
          level: 3,
          kind: "hint",
          text: "Consider the ordering between the counter update and retry condition.",
        }),
      },
    ]);
    const consent = new ModelConsentRegistry();
    consent.grant(asModel(model), coordinator.snapshotNow());
    const { participant, evaluations } = buildParticipant(coordinator, { consent });
    const { stream, collected } = createResponseStream();

    await participant.handle(
      createRequest(model, { prompt: "keep the hint at the current level" }),
      createContext(),
      stream,
      createToken(),
    );

    expect(collected.markdown.join("\n")).toContain(WITHHELD_RESPONSE_MESSAGE);
    expect(evaluations.records.at(-1)).toMatchObject({
      outcome: "withheld",
      reason: "HINT_LEVEL_EXCEEDED",
    });
  });

  it("surfaces invalid JSON as a restraint failure without raw text", async () => {
    const snapshot = growthSnapshot({ runtimeRevision: 4 });
    const coordinator = new FakeCoordinator(snapshot);
    const model = new FakeModel([{ text: "Sure! Here is the whole fixed file for you." }]);
    const consent = new ModelConsentRegistry();
    consent.grant(asModel(model), coordinator.snapshotNow());
    const { participant, evaluations } = buildParticipant(coordinator, { consent });
    const { stream, collected } = createResponseStream();

    await participant.handle(
      createRequest(model, { prompt: "walk me through it" }),
      createContext(),
      stream,
      createToken(),
    );

    const record = evaluations.records.at(-1);
    expect(record?.outcome).toBe("restraint-failure");
    expect(JSON.stringify(evaluations.records)).not.toContain("whole fixed file");
    expect(collected.markdown.join("\n")).not.toContain("whole fixed file");
  });

  it("rejects a response and its tool view when the mode changes during generation", async () => {
    const before = growthSnapshot({ runtimeRevision: 4 });
    const after: PairRuntimeSnapshot = {
      ...before,
      revision: 9,
      session: before.session
        ? { ...before.session, mode: "pair", authorityEpoch: 1 }
        : undefined,
    };
    const coordinator = new FakeCoordinator(before);
    const model = new FakeModel([
      {
        text: JSON.stringify({ level: 1, kind: "question", text: "What have you tried?" }),
      },
    ]);
    // Flip the snapshot only after the model has produced its response.
    coordinator.snapshotProvider = () => (model.sendCount === 0 ? before : after);
    const consent = new ModelConsentRegistry();
    consent.grant(asModel(model), coordinator.snapshotNow());
    const { participant, evaluations } = buildParticipant(coordinator, { consent });
    const { stream, collected } = createResponseStream();

    await participant.handle(
      createRequest(model, { prompt: "walk me through this" }),
      createContext(),
      stream,
      createToken(),
    );

    expect(collected.markdown.join("\n")).not.toContain("What have you tried?");
    expect(evaluations.records.at(-1)?.outcome).toBe("restraint-failure");
    expect(evaluations.records.at(-1)?.reason).toBe("STALE_TURN");
  });
});

describe("GrowthParticipant hint and reveal authority", () => {
  it("requires a human attempt before escalating to level 2 or higher", async () => {
    const snapshot = growthSnapshot({
      runtimeRevision: 4,
      session: {
        status: "active",
        mode: "growth",
        assistance: {
          attempt: undefined,
          hypothesis: undefined,
          hint: { level: 1, recordedAt: 0 },
          solutionReveal: undefined,
        },
      },
    });
    const coordinator = new FakeCoordinator(snapshot, {
      onInvoke: call => {
        if (call.name === "pair_request_hint") {
          throw new Error("HINT_REQUIRES_ATTEMPT");
        }
      },
    });
    const model = new FakeModel([
      { text: JSON.stringify({ level: 2, kind: "hint", text: "clue" }) },
    ]);
    const consent = new ModelConsentRegistry();
    consent.grant(asModel(model), coordinator.snapshotNow());
    const { participant } = buildParticipant(coordinator, { consent });
    const { stream, collected } = createResponseStream();

    await participant.handle(
      createRequest(model, { prompt: "give me a hint" }),
      createContext(),
      stream,
      createToken(),
    );

    expect(model.sendCount).toBe(0);
    expect(collected.markdown.join("\n").toLowerCase()).toContain("attempt");
  });

  it("records an explicit reveal before requesting a level-5 solution", async () => {
    const snapshot = growthSnapshot({
      runtimeRevision: 4,
      session: {
        status: "active",
        mode: "growth",
        learningAgreement: {
          learningGoals: ["retry"],
          familiarAreas: [],
          humanOwnedCapabilities: ["implementation"],
          delegatableWork: [],
          maximumHintLevel: 5,
          independentCheck: "vary the retry",
        },
        assistance: {
          attempt: { summary: "tried", bypassed: false, recordedAt: 0 },
          hypothesis: undefined,
          hint: { level: 4, recordedAt: 0 },
          solutionReveal: { previewOnly: true, recordedAt: 0 },
        },
      },
    });
    const coordinator = new FakeCoordinator(snapshot);
    const model = new FakeModel([
      {
        text: JSON.stringify({
          level: 5,
          kind: "solution-preview",
          text: "The full transition looks like this.",
        }),
      },
    ]);
    const consent = new ModelConsentRegistry();
    consent.grant(asModel(model), coordinator.snapshotNow());
    const confirmReveal = vi.fn(() => Promise.resolve(true));
    const { participant } = buildParticipant(coordinator, {
      consent,
      confirmSolutionReveal: confirmReveal,
    });
    const { stream } = createResponseStream();

    await participant.handle(
      createRequest(model, { command: "reveal", prompt: "show me the answer" }),
      createContext(),
      stream,
      createToken(),
    );

    expect(confirmReveal).toHaveBeenCalledTimes(1);
    const revealIndex = coordinator.invokeCalls.findIndex(
      call => call.name === "pair_reveal_solution",
    );
    const level5Index = coordinator.invokeCalls.findIndex(
      call => call.name === "pair_request_hint" && call.input.level === 5,
    );
    expect(revealIndex).toBeGreaterThanOrEqual(0);
    expect(level5Index).toBeGreaterThan(revealIndex);
  });

  it("does not reveal a solution without explicit confirmation", async () => {
    const snapshot = growthSnapshot({ runtimeRevision: 4 });
    const coordinator = new FakeCoordinator(snapshot);
    const model = new FakeModel([
      { text: JSON.stringify({ level: 5, kind: "solution-preview", text: "answer" }) },
    ]);
    const consent = new ModelConsentRegistry();
    consent.grant(asModel(model), coordinator.snapshotNow());
    const { participant } = buildParticipant(coordinator, {
      consent,
      confirmSolutionReveal: () => Promise.resolve(false),
    });
    const { stream } = createResponseStream();

    await participant.handle(
      createRequest(model, { command: "reveal", prompt: "show me the answer" }),
      createContext(),
      stream,
      createToken(),
    );

    expect(
      coordinator.invokeCalls.some(call => call.name === "pair_reveal_solution"),
    ).toBe(false);
    expect(model.sendCount).toBe(0);
  });
});
