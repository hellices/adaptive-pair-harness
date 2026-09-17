import { describe, expect, it, vi } from "vitest";
import type { OperatingMode } from "@adaptive-pair/protocol";
import {
  FakeCoordinator,
  FakeModel,
  GrowthEvaluationLog,
  GrowthParticipant,
  ModelConsentRegistry,
  buildParticipant,
  createContext,
  createRequest,
  createResponseStream,
  createToken,
  growthSnapshot,
} from "./growthTestHarness.js";

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
};

const modeSnapshot = (mode: OperatingMode | undefined) => {
  const before = growthSnapshot({ runtimeRevision: 4 });
  return growthSnapshot({
    runtimeRevision: 4,
    session: {
      mode,
      workUnit: { ...before.session!.workUnit!, mode: mode ?? "growth" },
    },
  });
};

const responseModel = () => new FakeModel([{
  text: JSON.stringify({ level: 1, kind: "question", text: "Which invariant did you check?" }),
}]);

describe.each(["pair", "delivery", undefined] as const)("Growth route mode %s", mode => {
  it.each([undefined, "hint", "reveal", "transfer"])(
    "rejects %s before consent, reveal confirmation, or any Growth action",
    async command => {
      const coordinator = new FakeCoordinator(modeSnapshot(mode));
      const requestWorkspaceConsent = vi.fn(() => Promise.resolve(true));
      const confirmSolutionReveal = vi.fn(() => Promise.resolve(true));
      const { participant } = buildParticipant(coordinator, { requestWorkspaceConsent, confirmSolutionReveal });
      const model = responseModel();
      const { stream, collected } = createResponseStream();

      await participant.handle(
        createRequest(model, command === undefined ? {} : { command }),
        createContext([{ prompt: "private context" }]),
        stream,
        createToken(),
      );

      expect(requestWorkspaceConsent).not.toHaveBeenCalled();
      expect(confirmSolutionReveal).not.toHaveBeenCalled();
      expect(coordinator.prepareInputs).toEqual([]);
      expect(coordinator.invokeCalls).toEqual([]);
      expect(coordinator.grantCalls).toEqual([]);
      expect(model.sendCount).toBe(0);
      expect(model.countTokensCount).toBe(0);
      expect(collected.markdown.join("\n")).toContain("No Growth work unit is agreed");
    },
  );
});

describe("Growth deferred route mode", () => {
  it("does not publish a model-reported boundary from a different workspace", async () => {
    const before = modeSnapshot("growth");
    const after = { ...before, revision: 5, presence: { ...before.presence, workspaceId: "workspace-2" } };
    const coordinator = new FakeCoordinator(before);
    const participant = new GrowthParticipant({
      coordinator,
      snapshotNow: () => coordinator.snapshotNow(),
      consent: new ModelConsentRegistry(),
      evaluations: new GrowthEvaluationLog(),
      requestWorkspaceConsent: () => Promise.resolve(true),
      confirmSolutionReveal: () => Promise.resolve(true),
      createModel: () => ({
        request: () => {
          coordinator.setSnapshot(after);
          return Promise.resolve({
            response: { level: 1, kind: "question", text: "This belongs to the wrong workspace." },
            runtime: { runtimeRevision: 5, authorityEpoch: after.session?.authorityEpoch, mode: "growth" },
          });
        },
      }),
    });
    const { stream, collected } = createResponseStream();

    await participant.handle(createRequest(responseModel()), createContext(), stream, createToken());

    expect(collected.markdown.join("\n")).not.toContain("This belongs to the wrong workspace.");
    expect(collected.markdown.join("\n")).toContain("Ask again");
  });

  it("keeps ordinary guidance available for an agreed Growth work unit", async () => {
    const coordinator = new FakeCoordinator(modeSnapshot("growth"));
    const model = responseModel();
    const { participant } = buildParticipant(coordinator);
    const { stream, collected } = createResponseStream();

    await participant.handle(createRequest(model), createContext(), stream, createToken());

    expect(model.sendCount).toBe(1);
    expect(collected.markdown).toEqual(["Which invariant did you check?"]);
  });

  it.each([undefined, "hint", "reveal"])(
    "does not apply pending %s consent after the runtime leaves Growth",
    async command => {
      const before = modeSnapshot("growth");
      const coordinator = new FakeCoordinator(before);
      const requested = deferred<void>();
      const consent = deferred<boolean>();
      const model = responseModel();
      const { participant } = buildParticipant(coordinator, {
        requestWorkspaceConsent: () => {
          requested.resolve(undefined);
          return consent.promise;
        },
      });
      const { stream, collected } = createResponseStream();
      const pending = participant.handle(
        createRequest(model, command === undefined ? {} : { command }),
        createContext(), stream, createToken(),
      );
      await requested.promise;
      coordinator.setSnapshot({
        ...before,
        revision: 5,
        session: { ...before.session!, mode: "pair", authorityEpoch: 1 },
      });
      consent.resolve(true);
      await pending;

      expect(coordinator.grantCalls).toEqual([]);
      expect(coordinator.invokeCalls).toEqual([]);
      expect(coordinator.prepareInputs).toEqual([]);
      expect(model.sendCount).toBe(0);
      expect(collected.markdown.join("\n")).toContain("Ask again");
    },
  );

  it("binds solution reveal to the session that opened its confirmation", async () => {
    const before = modeSnapshot("growth");
    const coordinator = new FakeCoordinator(before);
    const requested = deferred<void>();
    const reveal = deferred<boolean>();
    const requestWorkspaceConsent = vi.fn(() => Promise.resolve(true));
    const model = responseModel();
    const { participant } = buildParticipant(coordinator, {
      requestWorkspaceConsent,
      confirmSolutionReveal: () => {
        requested.resolve(undefined);
        return reveal.promise;
      },
    });
    const { stream } = createResponseStream();
    const pending = participant.handle(
      createRequest(model, { command: "reveal" }), createContext(), stream, createToken(),
    );
    await requested.promise;
    coordinator.setSnapshot({
      ...before,
      revision: 8,
      session: { ...before.session!, startedAtRevision: 6 },
    });
    reveal.resolve(true);
    await pending;

    expect(requestWorkspaceConsent).not.toHaveBeenCalled();
    expect(coordinator.grantCalls).toEqual([]);
    expect(coordinator.invokeCalls).toEqual([]);
    expect(model.sendCount).toBe(0);
  });
});
