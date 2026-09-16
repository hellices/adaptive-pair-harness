import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GROWTH_COMMAND_INTENTS, interpretGrowthIntent, FakeModel, createRequest } from "./growthTestHarness.js";

describe("interpretGrowthIntent", () => {
  it("maps natural language to the same core intents as slash commands", () => {
    expect(interpretGrowthIntent(createRequest(new FakeModel([]), { command: "hint" })).intent).toBe(
      "hint",
    );
    expect(
      interpretGrowthIntent(
        createRequest(new FakeModel([]), { prompt: "give me a hint on this" }),
      ).intent,
    ).toBe("hint");
    expect(
      interpretGrowthIntent(
        createRequest(new FakeModel([]), { prompt: "I think the cause is the retry guard" }),
      ).intent,
    ).toBe("hypothesis");
    expect(
      interpretGrowthIntent(
        createRequest(new FakeModel([]), { prompt: "show me the answer please" }),
      ).intent,
    ).toBe("reveal");
    expect(
      interpretGrowthIntent(
        createRequest(new FakeModel([]), { prompt: "join me here" }),
      ).intent,
    ).toBe("join");
    expect(
      interpretGrowthIntent(
        createRequest(new FakeModel([]), { prompt: "please stay quiet for now" }),
      ).intent,
    ).toBe("quiet");
  });
});

describe("interpretGrowthIntent deterministic routes", () => {
  it("has exact parity between the manifest slash commands and implemented intents", () => {
    const manifest = JSON.parse(
      readFileSync(resolve("apps/vscode-extension/package.json"), "utf8"),
    ) as {
      contributes: {
        chatParticipants: {
          commands: { name: string; description: string }[];
        }[];
      };
    };

    const declared = manifest.contributes.chatParticipants[0]?.commands ?? [];
    expect(declared.map(command => command.name).sort()).toEqual(
      Object.keys(GROWTH_COMMAND_INTENTS).sort(),
    );
    // Every advertised command routes to a deterministic implemented intent.
    for (const command of declared) {
      expect(GROWTH_COMMAND_INTENTS[command.name]).toBeDefined();
      expect(command.description.length).toBeGreaterThan(0);
    }
  });

  it("maps natural transfer, check, brief, and session language", () => {
    const model = new FakeModel([]);
    expect(
      interpretGrowthIntent(
        createRequest(model, { prompt: "give me something to try on my own" }),
      ).intent,
    ).toBe("transfer");
    expect(
      interpretGrowthIntent(createRequest(model, { prompt: "run the verification please" }))
        .intent,
    ).toBe("check");
    expect(
      interpretGrowthIntent(createRequest(model, { prompt: "what is my current task?" }))
        .intent,
    ).toBe("brief");
    expect(
      interpretGrowthIntent(createRequest(model, { prompt: "show me the session status" }))
        .intent,
    ).toBe("session");
  });
});
