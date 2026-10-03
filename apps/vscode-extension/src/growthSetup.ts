import { nativeToolName, type PairToolName } from "@adaptive-pair/harness";
import type { LearningAgreement, PairRuntimeSnapshot, WorkUnit } from "@adaptive-pair/protocol";
import type { InvokeToolOptions, PairCoordinatorPort } from "@adaptive-pair/runtime";
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
    return code >= 32 && code !== 127 && code !== 0x2028 && code !== 0x2029;
  });

export const normalizeGrowthSetupPath = (value: string): string | undefined => {
  if (!isSetupText(value, 1_024)) { return undefined; }
  const path = canonicalRelative(value);
  return path === undefined || isSecretPath(path) || isBinaryPath(path) ||
    path.split("/").some(segment => segment === ".git" || segment === "node_modules")
    ? undefined : path;
};

export const normalizeGrowthSetupInput = (input: GrowthSetupInput): GrowthSetupInput | undefined => {
  if (
    !isSetupText(input.objective) || !isSetupText(input.independentCheck) ||
    !isSetupText(input.allowedPath, 1_024) || !isSetupText(input.verificationPlan, 160)
  ) {
    return undefined;
  }
  const allowedPath = normalizeGrowthSetupPath(input.allowedPath);
  const script = parseVerificationScript(input.verificationPlan);
  const plans = script === undefined ? [] : [script, ...["npm", "pnpm", "yarn"].flatMap(runner =>
    [`${runner} ${script}`, `${runner} run ${script}`])];
  if (
    allowedPath === undefined ||
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
    const options = explicit ? await this.grant(name, before) : observed;
    this.current();
    const result = await this.deps.coordinator.invokeTool(name, input, this.signal, options);
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

  private async grant(name: PairToolName, before: PairRuntimeSnapshot): Promise<InvokeToolOptions> {
    const userActionId = await this.deps.coordinator.grantUserAction(name, this.signal, {
      runtimeRevision: before.revision, authorityEpoch: before.session?.authorityEpoch,
    });
    this.signal.throwIfAborted();
    const granted = this.deps.snapshotNow();
    const record = granted.session?.userActionGrants.find(grant => grant.id === userActionId);
    if (
      !sameSession(before, granted) || granted.revision !== before.revision + 1 ||
      granted.session?.authorityEpoch !== before.session?.authorityEpoch ||
      record?.status !== "available" || record.nativeToolName !== nativeToolName(name) ||
      record.runtimeRevision !== granted.revision || record.authorityEpoch !== granted.session?.authorityEpoch
    ) {
      throw new Error("SETUP_STALE");
    }
    this.expected = granted;
    this.current();
    return { userActionId, runtimeRevision: granted.revision, authorityEpoch: granted.session?.authorityEpoch };
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

const descriptionsFor = (input: GrowthSetupInput): Readonly<Record<GrowthSetupStage, string>> => ({
  learning: `Learning goal: ${input.objective}. You own implementation, diagnosis, and repair.\nHint ceiling: 4. Independent variation: ${input.independentCheck}.`,
  mode: "Use Growth mode? You own all edits; the assistant only offers bounded guidance.",
  "work-unit": `Objective: ${input.objective}. Scope: ${input.allowedPath}. Owner: you.\nVerification: ${input.verificationPlan}. The script is checked and separately confirmed when /check runs.`,
});

const proposedInput = (snapshot: PairRuntimeSnapshot): GrowthSetupInput | undefined => {
  const session = snapshot.session;
  const unit = session?.workUnit;
  const agreement = session?.learningAgreement;
  if (
    session?.mode !== "growth" || unit?.status !== "proposed" || unit.mode !== "growth" ||
    unit.owner !== "human" || unit.capability !== "implementation" || unit.learningValue !== "high" ||
    unit.allowedPaths.length !== 1 || unit.allowedPaths[0] === undefined || agreement === undefined ||
    agreement.maximumHintLevel !== 4 || agreement.learningGoals.length !== 1 ||
    agreement.learningGoals[0] !== unit.objective || agreement.familiarAreas.length !== 0 ||
    agreement.delegatableWork.length !== 0 ||
    agreement.humanOwnedCapabilities.join(",") !== "implementation,diagnosis,repair" ||
    unit.acceptanceChecks.length !== 2 || unit.acceptanceChecks[0] !== unit.objective ||
    unit.acceptanceChecks[1] !== "The agreed verification passes" || Object.keys(unit.baseline).length !== 0 ||
    unit.stoppingCondition !== "The objective and verification are satisfied"
  ) {
    return undefined;
  }
  return normalizeGrowthSetupInput({
    objective: unit.objective, allowedPath: unit.allowedPaths[0],
    independentCheck: agreement.independentCheck, verificationPlan: unit.verificationPlan,
  });
};

const resumeProposal = async (transaction: SetupTransaction): Promise<GrowthSetupOutcome> => {
  const initial = transaction.current();
  const input = proposedInput(initial);
  const unit = initial.session?.workUnit;
  if (input === undefined || unit === undefined) { return "unavailable"; }
  const descriptions = descriptionsFor(input);
  for (const stage of ["learning", "mode", "work-unit"] as const) {
    if (!await transaction.confirm(stage, descriptions[stage])) { return "cancelled"; }
  }
  await transaction.apply("pair_agree_work_unit", { workUnitId: unit.id });
  return "completed";
};

export const runGrowthSetup = async (
  deps: GrowthSetupDependencies,
  signal: AbortSignal,
): Promise<GrowthSetupOutcome> => {
  if (signal.aborted) {
    return "cancelled";
  }
  const initial = deps.snapshotNow();
  if (
    !enabled(initial) || initial.session?.status !== "briefing" ||
    (initial.session.workUnit !== undefined && initial.session.workUnit.status !== "proposed") ||
    (initial.session.mode !== undefined && initial.session.mode !== "growth") || deps.isAvailable?.() === false
  ) {
    return "unavailable";
  }
  const transaction = new SetupTransaction(deps, signal, initial);
  try {
    if (initial.session.workUnit !== undefined) { return await resumeProposal(transaction); }
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
    const descriptions = descriptionsFor(input);
    if (!await transaction.confirm("learning", descriptions.learning)) {
      return "cancelled";
    }
    await transaction.apply("pair_confirm_learning", { agreement: agreementFor(input) });
    if (!await transaction.confirm("mode", descriptions.mode)) {
      return "cancelled";
    }
    await transaction.apply("pair_select_mode", { mode: "growth" });
    if (!await transaction.confirm("work-unit", descriptions["work-unit"])) {
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
