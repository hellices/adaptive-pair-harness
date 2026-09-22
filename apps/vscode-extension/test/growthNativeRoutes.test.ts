import { describe, expect, it, vi } from "vitest";
import {
  FakeModel, GrowthParticipant, GrowthEvaluationLog, ModelConsentRegistry,
  realCoordinator, growthSnapshot, createRequest, createContext, createResponseStream, createToken,
  interpretGrowthIntent,
} from "./growthTestHarness.js";
import { createNativeCheckpoint } from "../src/nativeCheckpoint.js";
import type { GrowthSetupOutcome } from "../src/growthSetup.js";

const createHarness = () => {
  const coordinator = realCoordinator(growthSnapshot({
    session: { assistance: {
      attempt: { summary: "private-attempt", bypassed: false, recordedAt: 1 },
      hypothesis: undefined, hint: { level: 2, recordedAt: 2 }, solutionReveal: undefined,
    } },
  }));
  const model = new FakeModel([]);
  const setup = vi.fn<() => Promise<GrowthSetupOutcome>>(() => Promise.resolve("completed"));
  const confirmCheckpoint = vi.fn<() => Promise<boolean>>(() => Promise.resolve(true));
  const mutation = vi.spyOn(coordinator, "invokeTool");
  const participant = new GrowthParticipant({
    coordinator, snapshotNow: () => coordinator.snapshotNow(),
    consent: new ModelConsentRegistry(), evaluations: new GrowthEvaluationLog(),
    requestWorkspaceConsent: () => Promise.resolve(false),
    confirmSolutionReveal: () => Promise.resolve(false), setup, confirmCheckpoint,
  });
  const { stream, collected } = createResponseStream();
  const request = (command: string) => {
    const result = createRequest(model, { command });
    Object.defineProperty(result, "model", { get: () => { throw new Error("A local route accessed the model"); } });
    return result;
  };
  return { coordinator, participant, model, setup, confirmCheckpoint, mutation, stream, collected, request };
};

describe("native local Growth participant routes", () => {
  it.each([
    ["setup", "set up my task"], ["checkpoint", "save a checkpoint"], ["history", "show my history"],
  ])("routes /%s and its explicit natural-language equivalent", (intent, prompt) => {
    const model = new FakeModel([]);
    expect(interpretGrowthIntent(createRequest(model, { command: intent })).intent).toBe(intent);
    expect(interpretGrowthIntent(createRequest(model, { prompt })).intent).toBe(intent);
  });

  it("invokes setup without even accessing a selected model", async () => {
    const harness = createHarness();
    await harness.participant.handler()(harness.request("setup"), createContext(), harness.stream, createToken());
    expect(harness.setup).toHaveBeenCalledOnce();
    expect(harness.collected.markdown.join("\n")).toContain("/brief");
    expect(harness.model.sendCount).toBe(0);
  });

  it.each(["cancelled", "unavailable", "stale", "failed"] as const)("reports setup outcome %s without claiming completion", async outcome => {
    const harness = createHarness();
    harness.setup.mockResolvedValue(outcome);
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
    expect(result?.metadata).toEqual({ adaptivePairCheckpoint: expectedCheckpoint });
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

  it("treats a fork-shaped copy as historical, not a second live session", async () => {
    const harness = createHarness();
    const before = harness.coordinator.snapshotNow();
    const history = [{ participant: "adaptivePair.chat", result: { metadata: {
      adaptivePairCheckpoint: createNativeCheckpoint(before),
    } } }];
    await harness.participant.handle(harness.request("history"), createContext(history), harness.stream, createToken());
    await harness.participant.handle(harness.request("history"), createContext(structuredClone(history)), harness.stream, createToken());
    expect(harness.coordinator.snapshotNow()).toEqual(before);
    expect(harness.setup).not.toHaveBeenCalled();
    expect(harness.mutation).not.toHaveBeenCalled();
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
