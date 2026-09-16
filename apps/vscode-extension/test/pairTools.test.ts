import { PAIR_TOOL_CATALOG, nativeToolName } from "@adaptive-pair/harness";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EffectPortDouble,
  asExtensionContext,
  confirmationText,
  createContext,
  createCoordinator,
  createGrowthRuntime,
  createPairRuntime,
  createToken,
  fakeVscode,
  parseToolPayload,
} from "./pairToolTestHarness.js";



describe("registerPairTools", () => {
  it("registers the same native tools contributed by the manifest", async () => {
    const manifest = JSON.parse(
      readFileSync(resolve("apps/vscode-extension/package.json"), "utf8"),
    ) as {
      contributes: {
        languageModelTools: { name: string }[];
      };
    };

    const { registerPairTools } = await import("../src/tools/registerPairTools.js");
    const { coordinator } = createCoordinator(
      createPairRuntime(),
      new EffectPortDouble(request => ({
        operationId: request.operationId,
        status: "confirmed",
        summary: "confirmed",
        observation: {},
        sensitiveData: false,
        partial: false,
      })),
    );

    const context = asExtensionContext(createContext());
    registerPairTools(context, coordinator);

    expect(fakeVscode.state.registeredTools.map(item => item.name).sort()).toEqual(
      manifest.contributes.languageModelTools.map(tool => tool.name).sort(),
    );
  });
});


it("derives verification script and scope from the agreed work unit", async () => {
  const { adaptPublicToolInput, PairLanguageModelTool } = await import(
    "../src/tools/pairTool.js"
  );
  const effects = new EffectPortDouble(request => ({
    operationId: request.operationId,
    status: "confirmed",
    summary: "confirmed",
    observation: {},
    sensitiveData: false,
    partial: false,
  }));
  const { coordinator } = createCoordinator(createGrowthRuntime(), effects);
  const descriptor = PAIR_TOOL_CATALOG.find(
    tool => tool.name === "pair_run_verification",
  );
  if (descriptor === undefined) {
    throw new Error("Missing pair_run_verification descriptor.");
  }
  const tool = new PairLanguageModelTool(
    nativeToolName(descriptor.name),
    descriptor,
    coordinator,
  );
  expect(
    adaptPublicToolInput(
      "pair_run_verification",
      { plan: "npm run deploy" },
      createGrowthRuntime(),
    ),
  ).toEqual({
    script: "test",
    targetPaths: ["src/pair.ts"],
  });

  const result = await tool.invoke(
    { input: { plan: "npm run deploy" } } as never,
    createToken() as never,
  );

  const payload = parseToolPayload(result);
  expect(fakeVscode.state.warnings).toHaveLength(1);
  expect(effects.calls[0]?.payload).toEqual({
    script: "test",
    targetPaths: ["src/pair.ts"],
  });
  expect(payload.status, JSON.stringify(payload)).toBe("confirmed");
});

it("shows mode, owner, scope, and operation class during preparation", async () => {
  const { PairLanguageModelTool } = await import("../src/tools/pairTool.js");
  const { coordinator } = createCoordinator(
    createPairRuntime(),
    new EffectPortDouble(request => ({
      operationId: request.operationId,
      status: "confirmed",
      summary: "confirmed",
      observation: {},
      sensitiveData: false,
      partial: false,
    })),
  );
  const descriptor = PAIR_TOOL_CATALOG.find(
    tool => tool.name === "pair_run_verification",
  );

  if (descriptor === undefined) {
    throw new Error("Missing pair_run_verification descriptor.");
  }

  const tool = new PairLanguageModelTool(
    nativeToolName(descriptor.name),
    descriptor,
    coordinator,
  );
  const prepared = await tool.prepareInvocation(
    { input: { plan: "npm test" } },
    createToken() as never,
  );

  expect(prepared.invocationMessage).toContain("pair_run_verification");
  expect(prepared.invocationMessage).toContain("verification");
  const details = confirmationText(prepared.confirmationMessages?.message);

  expect(details).toContain("Mode: pair");
  expect(details).toContain("owner: ai");
  expect(details).toContain("scope: src/pair.ts");
  expect(details).toContain(
    "operation class: verification",
  );
});

it("reads the latest coordinator state instead of trusting an earlier visible state", async () => {
  const { PairLanguageModelTool } = await import("../src/tools/pairTool.js");
  const effectPort = new EffectPortDouble(request => ({
    operationId: request.operationId,
    status: "confirmed",
    summary: "confirmed",
    observation: {},
    sensitiveData: false,
    partial: false,
  }));
  const { coordinator, store } = createCoordinator(createPairRuntime(), effectPort);
  const descriptor = PAIR_TOOL_CATALOG.find(
    tool => tool.name === "pair_apply_edit",
  );

  if (descriptor === undefined) {
    throw new Error("Missing pair_apply_edit descriptor.");
  }

  await coordinator.dispatch({
    protocolVersion: 1,
    commandId: "pause-before-invoke",
    expectedRevision: store.snapshotNow().revision,
    actor: "human",
    observedAt: 1001,
    type: "PauseSession",
    reason: "The developer paused after seeing the tool.",
  });
  const tool = new PairLanguageModelTool(
    nativeToolName(descriptor.name),
    descriptor,
    coordinator,
  );
  const result = await tool.invoke(
    {
      input: {
        path: "src/pair.ts",
        expectedHash: "a".repeat(64),
        patch: "diff --git",
      },
    } as never,
    createToken() as never,
  );
  const payload = parseToolPayload(result);

  expect(payload).toMatchObject({
    status: "denied",
    reason: "tool-hidden",
  });
  expect(effectPort.calls).toHaveLength(0);
});

it("denies a Growth edit-shaped tool call even when invoked by name", async () => {
  const { PairLanguageModelTool } = await import("../src/tools/pairTool.js");
  const effectPort = new EffectPortDouble(request => ({
    operationId: request.operationId,
    status: "confirmed",
    summary: "confirmed",
    observation: {},
    sensitiveData: false,
    partial: false,
  }));
  const { coordinator } = createCoordinator(createGrowthRuntime(), effectPort);
  const descriptor = PAIR_TOOL_CATALOG.find(
    tool => tool.name === "pair_apply_edit",
  );

  if (descriptor === undefined) {
    throw new Error("Missing pair_apply_edit descriptor.");
  }

  const tool = new PairLanguageModelTool(
    nativeToolName(descriptor.name),
    descriptor,
    coordinator,
  );
  const result = await tool.invoke(
    {
      input: {
        path: "src/pair.ts",
        expectedHash: "a".repeat(64),
        patch: "diff --git",
      },
    } as never,
    createToken() as never,
  );

  expect(parseToolPayload(result)).toMatchObject({
    status: "denied",
    reason: "tool-hidden",
  });
});

it("returns structured stale revision and authority denials", async () => {
  const { PairLanguageModelTool } = await import("../src/tools/pairTool.js");
  const descriptor = PAIR_TOOL_CATALOG.find(
    tool => tool.name === "pair_read_scope",
  );

  if (descriptor === undefined) {
    throw new Error("Missing pair_read_scope descriptor.");
  }

  const { coordinator } = createCoordinator(
    createPairRuntime(),
    new EffectPortDouble(request => ({
      operationId: request.operationId,
      status: "confirmed",
      summary: "confirmed",
      observation: {},
      sensitiveData: false,
      partial: false,
    })),
  );
  const tool = new PairLanguageModelTool(
    nativeToolName(descriptor.name),
    descriptor,
    coordinator,
  );
  const result = await tool.invoke(
    {
      input: {
        path: "src/pair.ts",
        runtimeRevision: 1,
        authorityEpoch: 99,
      },
    } as never,
    createToken() as never,
  );

  expect(parseToolPayload(result)).toMatchObject({
    status: "denied",
    reason: "stale-tool-view",
  });
});

it("sanitizes private host failures out of tool results", async () => {
  const { PairLanguageModelTool } = await import("../src/tools/pairTool.js");
  const descriptor = PAIR_TOOL_CATALOG.find(
    tool => tool.name === "pair_read_scope",
  );

  if (descriptor === undefined) {
    throw new Error("Missing pair_read_scope descriptor.");
  }

  const { coordinator } = createCoordinator(
    createPairRuntime(),
    new EffectPortDouble(() => {
      throw new Error("HOST_SECRET:/workspace/private.log");
    }),
  );
  const tool = new PairLanguageModelTool(
    nativeToolName(descriptor.name),
    descriptor,
    coordinator,
  );
  const result = await tool.invoke(
    {
      input: {
        path: "src/pair.ts",
      },
    } as never,
    createToken() as never,
  );
  const payload = parseToolPayload(result);

  expect(payload).toMatchObject({
    status: "failed",
    reason: "host-error",
  });
  expect(result.content).toHaveLength(1);
  expect(JSON.stringify(result.content)).not.toContain("HOST_SECRET");
  expect(JSON.stringify(payload)).not.toContain("HOST_SECRET");
});


describe("manifest and harness parity", () => {
  it("keeps every registered native name inside the harness catalog", () => {
    const contributedNames = JSON.parse(
      readFileSync(resolve("apps/vscode-extension/package.json"), "utf8"),
    ) as {
      contributes: {
        languageModelTools: { name: string }[];
      };
    };

    const harnessNames = new Set<string>(
      PAIR_TOOL_CATALOG.map(tool => nativeToolName(tool.name)),
    );

    expect(
      contributedNames.contributes.languageModelTools.every(tool => harnessNames.has(tool.name)),
    ).toBe(true);
  });
});
