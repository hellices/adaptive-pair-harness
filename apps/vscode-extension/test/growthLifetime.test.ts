import { describe, expect, it, vi } from "vitest";
import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { InMemoryJournal, PairCoordinator } from "@adaptive-pair/runtime";
import {
  ModelConsentRegistry,
  FakeModel,
  asModel,
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

const lifetimeFixture = () => {
  const before = growthSnapshot({ runtimeRevision: 4 });
  const store = new InMemoryJournal("workspace-1", before);
  let nextId = 0;
  const runtime = new PairCoordinator({
    store,
    streamId: "workspace-1",
    clock: { now: () => 1_000 },
    ids: { next: prefix => `${prefix}-${++nextId}` },
    effects: {
      execute: request => Promise.resolve({
        operationId: request.operationId,
        status: "confirmed",
        summary: "The agreed check exited 0.",
        observation: { passed: true, exitCode: 0 },
        sensitiveData: false,
        partial: false,
      }),
    },
  });
  const coordinator = Object.assign(runtime, { snapshotNow: () => store.snapshotNow() });
  const requestWorkspaceConsent = vi.fn(() => Promise.resolve(true));
  const model = new FakeModel(Array.from({ length: 4 }, () => ({
    text: JSON.stringify({
      level: 1,
      kind: "question",
      text: "Independent variation: design a bounded queue and prove its capacity.",
    }),
  })));
  const built = buildParticipant(coordinator, { requestWorkspaceConsent });
  const run = async (command?: string) => {
    const { stream, collected } = createResponseStream();
    await built.participant.handle(
      createRequest(model, command === undefined ? {} : { command }),
      createContext([{ prompt: "private task context" }]),
      stream,
      createToken(),
    );
    return collected.markdown.join("\n");
  };
  return { ...built, before, coordinator, store, model, requestWorkspaceConsent, run };
};

const recreateSession = async (fixture: ReturnType<typeof lifetimeFixture>): Promise<void> => {
  const { coordinator, before, store } = fixture;
  const session = before.session!;
  const workUnit = session.workUnit!;
  await coordinator.setPresence("off");
  await coordinator.setPresence("observing", "workspace-1");
  const commands = [
    { type: "StartSession", sessionId: session.sessionId },
    { type: "CaptureEntry", entry: session.entrySnapshot! },
    { type: "ConfirmLearning", agreement: session.learningAgreement! },
    { type: "SelectMode", mode: "growth" },
    { type: "ProposeWorkUnit", workUnit: { ...workUnit, status: "proposed" } },
    { type: "AgreeWorkUnit", workUnitId: workUnit.id },
  ] as const;
  for (const command of commands) {
    await coordinator.dispatch({
      ...command,
      protocolVersion: 1,
      commandId: `recreate-${store.snapshotNow().revision}-${command.type}`,
      expectedRevision: store.snapshotNow().revision,
      actor: "human",
      observedAt: 1_001,
    });
  }
  expect(store.snapshotNow().session?.startedAtRevision).not.toBe(session.startedAtRevision);
};

describe("Growth consent lifetime", () => {
  it("reuses destination consent only within the same committed session", async () => {
    const fixture = lifetimeFixture();
    await fixture.run();
    await fixture.run();
    expect(fixture.requestWorkspaceConsent).toHaveBeenCalledTimes(1);
    expect(fixture.model.sendCount).toBe(2);
  });

  it("requests consent again after Disable and identical-ID session recreation", async () => {
    const fixture = lifetimeFixture();
    await fixture.run();
    await recreateSession(fixture);
    fixture.requestWorkspaceConsent.mockResolvedValue(false);

    const text = await fixture.run();

    expect(fixture.requestWorkspaceConsent).toHaveBeenCalledTimes(2);
    expect(fixture.model.sendCount).toBe(1);
    expect(text).toContain("kept your workspace private");
  });

  it.each([undefined, "hint", "reveal", "transfer"])(
    "does not rebind a pending %s consent decision to a recreated session",
    async command => {
      const fixture = lifetimeFixture();
      const consentRequested = deferred<void>();
      const decision = deferred<boolean>();
      fixture.requestWorkspaceConsent.mockImplementation(() => {
        consentRequested.resolve(undefined);
        return decision.promise;
      });
      const pending = fixture.run(command);
      await consentRequested.promise;
      await recreateSession(fixture);
      decision.resolve(true);

      await pending;

      expect(fixture.model.sendCount).toBe(0);
      expect(fixture.store.snapshotNow().session?.assistance?.hint).toBeUndefined();
      expect(fixture.store.snapshotNow().session?.assistance?.solutionReveal).toBeUndefined();
      fixture.requestWorkspaceConsent.mockResolvedValue(false);
      await fixture.run();
      expect(fixture.requestWorkspaceConsent).toHaveBeenCalledTimes(2);
      expect(fixture.model.sendCount).toBe(0);
    },
  );

  it.each(["workspace", "session", "start", "disabled"] as const)(
    "does not reuse a registry entry after its %s identity changes",
    change => {
      const before = growthSnapshot({ runtimeRevision: 4 });
      const model = asModel(new FakeModel([]));
      const registry = new ModelConsentRegistry();
      registry.grant(model, before);
      const after: PairRuntimeSnapshot = {
        ...before,
        presence: {
          ...before.presence,
          ...(change === "workspace" ? { workspaceId: "workspace-2" } : {}),
          ...(change === "disabled" ? { status: "off" } : {}),
        },
        session: change === "disabled" ? undefined : {
          ...before.session!,
          ...(change === "session" ? { sessionId: "session-2" } : {}),
          ...(change === "start" ? { startedAtRevision: 5 } : {}),
        },
      };

      expect(registry.has(model, before)).toBe(true);
      expect(registry.has(model, after)).toBe(false);
    },
  );
});

describe("Growth transient lifetime", () => {
  it.each(["recreated", "paused", "observed"] as const)(
    "does not publish a check result after the committed runtime was %s",
    async transition => {
      const fixture = lifetimeFixture();
      const invoke = fixture.coordinator.invokeTool.bind(fixture.coordinator);
      vi.spyOn(fixture.coordinator, "invokeTool").mockImplementationOnce(async (...args) => {
        const result = await invoke(...args);
        if (transition === "recreated") {
          await recreateSession(fixture);
        } else if (transition === "paused") {
          await fixture.coordinator.setPresence("paused");
        } else {
          await fixture.coordinator.observeWorkspace();
        }
        return result;
      });

      const text = await fixture.run("check");

      expect(text).not.toContain("Product result:");
      expect(text).toContain("Ask again");
      expect(await fixture.run("session")).toContain("no check observed in this session");
    },
  );

  it("does not report an old transfer after identical-ID session recreation", async () => {
    const fixture = lifetimeFixture();
    await fixture.run("transfer");
    expect(await fixture.run("session")).toContain("Transfer: started");

    await recreateSession(fixture);

    expect(await fixture.run("session")).toContain("Transfer: not started");
    expect(fixture.participant.transferStatus()).toBeUndefined();
  });

  it("does not expose a transfer after Disable without a new chat request", async () => {
    const fixture = lifetimeFixture();
    await fixture.run("transfer");
    expect(fixture.participant.transferStatus()).toBeDefined();

    await fixture.coordinator.setPresence("off");

    expect(fixture.participant.transferStatus()).toBeUndefined();
  });

  it("does not report a previous lifetime's passing product check", async () => {
    const fixture = lifetimeFixture();
    expect(await fixture.run("check")).toContain("Product result: **passed**");
    expect(await fixture.run("session")).toContain("last check `test` passed");

    await recreateSession(fixture);

    expect(await fixture.run("session")).toContain("no check observed in this session");
  });
});
