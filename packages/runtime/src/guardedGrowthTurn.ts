import { maximumHintLevelForSnapshot } from "@adaptive-pair/harness";
import type { OperatingMode, PairRuntimeSnapshot, WorkUnit } from "@adaptive-pair/protocol";
import { guardGrowthResponse, type GrowthResponse } from "@adaptive-pair/restraint";
import {
  growthFailureReason,
  GrowthModelFailure,
  isGrowthModelResult,
  type GrowthModel,
  type GrowthRuntimeBoundary,
} from "./growthModel.js";
import type { PairCoordinatorPort } from "./ports.js";

export type GrowthTurnCoordinator = Pick<
  PairCoordinatorPort,
  "snapshot" | "prepareTurn"
>;

export interface GrowthTurnIntent {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly startedAtRevision: number;
  readonly authorityEpoch: number;
  readonly mode: OperatingMode;
  readonly workUnitId: string;
  readonly objective: string;
  readonly capability: WorkUnit["capability"];
  readonly independentCheck: string | undefined;
}

export const isGrowthTurnIntentCurrent = (intent: GrowthTurnIntent, snapshot: PairRuntimeSnapshot): boolean => {
  const session = snapshot.session;
  const workUnit = session?.workUnit;
  return session !== undefined && workUnit !== undefined && snapshot.presence.status !== "off" &&
    snapshot.presence.workspaceId === intent.workspaceId &&
    session.sessionId === intent.sessionId &&
    session.startedAtRevision === intent.startedAtRevision &&
    session.authorityEpoch === intent.authorityEpoch &&
    session.mode === intent.mode &&
    (session.status === "active" || session.status === "ready") &&
    workUnit.id === intent.workUnitId &&
    workUnit.status === "agreed" &&
    workUnit.objective === intent.objective &&
    workUnit.capability === intent.capability &&
    session.learningAgreement?.independentCheck === intent.independentCheck;
};

export interface GuardedGrowthTurnInput {
  readonly coordinator: GrowthTurnCoordinator;
  readonly createModel: () => GrowthModel;
  readonly signal: AbortSignal;
  readonly userRequest?: string;
  readonly repositoryContext?: string;
  readonly intent?: GrowthTurnIntent;
  readonly validate?: (response: GrowthResponse) => string | undefined;
}

export type GrowthTurnOutcome =
  | {
      readonly status: "delivered";
      readonly response: GrowthResponse;
      readonly runtime: GrowthRuntimeBoundary;
    }
  | { readonly status: "stale" }
  | { readonly status: "reprepare" }
  | {
      readonly status: "withheld";
      readonly response: GrowthResponse;
      readonly reason: string;
      readonly source: "restraint" | "validation";
      readonly runtime: GrowthRuntimeBoundary;
    }
  | { readonly status: "failed"; readonly reason: string };

export interface ReadyGrowthTurn {
  readonly status: "ready";
  readonly response: GrowthResponse;
  readonly runtime: GrowthRuntimeBoundary;
  readonly intent?: GrowthTurnIntent;
}

export type GrowthTurnRequestOutcome =
  | ReadyGrowthTurn
  | Extract<GrowthTurnOutcome, { readonly status: "stale" | "reprepare" | "failed" }>;

const stem = (path: string): string | undefined => {
  const base = path.split(/[\\/]/u).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const name = dot > 0 ? base.slice(0, dot) : base;
  return name.length > 1 ? name : undefined;
};

const deriveTargetIdentifiers = (
  snapshot: PairRuntimeSnapshot,
): readonly string[] => {
  const identifiers = new Set<string>();
  const workUnit = snapshot.session?.workUnit;
  if (workUnit !== undefined) {
    for (const path of workUnit.allowedPaths) {
      const value = stem(path);
      if (value !== undefined) {
        identifiers.add(value);
      }
    }
    for (const key of Object.keys(workUnit.baseline)) {
      const value = stem(key);
      if (value !== undefined) {
        identifiers.add(value);
      }
    }
  }
  return [...identifiers];
};

export const requestGuardedGrowthTurn = async (
  input: GuardedGrowthTurnInput,
): Promise<GrowthTurnRequestOutcome> => {
  try {
    const intent = input.intent === undefined ? undefined : Object.freeze({ ...input.intent });
    const before = await input.coordinator.snapshot();
    if (intent !== undefined && !isGrowthTurnIntentCurrent(intent, before)) {
      return { status: "stale" };
    }
    const prompt = input.userRequest ?? "";
    const prepared = await input.coordinator.prepareTurn({
      ...(prompt.length > 0 ? { userRequest: prompt } : {}),
      ...(input.repositoryContext === undefined
        ? {}
        : { repositoryContext: input.repositoryContext }),
    });

    if (
      prepared.instructions.runtimeRevision !== prepared.tools.runtimeRevision ||
      prepared.instructions.authorityEpoch !== prepared.tools.authorityEpoch ||
      prepared.instructions.runtimeRevision !== before.revision ||
      prepared.instructions.authorityEpoch !== before.session?.authorityEpoch
    ) {
      return { status: "stale" };
    }

    const model = input.createModel();
    let response: GrowthResponse;
    let expectedRuntime: GrowthRuntimeBoundary = {
      runtimeRevision: before.revision,
      authorityEpoch: before.session?.authorityEpoch,
      mode: before.session?.mode,
    };
    try {
      const output = await model.request(
        prepared.instructions,
        prepared.tools,
        input.signal,
      );
      if (isGrowthModelResult(output)) {
        response = output.response;
        expectedRuntime = output.runtime;
      } else {
        response = output;
      }
    } catch (error) {
      if (error instanceof GrowthModelFailure && error.code === "GROWTH_REPREPARE_REQUIRED") {
        return { status: "reprepare" };
      }
      if (
        error instanceof GrowthModelFailure &&
        error.code === "GROWTH_STALE_TURN"
      ) {
        return { status: "stale" };
      }
      return { status: "failed", reason: growthFailureReason(error) };
    }

    return { status: "ready", response, runtime: expectedRuntime, ...(intent === undefined ? {} : { intent }) };
  } catch (error) {
    return { status: "failed", reason: growthFailureReason(error) };
  }
};

export const finishGuardedGrowthTurn = (
  requested: ReadyGrowthTurn,
  after: PairRuntimeSnapshot,
  validate?: GuardedGrowthTurnInput["validate"],
): GrowthTurnOutcome => {
  try {
    const { response, runtime: expectedRuntime } = requested;
    if (requested.intent !== undefined && !isGrowthTurnIntentCurrent(requested.intent, after)) {
      return { status: "stale" };
    }
    if (
      after.revision !== expectedRuntime.runtimeRevision ||
      after.session?.authorityEpoch !== expectedRuntime.authorityEpoch ||
      after.session?.mode !== expectedRuntime.mode
    ) {
      return { status: "stale" };
    }

    const runtime = Object.freeze({
      runtimeRevision: after.revision,
      authorityEpoch: after.session?.authorityEpoch,
      mode: after.session?.mode,
    });
    const guard = guardGrowthResponse(response, {
      authorizedHintLevel: maximumHintLevelForSnapshot(after),
      revealAuthorized: after.session?.assistance?.solutionReveal !== undefined,
      targetIdentifiers: deriveTargetIdentifiers(after),
    });
    if (!guard.accepted) {
      return {
        status: "withheld",
        response,
        reason: guard.reason,
        source: "restraint",
        runtime,
      };
    }

    const rejection = validate?.(guard.response);
    if (rejection !== undefined) {
      return {
        status: "withheld",
        response: guard.response,
        reason: rejection,
        source: "validation",
        runtime,
      };
    }

    return { status: "delivered", response: guard.response, runtime };
  } catch (error) {
    return { status: "failed", reason: growthFailureReason(error) };
  }
};

export const runGuardedGrowthTurn = async (
  input: GuardedGrowthTurnInput,
): Promise<GrowthTurnOutcome> => {
  const requested = await requestGuardedGrowthTurn(input);
  if (requested.status !== "ready") {
    return requested;
  }

  try {
    const after = await input.coordinator.snapshot();
    return finishGuardedGrowthTurn(requested, after, input.validate);
  } catch (error) {
    return { status: "failed", reason: growthFailureReason(error) };
  }
};
