import { expect, it } from "vitest";
import { createRuntime, decide, reduce } from "../src/index.js";
import {
  command,
  createActiveRuntime,
  createGrowthAgreement,
  createGrowthWorkUnit,
  createSessionRuntime,
  event,
  growthSetupEvents,
} from "./sessionCoreFixtures.js";

it("rejects AI-authored learning, mode, and work-unit agreements without a human grant", () => {
  const setup = growthSetupEvents();
  const briefing = reduce(createRuntime("workspace-1"), setup.slice(0, 2));
  expect(() => decide(briefing, command("ConfirmLearning", 2, { agreement: createGrowthAgreement() }, { actor: "ai" })))
    .toThrow("USER_ACTION_REQUIRED");

  const withLearning = reduce(briefing, setup.slice(2, 3));
  expect(() => decide(withLearning, command("SelectMode", 3, { mode: "growth" }, { actor: "ai" })))
    .toThrow("USER_ACTION_REQUIRED");

  const withProposal = reduce(withLearning, [
    setup[3]!,
    event("WorkUnitProposed", 5, { workUnit: createGrowthWorkUnit() }, { actor: "ai" }),
  ]);
  expect(() => decide(withProposal, command("AgreeWorkUnit", 5, { workUnitId: "growth-wu-1" }, { actor: "ai" })))
    .toThrow("USER_ACTION_REQUIRED");
});

it("increments authority before pausing", () => {
  const runtime = createActiveRuntime();
  const next = reduce(runtime, decide(runtime, command("PauseSession", 0, { reason: "takeover" })).events);

  expect(next.session?.status).toBe("paused");
  expect(next.session?.authorityEpoch).toBe(1);
  expect(next.presence.status).toBe("paused");
  expect(next.presence.activeSessionId).toBe("session-1");
});

it.each(["inactive", "briefing", "paused", "closed"] as const)("rejects pausing a %s session", status => {
  expect(() => reduce(createSessionRuntime({ status }), [
    event("SessionPaused", 1, { reason: "takeover", authorityEpoch: 1 }),
  ])).toThrow("SESSION_NOT_PAUSABLE");
});

it("rejects paused events that do not advance authority", () => {
  expect(() => reduce(createSessionRuntime({ authorityEpoch: 3 }), [
    event("SessionPaused", 1, { reason: "takeover", authorityEpoch: 3 }),
  ])).toThrow("INVALID_AUTHORITY_EPOCH");
});

it("rejects closing a missing or already closed session", () => {
  const closed = createSessionRuntime({ status: "closed" });

  expect(() => decide(createRuntime("workspace-1"), command("CloseSession", 0, {})))
    .toThrow("SESSION_NOT_STARTED");
  expect(() => decide(closed, command("CloseSession", 0, {}))).toThrow("SESSION_ALREADY_CLOSED");
  expect(() => reduce(closed, [event("SessionClosed", 1, {})])).toThrow("SESSION_ALREADY_CLOSED");
});

it("closes a session and returns presence to observing", () => {
  const runtime = createActiveRuntime();
  const decision = decide(runtime, command("CloseSession", 0, {}));
  expect(decision.events).toEqual([event("SessionClosed", 1, {})]);

  const closed = reduce(runtime, [event("SessionClosed", 1, {}, { actor: "policy" })]);
  expect(closed.session?.status).toBe("closed");
  expect(closed.presence.status).toBe("observing");
  expect(closed.presence.activeSessionId).toBe(undefined);
});
