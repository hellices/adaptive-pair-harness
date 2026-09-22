import { describe, expect, it, vi } from "vitest";
import { InMemoryJournal } from "@adaptive-pair/runtime";
import {
  FakeModel, GrowthParticipant, GrowthEvaluationLog, ModelConsentRegistry,
  realCoordinator, growthSnapshot, createRequest, createContext, createResponseStream, createToken,
} from "./growthTestHarness.js";
import { createNativeCheckpoint } from "../src/nativeCheckpoint.js";
import { runGrowthSetup } from "../src/growthSetup.js";
import type { GrowthSetupResult } from "../src/growthHostState.js";
import { ATTEMPT_REQUIRED_MESSAGE, RESTRAINT_FAILURE_MESSAGE } from "../src/growthPresentation.js";

const createHarness = (coordinator = realCoordinator(growthSnapshot({
  session: { assistance: {
    attempt: { summary: "private-attempt", bypassed: false, recordedAt: 1 },
    hypothesis: undefined, hint: { level: 2, recordedAt: 2 }, solutionReveal: undefined,
  } },
}))) => {
  const model = new FakeModel([]);
  const setupCurrent = vi.fn(() => true);
  const setup = vi.fn<() => Promise<GrowthSetupResult>>(() => Promise.resolve({ outcome: "completed", isCurrent: setupCurrent }));
  const confirmCheckpoint = vi.fn<() => Promise<boolean>>(() => Promise.resolve(true));
  const confirmSolutionReveal = vi.fn<() => Promise<boolean>>(() => Promise.resolve(false));
  const requestWorkspaceConsent = vi.fn<() => Promise<boolean>>(() => Promise.resolve(false));
  const createModel = vi.fn(() => { throw new Error("A guarded local route created a model"); });
  const evaluations = new GrowthEvaluationLog();
  const mutation = vi.spyOn(coordinator, "invokeTool");
  const participant = new GrowthParticipant({
    coordinator, snapshotNow: () => coordinator.snapshotNow(),
    consent: new ModelConsentRegistry(), evaluations, createModel,
    requestWorkspaceConsent, confirmSolutionReveal, setup, confirmCheckpoint,
  });
  const { stream, collected } = createResponseStream();
  const request = (command: string | undefined, prompt = "") => {
    const result = createRequest(model, command === undefined ? { prompt } : { command, prompt });
    Object.defineProperty(result, "model", { get: () => { throw new Error("A local route accessed the model"); } });
    return result;
  };
  return {
    coordinator, participant, model, setup, setupCurrent, confirmCheckpoint, confirmSolutionReveal,
    requestWorkspaceConsent, createModel, evaluations, mutation, stream, collected, request,
  };
};

const createFreshCoordinator = async () => {
  const store = new InMemoryJournal("workspace-1");
  const coordinator = realCoordinator(store.snapshotNow(), store);
  await coordinator.setPresence("observing", "workspace-1");
  await coordinator.dispatch({
    type: "StartSession", sessionId: "fresh-native-session", protocolVersion: 1,
    commandId: "fresh-start", expectedRevision: store.snapshotNow().revision,
    actor: "human", observedAt: 100,
  });
  expect(store.snapshotNow().session?.status).toBe("briefing");
  expect(store.snapshotNow().session?.workUnit).toBeUndefined();
  const outcome = await runGrowthSetup({
    coordinator, snapshotNow: () => store.snapshotNow(),
    prepareEntry: () => coordinator.dispatch({
      type: "CaptureEntry", protocolVersion: 1, commandId: "fresh-entry",
      expectedRevision: store.snapshotNow().revision, actor: "human", observedAt: 101,
      entry: {
        workspaceId: "workspace-1", dirtyPaths: [], openPaths: ["src/retry.mjs"],
        diagnostics: [], protectedPaths: [], capturedAt: 101,
      },
    }),
    ui: {
      collect: () => Promise.resolve({
        objective: "Fix a new retry boundary", allowedPath: "src/retry.mjs",
        independentCheck: "Try a new limit independently", verificationPlan: "npm test",
      }),
      confirm: () => Promise.resolve(true),
    },
  }, new AbortController().signal);
  expect(outcome).toBe("completed");
  return coordinator;
};

describe("native local Growth participant routes", () => {
  it.each([
    ["setup", "set up my task"], ["checkpoint", "save a checkpoint"], ["history", "show my history"],
  ])("routes the natural-language equivalent of /%s without accessing the model", async (intent, prompt) => {
    const harness = createHarness();
    const before = harness.coordinator.snapshotNow();
    const checkpoint = createNativeCheckpoint(before);
    const history = [{ participant: "adaptivePair.chat", result: { metadata: { adaptivePairCheckpoint: checkpoint } } }];
    const result = await harness.participant.handler()(
      harness.request(undefined, prompt), createContext(history), harness.stream, createToken(),
    );
    expect(harness.setup).toHaveBeenCalledTimes(intent === "setup" ? 1 : 0);
    expect(harness.confirmCheckpoint).toHaveBeenCalledTimes(intent === "checkpoint" ? 1 : 0);
    expect(result?.metadata).toEqual(intent === "checkpoint" ? { adaptivePairCheckpoint: checkpoint } : undefined);
    const text = harness.collected.markdown.join("\n");
    if (intent === "setup") { expect(text).toContain("Growth setup is complete"); }
    if (intent === "checkpoint") { expect(text).toContain("VS Code controls native retention"); }
    if (intent === "history") { expect(text).toContain("Historical report only"); }
    expect(harness.coordinator.snapshotNow()).toEqual(before);
    expect(harness.mutation).not.toHaveBeenCalled();
    expect(harness.requestWorkspaceConsent).not.toHaveBeenCalled();
    expect(harness.model.sendCount).toBe(0);
  });

  it("invokes setup without even accessing a selected model", async () => {
    const harness = createHarness();
    await harness.participant.handler()(harness.request("setup"), createContext(), harness.stream, createToken());
    expect(harness.setup).toHaveBeenCalledOnce();
    expect(harness.setupCurrent).toHaveBeenCalledOnce();
    expect(harness.collected.markdown.join("\n")).toContain("/brief");
    expect(harness.model.sendCount).toBe(0);
  });

  it.each(["cancelled", "unavailable", "stale", "failed"] as const)("reports setup outcome %s without claiming completion", async outcome => {
    const harness = createHarness();
    harness.setup.mockResolvedValue({ outcome, isCurrent: harness.setupCurrent });
    await harness.participant.handle(harness.request("setup"), createContext(), harness.stream, createToken());
    expect(harness.collected.markdown.join("\n")).not.toContain("Growth setup is complete");
    expect(harness.mutation).not.toHaveBeenCalled();
  });

  it("returns only minimized metadata after an explicit checkpoint confirmation", async () => {
    const harness = createHarness();
    const before = harness.coordinator.snapshotNow();
    const expectedCheckpoint = createNativeCheckpoint(before);
    expect(expectedCheckpoint).toBeDefined();
    const result = await harness.participant.handler()(
      harness.request("checkpoint"), createContext(), harness.stream, createToken(),
    );
    expect(harness.confirmCheckpoint).toHaveBeenCalledOnce();
    expect(result).toEqual({ metadata: { adaptivePairCheckpoint: expectedCheckpoint } });
    expect(Reflect.ownKeys(result ?? {})).toEqual(["metadata"]);
    expect(structuredClone(result)).toEqual(result);
    expect(JSON.stringify(result)).not.toContain("private-attempt");
    expect(harness.coordinator.snapshotNow()).toEqual(before);
    expect(harness.mutation).not.toHaveBeenCalled();
  });

  it("returns no checkpoint when confirmation is declined", async () => {
    const harness = createHarness();
    harness.confirmCheckpoint.mockResolvedValue(false);
    const result = await harness.participant.handle(harness.request("checkpoint"), createContext(), harness.stream, createToken());
    expect(result?.metadata).toBeUndefined();
    expect(harness.collected.markdown.join("\n")).toContain("not saved");
  });

  it("does not publish a checkpoint captured before a runtime change", async () => {
    const harness = createHarness();
    harness.confirmCheckpoint.mockImplementation(async () => {
      await harness.coordinator.observeWorkspace();
      return true;
    });
    const result = await harness.participant.handle(harness.request("checkpoint"), createContext(), harness.stream, createToken());
    expect(result?.metadata).toBeUndefined();
    expect(harness.collected.markdown.join("\n")).toContain("changed");
  });

  it("does not publish a checkpoint after cancellation during confirmation", async () => {
    const harness = createHarness();
    let cancelled = false;
    let notify = (): void => undefined;
    const token: import("vscode").CancellationToken = {
      get isCancellationRequested() { return cancelled; },
      onCancellationRequested: listener => {
        notify = () => { listener(undefined); };
        return { dispose: () => undefined };
      },
    };
    harness.confirmCheckpoint.mockImplementation(() => {
      cancelled = true;
      notify();
      return Promise.resolve(true);
    });
    const result = await harness.participant.handle(harness.request("checkpoint"), createContext(), harness.stream, token);
    expect(result?.metadata).toBeUndefined();
    expect(harness.collected.markdown).toHaveLength(0);
  });
});

describe("historical checkpoints never admit live work", () => {
  it("reports historical authorization, not display, after a fresh setup blocks reveal at ceiling four", async () => {
    const harness = createHarness(await createFreshCoordinator());
    const before = harness.coordinator.snapshotNow();
    expect(before.session?.learningAgreement?.maximumHintLevel).toBe(4);
    expect(before.session?.assistance?.solutionReveal).toBeUndefined();
    harness.confirmSolutionReveal.mockResolvedValue(true);
    harness.requestWorkspaceConsent.mockResolvedValue(true);

    await harness.participant.handler()(
      createRequest(harness.model, { command: "reveal" }), createContext(), harness.stream, createToken(),
    );

    expect(harness.collected.markdown).toEqual([RESTRAINT_FAILURE_MESSAGE]);
    expect(harness.evaluations.records).toMatchObject([
      { outcome: "restraint-failure", reason: "HINT_EXCEEDS_AGREEMENT" },
    ]);
    expect(harness.confirmSolutionReveal).toHaveBeenCalledOnce();
    expect(harness.requestWorkspaceConsent).toHaveBeenCalledOnce();
    const afterReveal = harness.coordinator.snapshotNow();
    expect(afterReveal.session?.assistance?.solutionReveal).toBeDefined();
    expect(afterReveal.session?.assistance?.hint).toBeUndefined();
    expect(afterReveal.session?.learningAgreement?.maximumHintLevel).toBe(4);
    harness.mutation.mockClear();
    const saved = await harness.participant.handler()(
      harness.request("checkpoint"), createContext(), harness.stream, createToken(),
    );
    expect(saved).toEqual({ metadata: { adaptivePairCheckpoint: {
      format: "adaptive-pair-native-checkpoint", version: 1, mode: "growth",
      workUnitStatus: "agreed", maximumHintLevel: 4, attempt: "none", hypothesis: "none",
      hintLevel: null, solutionRevealed: true,
    } } });
    const history = createResponseStream();
    await harness.participant.handler()(
      harness.request("history"), createContext([{ participant: "adaptivePair.chat", result: saved }]),
      history.stream, createToken(),
    );
    const live = createResponseStream();
    await harness.participant.handler()(harness.request("session"), createContext(), live.stream, createToken());

    const report = history.collected.markdown.join("\n");
    expect(report).toContain("Historical report only");
    expect(report).toContain("Solution reveal authorized: yes");
    expect(report).toContain("not evidence that a solution was shown");
    expect(report).not.toContain("Solution revealed: yes");
    expect(report).toContain("cannot restore live state");
    expect(live.collected.markdown.join("\n")).toContain("Solution reveal authorized: yes");
    expect(harness.coordinator.snapshotNow()).toEqual(afterReveal);
    expect(harness.coordinator.snapshotNow().session?.userActionGrants).toEqual(afterReveal.session?.userActionGrants);
    expect(harness.mutation).not.toHaveBeenCalled();
    expect(harness.createModel).not.toHaveBeenCalled();
    expect(harness.model.sendCount).toBe(0);
    expect(harness.model.countTokensCount).toBe(0);
  });

  it("displays a native-history-shaped checkpoint without modifying a fresh runtime", async () => {
    const harness = createHarness();
    const checkpoint = createNativeCheckpoint(harness.coordinator.snapshotNow());
    await harness.coordinator.setPresence("off");
    await harness.coordinator.setPresence("observing", "workspace-1");
    const before = harness.coordinator.snapshotNow();
    const history = [{ participant: "adaptivePair.chat", result: { metadata: { adaptivePairCheckpoint: checkpoint } } }];
    await harness.participant.handler()(harness.request("history"), createContext(history), harness.stream, createToken());
    const text = harness.collected.markdown.join("\n");
    expect(text).toContain("Historical report only");
    expect(text).toContain("Hint level: 2");
    expect(text).toContain("fresh /setup");
    expect(harness.coordinator.snapshotNow()).toEqual(before);
    expect(harness.coordinator.snapshotNow().session).toBeUndefined();
    expect(harness.mutation).not.toHaveBeenCalled();
    expect(harness.setup).not.toHaveBeenCalled();
    expect(harness.confirmCheckpoint).not.toHaveBeenCalled();
  });

  it.each([2, 4])("does not let old or forked metadata satisfy a fresh runtime's level-%s attempt gate", async level => {
    const old = createHarness();
    const oldSnapshot = old.coordinator.snapshotNow();
    const checkpoint = createNativeCheckpoint(oldSnapshot);
    expect(checkpoint).toMatchObject({ attempt: "recorded", hintLevel: 2 });
    const saved = await old.participant.handler()(
      old.request("checkpoint"), createContext(), old.stream, createToken(),
    );
    expect(saved?.metadata).toEqual({ adaptivePairCheckpoint: checkpoint });
    const harness = createHarness(await createFreshCoordinator());
    harness.requestWorkspaceConsent.mockResolvedValue(true);
    const before = harness.coordinator.snapshotNow();
    expect(before.session?.sessionId).not.toBe(oldSnapshot.session?.sessionId);
    expect(before.session?.workUnit).toMatchObject({ status: "agreed", mode: "growth", owner: "human" });
    expect(before.session?.assistance?.attempt).toBeUndefined();
    expect(before.session?.assistance?.hint).toBeUndefined();
    const history = [{ participant: "adaptivePair.chat", result: saved }];
    const fork = structuredClone(history);
    expect(fork).toEqual(history);
    expect(fork[0]).not.toBe(history[0]);
    for (const selectedHistory of [history, fork]) {
      const display = createResponseStream();
      const result = await harness.participant.handler()(
        harness.request("history"), createContext(selectedHistory), display.stream, createToken(),
      );
      expect(result?.metadata).toBeUndefined();
      expect(display.collected.markdown.join("\n")).toContain("Historical report only");
      expect(display.collected.markdown.join("\n")).toContain("Attempt: recorded");
      expect(display.collected.markdown.join("\n")).toContain("Hint level: 2");
      expect(harness.coordinator.snapshotNow()).toEqual(before);
      expect(harness.coordinator.snapshotNow().session?.userActionGrants).toEqual(before.session?.userActionGrants);
    }
    expect(harness.setup).not.toHaveBeenCalled();
    expect(harness.mutation).not.toHaveBeenCalled();
    expect(harness.confirmCheckpoint).not.toHaveBeenCalled();
    expect(harness.requestWorkspaceConsent).not.toHaveBeenCalled();
    const hint = createRequest(harness.model, { command: "hint", prompt: `level ${level}` });
    await harness.participant.handler()(hint, createContext(fork), harness.stream, createToken());
    expect(harness.requestWorkspaceConsent).toHaveBeenCalledOnce();
    expect(harness.mutation).toHaveBeenCalledExactlyOnceWith(
      "pair_request_hint", { workUnitId: before.session?.workUnit?.id, level }, expect.any(AbortSignal),
      expect.objectContaining<{ userActionId: unknown }>({ userActionId: expect.any(String) }),
    );
    expect(harness.collected.markdown).toEqual([ATTEMPT_REQUIRED_MESSAGE]);
    expect(harness.coordinator.snapshotNow().session?.assistance).toEqual(before.session?.assistance);
    expect(harness.model.sendCount).toBe(0);
    expect(harness.model.countTokensCount).toBe(0);
  });

  it("reports empty history without a model", async () => {
    const harness = createHarness();
    await harness.participant.handle(harness.request("history"), createContext(), harness.stream, createToken());
    expect(harness.collected.markdown.join("\n")).toContain("No checkpoint");
    expect(harness.mutation).not.toHaveBeenCalled();
  });

  it.each(["setup", "checkpoint", "history"])("keeps disabled /%s inactive without inspecting history", async command => {
    const harness = createHarness();
    await harness.coordinator.setPresence("off");
    const context = createContext();
    Object.defineProperty(context, "history", { get: () => { throw new Error("Inactive history inspection"); } });
    await harness.participant.handle(harness.request(command), context, harness.stream, createToken());
    expect(harness.setup).not.toHaveBeenCalled();
    expect(harness.confirmCheckpoint).not.toHaveBeenCalled();
    expect(harness.mutation).not.toHaveBeenCalled();
    expect(harness.collected.markdown.join("\n")).toContain("Enable Presence");
  });
});

describe("invalid and foreign history through the public handler", () => {
  it.each([{ hintLevel: "2" }, { version: 2 }])("rejects malformed newest metadata %j without falling back", async invalid => {
    const harness = createHarness();
    const before = harness.coordinator.snapshotNow();
    const checkpoint = createNativeCheckpoint(before);
    const history = [
      { participant: "adaptivePair.chat", result: { metadata: { adaptivePairCheckpoint: checkpoint } } },
      { participant: "adaptivePair.chat", result: { metadata: { adaptivePairCheckpoint: { ...checkpoint, ...invalid } } } },
    ];
    const result = await harness.participant.handler()(
      harness.request("history"), createContext(history), harness.stream, createToken(),
    );
    expect(result?.metadata).toBeUndefined();
    expect(harness.collected.markdown.join("\n")).toContain("invalid or unsupported");
    expect(harness.collected.markdown.join("\n")).toContain("Older checkpoints are not used");
    expect(harness.collected.markdown.join("\n")).not.toContain("Hint level: 2");
    expect(harness.coordinator.snapshotNow()).toEqual(before);
    expect(harness.coordinator.snapshotNow().session?.userActionGrants).toEqual(before.session?.userActionGrants);
    expect(harness.mutation).not.toHaveBeenCalled();
    expect(harness.setup).not.toHaveBeenCalled();
    expect(harness.confirmCheckpoint).not.toHaveBeenCalled();
    expect(harness.requestWorkspaceConsent).not.toHaveBeenCalled();
    expect(harness.model.sendCount).toBe(0);
  });

  it("does not accept another participant's checkpoint as historical progress", async () => {
    const harness = createHarness();
    const before = harness.coordinator.snapshotNow();
    const history = [{ participant: "other.chat", result: { metadata: {
      adaptivePairCheckpoint: createNativeCheckpoint(before),
    } } }];
    const result = await harness.participant.handler()(
      harness.request("history"), createContext(history), harness.stream, createToken(),
    );
    expect(result?.metadata).toBeUndefined();
    expect(harness.collected.markdown.join("\n")).toContain("No checkpoint");
    expect(harness.collected.markdown.join("\n")).not.toContain("Hint level: 2");
    expect(harness.coordinator.snapshotNow()).toEqual(before);
    expect(harness.coordinator.snapshotNow().session?.userActionGrants).toEqual(before.session?.userActionGrants);
    expect(harness.mutation).not.toHaveBeenCalled();
    expect(harness.setup).not.toHaveBeenCalled();
    expect(harness.confirmCheckpoint).not.toHaveBeenCalled();
    expect(harness.requestWorkspaceConsent).not.toHaveBeenCalled();
    expect(harness.model.sendCount).toBe(0);
  });
});
