import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CompiledInstructionEnvelope, PairToolView } from "@adaptive-pair/harness";
import type { GrowthResponse } from "@adaptive-pair/restraint";
import { ActivityLedger } from "../src/activityLedger.js";
import { accountedModelFactory } from "../src/modelAccounting.js";
import type { GrowthModel } from "../src/modelAdapter.js";

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const hostDir = resolve(dirname(fileURLToPath(import.meta.url)), "host");

const envelope = { runtimeRevision: 4 } as unknown as CompiledInstructionEnvelope;
const toolView = { runtimeRevision: 4, tools: [] } as unknown as PairToolView;

const answer = (text: string): GrowthResponse => ({ kind: "hint", level: 2, text });

describe("accountedModelFactory", () => {
  it("counts one model request per dispatched turn and returns the response", async () => {
    const ledger = new ActivityLedger();
    const model: GrowthModel = { request: () => Promise.resolve(answer("try again")) };

    const factory = accountedModelFactory(ledger, () => model);
    const accounted = factory({} as never);

    expect(ledger.snapshot().modelRequests).toBe(0);
    await expect(accounted.request(envelope, toolView, new AbortController().signal)).resolves
      .toEqual(answer("try again"));
    expect(ledger.snapshot().modelRequests).toBe(1);

    await accounted.request(envelope, toolView, new AbortController().signal);
    expect(ledger.snapshot().modelRequests).toBe(2);
  });

  it("forwards the instructions, tool view, and abort signal unchanged", async () => {
    const ledger = new ActivityLedger();
    const seen: unknown[] = [];
    const signal = new AbortController().signal;
    const factory = accountedModelFactory(ledger, () => ({
      request: (instructions, tools, abort) => {
        seen.push(instructions, tools, abort);
        return Promise.resolve(answer("ok"));
      },
    }));

    await factory({} as never).request(envelope, toolView, signal);

    expect(seen).toEqual([envelope, toolView, signal]);
  });

  it("counts a request that the model rejects, because the boundary was crossed", async () => {
    const ledger = new ActivityLedger();
    const factory = accountedModelFactory(ledger, () => ({
      request: () => Promise.reject(new Error("model unavailable")),
    }));

    await expect(
      factory({} as never).request(envelope, toolView, new AbortController().signal),
    ).rejects.toThrow("model unavailable");
    expect(ledger.snapshot().modelRequests).toBe(1);
  });

  it("builds the underlying model once per chat model, through the given factory", () => {
    const ledger = new ActivityLedger();
    const built: unknown[] = [];
    const chatModel = { id: "test-model" } as never;

    accountedModelFactory(ledger, (model) => {
      built.push(model);
      return { request: () => Promise.resolve(answer("ok")) };
    })(chatModel);

    expect(built).toEqual([chatModel]);
  });
});

describe("model accounting wiring", () => {
  it("is the only place that records a model request", async () => {
    const callers: string[] = [];
    for (const file of [
      "extensionCore.ts",
      "growthParticipant.ts",
      "presenceController.ts",
      "sessionController.ts",
    ]) {
      if ((await readFile(resolve(srcDir, file), "utf8")).includes("recordModelRequest(")) {
        callers.push(file);
      }
    }
    const host = await readFile(resolve(hostDir, "hostTestApi.ts"), "utf8");

    expect(callers).toEqual([]);
    expect(host, "the host entry duplicates the production accounting wrapper").not.toContain(
      "recordModelRequest(",
    );
  });

  it("is shared by the production entry and the isolated host entry", async () => {
    const core = await readFile(resolve(srcDir, "extensionCore.ts"), "utf8");
    const host = await readFile(resolve(hostDir, "hostTestApi.ts"), "utf8");

    expect(core).toContain("accountedModelFactory");
    expect(host).toContain("accountedModelFactory");
  });
});
