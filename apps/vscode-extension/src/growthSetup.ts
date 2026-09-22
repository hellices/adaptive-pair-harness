import type { PairToolName } from "@adaptive-pair/harness";
import type { LearningAgreement, PairRuntimeSnapshot, WorkUnit } from "@adaptive-pair/protocol";
import type { PairCoordinatorPort } from "@adaptive-pair/runtime";
import { invokeGrowthUserAction } from "./growthUserActions.js";
import { parseVerificationScript } from "./verificationPlan.js";
import { canonicalRelative, isBinaryPath, isSecretPath } from "./workspaceContext.js";

export interface GrowthSetupInput {
  readonly objective: string;
  readonly allowedPath: string;
  readonly independentCheck: string;
  readonly verificationPlan: string;
}

export type GrowthSetupStage = "learning" | "mode" | "work-unit";

export interface GrowthSetupUi {
  collect(signal: AbortSignal): Promise<GrowthSetupInput | undefined>;
  confirm(stage: GrowthSetupStage, description: string, signal: AbortSignal): Promise<boolean>;
}

export type GrowthSetupOutcome = "completed" | "cancelled" | "unavailable" | "stale" | "failed";

export interface GrowthSetupDependencies {
  readonly coordinator: PairCoordinatorPort;
  readonly snapshotNow: () => PairRuntimeSnapshot;
  readonly prepareEntry: (signal: AbortSignal) => Promise<PairRuntimeSnapshot>;
  readonly ui: GrowthSetupUi;
  readonly isAvailable?: () => boolean;
}

export const isSetupText = (value: string, maximum = 300): boolean =>
  value.length <= maximum && value.trim().length > 0 && Array.from(value).every(character => {
    const code = character.charCodeAt(0);
    return code >= 32 && code !== 127;
  });

export const normalizeGrowthSetupInput = (input: GrowthSetupInput): GrowthSetupInput | undefined => {
  if (
    !isSetupText(input.objective) || !isSetupText(input.independentCheck) ||
    !isSetupText(input.allowedPath, 1_024) || !isSetupText(input.verificationPlan, 160)
  ) {
    return undefined;
  }
  const allowedPath = canonicalRelative(input.allowedPath);
  const script = parseVerificationScript(input.verificationPlan);
  const plans = script === undefined ? [] : [script, ...["npm", "pnpm", "yarn"].flatMap(runner =>
    [`${runner} ${script}`, `${runner} run ${script}`])];
  if (
    allowedPath === undefined ||
    isSecretPath(allowedPath) || isBinaryPath(allowedPath) ||
    allowedPath.split("/").some(segment => segment === ".git" || segment === "node_modules") ||
    !plans.includes(input.verificationPlan.trim())
  ) {
    return undefined;
  }
  return Object.freeze({
    objective: input.objective.trim(), allowedPath,
    independentCheck: input.independentCheck.trim(), verificationPlan: `npm run ${script}`,
  });
};

const enabled = (snapshot: PairRuntimeSnapshot): boolean =>
  snapshot.presence.status !== "off" && snapshot.presence.status !== "paused";

const sameSession = (before: PairRuntimeSnapshot, after: PairRuntimeSnapshot): boolean =>
  enabled(after) && before.presence.workspaceId === after.presence.workspaceId &&
  before.session?.sessionId === after.session?.sessionId &&
  before.session?.startedAtRevision === after.session?.startedAtRevision;

class SetupTransaction {
  public constructor(
    private readonly deps: GrowthSetupDependencies,
    private readonly signal: AbortSignal,
    private expected: PairRuntimeSnapshot,
  ) {}

  public current(): PairRuntimeSnapshot {
    this.signal.throwIfAborted();
    const current = this.deps.snapshotNow();
    if (
      !sameSession(this.expected, current) || current.revision !== this.expected.revision ||
      current.session?.authorityEpoch !== this.expected.session?.authorityEpoch ||
      this.deps.isAvailable?.() === false
    ) {
      throw new Error("SETUP_STALE");
    }
    return current;
  }

  public async prepare(): Promise<void> {
    const before = this.current();
    const prepared = await this.deps.prepareEntry(this.signal);
    if (!sameSession(before, prepared) || prepared.session?.status !== "briefing") {
      throw new Error("SETUP_STALE");
    }
    this.expected = prepared;
    this.current();
  }

  public async confirm(stage: GrowthSetupStage, description: string): Promise<boolean> {
    this.current();
    const accepted = await this.deps.ui.confirm(stage, description, this.signal);
    this.current();
    return accepted;
  }

  public async apply(name: PairToolName, input: Readonly<Record<string, unknown>>, explicit = true): Promise<void> {
    const before = this.current();
    const observed = { runtimeRevision: before.revision, authorityEpoch: before.session?.authorityEpoch };
    const result = explicit
      ? await invokeGrowthUserAction(this.deps.coordinator, name, input, this.signal, observed)
      : await this.deps.coordinator.invokeTool(name, input, this.signal, observed);
    if (result.status !== "confirmed") {
      throw new Error("SETUP_ACTION_FAILED");
    }
    const after = this.deps.snapshotNow();
    if (
      !sameSession(before, after) || after.revision !== result.runtimeRevision ||
      after.session?.authorityEpoch !== result.authorityEpoch
    ) {
      throw new Error("SETUP_STALE");
    }
    this.expected = after;
    this.current();
  }
}

const agreementFor = (input: GrowthSetupInput): LearningAgreement => ({
  learningGoals: [input.objective], familiarAreas: [],
  humanOwnedCapabilities: ["implementation", "diagnosis", "repair"],
  delegatableWork: [], maximumHintLevel: 4, independentCheck: input.independentCheck,
});

const workUnitFor = (input: GrowthSetupInput, snapshot: PairRuntimeSnapshot): WorkUnit => ({
  id: `growth-setup-${snapshot.revision}`, objective: input.objective,
  mode: "growth", learningValue: "high", capability: "implementation", owner: "human",
  allowedPaths: [input.allowedPath], acceptanceChecks: [input.objective, "The agreed verification passes"],
  verificationPlan: input.verificationPlan, stoppingCondition: "The objective and verification are satisfied",
  baseline: {}, status: "proposed",
});

export const runGrowthSetup = async (
  deps: GrowthSetupDependencies,
  signal: AbortSignal,
): Promise<GrowthSetupOutcome> => {
  if (signal.aborted) {
    return "cancelled";
  }
  const initial = deps.snapshotNow();
  if (
    !enabled(initial) || initial.session?.status !== "briefing" || initial.session.workUnit !== undefined ||
    (initial.session.mode !== undefined && initial.session.mode !== "growth") || deps.isAvailable?.() === false
  ) {
    return "unavailable";
  }
  const transaction = new SetupTransaction(deps, signal, initial);
  try {
    const collected = await deps.ui.collect(signal);
    transaction.current();
    if (collected === undefined) {
      return "cancelled";
    }
    const input = normalizeGrowthSetupInput(collected);
    if (input === undefined) {
      return "unavailable";
    }
    await transaction.prepare();
    if (!await transaction.confirm("learning", [
      `Learning goal: ${input.objective}. You own implementation, diagnosis, and repair.`,
      `Hint ceiling: 4. Independent variation: ${input.independentCheck}.`,
    ].join("\n"))) {
      return "cancelled";
    }
    await transaction.apply("pair_confirm_learning", { agreement: agreementFor(input) });
    if (!await transaction.confirm("mode", "Use Growth mode? You own all edits; the assistant only offers bounded guidance.")) {
      return "cancelled";
    }
    await transaction.apply("pair_select_mode", { mode: "growth" });
    if (!await transaction.confirm("work-unit", [
      `Objective: ${input.objective}. Scope: ${input.allowedPath}. Owner: you.`,
      `Verification: ${input.verificationPlan}. The script is checked and separately confirmed when /check runs.`,
    ].join("\n"))) {
      return "cancelled";
    }
    const workUnit = workUnitFor(input, transaction.current());
    await transaction.apply("pair_propose_work_unit", { workUnit }, false);
    await transaction.apply("pair_agree_work_unit", { workUnitId: workUnit.id });
    return "completed";
  } catch (error) {
    if (signal.aborted) {
      return "cancelled";
    }
    return error instanceof Error && error.message === "SETUP_STALE" ? "stale" : "failed";
  }
};
