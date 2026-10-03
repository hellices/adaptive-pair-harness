import { describe, expect, it, vi } from "vitest";
import type { GrowthModel, GrowthModelOutput } from "@adaptive-pair/runtime";
import { TRANSFER_NOT_DEMONSTRATED_NOTE } from "../src/growthPresentation.js";
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
  growthSnapshot,
} from "./growthTestHarness.js";
import { cancellation, deferred } from "./growthRouteBoundaryHarness.js";

// Model output carries its runtime boundary, as the production adapter does.
// The plain-output branch is exercised by growthPublication, growthTransferIntent
// and runtime guardedGrowthTurn; cancellation is independent of the format.
const runtimeResult = <Response>(response: Response, revision: number) => ({
  response,
  runtime: { runtimeRevision: revision, authorityEpoch: 2, mode: "growth" as const },
});

describe("Growth response cancellation", () => {
  it.each([
    { route: "guidance", command: undefined, timing: "during request" },
    { route: "guidance", command: undefined, timing: "after response" },
    { route: "transfer", command: "transfer", timing: "during request" },
    { route: "transfer", command: "transfer", timing: "after response" },
  ] as const)("suppresses $route publication cancelled $timing", async ({ command, timing }) => {
    const before = growthSnapshot({ runtimeRevision: 4, session: { authorityEpoch: 2 } });
    const coordinator = realCoordinator(before);
    const model = new FakeModel([]);
    const consent = new ModelConsentRegistry();
    consent.grant(asModel(model), coordinator.snapshotNow());
    const evaluations = new GrowthEvaluationLog();
    const { stream, collected } = createResponseStream();
    const { token, cancel } = cancellation();
    let modelSignal: AbortSignal | undefined;
    const answer = {
      level: 1,
      kind: "question",
      text: command === "transfer"
        ? "Independent variation: build a bounded queue and prove its capacity."
        : "What have you tried?",
    } as const;
    const requestModel = vi.fn<GrowthModel["request"]>((_instructions, _tools, signal) => {
      modelSignal = signal;
      if (timing === "during request") {
        cancel();
      } else {
        queueMicrotask(() => queueMicrotask(cancel));
      }
      return Promise.resolve(runtimeResult(answer, before.revision));
    });
    const participant = new GrowthParticipant({
      coordinator,
      snapshotNow: () => coordinator.snapshotNow(),
      consent,
      evaluations,
      createModel: () => ({ request: requestModel }),
      requestWorkspaceConsent: () => Promise.resolve(true),
      confirmSolutionReveal: () => Promise.resolve(true),
    });

    await participant.handle(
      createRequest(model, command === undefined ? {} : { command }),
      createContext(),
      stream,
      token,
    );

    expect(requestModel).toHaveBeenCalledTimes(1);
    expect(modelSignal?.aborted).toBe(true);
    expect.soft(collected.markdown).toEqual([]);
    expect.soft(evaluations.records).toMatchObject([
      { outcome: "restraint-failure", reason: "GROWTH_CANCELLED" },
    ]);
    expect.soft(participant.transferStatus()).toBeUndefined();
    expect(coordinator.snapshotNow()).toEqual(before);
  });
});

describe("Growth transfer continuation cancellation", () => {
  it.each([
    { timing: "response+2", followup: false },
    { timing: "snapshot-return", followup: false },
    { timing: "response+3", followup: true },
    { timing: "uncancelled", followup: true },
  ] as const)("bounds the transfer follow-up at $timing", async ({ timing, followup }) => {
    const before = growthSnapshot({ runtimeRevision: 4, session: { authorityEpoch: 2 } });
    const coordinator = realCoordinator(before);
    const model = new FakeModel([]);
    const consent = new ModelConsentRegistry();
    consent.grant(asModel(model), coordinator.snapshotNow());
    const evaluations = new GrowthEvaluationLog();
    const { stream, collected } = createResponseStream();
    const { token, cancel } = cancellation();
    const requestStarted = deferred<AbortSignal>();
    const reply = deferred<GrowthModelOutput>();
    let publicationProbeArmed = false;
    let snapshotCancellationQueued = false;
    const cancelledAtEvaluation: boolean[] = [];
    const cancelledAtMarkdown: boolean[] = [];
    const record = evaluations.record.bind(evaluations);
    vi.spyOn(evaluations, "record").mockImplementation(input => {
      cancelledAtEvaluation.push(token.isCancellationRequested);
      record(input);
    });
    const markdown = stream.markdown.bind(stream);
    vi.spyOn(stream, "markdown").mockImplementation(value => {
      cancelledAtMarkdown.push(token.isCancellationRequested);
      return markdown(value);
    });
    let startedAtCancellation = false;
    const cancelChat = (): void => {
      startedAtCancellation = participant.transferStatus() !== undefined;
      cancel();
    };
    const requestModel = vi.fn<GrowthModel["request"]>((_instructions, _tools, signal) => {
      requestStarted.resolve(signal);
      return reply.promise;
    });
    const participant = new GrowthParticipant({
      coordinator,
      snapshotNow: () => {
        const current = coordinator.snapshotNow();
        if (timing === "snapshot-return" && publicationProbeArmed && !snapshotCancellationQueued) {
          snapshotCancellationQueued = true;
          queueMicrotask(cancelChat);
        }
        return current;
      },
      consent,
      evaluations,
      createModel: () => ({ request: requestModel }),
      requestWorkspaceConsent: () => Promise.resolve(true),
      confirmSolutionReveal: () => Promise.resolve(true),
    });
    const answer = {
      level: 1,
      kind: "question",
      text: "Independent variation: design a bounded queue and prove its capacity.",
    } as const;

    const pending = participant.handle(createRequest(model, { command: "transfer" }), createContext(), stream, token);
    const signal = await requestStarted.promise;
    publicationProbeArmed = true;
    reply.resolve(runtimeResult(answer, before.revision));
    if (timing === "response+2") {
      queueMicrotask(() => queueMicrotask(cancelChat));
    } else if (timing === "response+3") {
      queueMicrotask(() => queueMicrotask(() => queueMicrotask(cancelChat)));
    }
    await pending;

    expect(requestModel).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(timing !== "uncancelled");
    expect(startedAtCancellation).toBe(timing === "response+3");
    expect(cancelledAtEvaluation).toEqual([false]);
    expect(evaluations.records).toMatchObject([
      { outcome: "transfer-started", level: answer.level, kind: answer.kind, reason: undefined },
    ]);
    expect.soft(cancelledAtMarkdown).toEqual(followup ? [false, false] : [false]);
    expect.soft(collected.markdown).toEqual(followup ? [answer.text, TRANSFER_NOT_DEMONSTRATED_NOTE] : [answer.text]);
    expect.soft(participant.transferStatus() !== undefined).toBe(followup);
    expect(coordinator.snapshotNow()).toEqual(before);
  });
});
