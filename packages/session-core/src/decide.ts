import type {
  PairCommand,
  PairEvent,
  PairRuntimeSnapshot,
  PairSessionSnapshot,
  SessionStatus,
} from "@adaptive-pair/protocol";
import { normalizeEntrySnapshot } from "./entrySnapshot.js";
import {
  requireModeChangeWithoutWorkUnit,
  requireGrowthAgreement,
  requireGrowthWorkUnit,
  requireLearningEntry,
  requireWorkUnitEntry,
  validateHintLevel,
  validateProposedWorkUnit,
  validateSolutionReveal,
} from "./growth.js";
import { cloneFrozen } from "./immutable.js";

export interface Decision {
  readonly events: readonly PairEvent[];
}

const freezeDecision = (events: readonly PairEvent[]): Decision =>
  cloneFrozen({
    events,
  });

const isPausableStatus = (status: SessionStatus): boolean =>
  status === "ready" || status === "active" || status === "reconciling";

const requireBriefingSession = (
  session: PairSessionSnapshot | undefined,
): PairSessionSnapshot => {
  if (session === undefined || session.status !== "briefing") {
    throw new Error("SESSION_NOT_BRIEFING");
  }

  return session;
};

const requirePausedSession = (
  session: PairSessionSnapshot | undefined,
): PairSessionSnapshot => {
  if (session === undefined || session.status !== "paused") {
    throw new Error("SESSION_NOT_PAUSED");
  }

  return session;
};

export const decide = (
  snapshot: PairRuntimeSnapshot,
  command: PairCommand,
): Decision => {
  if (command.expectedRevision !== snapshot.revision) {
    throw new Error("STALE_REVISION");
  }

  const base = {
    protocolVersion: 1 as const,
    eventId: `${command.commandId}:0`,
    commandId: command.commandId,
    actor: command.actor,
    revision: snapshot.revision + 1,
    recordedAt: command.observedAt,
  };

  switch (command.type) {
    case "StartSession":
      if (snapshot.session !== undefined) {
        throw new Error("SESSION_ALREADY_STARTED");
      }

      return freezeDecision([
        {
          ...base,
          type: "SessionStarted",
          sessionId: command.sessionId,
        },
      ]);

    case "PauseSession": {
      const session = snapshot.session;

      if (session === undefined || !isPausableStatus(session.status)) {
        throw new Error("SESSION_NOT_PAUSABLE");
      }

      return freezeDecision([
        {
          ...base,
          type: "SessionPaused",
          reason: command.reason,
          authorityEpoch: session.authorityEpoch + 1,
        },
      ]);
    }

    case "CaptureEntry":
      return freezeDecision([
        {
          ...base,
          type: "EntryCaptured",
          entry: normalizeEntrySnapshot(
            command.entry,
            requireBriefingSession(snapshot.session).entrySnapshot,
          ),
        },
      ]);

    case "ConfirmLearning":
      requireLearningEntry(requireBriefingSession(snapshot.session));

      return freezeDecision([
        {
          ...base,
          type: "LearningConfirmed",
          agreement: command.agreement,
        },
      ]);

    case "SelectMode": {
      const session = requireModeChangeWithoutWorkUnit(
        requireBriefingSession(snapshot.session),
      );

      if (command.mode === "growth") {
        requireGrowthAgreement(session);
      }

      return freezeDecision([
        {
          ...base,
          type: "ModeSelected",
          mode: command.mode,
        },
      ]);
    }

    case "ProposeWorkUnit": {
      const session = requireWorkUnitEntry(
        requireBriefingSession(snapshot.session),
      );
      validateProposedWorkUnit(session, command.workUnit);

      return freezeDecision([
        {
          ...base,
          type: "WorkUnitProposed",
          workUnit: command.workUnit,
        },
      ]);
    }

    case "AgreeWorkUnit": {
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

      return freezeDecision([
        {
          ...base,
          type: "WorkUnitAgreed",
          workUnitId: command.workUnitId,
        },
      ]);
    }

    case "RecordAttempt":
      requireGrowthWorkUnit(
        requireBriefingOrActiveSession(snapshot.session),
        command.workUnitId,
      );

      return freezeDecision([
        {
          ...base,
          type: "AttemptRecorded",
          workUnitId: command.workUnitId,
          summary: command.summary,
          bypassed: command.bypassed,
        },
      ]);

    case "RecordHypothesis":
      requireGrowthWorkUnit(
        requireBriefingOrActiveSession(snapshot.session),
        command.workUnitId,
      );

      return freezeDecision([
        {
          ...base,
          type: "HypothesisRecorded",
          workUnitId: command.workUnitId,
          summary: command.summary,
          bypassed: command.bypassed,
        },
      ]);

    case "RequestHint":
      validateHintLevel(
        requireBriefingOrActiveSession(snapshot.session),
        command.workUnitId,
        command.level,
      );

      return freezeDecision([
        {
          ...base,
          type: "HintRequested",
          workUnitId: command.workUnitId,
          level: command.level,
        },
      ]);

    case "AuthorizeSolutionReveal":
      validateSolutionReveal(
        requireBriefingOrActiveSession(snapshot.session),
        command.workUnitId,
        command.previewOnly,
      );

      return freezeDecision([
        {
          ...base,
          type: "SolutionRevealAuthorized",
          workUnitId: command.workUnitId,
          previewOnly: true,
        },
      ]);

    case "RequestEditOperation":
      if (snapshot.session?.mode === "growth") {
        throw new Error("GROWTH_AI_MUTATION_FORBIDDEN");
      }

      throw new Error("EDIT_OPERATION_UNSUPPORTED");

    case "ResumeSession":
      return freezeDecision([
        {
          ...base,
          type: "SessionResumed",
          entry: normalizeEntrySnapshot(
            command.entry,
            requirePausedSession(snapshot.session).entrySnapshot,
          ),
        },
      ]);

    case "CloseSession":
      if (snapshot.session === undefined) {
        throw new Error("SESSION_NOT_STARTED");
      }

      if (snapshot.session.status === "closed") {
        throw new Error("SESSION_ALREADY_CLOSED");
      }

      return freezeDecision([
        {
          ...base,
          type: "SessionClosed",
        },
      ]);

    default:
      throw new Error(`UNSUPPORTED_COMMAND:${command.type}`);
  }
};

const requireBriefingOrActiveSession = (
  session: PairSessionSnapshot | undefined,
): PairSessionSnapshot => {
  if (session === undefined) {
    throw new Error("SESSION_NOT_STARTED");
  }

  if (session.status === "briefing" || session.status === "ready" || session.status === "active") {
    return session;
  }

  throw new Error("WORK_UNIT_NOT_AGREED");
};
