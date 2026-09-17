import { describe, expect, it, vi } from "vitest";
import type { PairToolName } from "@adaptive-pair/harness";
import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { InMemoryJournal, type PairCoordinator } from "@adaptive-pair/runtime";
import {
  FakeModel,
  asModel,
  realCoordinator,
  createResponseStream,
  createRequest,
  createContext,
  createToken,
  growthSnapshot,
  buildParticipant,
} from "./growthTestHarness.js";

const actionHarness = () => {
  const before = growthSnapshot({
    runtimeRevision: 4,
    session: {
      authorityEpoch: 2,
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
        hint: { level: 1, recordedAt: 0 },
        solutionReveal: undefined,
      },
    },
  });
  const store = new InMemoryJournal("workspace-1", before);
  const coordinator = realCoordinator(before, store);
  const model = new FakeModel([
    { text: JSON.stringify({ level: 1, kind: "question", text: "What have you tried?" }) },
  ]);
  const { participant, consent, evaluations } = buildParticipant(coordinator);
  consent.grant(asModel(model), coordinator.snapshotNow());
  return { before, store, coordinator, model, participant, evaluations, ...createResponseStream() };
};

const replaceWorkUnit = async (
  coordinator: PairCoordinator,
  store: InMemoryJournal,
  before: PairRuntimeSnapshot,
): Promise<void> => {
  const session = before.session;
  if (session?.entrySnapshot === undefined || session.workUnit === undefined || session.learningAgreement === undefined) {
    throw new Error("Expected an agreed Growth fixture");
  }
  await coordinator.setPresence("off");
  await coordinator.setPresence("observing", "workspace-1");
  const commands = [
    { type: "StartSession", sessionId: "session-2" },
    { type: "CaptureEntry", entry: session.entrySnapshot },
    { type: "ConfirmLearning", agreement: session.learningAgreement },
    { type: "SelectMode", mode: "growth" },
    {
      type: "ProposeWorkUnit",
      workUnit: {
        ...session.workUnit,
        id: "unit-2",
        status: "proposed",
        allowedPaths: ["src/queue.ts"],
        verificationPlan: "npm run lint",
      },
    },
    { type: "AgreeWorkUnit", workUnitId: "unit-2" },
    { type: "RecordAttempt", workUnitId: "unit-2", summary: "Tried the queue", bypassed: false },
  ] as const;
  for (const command of commands) {
    await coordinator.dispatch({
      ...command,
      protocolVersion: 1,
      commandId: `replace-${command.type}`,
      expectedRevision: store.snapshotNow().revision,
      actor: "human",
      observedAt: 1_001,
    });
  }
};

const actionRoutes: readonly { readonly command: string; readonly tool: PairToolName }[] = [
  { command: "attempt", tool: "pair_record_attempt" },
  { command: "hypothesis", tool: "pair_record_hypothesis" },
  { command: "hint", tool: "pair_request_hint" },
  { command: "reveal", tool: "pair_reveal_solution" },
  { command: "check", tool: "pair_run_verification" },
];

describe.each(["observation", "replacement"] as const)("Growth intent after %s transition", transition => {
  it.each(actionRoutes)("rejects /$command before granting its stale input", async ({ command, tool }) => {
    const { before, store, coordinator, model, participant, evaluations, stream } = actionHarness();
    const invoke = vi.spyOn(coordinator, "invokeTool");
    const grant = coordinator.grantUserAction.bind(coordinator);
    let transitioned: PairRuntimeSnapshot | undefined;
    const grantSpy = vi.spyOn(coordinator, "grantUserAction").mockImplementationOnce(async (name, signal, options) => {
      if (transition === "observation") {
        await coordinator.observeWorkspace();
      } else {
        await replaceWorkUnit(coordinator, store, before);
      }
      transitioned = store.snapshotNow();
      return grant(name, signal, options);
    });

    await participant.handle(
      createRequest(model, { command, prompt: "Recorded my reasoning" }),
      createContext(),
      stream,
      createToken(),
    );

    expect(transitioned, evaluations.records.at(-1)?.reason).toBeDefined();
    expect(transitioned?.revision).toBeGreaterThan(before.revision);
    if (transition === "replacement") {
      expect(transitioned?.session).toMatchObject({ sessionId: "session-2", workUnit: { id: "unit-2" } });
      expect(transitioned?.session?.authorityEpoch).not.toBe(before.session?.authorityEpoch);
      expect(transitioned?.session?.workUnit?.allowedPaths).toEqual(["src/queue.ts"]);
      expect(transitioned?.session?.workUnit?.verificationPlan).toBe("npm run lint");
    }
    expect.soft(store.events().filter(event => event.type === "UserActionGranted")).toEqual([]);
    expect.soft(invoke).not.toHaveBeenCalled();
    expect.soft(model.sendCount).toBe(0);
    expect.soft(store.snapshotNow()).toEqual(transitioned);
    expect.soft(evaluations.records.at(-1)?.reason).toBe("STALE_TOOL_VIEW");
    expect(grantSpy).toHaveBeenCalledWith(tool, expect.any(AbortSignal), {
      runtimeRevision: before.revision,
      authorityEpoch: before.session?.authorityEpoch,
    });
  });
});

describe("Growth unchanged human intents", () => {
  it.each(actionRoutes)("continues /$command when its observed boundary stays current", async ({ command, tool }) => {
    const { store, coordinator, model, participant, evaluations, stream } = actionHarness();
    const invoke = vi.spyOn(coordinator, "invokeTool");

    await participant.handle(createRequest(model, { command, prompt: "Recorded my reasoning" }), createContext(), stream, createToken());

    expect(invoke.mock.calls[0]?.[0]).toBe(tool);
    expect(store.events().filter(event => event.type === "UserActionGranted").length).toBeGreaterThan(0);
    expect(evaluations.records.every(record => record.reason === undefined)).toBe(true);
    expect(model.sendCount).toBe(command === "hint" || command === "reveal" ? 1 : 0);
  });
});

describe("Growth reveal action boundaries", () => {
  it("rejects a transition between reveal authorization and its level-five hint grant", async () => {
    const { store, coordinator, model, participant, evaluations, stream } = actionHarness();
    const invoke = vi.spyOn(coordinator, "invokeTool");
    const grant = coordinator.grantUserAction.bind(coordinator);
    let transitioned: PairRuntimeSnapshot | undefined;
    vi.spyOn(coordinator, "grantUserAction").mockImplementation(async (name, signal, options) => {
      if (name === "pair_request_hint") {
        await coordinator.observeWorkspace();
        transitioned = store.snapshotNow();
      }
      return grant(name, signal, options);
    });

    await participant.handle(createRequest(model, { command: "reveal" }), createContext(), stream, createToken());

    expect(transitioned?.session?.assistance?.solutionReveal).toBeDefined();
    expect.soft(invoke.mock.calls.map(([name]) => name)).toEqual(["pair_reveal_solution"]);
    expect.soft(store.events().filter(event => event.type === "UserActionGranted")).toHaveLength(1);
    expect.soft(store.snapshotNow()).toEqual(transitioned);
    expect.soft(model.sendCount).toBe(0);
    expect(evaluations.records.at(-1)?.reason).toBe("STALE_TOOL_VIEW");
  });

  it("chains an unchanged reveal intent from the first action's confirmed boundary", async () => {
    const { before, store, coordinator, model, participant, evaluations, stream, collected } = actionHarness();
    const grant = vi.spyOn(coordinator, "grantUserAction");
    const invoke = vi.spyOn(coordinator, "invokeTool");

    await participant.handle(createRequest(model, { command: "reveal" }), createContext(), stream, createToken());

    expect(invoke.mock.calls.map(([name]) => name)).toEqual(["pair_reveal_solution", "pair_request_hint"]);
    const revealResult = invoke.mock.results[0];
    if (revealResult?.type !== "return") {
      throw new Error("Expected the reveal action to return");
    }
    const revealed = await revealResult.value;
    expect(revealed.status).toBe("confirmed");
    expect.soft(grant).toHaveBeenNthCalledWith(1, "pair_reveal_solution", expect.any(AbortSignal), {
      runtimeRevision: before.revision,
      authorityEpoch: before.session?.authorityEpoch,
    });
    expect.soft(grant).toHaveBeenNthCalledWith(2, "pair_request_hint", expect.any(AbortSignal), {
      runtimeRevision: revealed.runtimeRevision,
      authorityEpoch: revealed.authorityEpoch,
    });
    expect(store.snapshotNow().session?.assistance?.hint?.level).toBe(5);
    expect(model.sendCount).toBe(1);
    expect(evaluations.records.at(-1)?.outcome).toBe("delivered");
    expect(collected.markdown).toEqual(["What have you tried?"]);
  });
});
