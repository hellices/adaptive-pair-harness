import type { EffectRequest, EffectResult } from "@adaptive-pair/runtime";
import { expect, it } from "vitest";
import {
  StableEffectPort,
  type ScopeEffectRunner,
  type VerificationRunner,
} from "../src/stableEffectPort.js";
import type { VerificationPlan } from "../src/verificationAdapter.js";

const request = (over: Partial<EffectRequest> = {}): EffectRequest => ({
  operationId: "op-1",
  workspaceId: "workspace-1",
  workUnitId: "unit-1",
  allowedPaths: ["src"],
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

it("passes the trusted effect request to the verification resolver", async () => {
  const resolved: (EffectRequest | undefined)[] = [];
  const runner: VerificationRunner = {
    run: plan => Promise.resolve(confirmed(plan.operationId)),
  };
  const port = new StableEffectPort({
    resolveVerification: (...args: EffectRequest[]) => {
      resolved.push(args[0]);
      return runner;
    },
  });
  const trustedRequest = request({
    workspaceId: "file:///trusted-workspace",
    payload: { script: "test" },
  });

  await port.execute(trustedRequest, new AbortController().signal);

  expect(resolved).toEqual([trustedRequest]);
});

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

it("routes bounded read and search tools to the scope runner", async () => {
  const requests: EffectRequest[] = [];
  const runner: ScopeEffectRunner = {
    run: (scopeRequest) => {
      requests.push(scopeRequest);
      return Promise.resolve(confirmed(scopeRequest.operationId));
    },
  };
  const port = new StableEffectPort({ resolveScope: () => runner });

  for (const toolName of ["pair_read_scope", "pair_search_scope"] as const) {
    const result = await port.execute(
      request({ toolName, kind: "read" }),
      new AbortController().signal,
    );
    expect(result.status).toBe("confirmed");
  }
  expect(requests.map(item => item.toolName)).toEqual([
    "pair_read_scope",
    "pair_search_scope",
  ]);
});

it("reads only bounded lines inside the trusted work-unit scope", async () => {
  const readPaths: string[] = [];
  const port = new StableEffectPort({
    resolveScopeAccess: () => ({
      readText: (path: string) => {
        readPaths.push(path);
        return Promise.resolve({
          status: "ok" as const,
          text: ["zero", "one", "two", "three"].join("\n"),
        });
      },
      listPaths: () =>
        Promise.resolve({ paths: [], truncated: false }),
    }),
  });

  const result = await port.execute(
    request({
      toolName: "pair_read_scope",
      kind: "read",
      payload: { path: "src/retry.ts", startLine: 2, endLine: 3 },
    }),
    new AbortController().signal,
  );

  expect(result.status).toBe("confirmed");
  expect(result.observation).toEqual({
    path: "src/retry.ts",
    startLine: 2,
    endLine: 3,
    text: "one\ntwo",
  });
  expect(readPaths).toEqual(["src/retry.ts"]);
});

it("declines edit and command effects the Stable shell does not implement", async () => {
  const port = new StableEffectPort({});

  for (const toolName of ["pair_apply_edit", "pair_run_command"] as const) {
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
