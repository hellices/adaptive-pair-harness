import { requireGrowthWorkUnit, validateHintLevel, validateSolutionReveal } from "../growth.js";
import {
  consumeHumanActionEvents,
  freezeDecision,
  requireBriefingOrActiveSession,
  type DecisionHandler,
} from "./support.js";

export const recordAttempt: DecisionHandler<"RecordAttempt"> = (snapshot, command, event) => {
  requireGrowthWorkUnit(
    requireBriefingOrActiveSession(snapshot.session),
    command.workUnitId,
  );

  return freezeDecision((() => {
    const session = requireBriefingOrActiveSession(snapshot.session);
    const events = consumeHumanActionEvents(
      snapshot,
      session,
      event,
      command,
      "adaptive_pair_record_attempt",
    );

    events.push(event(events.length, "AttemptRecorded", {
      workUnitId: command.workUnitId,
      summary: command.summary,
      bypassed: command.bypassed,
    }));

    return events;
  })());
};

export const recordHypothesis: DecisionHandler<"RecordHypothesis"> = (snapshot, command, event) => {
  return freezeDecision((() => {
    const session = requireBriefingOrActiveSession(snapshot.session);
    requireGrowthWorkUnit(session, command.workUnitId);
    const events = consumeHumanActionEvents(
      snapshot,
      session,
      event,
      command,
      "adaptive_pair_record_hypothesis",
    );

    events.push(event(events.length, "HypothesisRecorded", {
      workUnitId: command.workUnitId,
      summary: command.summary,
      bypassed: command.bypassed,
    }));

    return events;
  })());
};

export const requestHint: DecisionHandler<"RequestHint"> = (snapshot, command, event) => {
  return freezeDecision((() => {
    const session = requireBriefingOrActiveSession(snapshot.session);
    validateHintLevel(session, command.workUnitId, command.level);
    const events = consumeHumanActionEvents(
      snapshot,
      session,
      event,
      command,
      "adaptive_pair_request_hint",
    );

    events.push(event(events.length, "HintRequested", {
      workUnitId: command.workUnitId,
      level: command.level,
    }));

    return events;
  })());
};

export const authorizeSolutionReveal: DecisionHandler<"AuthorizeSolutionReveal"> = (snapshot, command, event) => {
  return freezeDecision((() => {
    const session = requireBriefingOrActiveSession(snapshot.session);
    const previewOnly = command.previewOnly;
    validateSolutionReveal(
      session,
      command.workUnitId,
      previewOnly,
    );
    const events = consumeHumanActionEvents(
      snapshot,
      session,
      event,
      command,
      "adaptive_pair_reveal_solution",
    );

    events.push(event(events.length, "SolutionRevealAuthorized", {
      workUnitId: command.workUnitId,
      previewOnly,
    }));

    return events;
  })());
};
