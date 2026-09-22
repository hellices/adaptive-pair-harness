import { promiseHooks } from "node:v8";
import type * as vscode from "vscode";
import { describe, expect, it, vi } from "vitest";
import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { InMemoryJournal } from "@adaptive-pair/runtime";
import {
  FakeModel, GrowthParticipant, GrowthEvaluationLog, ModelConsentRegistry,
  realCoordinator, growthSnapshot, createRequest, createContext, createResponseStream, createToken,
} from "./growthTestHarness.js";

const observePublicReturn = async (
  invoke: () => ReturnType<vscode.ChatRequestHandler>,
  observe: () => void,
): Promise<Awaited<ReturnType<vscode.ChatRequestHandler>>> => {
  let pending: ReturnType<vscode.ChatRequestHandler> | undefined;
  const stop = promiseHooks.onSettled(promise => {
    if (promise === pending) { observe(); }
  }) as () => void;
  try {
    pending = invoke();
    return await pending;
  } finally {
    stop();
  }
};

const createFixture = () => {
  const before = growthSnapshot();
  const store = new InMemoryJournal("workspace-1", before);
  const coordinator = realCoordinator(before, store);
  const confirmCheckpoint = vi.fn<() => Promise<boolean>>(() => Promise.resolve(true));
  const createModel = vi.fn(() => { throw new Error("A local checkpoint created a model"); });
  const participant = new GrowthParticipant({
    coordinator, snapshotNow: () => coordinator.snapshotNow(),
    consent: new ModelConsentRegistry(), evaluations: new GrowthEvaluationLog(), createModel,
    requestWorkspaceConsent: () => Promise.resolve(false),
    confirmSolutionReveal: () => Promise.resolve(false), confirmCheckpoint,
  });
  const { stream, collected } = createResponseStream();
  const request = createRequest(new FakeModel([]), { command: "checkpoint" });
  Object.defineProperty(request, "model", { get: () => { throw new Error("A local checkpoint accessed the model"); } });
  const invoke = (token = createToken()) => participant.handler()(request, createContext(), stream, token);
  return { before, store, coordinator, confirmCheckpoint, createModel, stream, collected, invoke };
};

describe("checkpoint publication at the public handler return", () => {
  it.each([
    { transition: "disable", turns: 3, presence: "off" },
    { transition: "pause", turns: 3, presence: "paused" },
    { transition: "revision", turns: 6, presence: "engaged" },
  ] as const)("withholds metadata when a real $transition commits after the inner check", async ({ transition, turns, presence }) => {
    const fixture = createFixture();
    const trace: { readonly boundary: string; readonly presence: string; readonly revision: number }[] = [];
    const observe = (boundary: string): void => {
      const snapshot = fixture.store.snapshotNow();
      trace.push({ boundary, presence: snapshot.presence.status, revision: snapshot.revision });
    };
    const markdown = fixture.stream.markdown.bind(fixture.stream);
    vi.spyOn(fixture.stream, "markdown").mockImplementation(value => {
      observe("checkpoint message");
      return markdown(value);
    });
    const commit = fixture.store.commit.bind(fixture.store);
    vi.spyOn(fixture.store, "commit").mockImplementation((...args) => {
      const result = commit(...args);
      observe("coordinator commit");
      return result;
    });
    let invalidation: Promise<PairRuntimeSnapshot> | undefined;
    fixture.confirmCheckpoint.mockImplementation(async () => {
      invalidation = transition === "revision"
        ? fixture.coordinator.observeWorkspace()
        : fixture.coordinator.setPresence(transition === "disable" ? "off" : "paused");
      for (let turn = 0; turn < turns; turn += 1) { await Promise.resolve(); }
      return true;
    });

    const result = await observePublicReturn(() => fixture.invoke(), () => observe("public return"));
    await invalidation;

    expect(trace).toEqual([
      { boundary: "checkpoint message", presence: "engaged", revision: fixture.before.revision },
      { boundary: "coordinator commit", presence, revision: fixture.before.revision + 1 },
      { boundary: "public return", presence, revision: fixture.before.revision + 1 },
    ]);
    expect(fixture.collected.markdown.join("\n")).toContain("Requested a minimized checkpoint");
    expect(result?.metadata).toBeUndefined();
    expect(fixture.createModel).not.toHaveBeenCalled();
  });

  it("withholds metadata when cancellation arrives after the inner check", async () => {
    const fixture = createFixture();
    let cancelled = false;
    let notify = (): void => undefined;
    const token: vscode.CancellationToken = {
      get isCancellationRequested() { return cancelled; },
      onCancellationRequested: listener => {
        notify = () => { listener(undefined); };
        return { dispose: () => undefined };
      },
    };
    const markdown = fixture.stream.markdown.bind(fixture.stream);
    vi.spyOn(fixture.stream, "markdown").mockImplementation(value => {
      queueMicrotask(() => { cancelled = true; notify(); });
      return markdown(value);
    });
    const atReturn: boolean[] = [];

    const result = await observePublicReturn(() => fixture.invoke(token), () => { atReturn.push(cancelled); });

    expect(atReturn).toEqual([true]);
    expect(fixture.collected.markdown.join("\n")).toContain("Requested a minimized checkpoint");
    expect(result?.metadata).toBeUndefined();
    expect(fixture.store.snapshotNow()).toEqual(fixture.before);
    expect(fixture.createModel).not.toHaveBeenCalled();
  });

  it.each(["workspace", "session", "start", "epoch"] as const)(
    "keeps the original %s identity through the final await even at an equal revision",
    async change => {
      const fixture = createFixture();
      const before = fixture.before;
      const after: PairRuntimeSnapshot = {
        ...before,
        presence: {
          ...before.presence,
          ...(change === "workspace" ? { workspaceId: "workspace-2" } : {}),
        },
        session: {
          ...before.session!,
          ...(change === "session" ? { sessionId: "session-2" } : {}),
          ...(change === "start" ? { startedAtRevision: 1 } : {}),
          ...(change === "epoch" ? { authorityEpoch: 1 } : {}),
        },
      };
      let current = before;
      const reads: PairRuntimeSnapshot[] = [];
      vi.spyOn(fixture.coordinator, "snapshotNow").mockImplementation(() => {
        reads.push(current);
        return current;
      });
      const markdown = fixture.stream.markdown.bind(fixture.stream);
      vi.spyOn(fixture.stream, "markdown").mockImplementation(value => {
        queueMicrotask(() => { current = after; });
        return markdown(value);
      });
      const atReturn: PairRuntimeSnapshot[] = [];

      const result = await observePublicReturn(() => fixture.invoke(), () => { atReturn.push(current); });

      expect(atReturn).toEqual([after]);
      expect(after.revision).toBe(before.revision);
      expect(fixture.collected.markdown.join("\n")).toContain("Requested a minimized checkpoint");
      expect(result?.metadata).toBeUndefined();
      expect(reads.at(-1)).toBe(after);
      expect(fixture.createModel).not.toHaveBeenCalled();
    },
  );
});
