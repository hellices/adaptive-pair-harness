import { describe, expect, it } from "vitest";
import {
  isDistinctVariation,
  FakeModel,
  FakeCoordinator,
  createResponseStream,
  createToken,
  createRequest,
  createContext,
  growthSnapshot,
  buildParticipant,
} from "./growthTestHarness.js";

const variation =
  "Independent variation: build a queue that drains at most N jobs per tick and prove the boundary yourself.";

describe("GrowthParticipant transfer validation", () => {
  it("does not treat an identical Korean objective as a distinct variation", () => {
    expect(isDistinctVariation("배열 정렬 구현", "배열 정렬 구현")).toBe(false);
  });

  it("requests a bounded variation distinct from the work unit and records transfer-started", async () => {
    const coordinator = new FakeCoordinator(growthSnapshot({ runtimeRevision: 4 }));
    const model = new FakeModel([
      { text: JSON.stringify({ level: 1, kind: "question", text: variation }) },
    ]);
    const { participant, evaluations } = buildParticipant(coordinator);
    const { stream, collected } = createResponseStream();

    await participant.handle(
      createRequest(model, { command: "transfer", prompt: "" }),
      createContext(),
      stream,
      createToken(),
    );

    expect(coordinator.prepareInputs).toHaveLength(1);
    const userRequest = coordinator.prepareInputs[0]?.userRequest ?? "";
    expect(userRequest.toLowerCase()).toContain("independent");
    expect(userRequest.toLowerCase()).toContain("distinct");
    expect(userRequest).toContain("Implement one retry transition");
    expect(userRequest).toContain("Implement a varied timeout retry");

    const text = collected.markdown.join("\n");
    expect(text).toContain(variation);
    expect(text.toLowerCase()).toContain("not demonstrated");

    const record = evaluations.records.at(-1);
    expect(record?.outcome).toBe("transfer-started");
    expect(record?.level).toBe(1);
    expect(record?.kind).toBe("question");
    // The evaluation record is non-raw: it never carries model or user text.
    expect(JSON.stringify(record)).not.toContain(variation);

    expect(participant.transferStatus()).toEqual({
      status: "started",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      startedAtRevision: coordinator.snapshotNow().session?.startedAtRevision,
      workUnitId: "unit-1",
      independentCheck: "Implement a varied timeout retry",
      demonstrated: false,
      startedAt: 1_000,
    });
    expect(coordinator.invokeCalls.map(call => call.name)).not.toContain(
      "pair_record_transfer",
    );
  });

  it("withholds a transfer variation that only restates the current objective", async () => {
    const coordinator = new FakeCoordinator(growthSnapshot({ runtimeRevision: 4 }));
    const model = new FakeModel([
      {
        text: JSON.stringify({
          level: 1,
          kind: "question",
          text: "Try this next: implement one retry transition, exactly as before.",
        }),
      },
    ]);
    const { participant, evaluations } = buildParticipant(coordinator);
    const { stream, collected } = createResponseStream();

    await participant.handle(
      createRequest(model, { prompt: "give me something to try on my own" }),
      createContext(),
      stream,
      createToken(),
    );

    expect(collected.markdown.join("\n")).not.toContain("exactly as before");
    expect(evaluations.records.at(-1)?.outcome).toBe("withheld");
    expect(evaluations.records.at(-1)?.reason).toBe("TRANSFER_NOT_DISTINCT");
    expect(participant.transferStatus()).toBeUndefined();
  });

  it("does not start a transfer when workspace consent is declined", async () => {
    const coordinator = new FakeCoordinator(growthSnapshot({ runtimeRevision: 4 }));
    const model = new FakeModel([
      { text: JSON.stringify({ level: 1, kind: "question", text: variation }) },
    ]);
    const { participant, evaluations } = buildParticipant(coordinator, {
      requestWorkspaceConsent: () => Promise.resolve(false),
    });
    const { stream } = createResponseStream();

    await participant.handle(
      createRequest(model, { command: "transfer", prompt: "" }),
      createContext(),
      stream,
      createToken(),
    );

    expect(model.sendCount).toBe(0);
    expect(coordinator.prepareInputs).toHaveLength(0);
    expect(evaluations.records).toHaveLength(0);
    expect(participant.transferStatus()).toBeUndefined();
  });
});

describe("GrowthParticipant transfer status", () => {
  it("reports a started transfer as not demonstrated in /session", async () => {
    const coordinator = new FakeCoordinator(growthSnapshot({ runtimeRevision: 4 }));
    const model = new FakeModel([
      { text: JSON.stringify({ level: 1, kind: "question", text: variation }) },
    ]);
    const { participant } = buildParticipant(coordinator);

    await participant.handle(
      createRequest(model, { command: "transfer", prompt: "" }),
      createContext(),
      createResponseStream().stream,
      createToken(),
    );

    const { stream, collected } = createResponseStream();
    await participant.handle(
      createRequest(new FakeModel([]), { command: "session", prompt: "" }),
      createContext(),
      stream,
      createToken(),
    );

    const text = collected.markdown.join("\n").toLowerCase();
    expect(text).toContain("transfer: started");
    expect(text).toContain("not demonstrated");
  });

  it("reports a transfer from an old work unit as not started in /session", async () => {
    const coordinator = new FakeCoordinator(growthSnapshot({ runtimeRevision: 4 }));
    const model = new FakeModel([
      { text: JSON.stringify({ level: 1, kind: "question", text: variation }) },
    ]);
    const { participant } = buildParticipant(coordinator);

    await participant.handle(
      createRequest(model, { command: "transfer", prompt: "" }),
      createContext(),
      createResponseStream().stream,
      createToken(),
    );

    const previous = await coordinator.snapshot();
    coordinator.setSnapshot({
      ...previous,
      revision: 5,
      session: {
        ...previous.session!,
        workUnit: {
          ...previous.session!.workUnit!,
          id: "unit-2",
        },
      },
    });

    const { stream, collected } = createResponseStream();
    await participant.handle(
      createRequest(new FakeModel([]), { command: "session", prompt: "" }),
      createContext(),
      stream,
      createToken(),
    );

    expect(collected.markdown.join("\n").toLowerCase()).toContain(
      "transfer: not started",
    );
  });

  it("does not report a transfer after the session changes with the same work unit id", async () => {
    const coordinator = new FakeCoordinator(growthSnapshot({ runtimeRevision: 4 }));
    const model = new FakeModel([
      { text: JSON.stringify({ level: 1, kind: "question", text: variation }) },
    ]);
    const { participant } = buildParticipant(coordinator);

    await participant.handle(
      createRequest(model, { command: "transfer", prompt: "" }),
      createContext(),
      createResponseStream().stream,
      createToken(),
    );

    const previous = await coordinator.snapshot();
    coordinator.setSnapshot({
      ...previous,
      revision: 5,
      presence: {
        ...previous.presence,
        activeSessionId: "session-2",
      },
      session: {
        ...previous.session!,
        sessionId: "session-2",
      },
    });

    const { stream, collected } = createResponseStream();
    await participant.handle(
      createRequest(new FakeModel([]), { command: "session", prompt: "" }),
      createContext(),
      stream,
      createToken(),
    );

    expect(collected.markdown.join("\n").toLowerCase()).toContain(
      "transfer: not started",
    );
  });
});
