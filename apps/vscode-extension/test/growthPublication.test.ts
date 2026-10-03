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

const answer = { level: 1, kind: "question", text: "What have you tried?" } as const;

/**
 * A real coordinator whose evaluation and markdown publications record the
 * live journal state at the moment each one happens.
 */
const publicationFixture = (format: "plain" | "runtime") => {
  const before = growthSnapshot({ runtimeRevision: 4, session: { authorityEpoch: 2 } });
  const store = new InMemoryJournal("workspace-1", before);
  const coordinator = realCoordinator(before, store);
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
  const output = format === "plain" ? answer : {
    response: answer,
    runtime: { runtimeRevision: 4, authorityEpoch: 2, mode: "growth" as const },
  };

  const pause = (commandId: string): Promise<PairRuntimeSnapshot> => coordinator.dispatch({
    protocolVersion: 1,
    commandId,
    expectedRevision: before.revision,
    actor: "human",
    type: "PauseSession",
    reason: "The developer paused Growth",
    observedAt: 1_001,
  });

  const handle = async (snapshotNow: () => PairRuntimeSnapshot, onRequest: () => void): Promise<void> => {
    await new GrowthParticipant({
      coordinator,
      snapshotNow,
      consent,
      evaluations,
      createModel: () => ({
        request: () => {
          onRequest();
          return Promise.resolve(output);
        },
      }),
      requestWorkspaceConsent: () => Promise.resolve(true),
      confirmSolutionReveal: () => Promise.resolve(true),
    }).handle(createRequest(model), createContext(), stream, createToken());
  };

  /** The pause commits, yet both publications observed the pre-pause state. */
  const expectPublishedBeforePause = async (paused: Promise<PairRuntimeSnapshot> | undefined): Promise<void> => {
    expect(paused).toBeDefined();
    await paused;
    expect(store.snapshotNow()).toMatchObject({ revision: 5, session: { authorityEpoch: 3, status: "paused" } });
    const expectedState = { revision: 4, epoch: 2, status: "active" };
    expect(publications).toEqual([
      { surface: "evaluation", ...expectedState },
      { surface: "markdown", ...expectedState },
    ]);
    expect(evaluations.records.at(-1)?.outcome).toBe("delivered");
    expect(collected.markdown).toEqual([answer.text]);
  };

  return { store, pause, handle, expectPublishedBeforePause };
};

describe.each(["plain", "runtime"] as const)("GrowthParticipant %s publication boundary", format => {
  it("does not publish from an async snapshot captured before a queued pause commits", async () => {
    const fixture = publicationFixture(format);
    let paused: Promise<PairRuntimeSnapshot> | undefined;

    await fixture.handle(() => fixture.store.snapshotNow(), () => {
      queueMicrotask(() => queueMicrotask(() => {
        paused = fixture.pause("pause-from-model-response");
      }));
    });

    await fixture.expectPublishedBeforePause(paused);
  });

  it.each([0, 1, 2, 3])("keeps finalization and publication in one continuation with pause delayed by %i microtasks", async delay => {
    const fixture = publicationFixture(format);
    let requested = false;
    let responseSnapshots = 0;
    let paused: Promise<PairRuntimeSnapshot> | undefined;
    const snapshotNow = (): PairRuntimeSnapshot => {
      const current = fixture.store.snapshotNow();
      if (requested && ++responseSnapshots === 1) {
        let remaining = delay;
        const dispatchPause = (): void => {
          if (remaining > 0) {
            remaining -= 1;
            queueMicrotask(dispatchPause);
            return;
          }
          paused = fixture.pause("pause-at-publication");
        };
        dispatchPause();
      }
      return current;
    };

    await fixture.handle(snapshotNow, () => { requested = true; });

    await fixture.expectPublishedBeforePause(paused);
    expect(responseSnapshots).toBe(1);
  });
});
