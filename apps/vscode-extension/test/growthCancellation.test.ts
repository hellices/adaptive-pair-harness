import { describe, expect, it, vi } from "vitest";
import type { CancellationToken } from "vscode";
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

const cancellableToken = (): { readonly token: CancellationToken; readonly cancel: () => void } => {
  let cancelled = false;
  const listeners = new Set<() => void>();
  const token: CancellationToken = {
    get isCancellationRequested() { return cancelled; },
    onCancellationRequested: listener => {
      const notify = (): void => { listener(undefined); };
      listeners.add(notify);
      return { dispose: () => { listeners.delete(notify); } };
    },
  };
  return {
    token,
    cancel: () => {
      cancelled = true;
      for (const listener of listeners) {
        listener();
      }
    },
  };
};

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
};

describe.each(["plain", "runtime"] as const)("Growth %s response cancellation", format => {
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
    consent.grant(asModel(model));
    const evaluations = new GrowthEvaluationLog();
    const { stream, collected } = createResponseStream();
    const { token, cancel } = cancellableToken();
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
      return Promise.resolve(format === "plain" ? answer : {
        response: answer,
        runtime: { runtimeRevision: before.revision, authorityEpoch: 2, mode: "growth" },
      });
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

describe.each(["plain", "runtime"] as const)("Growth %s transfer continuation cancellation", format => {
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
    consent.grant(asModel(model));
    const evaluations = new GrowthEvaluationLog();
    const { stream, collected } = createResponseStream();
    const { token, cancel } = cancellableToken();
    const requestStarted = deferred<AbortSignal>();
    const reply = deferred<GrowthModelOutput>();
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
        if (timing === "snapshot-return") {
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
    reply.resolve(format === "plain" ? answer : {
      response: answer,
      runtime: { runtimeRevision: before.revision, authorityEpoch: 2, mode: "growth" },
    });
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
