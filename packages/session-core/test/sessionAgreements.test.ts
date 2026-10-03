import { it } from "vitest";
import { createRuntime, reduce } from "../src/index.js";
import {
  command,
  createGrowthAgreement,
  createGrowthWorkUnit,
  createSessionRuntime,
  event,
  expectDecisionAndReplayRejection,
  growthSetupEvents,
} from "./sessionCoreFixtures.js";

const setup = (count: number) => reduce(createRuntime("workspace-1"), growthSetupEvents().slice(0, count));
const pairWorkUnit = { ...createGrowthWorkUnit(), mode: "pair" as const, learningValue: "mixed" as const, owner: "ai" as const };

it("rejects confirming learning before an entry snapshot in decisions and direct events", () => {
  const agreement = createGrowthAgreement();
  expectDecisionAndReplayRejection(
    setup(1),
    command("ConfirmLearning", 1, { agreement }),
    event("LearningConfirmed", 2, { agreement }),
    "LEARNING_REQUIRES_ENTRY",
  );
});

it("rejects selecting Growth mode without a learning agreement", () => {
  expectDecisionAndReplayRejection(
    setup(2),
    command("SelectMode", 2, { mode: "growth" }),
    event("ModeSelected", 3, { mode: "growth" }),
    "MODE_REQUIRES_LEARNING_AGREEMENT",
  );
});

it("rejects AI-owned Growth work units in decisions and direct events", () => {
  const workUnit = { ...createGrowthWorkUnit(), owner: "ai" as const };
  expectDecisionAndReplayRejection(
    setup(4),
    command("ProposeWorkUnit", 4, { workUnit }),
    event("WorkUnitProposed", 5, { workUnit }),
    "GROWTH_REQUIRES_HUMAN_OWNER",
  );
});

it("rejects Growth work-unit proposals before an entry snapshot", () => {
  const workUnit = createGrowthWorkUnit();
  expectDecisionAndReplayRejection(
    createSessionRuntime({ status: "briefing", mode: "growth", learningAgreement: createGrowthAgreement() }),
    command("ProposeWorkUnit", 0, { workUnit }),
    event("WorkUnitProposed", 1, { workUnit }),
    "WORK_UNIT_REQUIRES_ENTRY",
  );
});

it("rejects work-unit agreement without an entry snapshot on malformed sessions", () => {
  expectDecisionAndReplayRejection(
    createSessionRuntime({ status: "briefing", mode: "pair", workUnit: pairWorkUnit }),
    command("AgreeWorkUnit", 0, { workUnitId: "growth-wu-1" }),
    event("WorkUnitAgreed", 1, { workUnitId: "growth-wu-1" }),
    "WORK_UNIT_REQUIRES_ENTRY",
  );
});

it("rejects mode changes while a work unit is still attached", () => {
  const [started, entry] = growthSetupEvents();
  const runtime = reduce(createRuntime("workspace-1"), [
    started!,
    entry!,
    event("ModeSelected", 3, { mode: "pair" }),
    event("WorkUnitProposed", 4, { workUnit: pairWorkUnit }),
    event("LearningConfirmed", 5, { agreement: createGrowthAgreement() }),
  ]);
  expectDecisionAndReplayRejection(
    runtime,
    command("SelectMode", 5, { mode: "growth" }),
    event("ModeSelected", 6, { mode: "growth" }),
    "MODE_CHANGE_REQUIRES_NEW_WORK_UNIT",
  );
});
