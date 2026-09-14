import { describe, expect, it, vi } from "vitest";
import {
  runPairAgentTurn,
  type PairAgentMessage,
  type PairAgentModel,
  type PairAgentModelPart,
  type PairAgentToolbox,
} from "../src/core/pairAgent";

const toolDefinitions: PairAgentToolbox["definitions"] = [{
  name: "read_file",
  description: "Read a project file.",
  inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  kind: "read",
}];

const makeModel = (responses: readonly (readonly PairAgentModelPart[])[]): PairAgentModel & {
  readonly calls: PairAgentMessage[][];
} => {
  const calls: PairAgentMessage[][] = [];
  return {
    calls,
    countTokens: async () => 20,
    stream: async (messages) => {
      const parts = responses[calls.length] ?? [];
      calls.push([...messages]);
      return (async function* () { yield* parts; })();
    },
  };
};

const makeToolbox = (): PairAgentToolbox => ({
  definitions: toolDefinitions,
  invoke: vi.fn(async () => ({
    status: "ok" as const,
    text: "12: Reject a retry with a different payment identity.",
    summary: "Read docs/requirements.md, lines 1–20.",
  })),
});

const input = (model: PairAgentModel, toolbox = makeToolbox()) => ({
  model,
  toolbox,
  prompt: "What should we implement first?",
  context: "Goal: prevent duplicate charges.",
  instructions: "Read requirements, explain the tradeoff, and propose a small step.",
  signal: new AbortController().signal,
  isCurrent: () => true,
});

describe("working pair agent", () => {
  it("requires an observed read before offering edits or a grounded answer", async () => {
    const available: string[][] = [];
    const forced: boolean[] = [];
    const model: PairAgentModel = {
      countTokens: async () => 20,
      stream: async (_messages, definitions, _maximum, _signal, requireTool) => {
        available.push(definitions.map((definition) => definition.name));
        forced.push(requireTool === true);
        return (async function* () {
          if (available.length === 1) {
            yield { kind: "tool-call" as const, callId: "inspect", name: "read_file", input: { path: "README.md" } };
          } else {
            yield { kind: "text" as const, text: "The observed requirement needs a retry test." };
          }
        })();
      },
    };
    const toolbox: PairAgentToolbox = { ...makeToolbox(), definitions: [...toolDefinitions, { ...toolDefinitions[0]!, name: "edit_file", kind: "edit" }] };
    await runPairAgentTurn({ ...input(model, toolbox), requireInitialRead: true });
    expect(available).toEqual([["read_file"], ["read_file", "edit_file"]]);
    expect(forced).toEqual([true, false]);
  });

  it.each(["error", "blocked", "sensitive"])("does not count a %s read as usable inspection", async (firstStatus) => {
    const available: string[][] = [];
    const model: PairAgentModel = {
      countTokens: async () => 20,
      stream: async (_messages, definitions) => {
        available.push(definitions.map((definition) => definition.name));
        return (async function* () {
          if (available.length <= 2) {
            yield { kind: "tool-call" as const, callId: `read-${available.length}`, name: "read_file", input: { path: "README.md" } };
          } else {
            yield { kind: "text" as const, text: "Now the project requirement has actually been read." };
          }
        })();
      },
    };
    let reads = 0;
    const toolbox: PairAgentToolbox = {
      definitions: [...toolDefinitions, { ...toolDefinitions[0]!, name: "edit_file", kind: "edit" }],
      invoke: async () => {
        reads += 1;
        return reads === 1
          ? { status: firstStatus === "sensitive" ? "ok" : firstStatus as "error" | "blocked", text: "No usable content.", summary: "Read failed.", sensitiveDataDetected: firstStatus === "sensitive" }
          : { status: "ok", text: "A real requirement from README.", summary: "Read README." };
      },
    };
    await runPairAgentTurn({ ...input(model, toolbox), requireInitialRead: true });
    expect(available).toEqual([["read_file"], ["read_file"], ["read_file", "edit_file"]]);
  });

  it("returns real tool observations to the model before answering", async () => {
    const model = makeModel([
      [{ kind: "tool-call", callId: "read-1", name: "read_file", input: { path: "docs/requirements.md" } }],
      [{ kind: "text", text: "The requirement on line 12 needs an identity-mismatch test first." }],
    ]);
    const toolbox = makeToolbox();
    const result = await runPairAgentTurn(input(model, toolbox));
    expect(toolbox.invoke).toHaveBeenCalledWith("read_file", { path: "docs/requirements.md" }, expect.any(AbortSignal));
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]).toContainEqual({ role: "user", content: [{
      kind: "tool-result", callId: "read-1", text: "12: Reject a retry with a different payment identity.",
    }] });
    expect(result.text).toContain("identity-mismatch test");
    expect(result.activities).toEqual([{ name: "read_file", status: "ok", summary: "Read docs/requirements.md, lines 1–20." }]);
    expect(result.modelCalls).toBe(2);
  });

  it("never executes a tool absent from the approved toolbox", async () => {
    const model = makeModel([
      [{ kind: "tool-call", callId: "bad", name: "run_shell", input: { command: "unapproved" } }],
      [{ kind: "text", text: "That operation is unavailable." }],
    ]);
    const toolbox = makeToolbox();
    await runPairAgentTurn(input(model, toolbox));
    expect(toolbox.invoke).not.toHaveBeenCalled();
    expect(JSON.stringify(model.calls[1])).toContain("not available");
  });

  it("withholds complete sensitive tool output before output truncation", async () => {
    const model = makeModel([
      [{ kind: "tool-call", callId: "read", name: "read_file", input: { path: "docs/requirements.md" } }],
      [{ kind: "text", text: "Inspect the blocked document locally." }],
    ]);
    const toolbox: PairAgentToolbox = {
      definitions: toolDefinitions,
      invoke: async () => ({ status: "ok", text: `${"ordinary description ".repeat(1_000)} api_key='never-forward-this-credential'`, summary: "Read document." }),
    };
    await runPairAgentTurn(input(model, toolbox));
    expect(JSON.stringify(model.calls)).not.toContain("never-forward-this-credential");
    expect(JSON.stringify(model.calls[1])).toContain("withheld");
  });

  it("refuses sensitive explicit task input before calling a model", async () => {
    const model = makeModel([[{ kind: "text", text: "must not run" }]]);
    await expect(runPairAgentTurn({ ...input(model), prompt: "api_key='private-task-credential'" })).rejects.toThrow(/sensitive/i);
    expect(model.calls).toHaveLength(0);
  });

  it("rechecks scope after a tool finishes and before another model request", async () => {
    let current = true;
    const model = makeModel([[{ kind: "tool-call", callId: "read", name: "read_file", input: { path: "docs/requirements.md" } }]]);
    const toolbox: PairAgentToolbox = {
      definitions: toolDefinitions,
      invoke: async () => { current = false; return { status: "ok", text: "Late result", summary: "Read document." }; },
    };
    await expect(runPairAgentTurn({ ...input(model, toolbox), isCurrent: () => current })).rejects.toThrow(/current|changed/i);
    expect(model.calls).toHaveLength(1);
  });

  it("does not dispatch when cancelled during token admission", async () => {
    const controller = new AbortController();
    const model = makeModel([[{ kind: "text", text: "must not run" }]]);
    model.countTokens = async () => { controller.abort(); return 20; };
    await expect(runPairAgentTurn({ ...input(model), signal: controller.signal })).rejects.toThrow();
    expect(model.calls).toHaveLength(0);
  });

  it("checks scope before starting an asynchronous model operation", async () => {
    let current = true;
    const model = makeModel([[{ kind: "text", text: "Must not dispatch." }]]);
    await expect(runPairAgentTurn({
      ...input(model), isCurrent: () => current, progress: () => { current = false; },
    })).rejects.toThrow(/current|changed/i);
    expect(model.calls).toHaveLength(0);
  });

  it("bounds model loops rather than returning a fabricated success", async () => {
    const model = makeModel([
      [{ kind: "tool-call", callId: "first", name: "read_file", input: { path: "docs/requirements.md" } }],
      [{ kind: "tool-call", callId: "second", name: "read_file", input: { path: "docs/requirements.md" } }],
    ]);
    await expect(runPairAgentTurn({ ...input(model), limits: { modelCalls: 2 } })).rejects.toThrow(/limit|budget/i);
    expect(model.calls).toHaveLength(2);
  });

  it("removes declined action tools for the rest of the turn", async () => {
    const model = makeModel([
      [{ kind: "tool-call", callId: "first", name: "edit_file", input: { path: "docs/brief.md" } }],
      [{ kind: "tool-call", callId: "second", name: "edit_file", input: { path: "docs/brief.md" } }],
      [{ kind: "text", text: "No change was applied." }],
    ]);
    const toolbox: PairAgentToolbox = {
      definitions: [{ ...toolDefinitions[0]!, name: "edit_file", kind: "edit" }],
      invoke: vi.fn(async () => ({ status: "declined" as const, text: "The developer declined this change. Do not request it again this turn.", summary: "No change applied." })),
    };
    const result = await runPairAgentTurn(input(model, toolbox));
    expect(toolbox.invoke).toHaveBeenCalledTimes(1);
    expect(result.text).toBe("No change was applied.");
  });
});
