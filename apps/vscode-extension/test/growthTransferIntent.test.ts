import { describe, expect, it, vi } from "vitest";
import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { InMemoryJournal, type GrowthModel, type GrowthModelOutput } from "@adaptive-pair/runtime";
import { CONSENT_DECLINED_MESSAGE, STALE_TURN_MESSAGE, TRANSFER_NOT_DEMONSTRATED_NOTE } from "../src/growthPresentation.js";
import {
  GrowthParticipant,
  GrowthEvaluationLog,
  ModelConsentRegistry,
  FakeModel,
  asModel,
  realCoordinator,
  createResponseStream,
  createRequest,
  createContext,
  createToken,
  growthSnapshot,
} from "./growthTestHarness.js";

type ModelFormat = "plain" | "runtime";

const variation = "Independent variation: design a bounded queue and prove its capacity.";

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
};

const modelOutput = (format: ModelFormat, snapshot: PairRuntimeSnapshot): GrowthModelOutput => {
  const response = { level: 1, kind: "question", text: variation } as const;
  return format === "plain" ? response : {
    response,
    runtime: {
      runtimeRevision: snapshot.revision,
      authorityEpoch: snapshot.session?.authorityEpoch,
      mode: snapshot.session?.mode,
    },
  };
};

const transferHarness = (format: ModelFormat, consentDecision = Promise.resolve(true)) => {
  const before = growthSnapshot({ runtimeRevision: 4, session: { authorityEpoch: 0 } });
  const store = new InMemoryJournal("workspace-1", before);
  const coordinator = realCoordinator(before, store);
  const model = new FakeModel([]);
  const consent = new ModelConsentRegistry();
  const evaluations = new GrowthEvaluationLog();
  const { stream, collected } = createResponseStream();
  const consentRequested = deferred<void>();
  const modelStarted = deferred<void>();
  const requestWorkspaceConsent = vi.fn(() => {
    consentRequested.resolve(undefined);
    return consentDecision;
  });
  const requestModel = vi.fn<GrowthModel["request"]>(() => Promise.resolve(modelOutput(format, store.snapshotNow())));
  const growthModel: GrowthModel = {
    request: (...args) => {
      modelStarted.resolve(undefined);
      return requestModel(...args);
    },
  };
  const createModel = vi.fn(() => growthModel);
  const participant = new GrowthParticipant({
    coordinator,
    snapshotNow: () => store.snapshotNow(),
    consent,
    evaluations,
    createModel,
    requestWorkspaceConsent,
    confirmSolutionReveal: () => Promise.resolve(true),
    now: () => 1_000,
  });
  const run = (): Promise<void> => participant.handle(
    createRequest(model, { command: "transfer" }), createContext(), stream, createToken(),
  );
  return {
    before, store, coordinator, model, consent, evaluations, stream, collected,
    consentRequested, modelStarted, requestWorkspaceConsent, requestModel, createModel, participant, run,
  };
};

type TransferHarness = ReturnType<typeof transferHarness>;

const replaceWorkUnit = async (
  { before, store, coordinator }: TransferHarness,
  sessionId = "session-2",
  workUnitId = "unit-2",
  sameIntent = false,
): Promise<void> => {
  const session = before.session;
  if (session?.entrySnapshot === undefined || session.learningAgreement === undefined || session.workUnit === undefined) {
    throw new Error("Expected an agreed Growth fixture");
  }
  await coordinator.setPresence("off");
  await coordinator.setPresence("observing", "workspace-1");
  const commands = [
    { type: "StartSession", sessionId },
    { type: "CaptureEntry", entry: session.entrySnapshot },
    { type: "ConfirmLearning", agreement: sameIntent ? session.learningAgreement : { ...session.learningAgreement, independentCheck: "Test a varied queue bound" } },
    { type: "SelectMode", mode: "growth" },
    {
      type: "ProposeWorkUnit",
      workUnit: {
        ...session.workUnit,
        id: workUnitId,
        objective: sameIntent ? session.workUnit.objective : "Design a bounded queue",
        capability: sameIntent ? session.workUnit.capability : "diagnosis",
        status: "proposed",
        allowedPaths: sameIntent ? session.workUnit.allowedPaths : ["src/queue.ts"],
        verificationPlan: sameIntent ? session.workUnit.verificationPlan : "npm run lint",
      },
    },
    { type: "AgreeWorkUnit", workUnitId },
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

const expectStaleTransfer = (fixture: TransferHarness, modelCalls: number): void => {
  expect.soft(fixture.requestModel).toHaveBeenCalledTimes(modelCalls);
  expect.soft(fixture.createModel).toHaveBeenCalledTimes(modelCalls);
  expect.soft(fixture.collected.markdown).toEqual([STALE_TURN_MESSAGE]);
  expect.soft(fixture.evaluations.records).toMatchObject([{ outcome: "restraint-failure", reason: "STALE_TURN" }]);
  expect.soft(fixture.participant.transferStatus()).toBeUndefined();
};

const expectStartedTransfer = (fixture: TransferHarness): void => {
  expect(fixture.requestModel).toHaveBeenCalledTimes(1);
  expect(fixture.createModel).toHaveBeenCalledTimes(1);
  expect(fixture.collected.markdown).toEqual([variation, TRANSFER_NOT_DEMONSTRATED_NOTE]);
  expect(fixture.evaluations.records).toMatchObject([{ outcome: "transfer-started", reason: undefined }]);
  expect(fixture.participant.transferStatus()).toMatchObject({
    status: "started",
    sessionId: fixture.before.session?.sessionId,
    workUnitId: fixture.before.session?.workUnit?.id,
    independentCheck: fixture.before.session?.learningAgreement?.independentCheck,
    demonstrated: false,
  });
};

describe.each(["plain", "runtime"] as const)("Growth %s deferred transfer consent", format => {
  it.each([
    { sessionId: "session-2", workUnitId: "unit-2" },
    { sessionId: "session-2", workUnitId: "unit-1" },
    { sessionId: "session-1", workUnitId: "unit-2" },
    { sessionId: "session-1", workUnitId: "unit-1" },
  ])("rejects changed intent at $sessionId/$workUnitId without constructing a model", async ({ sessionId, workUnitId }) => {
    const consentDecision = deferred<boolean>();
    const fixture = transferHarness(format, consentDecision.promise);
    const pending = fixture.run();
    await fixture.consentRequested.promise;
    expect(fixture.requestModel).not.toHaveBeenCalled();

    await replaceWorkUnit(fixture, sessionId, workUnitId);
    const changed = fixture.store.snapshotNow();
    expect(changed.session).toMatchObject({ sessionId, authorityEpoch: 0, mode: "growth", workUnit: { id: workUnitId } });
    consentDecision.resolve(true);
    await pending;

    expectStaleTransfer(fixture, 0);
    expect(fixture.store.snapshotNow()).toEqual(changed);
    expect(fixture.requestWorkspaceConsent).toHaveBeenCalledTimes(1);
    expect(fixture.consent.has(asModel(fixture.model))).toBe(true);
  });

  it.each(["unchanged", "observed"] as const)("keeps explicit consent for an %s intent", async change => {
    const consentDecision = deferred<boolean>();
    const fixture = transferHarness(format, consentDecision.promise);
    const pending = fixture.run();
    await fixture.consentRequested.promise;
    expect(fixture.requestModel).not.toHaveBeenCalled();
    if (change === "observed") {
      await fixture.coordinator.observeWorkspace();
    }
    consentDecision.resolve(true);
    await pending;

    expectStartedTransfer(fixture);
    expect(fixture.requestWorkspaceConsent).toHaveBeenCalledTimes(1);
  });

  it("keeps a decline neutral even if the session changes while consent is pending", async () => {
    const consentDecision = deferred<boolean>();
    const fixture = transferHarness(format, consentDecision.promise);
    const pending = fixture.run();
    await fixture.consentRequested.promise;
    await replaceWorkUnit(fixture);
    consentDecision.resolve(false);
    await pending;

    expect(fixture.createModel).not.toHaveBeenCalled();
    expect(fixture.requestModel).not.toHaveBeenCalled();
    expect(fixture.collected.markdown).toEqual([CONSENT_DECLINED_MESSAGE]);
    expect(fixture.evaluations.records).toEqual([]);
    expect(fixture.participant.transferStatus()).toBeUndefined();
    expect(fixture.consent.has(asModel(fixture.model))).toBe(false);
  });
});

describe.each(["plain", "runtime"] as const)("Growth %s transfer preparation intent", format => {
  it("does not rebind intent when the guarded request's snapshot moves to another work unit", async () => {
    const fixture = transferHarness(format);
    const snapshot = fixture.coordinator.snapshot.bind(fixture.coordinator);
    let reads = 0;
    vi.spyOn(fixture.coordinator, "snapshot").mockImplementation(async () => {
      if (++reads === 2) {
        await replaceWorkUnit(fixture);
      }
      return snapshot();
    });

    await fixture.run();

    expect(fixture.store.snapshotNow().session?.workUnit?.id).toBe("unit-2");
    expectStaleTransfer(fixture, 0);
  });

  it("retains the before/prepared revision fence during a work-unit replacement", async () => {
    const fixture = transferHarness(format);
    const prepare = fixture.coordinator.prepareTurn.bind(fixture.coordinator);
    vi.spyOn(fixture.coordinator, "prepareTurn").mockImplementationOnce(async input => {
      await replaceWorkUnit(fixture);
      return prepare(input);
    });

    await fixture.run();

    expectStaleTransfer(fixture, 0);
  });
});

describe.each(["plain", "runtime"] as const)("Growth %s transfer response intent", format => {
  it.each(["replacement", "reused IDs", "paused", "closed"] as const)("rejects a %s intent even if the model reports the new runtime", async change => {
    const fixture = transferHarness(format);
    const reply = deferred<GrowthModelOutput>();
    fixture.requestModel.mockReturnValueOnce(reply.promise);
    const pending = fixture.run();
    await fixture.modelStarted.promise;
    if (change === "replacement" || change === "reused IDs") {
      await replaceWorkUnit(fixture, change === "reused IDs" ? "session-1" : "session-2", change === "reused IDs" ? "unit-1" : "unit-2");
    } else if (change === "paused") {
      await fixture.coordinator.setPresence("paused");
    } else {
      await fixture.coordinator.dispatch({
        protocolVersion: 1, commandId: "close-pending-transfer", expectedRevision: fixture.store.snapshotNow().revision,
        actor: "human", observedAt: 1_001, type: "CloseSession",
      });
    }
    const changed = fixture.store.snapshotNow();
    reply.resolve(modelOutput(format, changed));
    await pending;

    expectStaleTransfer(fixture, 1);
    expect(fixture.store.snapshotNow()).toEqual(changed);
  });
});

it("allows a model-reported revision advance within the same transfer intent", async () => {
  const fixture = transferHarness("runtime");
  const reply = deferred<GrowthModelOutput>();
  fixture.requestModel.mockReturnValueOnce(reply.promise);
  const pending = fixture.run();
  await fixture.modelStarted.promise;
  await fixture.coordinator.observeWorkspace();
  reply.resolve(modelOutput("runtime", fixture.store.snapshotNow()));
  await pending;

  expect(fixture.store.snapshotNow().revision).toBeGreaterThan(fixture.before.revision);
  expectStartedTransfer(fixture);
});

describe.each(["plain", "runtime"] as const)("Growth %s transfer lifecycle identity", format => {
  it.each(["consent", "request-snapshot", "prepared-return", "model"] as const)("rejects an identically recreated session across %s", async phase => {
    const consent = deferred<boolean>();
    const fixture = transferHarness(format, phase === "consent" ? consent.promise : Promise.resolve(true));
    const recreate = () => replaceWorkUnit(fixture, "session-1", "unit-1", true);
    if (phase === "request-snapshot") {
      const snapshot = fixture.coordinator.snapshot.bind(fixture.coordinator);
      let reads = 0;
      vi.spyOn(fixture.coordinator, "snapshot").mockImplementation(async () => {
        if (++reads === 2) {
          await recreate();
        }
        return snapshot();
      });
    } else if (phase === "prepared-return") {
      const prepare = fixture.coordinator.prepareTurn.bind(fixture.coordinator);
      vi.spyOn(fixture.coordinator, "prepareTurn").mockImplementationOnce(async input => {
        const prepared = await prepare(input);
        await recreate();
        return prepared;
      });
    }
    const reply = deferred<GrowthModelOutput>();
    if (phase === "model") {
      fixture.requestModel.mockReturnValueOnce(reply.promise);
    }
    const pending = fixture.run();
    if (phase === "consent") {
      await fixture.consentRequested.promise;
      await recreate();
      consent.resolve(true);
    } else if (phase === "model") {
      await fixture.modelStarted.promise;
      await recreate();
      reply.resolve(modelOutput(format, fixture.store.snapshotNow()));
    }
    await pending;

    expect(fixture.store.events().some(event => event.type === "SessionStarted")).toBe(true);
    expect(fixture.store.snapshotNow().session).toMatchObject({
      sessionId: fixture.before.session?.sessionId,
      authorityEpoch: fixture.before.session?.authorityEpoch,
      workUnit: fixture.before.session?.workUnit,
      learningAgreement: fixture.before.session?.learningAgreement,
    });
    expectStaleTransfer(fixture, phase === "consent" || phase === "request-snapshot" ? 0 : 1);
  });
});

describe.each(["plain", "runtime"] as const)("Growth %s transfer publication continuation", format => {
  it.each([
    { transition: "pause", timing: "before follow-up", followup: false },
    { transition: "observation", timing: "before follow-up", followup: false },
    { transition: "pause", timing: "after follow-up", followup: true },
    { transition: "observation", timing: "after follow-up", followup: true },
  ] as const)("fences a $transition committed $timing", async ({ transition, timing, followup }) => {
    const fixture = transferHarness(format);
    const reply = deferred<GrowthModelOutput>();
    fixture.requestModel.mockReturnValueOnce(reply.promise);
    const pending = fixture.run();
    await fixture.modelStarted.promise;
    const commitReached = deferred<void>();
    const releaseCommit = deferred<void>();
    const commit = fixture.store.commit.bind(fixture.store);
    vi.spyOn(fixture.store, "commit").mockImplementationOnce((...args) => {
      commitReached.resolve(undefined);
      return releaseCommit.promise.then(() => commit(...args));
    });
    const changing = transition === "observation" ? fixture.coordinator.observeWorkspace() : fixture.coordinator.dispatch({
      protocolVersion: 1, commandId: "pause-transfer-continuation", expectedRevision: fixture.before.revision,
      actor: "human", observedAt: 1_001, type: "PauseSession", reason: "Paused during transfer publication",
    });
    await commitReached.promise;
    const markdownRevisions: number[] = [];
    const markdown = fixture.stream.markdown.bind(fixture.stream);
    vi.spyOn(fixture.stream, "markdown").mockImplementation(value => {
      markdownRevisions.push(fixture.store.snapshotNow().revision);
      return markdown(value);
    });
    reply.resolve(modelOutput(format, fixture.before));
    if (timing === "before follow-up") {
      queueMicrotask(() => releaseCommit.resolve(undefined));
    } else {
      queueMicrotask(() => queueMicrotask(() => releaseCommit.resolve(undefined)));
    }
    await pending;
    await changing;

    expect(fixture.store.snapshotNow().revision).toBeGreaterThan(fixture.before.revision);
    expect(fixture.evaluations.records).toMatchObject([{ outcome: "transfer-started", reason: undefined }]);
    expect.soft(fixture.collected.markdown).toEqual(followup ? [variation, TRANSFER_NOT_DEMONSTRATED_NOTE] : [variation]);
    expect.soft(markdownRevisions).toEqual(followup ? [fixture.before.revision, fixture.before.revision] : [fixture.before.revision]);
    expect.soft(fixture.participant.transferStatus() !== undefined).toBe(followup);
  });
});
