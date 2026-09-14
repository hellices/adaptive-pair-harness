import type { EffectPort, EffectRequest, EffectResult } from "@adaptive-pair/runtime";
import type { VerificationPlan } from "./verificationAdapter.js";

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
 * The Stable Pair Presence effect port. Verification is the only effect the
 * Stable shell actually performs: `pair_run_verification` runs an allowlisted
 * package script through the real {@link VerificationAdapter}. Every other
 * effectful tool (edits, delivery commands, scope reads) is honestly declined
 * because the Stable preview does not implement AI mutation or delivery.
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

    return declined(
      request,
      `${request.toolName} is not implemented in the Stable Pair Presence shell yet.`,
    );
  }
}
