import { describe, expect, it, vi } from "vitest";
import { routeBoundaryFixture } from "./growthRouteBoundaryHarness.js";

const privateText = "private boundary failure: repository-secret-sentinel";
const failures = ["model", "consent", "snapshot", "prepare"].flatMap(stage =>
  ["throw", "reject"].map(kind => ({ stage, kind })),
);

describe("Growth participant common failure privacy", () => {
  it.each(failures)("does not retain raw text from $stage $kind", async ({ stage, kind }) => {
    const fixture = routeBoundaryFixture();
    const fail = (): never | Promise<never> => {
      const error = new Error(privateText);
      if (kind === "throw") throw error;
      return Promise.reject(error);
    };
    if (stage === "model") fixture.requestModel.mockImplementation(fail);
    if (stage === "consent") fixture.requestWorkspaceConsent.mockImplementation(fail);
    if (stage === "snapshot") vi.spyOn(fixture.coordinator, "snapshot").mockImplementation(fail);
    if (stage === "prepare") vi.spyOn(fixture.coordinator, "prepareTurn").mockImplementation(fail);
    const running = fixture.start();
    await running.done;
    expect(fixture.evaluations.records.at(-1)?.reason).toBe("GROWTH_UNKNOWN_ERROR");
    expect(JSON.stringify(fixture.evaluations.records)).not.toContain(privateText);
    expect(running.collected.markdown.join("\n")).not.toContain(privateText);
    expect(fixture.execute).not.toHaveBeenCalled();
    if (stage !== "model") expect(fixture.requestModel).not.toHaveBeenCalled();
  });

  it("contains a factory error before model dispatch", async () => {
    const fixture = routeBoundaryFixture();
    fixture.createModel.mockImplementation(() => { throw new Error(privateText); });
    await fixture.start().done;
    expect(fixture.evaluations.records.at(-1)?.reason).toBe("GROWTH_UNKNOWN_ERROR");
    expect(JSON.stringify(fixture.evaluations.records)).not.toContain(privateText);
    expect(fixture.requestModel).not.toHaveBeenCalled();
  });
});
