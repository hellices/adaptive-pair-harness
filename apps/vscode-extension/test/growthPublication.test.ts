import { describe, expect, it, vi } from "vitest";
import { type PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { InMemoryJournal } from "@adaptive-pair/runtime";
import {
  GrowthParticipant,
  GrowthEvaluationLog,
  ModelConsentRegistry,
  FakeModel,
  asModel,
  realCoordinator,
  createResponseStream,
  createToken,
  createRequest,
  createContext,
  growthSnapshot,
} from "./growthTestHarness.js";

describe.each(["plain", "runtime"] as const)("GrowthParticipant %s publication boundary", format => {
  it("does not publish from an async snapshot captured before a queued pause commits", async () => {
    const before = growthSnapshot({ runtimeRevision: 4, session: { authorityEpoch: 2 } });
    const store = new InMemoryJournal("workspace-1", before);
    const coordinator = realCoordinator(before, store);
    let pause: Promise<PairRuntimeSnapshot> | undefined;
    const publications: { surface: string; revision: number; epoch: number | undefined; status: string | undefined }[] = [];
    const observe = (surface: string): void => {
      const current = store.snapshotNow();
      publications.push({ surface, revision: current.revision, epoch: current.session?.authorityEpoch, status: current.session?.status });
    };
    const evaluations = new GrowthEvaluationLog();
    const record = evaluations.record.bind(evaluations);
    vi.spyOn(evaluations, "record").mockImplementation(entry => {
      observe("evaluation");
      record(entry);
    });
    const { stream, collected } = createResponseStream();
    const markdown = stream.markdown.bind(stream);
    vi.spyOn(stream, "markdown").mockImplementation(value => {
      observe("markdown");
      return markdown(value);
    });
    const model = new FakeModel([]);
    const consent = new ModelConsentRegistry();
    consent.grant(asModel(model), coordinator.snapshotNow());
    const answer = { level: 1, kind: "question", text: "What have you tried?" } as const;
    const participant = new GrowthParticipant({
      coordinator,
      snapshotNow: () => store.snapshotNow(),
      consent,
      evaluations,
      createModel: () => ({
        request: () => {
          queueMicrotask(() => queueMicrotask(() => {
            pause = coordinator.dispatch({
              protocolVersion: 1,
              commandId: "pause-from-model-response",
              expectedRevision: before.revision,
              actor: "human",
              type: "PauseSession",
              reason: "The developer paused Growth",
              observedAt: 1_001,
            });
          }));
          return Promise.resolve(format === "plain" ? answer : {
            response: answer,
            runtime: { runtimeRevision: 4, authorityEpoch: 2, mode: "growth" },
          });
        },
      }),
      requestWorkspaceConsent: () => Promise.resolve(true),
      confirmSolutionReveal: () => Promise.resolve(true),
    });

    await participant.handle(createRequest(model), createContext(), stream, createToken());
    expect(pause).toBeDefined();
    await pause;

    expect(store.snapshotNow()).toMatchObject({ revision: 5, session: { authorityEpoch: 3, status: "paused" } });
    const expectedState = { revision: 4, epoch: 2, status: "active" };
    expect(publications).toEqual([
      { surface: "evaluation", ...expectedState },
      { surface: "markdown", ...expectedState },
    ]);
    expect(evaluations.records.at(-1)?.outcome).toBe("delivered");
    expect(collected.markdown).toEqual([answer.text]);
  });

  it.each([0, 1, 2, 3])("keeps finalization and publication in one continuation with pause delayed by %i microtasks", async delay => {
    const before = growthSnapshot({ runtimeRevision: 4, session: { authorityEpoch: 2 } });
    const store = new InMemoryJournal("workspace-1", before);
    const coordinator = realCoordinator(before, store);
    let requested = false;
    let responseSnapshots = 0;
    let pause: Promise<PairRuntimeSnapshot> | undefined;
    const snapshotNow = (): PairRuntimeSnapshot => {
      const current = store.snapshotNow();
      if (requested && ++responseSnapshots === 1) {
        let remaining = delay;
        const dispatchPause = (): void => {
          if (remaining > 0) {
            remaining -= 1;
            queueMicrotask(dispatchPause);
            return;
          }
          pause = coordinator.dispatch({
            protocolVersion: 1,
            commandId: "pause-at-publication",
            expectedRevision: before.revision,
            actor: "human",
            type: "PauseSession",
            reason: "The developer paused Growth",
            observedAt: 1_001,
          });
        };
        dispatchPause();
      }
      return current;
    };
    const publications: { surface: string; revision: number; epoch: number | undefined; status: string | undefined }[] = [];
    const observe = (surface: string): void => {
      const current = store.snapshotNow();
      publications.push({ surface, revision: current.revision, epoch: current.session?.authorityEpoch, status: current.session?.status });
    };
    const evaluations = new GrowthEvaluationLog();
    const record = evaluations.record.bind(evaluations);
    vi.spyOn(evaluations, "record").mockImplementation(entry => {
      observe("evaluation");
      record(entry);
    });
    const { stream, collected } = createResponseStream();
    const markdown = stream.markdown.bind(stream);
    vi.spyOn(stream, "markdown").mockImplementation(value => {
      observe("markdown");
      return markdown(value);
    });
    const model = new FakeModel([]);
    const consent = new ModelConsentRegistry();
    consent.grant(asModel(model), coordinator.snapshotNow());
    const answer = { level: 1, kind: "question", text: "What have you tried?" } as const;
    const participant = new GrowthParticipant({
      coordinator,
      snapshotNow,
      consent,
      evaluations,
      createModel: () => ({
        request: () => {
          requested = true;
          return Promise.resolve(format === "plain" ? answer : {
            response: answer,
            runtime: { runtimeRevision: 4, authorityEpoch: 2, mode: "growth" },
          });
        },
      }),
      requestWorkspaceConsent: () => Promise.resolve(true),
      confirmSolutionReveal: () => Promise.resolve(true),
    });

    await participant.handle(createRequest(model), createContext(), stream, createToken());
    expect(pause).toBeDefined();
    await pause;

    expect(store.snapshotNow()).toMatchObject({ revision: 5, session: { authorityEpoch: 3, status: "paused" } });
    const expectedState = { revision: 4, epoch: 2, status: "active" };
    expect(publications).toEqual([
      { surface: "evaluation", ...expectedState },
      { surface: "markdown", ...expectedState },
    ]);
    expect(evaluations.records.at(-1)?.outcome).toBe("delivered");
    expect(collected.markdown).toEqual([answer.text]);
    expect(responseSnapshots).toBe(1);
  });
});
