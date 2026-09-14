import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { createPairAgentModel } from "../src/vscode/pairAgentModel";
import type { PairAgentMessage, PairAgentModelPart } from "../src/core/pairAgent";

const native = vi.hoisted(() => {
  class TextPart { public constructor(public value: string) {} }
  class CallPart { public constructor(public callId: string, public name: string, public input: object) {} }
  class ResultPart { public constructor(public callId: string, public content: unknown[]) {} }
  const sources: { cancelled: boolean; disposed: boolean }[] = [];
  class CancellationTokenSource {
    public readonly state = { cancelled: false, disposed: false };
    public readonly token = this.state;
    public constructor() { sources.push(this.state); }
    public cancel(): void { this.state.cancelled = true; }
    public dispose(): void { this.state.disposed = true; }
  }
  return { TextPart, CallPart, ResultPart, CancellationTokenSource, sources };
});

vi.mock("vscode", () => ({
  LanguageModelTextPart: native.TextPart,
  LanguageModelToolCallPart: native.CallPart,
  LanguageModelToolResultPart: native.ResultPart,
  LanguageModelChatToolMode: { Required: 2 },
  LanguageModelChatMessage: {
    User: (content: unknown[]) => ({ role: "user", content }),
    Assistant: (content: unknown[]) => ({ role: "assistant", content }),
  },
  CancellationTokenSource: native.CancellationTokenSource,
  lm: { selectChatModels: () => { throw new Error("Do not replace the selected Chat model."); } },
}));

const selectedModel = (parts: readonly unknown[] = [new native.TextPart("A grounded answer.")]) => ({
  id: "selected-model",
  name: "Selected model",
  vendor: "selected-vendor",
  maxInputTokens: 32_000,
  countTokens: vi.fn(async () => 25),
  sendRequest: vi.fn<(messages: unknown[], options: unknown, token: unknown) => Promise<{ stream: AsyncIterable<unknown> }>>(async () => ({ stream: (async function* () { yield* parts; })() })),
});

describe("selected Chat model adapter", () => {
  beforeEach(() => { native.sources.length = 0; });

  it("uses exactly the model from Chat and preserves tool calls", async () => {
    const selected = selectedModel([new native.CallPart("read-1", "read_file", { path: "README.md" })]);
    const model = createPairAgentModel(selected as unknown as vscode.LanguageModelChat);
    const stream = await model.stream([{ role: "user", content: [{ kind: "text", text: "Inspect the goal." }] }], [{
      name: "read_file", description: "Read a project file.", inputSchema: { type: "object" }, kind: "read",
    }], 500, new AbortController().signal, true);
    const observed: PairAgentModelPart[] = [];
    for await (const part of stream) { observed.push(part); }
    expect(selected.sendRequest).toHaveBeenCalledTimes(1);
    expect(selected.sendRequest.mock.calls[0]).toEqual([
      [{ role: "user", content: [new native.TextPart("Inspect the goal.")] }],
      expect.objectContaining({ tools: [{ name: "read_file", description: "Read a project file.", inputSchema: { type: "object" } }], modelOptions: { max_tokens: 500 }, toolMode: 2 }),
      expect.anything(),
    ]);
    expect(observed).toEqual([{ kind: "tool-call", callId: "read-1", name: "read_file", input: { path: "README.md" } }]);
    expect(native.sources.every((source) => source.disposed)).toBe(true);
  });

  it("maps previous call and result messages to native tool parts", async () => {
    const selected = selectedModel();
    const model = createPairAgentModel(selected as unknown as vscode.LanguageModelChat);
    const messages: PairAgentMessage[] = [
      { role: "assistant", content: [{ kind: "tool-call", callId: "read-1", name: "read_file", input: { path: "README.md" } }] },
      { role: "user", content: [{ kind: "tool-result", callId: "read-1", text: "Observed requirements" }] },
    ];
    const stream = await model.stream(messages, [], 500, new AbortController().signal);
    for await (const part of stream) { expect(part).toEqual({ kind: "text", text: "A grounded answer." }); }
    expect(selected.sendRequest.mock.calls[0]?.[0]).toEqual([
      { role: "assistant", content: [new native.CallPart("read-1", "read_file", { path: "README.md" })] },
      { role: "user", content: [new native.ResultPart("read-1", [new native.TextPart("Observed requirements")])] },
    ]);
  });

  it("forwards cancellation throughout streaming", async () => {
    const selected = selectedModel([new native.TextPart("First part"), new native.TextPart("Late part")]);
    const controller = new AbortController();
    const model = createPairAgentModel(selected as unknown as vscode.LanguageModelChat);
    const stream = await model.stream([], [], 500, controller.signal);
    const consume = async (): Promise<void> => {
      for await (const part of stream) { expect(part).toEqual({ kind: "text", text: "First part" }); controller.abort(); }
    };
    await expect(consume()).rejects.toThrow();
    expect(native.sources[0]?.cancelled).toBe(true);
    expect(native.sources[0]?.disposed).toBe(true);
  });

  it("counts with the selected model and never sends a pre-cancelled request", async () => {
    const selected = selectedModel();
    const model = createPairAgentModel(selected as unknown as vscode.LanguageModelChat);
    expect(await model.countTokens("Count the real context.", new AbortController().signal)).toBe(25);
    expect(model.maxInputTokens).toBe(32_000);
    const controller = new AbortController();
    controller.abort();
    const consume = async (): Promise<void> => {
      const stream = await model.stream([], [], 500, controller.signal);
      for await (const part of stream) { throw new Error(`Must not emit ${part.kind}.`); }
    };
    await expect(consume()).rejects.toThrow();
    expect(selected.sendRequest).not.toHaveBeenCalled();
  });
});
