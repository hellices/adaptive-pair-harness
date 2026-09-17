import {
  requireGrowthAgreement,
  requireLearningEntry,
  requireModeChangeWithoutWorkUnit,
  requireWorkUnitEntry,
  validateProposedWorkUnit,
} from "../growth.js";
import {
  consumeHumanActionEvents,
  freezeDecision,
  requireBriefingSession,
  type DecisionHandler,
} from "./support.js";

export const confirmLearning: DecisionHandler<"ConfirmLearning"> = (snapshot, command, event) => {
  return freezeDecision((() => {
    const session = requireLearningEntry(
      requireBriefingSession(snapshot.session),
    );
    const events = consumeHumanActionEvents(
      snapshot,
      session,
      event,
      command,
      "adaptive_pair_confirm_learning",
    );
    events.push(event(events.length, "LearningConfirmed", {
      agreement: command.agreement,
    }));
    return events;
  })());
};

export const selectMode: DecisionHandler<"SelectMode"> = (snapshot, command, event) => {
  const session = requireModeChangeWithoutWorkUnit(
    requireBriefingSession(snapshot.session),
  );

  if (command.mode === "growth") {
    requireGrowthAgreement(session);
  }

  const events = consumeHumanActionEvents(
    snapshot,
    session,
    event,
    command,
    "adaptive_pair_select_mode",
  );
  events.push(event(events.length, "ModeSelected", {
      mode: command.mode,
  }));
  return freezeDecision(events);
};

export const proposeWorkUnit: DecisionHandler<"ProposeWorkUnit"> = (snapshot, command, event) => {
  const session = requireWorkUnitEntry(
    requireBriefingSession(snapshot.session),
  );
  validateProposedWorkUnit(session, command.workUnit);

  return freezeDecision([
    event(0, "WorkUnitProposed", {
      workUnit: command.workUnit,
    }),
  ]);
};

export const agreeWorkUnit: DecisionHandler<"AgreeWorkUnit"> = (snapshot, command, event) => {
  if (snapshot.session?.status === "reconciling") {
    throw new Error("SESSION_RECONCILING");
  }

  const session = requireWorkUnitEntry(
    requireBriefingSession(snapshot.session),
  );
  const workUnit = session.workUnit;
  if (workUnit === undefined || workUnit.id !== command.workUnitId) {
    throw new Error("WORK_UNIT_NOT_FOUND");
  }

  if (workUnit.status !== "proposed") {
    throw new Error("WORK_UNIT_NOT_PROPOSED");
  }

  if (workUnit.mode !== session.mode) {
    throw new Error("WORK_UNIT_MODE_MISMATCH");
  }

  const events = consumeHumanActionEvents(
    snapshot,
    session,
    event,
    command,
    "adaptive_pair_agree_work_unit",
  );
  events.push(event(events.length, "WorkUnitAgreed", {
      workUnitId: command.workUnitId,
  }));
  return freezeDecision(events);
};
