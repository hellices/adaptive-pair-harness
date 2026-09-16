import { describe, expect, it } from "vitest";
import { routeBoundaryFixture } from "./growthRouteBoundaryHarness.js";
import { asModel, createGrowthModel, FakeModel } from "./growthTestHarness.js";

const accountingCases = ["input", "output", "tool-output"].flatMap(phase =>
  ["throw", "reject"].map(failure => ({ phase, failure })),
);

describe("Growth model — non-raw accounting failures", () => {
  it.each(accountingCases)("does not retain private $phase after accounting $failure", async ({ phase, failure }) => {
    const fixture = routeBoundaryFixture();
    const marker = phase === "input" ? "bounded private context" : "private-model-output-sentinel";
    const response = JSON.stringify({ level: 1, kind: "question", text: marker });
    const provider = new FakeModel([phase === "tool-output"
      ? { toolCalls: [{ callId: "private-call", name: "adaptive_pair_get_state", input: { marker } }] }
      : { text: response }]);
    const countTokens = provider.countTokens.bind(provider);
    provider.countTokens = text => {
      if (typeof text === "string" && text.includes(marker)) {
        const error = new Error(`Tokenizer rejected its text: ${text}`);
        if (failure === "throw") throw error;
        return Promise.reject(error);
      }
      return countTokens(text);
    };
    fixture.createModel.mockImplementation(model => createGrowthModel(model, fixture.coordinator));
    const running = fixture.start(undefined, asModel(provider));
    await running.done;
    expect(provider.sendCount).toBe(phase === "input" ? 0 : 1);
    expect(running.collected.markdown.join("\n")).not.toContain(marker);
    const records = JSON.stringify(fixture.evaluations.records);
    expect(records).not.toContain(marker);
    expect(fixture.evaluations.records.at(-1)?.reason).toBe("GROWTH_MODEL_ERROR");
  });

  it("normalizes the same provider failure when it arises in sendRequest", async () => {
    const fixture = routeBoundaryFixture();
    const marker = "private-dispatch-error-sentinel";
    const provider = new FakeModel([]);
    provider.sendRequest = () => Promise.reject(new Error(marker));
    fixture.createModel.mockImplementation(model => createGrowthModel(model, fixture.coordinator));
    await fixture.start(undefined, asModel(provider)).done;
    expect(fixture.evaluations.records.at(-1)?.reason).toBe("GROWTH_MODEL_ERROR");
    expect(JSON.stringify(fixture.evaluations.records)).not.toContain(marker);
  });
});
