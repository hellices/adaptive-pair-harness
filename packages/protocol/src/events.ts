import type {
  Actor,
  EntrySnapshot,
  LearningAgreement,
  OperatingMode,
  PresenceStatus,
  WorkUnit,
} from "./types.js";

interface EventBase {
  readonly protocolVersion: 1;
  readonly eventId: string;
  readonly commandId: string;
  readonly actor: Actor;
  readonly revision: number;
  readonly recordedAt: number;
}

export type PairEvent =
  | (EventBase & {
      readonly type: "PresenceEnabled";
      readonly workspaceId: string;
    })
  | (EventBase & {
      readonly type: "PresenceChanged";
      readonly status: PresenceStatus;
    })
  | (EventBase & {
      readonly type: "SessionStarted";
      readonly sessionId: string;
    })
  | (EventBase & {
      readonly type: "EntryCaptured";
      readonly entry: EntrySnapshot;
    })
  | (EventBase & {
      readonly type: "BriefConfirmed";
      readonly goal: string;
      readonly criteria: readonly string[];
    })
  | (EventBase & {
      readonly type: "LearningConfirmed";
      readonly agreement: LearningAgreement;
    })
  | (EventBase & {
      readonly type: "ModeSelected";
      readonly mode: OperatingMode;
    })
  | (EventBase & {
      readonly type: "WorkUnitProposed";
      readonly workUnit: WorkUnit;
    })
  | (EventBase & {
      readonly type: "WorkUnitAgreed";
      readonly workUnitId: string;
    })
  | (EventBase & {
      readonly type: "SessionPaused";
      readonly reason: string;
      readonly authorityEpoch: number;
    })
  | (EventBase & {
      readonly type: "SessionResumed";
      readonly entry: EntrySnapshot;
    })
  | (EventBase & {
      readonly type: "SessionClosed";
    });
