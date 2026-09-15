import { describe, expect, it } from "vitest";
import type { EffectRequest, EffectResult } from "@adaptive-pair/runtime";
import type { VerificationPlan } from "../src/verificationAdapter.js";
import {
  StableEffectPort,
  type ScopeEffectRunner,
  type VerificationRunner,
} from "../src/stableEffectPort.js";

const request = (over: Partial<EffectRequest> = {}): EffectRequest => ({
  operationId: "op-1",
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
        listPaths: () => Promise.resolve([]),
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

  it("rejects a read outside the trusted scope before file access", async () => {
    let reads = 0;
    const port = new StableEffectPort({
      resolveScopeAccess: () => ({
        readText: () => {
          reads += 1;
          return Promise.resolve({ status: "ok" as const, text: "secret" });
        },
        listPaths: () => Promise.resolve([]),
      }),
    });

    const result = await port.execute(
      request({
        toolName: "pair_read_scope",
        kind: "read",
        allowedPaths: ["src"],
        payload: { path: "../secret.txt" },
      }),
      new AbortController().signal,
    );

    expect(result.status).toBe("declined");
    expect(result.observation).toMatchObject({ reason: "path-outside-scope" });
    expect(reads).toBe(0);
  });

  it("searches eligible scoped files with bounded structured matches", async () => {
    const port = new StableEffectPort({
      resolveScopeAccess: () => ({
        listPaths: () =>
          Promise.resolve(["src/a.ts", "src/b.ts", "docs/private.md"]),
        readText: (path: string) =>
          Promise.resolve({
            status: "ok" as const,
            text:
              path === "src/a.ts"
                ? "const retry = true;\nretry();"
                : "nothing here",
          }),
      }),
    });

    const result = await port.execute(
      request({
        toolName: "pair_search_scope",
        kind: "read",
        allowedPaths: ["src"],
        payload: { query: "retry", pattern: "**/*.ts" },
      }),
      new AbortController().signal,
    );

    expect(result.status).toBe("confirmed");
    expect(result.observation).toEqual({
      query: "retry",
      matches: [
        { path: "src/a.ts", line: 1, text: "const retry = true;" },
        { path: "src/a.ts", line: 2, text: "retry();" },
      ],
    });
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
});
