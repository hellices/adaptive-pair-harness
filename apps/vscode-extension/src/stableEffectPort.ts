import type { EffectPort, EffectRequest, EffectResult } from "@adaptive-pair/runtime";
import type { VerificationPlan } from "./verificationAdapter.js";
import {
  BoundedScopeEffectRunner,
  type ScopeAccess,
  type ScopeEffectRunner,
} from "./scopeEffect.js";
export type { ScopeEffectRunner } from "./scopeEffect.js";

/**
 * A runner that executes a verification plan and returns an observed effect
 * result. The production binding is {@link VerificationAdapter}; tests can
 * inject a deterministic runner.
 */
export interface VerificationRunner {
  run(plan: VerificationPlan, signal: AbortSignal): Promise<EffectResult>;
}

export interface StableEffectPortOptions {
  /**
   * Resolve the verification runner for the current workspace, or `undefined`
   * when no workspace/root is available. Resolving lazily lets the port bind to
   * the active workspace folder at run time rather than construction time.
   */
  readonly resolveVerification?: () => VerificationRunner | undefined;
  /** Resolve the bounded workspace reader used by read/search effects. */
  readonly resolveScope?: () => ScopeEffectRunner | undefined;
  /** Resolve raw workspace access for the built-in bounded scope runner. */
  readonly resolveScopeAccess?: (
    request: EffectRequest,
  ) => ScopeAccess | undefined;
}

const declined = (request: EffectRequest, summary: string): EffectResult => ({
  operationId: request.operationId,
  status: "declined",
  summary,
  observation: {
    closed: true,
    kind: request.kind,
  },
  sensitiveData: false,
  partial: false,
});

const toVerificationPlan = (request: EffectRequest): VerificationPlan | undefined => {
  const script = request.payload["script"];
  if (typeof script !== "string" || script.length === 0) {
    return undefined;
  }
  const rawTargets = request.payload["targetPaths"];
  const targetPaths = Array.isArray(rawTargets)
    ? rawTargets.filter((value): value is string => typeof value === "string")
    : [];
  return {
    kind: "package-script",
    operationId: request.operationId,
    script,
    targetPaths,
  };
};

/**
 * The Stable Pair Presence effect port. It performs consent-gated, bounded
 * scope reads/searches and runs an allowlisted verification package script.
 * Mutating edits and delivery commands are honestly declined because the
 * Stable preview does not implement AI mutation or Delivery Mode.
 */
export class StableEffectPort implements EffectPort {
  public constructor(private readonly options: StableEffectPortOptions = {}) {}

  public async execute(request: EffectRequest, signal: AbortSignal): Promise<EffectResult> {
    signal.throwIfAborted();

    if (request.toolName === "pair_run_verification") {
      const runner = this.options.resolveVerification?.();
      const plan = toVerificationPlan(request);
      if (runner !== undefined && plan !== undefined) {
        return await runner.run(plan, signal);
      }
      return declined(
        request,
        "Adaptive Pair could not run verification: no workspace script target was available.",
      );
    }

    if (
      request.toolName === "pair_read_scope" ||
      request.toolName === "pair_search_scope"
    ) {
      const access = this.options.resolveScopeAccess?.(request);
      const runner =
        this.options.resolveScope?.() ??
        (access === undefined ? undefined : new BoundedScopeEffectRunner(access));
      if (runner !== undefined) {
        return await runner.run(request, signal);
      }
      return declined(
        request,
        "Adaptive Pair could not read the agreed scope: no workspace reader was available.",
      );
    }

    return declined(
      request,
      `${request.toolName} is not implemented in the Stable Pair Presence shell yet.`,
    );
  }
}
