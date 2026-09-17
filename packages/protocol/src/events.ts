import type {
  Actor,
  EntrySnapshot,
  HintLevel,
  LearningAgreement,
  OperationRecord,
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
      readonly type: "WorkspaceObserved";
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
      readonly type: "AttemptRecorded";
      readonly workUnitId: string;
      readonly summary: string;
      readonly bypassed: boolean;
    })
  | (EventBase & {
      readonly type: "HypothesisRecorded";
      readonly workUnitId: string;
      readonly summary: string;
      readonly bypassed: boolean;
    })
  | (EventBase & {
      readonly type: "HintRequested";
      readonly workUnitId: string;
      readonly level: HintLevel;
    })
  | (EventBase & {
      readonly type: "SolutionRevealAuthorized";
      readonly workUnitId: string;
      readonly previewOnly: true;
    })
  | (EventBase & {
      readonly type: "UserActionGranted";
      readonly grantId: string;
      readonly nativeToolName: string;
      readonly runtimeRevision: number;
      readonly authorityEpoch: number | undefined;
    })
  | (EventBase & {
      readonly type: "UserActionConsumed";
      readonly grantId: string;
    })
  | (EventBase & {
      readonly type: "OperationAuthorized";
      readonly operation: OperationRecord;
    })
  | (EventBase & {
      readonly type: "OperationObserved";
      readonly operationId: string;
      readonly authorityEpoch: number;
      readonly status:
        | "confirmed"
        | "failed"
        | "declined"
        | "cancelled"
        | "unknown";
      readonly summary: string;
      readonly observation?: Readonly<Record<string, unknown>>;
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
