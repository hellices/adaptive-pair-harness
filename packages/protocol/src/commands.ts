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
    })
  | (CommandBase & {
      readonly type: "ConfirmBrief";
      readonly goal: string;
      readonly criteria: readonly string[];
    })
  | (CommandBase & {
      readonly type: "ConfirmLearning";
      readonly agreement: LearningAgreement;
    })
  | (CommandBase & {
      readonly type: "SelectMode";
      readonly mode: OperatingMode;
    })
  | (CommandBase & {
      readonly type: "ProposeWorkUnit";
      readonly workUnit: WorkUnit;
    })
  | (CommandBase & {
      readonly type: "AgreeWorkUnit";
      readonly workUnitId: string;
    })
  | (CommandBase & {
      readonly type: "RecordAttempt";
      readonly workUnitId: string;
      readonly summary: string;
      readonly bypassed: boolean;
    })
  | (CommandBase & {
      readonly type: "RecordHypothesis";
      readonly workUnitId: string;
      readonly summary: string;
      readonly bypassed: boolean;
    })
  | (CommandBase & {
      readonly type: "RequestHint";
      readonly workUnitId: string;
      readonly level: HintLevel;
    })
  | (CommandBase & {
      readonly type: "AuthorizeSolutionReveal";
      readonly workUnitId: string;
      readonly previewOnly: true;
    })
  | (CommandBase & {
      readonly type: "PauseSession";
      readonly reason: string;
    })
  | (CommandBase & {
      readonly type: "ResumeSession";
      readonly entry: EntrySnapshot;
    })
  | (CommandBase & {
      readonly type: "CloseSession";
    });
