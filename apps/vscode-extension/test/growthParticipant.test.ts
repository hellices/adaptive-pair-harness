import { describe, expect, it, vi } from "vitest";
import { nativeToolName } from "@adaptive-pair/harness";
import { type AssistanceState, type PairRuntimeSnapshot, type PairSessionSnapshot } from "@adaptive-pair/protocol";
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

const withAssistance = (
  assistance: Partial<AssistanceState>,
  session: Partial<PairSessionSnapshot> = {},
): PairRuntimeSnapshot =>
  growthSnapshot({
    runtimeRevision: 4,
    session: {
      ...session,
      assistance: {
        attempt: { summary: "tried", bypassed: false, recordedAt: 0 },
        hypothesis: undefined,
        hint: { level: 1, recordedAt: 0 },
        solutionReveal: undefined,
        ...assistance,
      },
    },
  });

/**
 * Handle one Chat request. By default the model already holds workspace
 * consent for the current snapshot; pass `consented: false` to exercise the
 * consent prompt instead.
 */
const handle = async (
  coordinator: Parameters<typeof buildParticipant>[0],
  model: FakeModel,
  request: Parameters<typeof createRequest>[1],
  options: NonNullable<Parameters<typeof buildParticipant>[1]> & {
    readonly consented?: boolean;
    readonly history?: readonly unknown[];
  } = {},
) => {
  const { consented = true, history, ...overrides } = options;
  const consent = overrides.consent ?? new ModelConsentRegistry();
  if (consented) {
    consent.grant(asModel(model), coordinator.snapshotNow());
  }
  const { participant, evaluations } = buildParticipant(coordinator, { ...overrides, consent });
  const { stream, collected } = createResponseStream();
  await participant.handle(createRequest(model, request), createContext(history), stream, createToken());
  return { evaluations, text: collected.markdown.join("\n") };
};

describe("GrowthParticipant workspace consent", () => {
  it("does not send task context before model-specific workspace consent", async () => {
    const coordinator = new FakeCoordinator(growthSnapshot({ runtimeRevision: 4 }));
    const model = new FakeModel([
      { text: JSON.stringify({ level: 1, kind: "question", text: "What have you tried?" }) },
    ]);

    const { evaluations, text } = await handle(coordinator, model, { prompt: "walk me through this bug" }, {
      consented: false,
      requestWorkspaceConsent: () => Promise.resolve(false),
      history: [{ prompt: "prior repository detail leaks here" }],
    });

    // Decline must short-circuit: no compiled turn, no model dispatch, no
    // token accounting, and no assistance state transition.
    expect(coordinator.prepareInputs).toHaveLength(0);
    expect(coordinator.invokeCalls).toHaveLength(0);
    expect(model.sendCount).toBe(0);
    expect(model.countTokensCount).toBe(0);
    expect(text.toLowerCase()).toContain("private");
    expect(evaluations.records).toHaveLength(0);
  });

  it("does not let consent for one model authorize a different model", async () => {
    const coordinator = new FakeCoordinator(growthSnapshot({ runtimeRevision: 4 }));
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

    await handle(coordinator, modelB, { prompt: "walk me through this bug" }, {
      consented: false,
      consent,
      requestWorkspaceConsent: () => Promise.resolve(false),
      history: [{ prompt: "prior repository detail" }],
    });

    expect(coordinator.prepareInputs).toHaveLength(0);
    expect(modelB.sendCount).toBe(0);
    expect(modelB.countTokensCount).toBe(0);
  });
});

describe("GrowthParticipant consented guidance", () => {
  it("delivers a response grounded by its own authorized read tool", async () => {
    const coordinator = realCoordinator(growthSnapshot({ runtimeRevision: 4 }));
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

    const { evaluations, text } = await handle(coordinator, model, { prompt: "read the scoped file and guide me" });

    expect(text).toContain("What evidence changed after the bounded read?");
    expect(evaluations.records.at(-1)?.outcome).toBe("delivered");
  });

  it("sends task context once consent is granted for the model", async () => {
    const coordinator = new FakeCoordinator(growthSnapshot({ runtimeRevision: 4 }));
    const model = new FakeModel([
      { text: JSON.stringify({ level: 1, kind: "question", text: "What have you tried?" }) },
    ]);

    await handle(coordinator, model, { prompt: "walk me through this bug" }, {
      consented: false,
      requestWorkspaceConsent: () => Promise.resolve(true),
      history: [{ prompt: "prior conversation detail" }],
    });

    expect(coordinator.prepareInputs[0]?.repositoryContext).toContain(
      "prior conversation detail",
    );
  });
});

describe("GrowthParticipant response restraint", () => {
  it("withholds a level-3 hint response that contains a target patch", async () => {
    const coordinator = new FakeCoordinator(withAssistance({ hint: { level: 2, recordedAt: 0 } }));
    const model = new FakeModel([
      {
        text: JSON.stringify({
          level: 3,
          kind: "hint",
          text: "```diff\n+export function retry() { return 3; }\n```",
        }),
      },
    ]);

    const { evaluations, text } = await handle(coordinator, model, { prompt: "give me a hint" });

    expect(text).toContain(WITHHELD_RESPONSE_MESSAGE);
    const record = evaluations.records.at(-1);
    expect(record?.outcome).toBe("withheld");
    expect(JSON.stringify(evaluations.records)).not.toContain("export function retry");
  });

  it("withholds a response one level above the currently authorized hint", async () => {
    const coordinator = new FakeCoordinator(withAssistance({ hint: { level: 2, recordedAt: 0 } }));
    const model = new FakeModel([
      {
        text: JSON.stringify({
          level: 3,
          kind: "hint",
          text: "Consider the ordering between the counter update and retry condition.",
        }),
      },
    ]);

    const { evaluations, text } = await handle(coordinator, model, { prompt: "keep the hint at the current level" });

    expect(text).toContain(WITHHELD_RESPONSE_MESSAGE);
    expect(evaluations.records.at(-1)).toMatchObject({
      outcome: "withheld",
      reason: "HINT_LEVEL_EXCEEDED",
    });
  });

  it("surfaces invalid JSON as a restraint failure without raw text", async () => {
    const coordinator = new FakeCoordinator(growthSnapshot({ runtimeRevision: 4 }));
    const model = new FakeModel([{ text: "Sure! Here is the whole fixed file for you." }]);

    const { evaluations, text } = await handle(coordinator, model, { prompt: "walk me through it" });

    const record = evaluations.records.at(-1);
    expect(record?.outcome).toBe("restraint-failure");
    expect(JSON.stringify(evaluations.records)).not.toContain("whole fixed file");
    expect(text).not.toContain("whole fixed file");
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

    const { evaluations, text } = await handle(coordinator, model, { prompt: "walk me through this" });

    expect(text).not.toContain("What have you tried?");
    expect(evaluations.records.at(-1)?.outcome).toBe("restraint-failure");
    expect(evaluations.records.at(-1)?.reason).toBe("STALE_TURN");
  });
});

describe("GrowthParticipant hint and reveal authority", () => {
  it("requires a human attempt before escalating to level 2 or higher", async () => {
    const coordinator = new FakeCoordinator(withAssistance({ attempt: undefined }), {
      onInvoke: call => {
        if (call.name === "pair_request_hint") {
          throw new Error("HINT_REQUIRES_ATTEMPT");
        }
      },
    });
    const model = new FakeModel([
      { text: JSON.stringify({ level: 2, kind: "hint", text: "clue" }) },
    ]);

    const { text } = await handle(coordinator, model, { prompt: "give me a hint" });

    expect(model.sendCount).toBe(0);
    expect(text.toLowerCase()).toContain("attempt");
  });

  it("records an explicit reveal before requesting a level-5 solution", async () => {
    const coordinator = new FakeCoordinator(withAssistance(
      { hint: { level: 4, recordedAt: 0 }, solutionReveal: { previewOnly: true, recordedAt: 0 } },
      {
        learningAgreement: {
          learningGoals: ["retry"],
          familiarAreas: [],
          humanOwnedCapabilities: ["implementation"],
          delegatableWork: [],
          maximumHintLevel: 5,
          independentCheck: "vary the retry",
        },
      },
    ));
    const model = new FakeModel([
      {
        text: JSON.stringify({
          level: 5,
          kind: "solution-preview",
          text: "The full transition looks like this.",
        }),
      },
    ]);
    const confirmReveal = vi.fn(() => Promise.resolve(true));

    await handle(coordinator, model, { command: "reveal", prompt: "show me the answer" }, {
      confirmSolutionReveal: confirmReveal,
    });

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
});
