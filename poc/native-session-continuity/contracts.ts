export interface FixtureMetadata {
  readonly fixture: "adaptive-pair-native-continuity/v1";
  readonly marker: string;
  readonly bootKey: string;
  readonly authorityRestored: false;
  readonly automaticReplayAllowed: false;
}

export interface HistoryEntry {
  readonly participant: string;
  readonly prompt?: string;
  readonly metadata?: FixtureMetadata;
}

export interface Invocation {
  readonly participant: string;
  readonly prompt: string;
  readonly bootKey: string;
  readonly history: readonly HistoryEntry[];
  readonly contextKeys: readonly string[];
  readonly requestKeys: readonly string[];
  readonly diagnosticSessionResource: { readonly value?: string; readonly error?: string };
}

export interface ProbeState {
  readonly invocations: readonly Invocation[];
  readonly bootKey: string;
  readonly modelCalls: number;
  readonly tokenCountCalls: number;
  readonly disposalApi: string;
  readonly disposalEvents: readonly string[];
}

export interface ProbeApi {
  getState(): ProbeState;
}

export interface ModelChoice {
  readonly id: string;
  readonly vendor: string;
  readonly family: string;
}

export type Phase = "seed" | "resume" | "fork" | "peer" | "delete" | "fork-after-delete" | "fresh";

export interface ProbeEvidence {
  readonly hostVersion: string;
  readonly nodeVersion: string;
  readonly phase: string;
  models?: readonly ModelChoice[];
  chatApiKeys?: readonly string[];
  commands?: readonly string[];
  enabledApiProposals?: readonly string[];
  copilot?: readonly { readonly id: string; readonly version: string }[];
  state?: ProbeState;
  deletion?: { readonly ready: boolean; readonly confirmed?: boolean };
  status?: "passed" | "failed";
  error?: string;
}

export const requiredEnvironment = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`The isolated probe requires ${name}.`);
  return value;
};

export const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

export const isFixtureMetadata = (value: unknown): value is FixtureMetadata =>
  typeof value === "object" && value !== null &&
  "fixture" in value && value.fixture === "adaptive-pair-native-continuity/v1" &&
  "marker" in value && typeof value.marker === "string" &&
  "bootKey" in value && typeof value.bootKey === "string" &&
  "authorityRestored" in value && value.authorityRestored === false &&
  "automaticReplayAllowed" in value && value.automaticReplayAllowed === false;
