import type * as vscode from "vscode";
import type { OperatingMode } from "@adaptive-pair/protocol";
import { InMemoryJournal, PairCoordinator, type EffectPort, type GrowthModel } from "@adaptive-pair/runtime";
import { vi } from "vitest";
import {
  GrowthParticipant, GrowthEvaluationLog, ModelConsentRegistry, FakeModel, asModel,
  createContext, createRequest, createResponseStream, growthSnapshot,
} from "./growthTestHarness.js";

export const answer = "Independent variation: design a bounded queue and prove its capacity.";

export const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
};

export const cancellation = () => {
  let aborted = false;
  const callbacks = new Set<() => void>();
  const token: vscode.CancellationToken = {
    get isCancellationRequested() { return aborted; },
    onCancellationRequested: listener => {
      const callback = () => { listener(undefined); };
      callbacks.add(callback);
      return { dispose: () => { callbacks.delete(callback); } };
    },
  };
  return {
    token,
    cancel: () => {
      if (aborted) return;
      aborted = true;
      for (const callback of callbacks) callback();
    },
  };
};

export const destination = (overrides: Partial<Record<"vendor" | "family" | "id" | "version", string>> = {}) =>
  asModel(Object.assign(new FakeModel([]), overrides));

export const routeBoundaryFixture = () => {
  const supported = growthSnapshot().session!;
  const before = growthSnapshot({
    runtimeRevision: 40,
    session: {
      startedAtRevision: 3,
      learningAgreement: { ...supported.learningAgreement!, maximumHintLevel: 5 },
      assistance: {
        attempt: { summary: "independent attempted implementation", bypassed: false, recordedAt: 0 },
        hypothesis: undefined, hint: { level: 1, recordedAt: 0 }, solutionReveal: undefined,
      },
    },
  });
  const store = new InMemoryJournal("workspace-1", before);
  let sequence = 0;
  const execute = vi.fn<EffectPort["execute"]>(request => Promise.resolve({
    operationId: request.operationId, status: "confirmed", summary: "The isolated product check passed.",
    observation: { passed: true, exitCode: 0 }, sensitiveData: false, partial: false,
  }));
  const coordinator = new PairCoordinator({
    store, streamId: "workspace-1", effects: { execute },
    clock: { now: () => 1_000 + sequence }, ids: { next: prefix => `${prefix}-boundary-${++sequence}` },
  });
  const consent = new ModelConsentRegistry();
  const evaluations = new GrowthEvaluationLog(() => 2_000);
  const requestWorkspaceConsent = vi.fn<(model: vscode.LanguageModelChat) => Promise<boolean>>(() => Promise.resolve(true));
  const confirmSolutionReveal = vi.fn<(model: vscode.LanguageModelChat) => Promise<boolean>>(() => Promise.resolve(true));
  const requestModel = vi.fn<GrowthModel["request"]>(() => Promise.resolve({ level: 1, kind: "question", text: answer }));
  const createModel = vi.fn<(model: vscode.LanguageModelChat) => GrowthModel>(() => ({ request: requestModel }));
  const grant = vi.spyOn(coordinator, "grantUserAction");
  const participant = new GrowthParticipant({
    coordinator, snapshotNow: () => store.snapshotNow(), consent, evaluations,
    requestWorkspaceConsent, confirmSolutionReveal, createModel, now: () => 3_000,
  });
  const start = (command?: string, model = destination(), source = cancellation()) => {
    const { stream, collected } = createResponseStream();
    const publishedAfterAbort: string[] = [];
    const markdown = stream.markdown.bind(stream);
    const publish = vi.spyOn(stream, "markdown").mockImplementation(value => {
      if (source.token.isCancellationRequested) publishedAfterAbort.push(typeof value === "string" ? value : value.value);
      return markdown(value);
    });
    const request = { ...createRequest(new FakeModel([]), command === undefined ? {} : { command }), model };
    const done = participant.handle(request, createContext([{ prompt: "bounded private context" }]), stream, source.token);
    return { done, stream, collected, publishedAfterAbort, source, model, publish };
  };
  const run = async (command?: string, model = destination()) => {
    const running = start(command, model);
    await running.done;
    return running.collected.markdown.join("\n");
  };
  return {
    before, store, coordinator, consent, evaluations, requestWorkspaceConsent, confirmSolutionReveal,
    requestModel, createModel, grant, execute, participant, start, run,
  };
};

export type RouteBoundaryFixture = ReturnType<typeof routeBoundaryFixture>;

export const recreate = async (
  fixture: RouteBoundaryFixture,
  mode: OperatingMode = "growth",
  workspaceId = "workspace-1",
) => {
  const { coordinator, before, store } = fixture;
  const session = before.session!;
  const workUnit = session.workUnit!;
  await coordinator.setPresence("off");
  await coordinator.setPresence("observing", workspaceId);
  const commands = [
    { type: "StartSession", sessionId: session.sessionId },
    { type: "CaptureEntry", entry: { ...session.entrySnapshot!, workspaceId } },
    { type: "ConfirmLearning", agreement: session.learningAgreement! },
    { type: "SelectMode", mode },
    { type: "ProposeWorkUnit", workUnit: { ...workUnit, mode, status: "proposed" } },
    { type: "AgreeWorkUnit", workUnitId: workUnit.id },
  ] as const;
  for (const command of commands) await coordinator.dispatch({
    ...command, protocolVersion: 1, commandId: `boundary-${store.snapshotNow().revision}-${command.type}`,
    expectedRevision: store.snapshotNow().revision, actor: "human", observedAt: 4_000,
  });
  return store.snapshotNow();
};

export const staleSnapshotOnce = (fixture: RouteBoundaryFixture, transition: () => Promise<unknown>) => {
  const snapshot = fixture.coordinator.snapshot.bind(fixture.coordinator);
  vi.spyOn(fixture.coordinator, "snapshot").mockImplementationOnce(async () => {
    const captured = await snapshot();
    await transition();
    return captured;
  });
};
