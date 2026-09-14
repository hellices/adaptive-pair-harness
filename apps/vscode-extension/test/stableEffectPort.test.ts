import { describe, expect, it } from "vitest";
import type { EffectRequest, EffectResult } from "@adaptive-pair/runtime";
import type { VerificationPlan } from "../src/verificationAdapter.js";
import { StableEffectPort, type VerificationRunner } from "../src/stableEffectPort.js";

const request = (over: Partial<EffectRequest> = {}): EffectRequest => ({
  operationId: "op-1",
  toolName: "pair_run_verification",
  kind: "check",
  payload: {},
  runtimeRevision: 1,
  authorityEpoch: 0,
  ...over,
});

const confirmed = (operationId: string): EffectResult => ({
  operationId,
  status: "confirmed",
  summary: "Verification ran and the check passed.",
  observation: { passed: true, exitCode: 0 },
  sensitiveData: false,
  partial: false,
});

describe("StableEffectPort", () => {
  it("routes pair_run_verification to the runner with a package-script plan", async () => {
    const plans: VerificationPlan[] = [];
    const runner: VerificationRunner = {
      run: (plan) => {
        plans.push(plan);
        return Promise.resolve(confirmed(plan.operationId));
      },
    };
    const port = new StableEffectPort({ resolveVerification: () => runner });

    const result = await port.execute(
      request({ payload: { script: "test", targetPaths: ["src/x.ts"] } }),
      new AbortController().signal,
    );

    expect(result.status).toBe("confirmed");
    expect(plans).toEqual([
      {
        kind: "package-script",
        operationId: "op-1",
        script: "test",
        targetPaths: ["src/x.ts"],
      },
    ]);
  });

  it("declines verification when no runner is available for the workspace", async () => {
    const port = new StableEffectPort({ resolveVerification: () => undefined });

    const result = await port.execute(
      request({ payload: { script: "test" } }),
      new AbortController().signal,
    );

    expect(result.status).toBe("declined");
  });

  it("declines verification when the script name is missing", async () => {
    const runner: VerificationRunner = {
      run: () => Promise.reject(new Error("must not run")),
    };
    const port = new StableEffectPort({ resolveVerification: () => runner });

    const result = await port.execute(request({ payload: {} }), new AbortController().signal);

    expect(result.status).toBe("declined");
  });

  it("declines edit, command, and scope effects the Stable shell does not implement", async () => {
    const port = new StableEffectPort({});

    for (const toolName of ["pair_apply_edit", "pair_run_command", "pair_read_scope"] as const) {
      const result = await port.execute(
        request({ toolName, kind: "edit" }),
        new AbortController().signal,
      );
      expect(result.status).toBe("declined");
      expect(result.observation).toMatchObject({ closed: true });
    }
  });

  it("throws when the signal is already aborted", async () => {
    const port = new StableEffectPort({});
    const controller = new AbortController();
    controller.abort();

    await expect(
      port.execute(request(), controller.signal),
    ).rejects.toThrow();
  });
});
