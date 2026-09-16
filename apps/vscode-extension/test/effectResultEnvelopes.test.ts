import { nativeToolName, PAIR_TOOL_CATALOG, type PairToolName } from "@adaptive-pair/harness";
import { InMemoryJournal, PairCoordinator, type EffectResult, type PairToolResult } from "@adaptive-pair/runtime";
import { growthRuntime } from "@adaptive-pair/testkit";
import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

vi.mock("vscode", () => {
  class LanguageModelTextPart {
    public constructor(public readonly value: string) {}
  }
  class LanguageModelToolResult {
    public constructor(public readonly content: readonly LanguageModelTextPart[]) {}
  }
  class LanguageModelToolResultPart {
    public constructor(public readonly callId: string, public readonly content: readonly LanguageModelTextPart[]) {}
  }
  return {
    LanguageModelTextPart,
    LanguageModelToolResult,
    LanguageModelToolResultPart,
    window: { showWarningMessage: () => Promise.resolve("Continue once") },
    workspace: { textDocuments: [] },
  };
});

const { BoundedScopeEffectRunner } = await import("../src/scopeEffect.js");
const { interpretVerificationOutcome } = await import("../src/verificationOutput.js");
const { PairLanguageModelTool } = await import("../src/tools/pairTool.js");
const { untrustedToolResult } = await import("../src/growthModelMessages.js");

const fixture = (
  toolName: PairToolName,
  content: string,
  longIdentity = false,
  identityCharacters = longIdentity ? 200 : 0,
) => {
  const initial = growthRuntime();
  const path = `src/${longIdentity ? "nested/".repeat(30) : ""}main.ts`;
  const snapshot = growthRuntime({
    runtimeRevision: longIdentity ? Number.MAX_SAFE_INTEGER - 20 : 4,
    session: {
      authorityEpoch: longIdentity ? Number.MAX_SAFE_INTEGER - 20 : 0,
      workUnit: { ...initial.session!.workUnit!, allowedPaths: [path] },
    },
  });
  const store = new InMemoryJournal("workspace-1", snapshot);
  const results: EffectResult[] = [];
  let sequence = 0;
  const scope = new BoundedScopeEffectRunner({
    readText: () => Promise.resolve({ status: "ok", text: content }),
    listPaths: () => Promise.resolve({ paths: [path], truncated: false }),
  });
  const coordinator = new PairCoordinator({
    store,
    streamId: "workspace-1",
    clock: { now: () => 1_000 },
    ids: { next: prefix => `${prefix}-${'"'.repeat(identityCharacters)}${++sequence}` },
    effects: {
      execute: async (request, signal) => {
        const result = toolName === "pair_read_scope"
          ? await scope.run(request, signal)
          : interpretVerificationOutcome(request.operationId, {
            exitCode: 0,
            signal: null,
            output: content,
            outputTruncated: false,
            terminationConfirmed: true,
          }, false, false);
        results.push(result);
        return result;
      },
    },
  });
  const descriptor = PAIR_TOOL_CATALOG.find(item => item.name === toolName)!;
  const tool = new PairLanguageModelTool(nativeToolName(toolName), descriptor, coordinator);
  const invoke = () => tool.invoke({
    input: toolName === "pair_read_scope" ? { path } : {},
  } as vscode.LanguageModelToolInvocationOptions<Record<string, unknown>>, {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => undefined }),
  });
  return { descriptor, results, store, path, invoke };
};

describe.each([
  { toolName: "pair_read_scope" as const, field: "text", limit: 12_000 },
  { toolName: "pair_run_verification" as const, field: "output", limit: 16_000 },
])("Complete $toolName display budget", ({ toolName, field, limit }) => {
  it.each(["ascii", "escaped", "unicode"] as const)(
    "retains useful bounded %s output through runtime, native, and Growth envelopes",
    async encoding => {
      const content = (encoding === "escaped" ? '\t"\\' : encoding === "unicode" ? "😀" : "x").repeat(limit);
      const running = fixture(toolName, content);

      const native = await running.invoke();
      const nativeText = (native.content[0] as vscode.LanguageModelTextPart).value;
      const result = JSON.parse(nativeText) as PairToolResult;

      expect.soft(JSON.stringify(running.results[0]).length).toBeLessThanOrEqual(limit);
      expect(result.status).toBe("confirmed");
      expect(nativeText.length).toBeLessThanOrEqual(limit);
      expect(result.operationId).toBe(running.results[0]?.operationId);
      const displayed = String(result.observation[field]);
      expect(displayed.length).toBeGreaterThan(0);
      expect(displayed.length).toBeLessThan(content.length);
      expect(content.startsWith(displayed)).toBe(true);
      expect(Buffer.from(displayed, "utf8").toString("utf8")).toBe(displayed);
      if (toolName === "pair_read_scope") {
        expect(result.partial).toBe(true);
        expect(result.observation["path"]).toBe(running.path);
      } else {
        expect(result.observation).toMatchObject({ passed: true, exitCode: 0, outputTruncatedForDisplay: true });
      }
      const growth = untrustedToolResult("display-budget", result, limit);
      const growthText = (growth.content[0] as vscode.LanguageModelTextPart).value;
      expect(growthText.length).toBeLessThanOrEqual(limit);
      expect(running.store.snapshotNow().session?.operations.at(-1)?.status).toBe("confirmed");
    },
  );

  it("reserves escaped identities, long paths, and runtime revision metadata", async () => {
    const content = "x".repeat(limit);
    const running = fixture(toolName, content, true);

    const native = await running.invoke();
    const nativeText = (native.content[0] as vscode.LanguageModelTextPart).value;
    const result = JSON.parse(nativeText) as PairToolResult;

    expect.soft(JSON.stringify(running.results[0]).length).toBeLessThanOrEqual(limit);
    expect(result.status).toBe("confirmed");
    expect(result.operationId).toBe(running.results[0]?.operationId);
    expect(nativeText.length).toBeLessThanOrEqual(limit);
    expect(result.runtimeRevision).toBeGreaterThan(Number.MAX_SAFE_INTEGER - 20);
    const growth = untrustedToolResult("long-identity-budget", result, limit);
    expect((growth.content[0] as vscode.LanguageModelTextPart).value.length).toBeLessThanOrEqual(limit);
    expect(String(result.observation[field]).length).toBeGreaterThan(0);
    if (toolName === "pair_read_scope") expect(result.observation["path"]).toBe(running.path);
  });

  it.each(["", "small output", 'quoted "value" and 😀'])("preserves an ordinary complete result: %s", async content => {
    const running = fixture(toolName, content);
    const native = await running.invoke();
    const result = JSON.parse((native.content[0] as vscode.LanguageModelTextPart).value) as PairToolResult;

    expect(result.status).toBe("confirmed");
    expect(result.observation[field]).toBe(content);
    expect(result.partial).toBe(false);
    if (toolName === "pair_run_verification") expect(result.observation["outputTruncatedForDisplay"]).toBe(false);
  });

  it("refuses unrepresentable immutable metadata without inventing an identity or undoing the operation", async () => {
    const running = fixture(toolName, "small output", false, limit);
    const native = await running.invoke();
    const nativeText = (native.content[0] as vscode.LanguageModelTextPart).value;
    const result = JSON.parse(nativeText) as Record<string, unknown>;

    expect(result).toMatchObject({ status: "failed", reason: "result-too-large" });
    expect(result["operationId"]).toBeUndefined();
    expect(nativeText.length).toBeLessThanOrEqual(limit);
    expect(running.results[0]?.operationId).toContain('"'.repeat(limit));
    expect(running.store.snapshotNow().session?.operations.at(-1)?.status).toBe("confirmed");
  });
});
