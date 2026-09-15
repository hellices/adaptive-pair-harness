import type {
  Actor,
  EntrySnapshot,
  HintLevel,
  LearningAgreement,
  OperatingMode,
  WorkUnit,
} from "./types.js";

interface CommandBase {
  readonly protocolVersion: 1;
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly actor: Actor;
  readonly observedAt: number;
}

export type PairCommand =
  | (CommandBase & {
      readonly type: "EnablePresence";
      readonly workspaceId: string;
    })
  | (CommandBase & {
      readonly type: "SetPresence";
      readonly status: "observing" | "quiet" | "paused" | "off";
    })
  | (CommandBase & {
      readonly type: "StartSession";
      readonly sessionId: string;
    })
  | (CommandBase & {
      readonly type: "CaptureEntry";
      readonly entry: EntrySnapshot;
      readonly userActionGrantId?: string;
    })
  | (CommandBase & {
      readonly type: "ConfirmBrief";
      readonly goal: string;
      readonly criteria: readonly string[];
    })
  | (CommandBase & {
      readonly type: "ConfirmLearning";
      readonly agreement: LearningAgreement;
      readonly userActionGrantId?: string;
    })
  | (CommandBase & {
      readonly type: "SelectMode";
      readonly mode: OperatingMode;
      readonly userActionGrantId?: string;
    })
  | (CommandBase & {
      readonly type: "ProposeWorkUnit";
      readonly workUnit: WorkUnit;
    })
  | (CommandBase & {
      readonly type: "AgreeWorkUnit";
      readonly workUnitId: string;
      readonly userActionGrantId?: string;
    })
  | (CommandBase & {
      readonly type: "RecordAttempt";
      readonly workUnitId: string;
      readonly summary: string;
      readonly bypassed: boolean;
      readonly userActionGrantId?: string;
    })
  | (CommandBase & {
      readonly type: "RecordHypothesis";
      readonly workUnitId: string;
      readonly summary: string;
      readonly bypassed: boolean;
      readonly userActionGrantId?: string;
    })
  | (CommandBase & {
      readonly type: "RequestHint";
      readonly workUnitId: string;
      readonly level: HintLevel;
      readonly userActionGrantId?: string;
    })
  | (CommandBase & {
      readonly type: "AuthorizeSolutionReveal";
      readonly workUnitId: string;
      readonly previewOnly: true;
      readonly userActionGrantId?: string;
    })
  | (CommandBase & {
      readonly type: "RequestEditOperation";
      readonly workUnitId: string;
      readonly operationId: string;
      readonly targetPath: string;
      readonly description: string;
    })
  | (CommandBase & {
      readonly type: "PauseSession";
      readonly reason: string;
    })
  | (CommandBase & {
      readonly type: "GrantUserAction";
      readonly grantId: string;
      readonly nativeToolName: string;
    })
  | (CommandBase & {
      readonly type: "AuthorizeOperation";
      readonly operationId: string;
      readonly toolName: string;
      readonly kind: "read" | "edit" | "check";
      readonly input: Readonly<Record<string, unknown>>;
      readonly userActionGrantId?: string;
    })
  | (CommandBase & {
      readonly type: "ObserveOperationResult";
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
  | (CommandBase & {
      readonly type: "ResumeSession";
      readonly entry: EntrySnapshot;
    })
  | (CommandBase & {
      readonly type: "CloseSession";
      readonly userActionGrantId?: string;
    });
