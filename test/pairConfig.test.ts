import { describe, expect, it } from "vitest";
import { readPairConfig } from "../src/config/pairConfig";

class TestConfiguration {
  public constructor(private readonly values: Readonly<Record<string, unknown>>) {}

  public get(key: string): unknown {
    return this.values[key];
  }
}

describe("readPairConfig", () => {
  it("clamps debounce and maps the balanced style to its exact budget", () => {
    const config = readPairConfig(
      new TestConfiguration({
        debounceMs: 2_000,
        interventionStyle: "balanced",
      }),
    );

    expect(config.debounceMs).toBe(800);
    expect(config.budget).toEqual({
      maxCalls: 4,
      maxInputTokens: 6_000,
      windowMs: 600_000,
    });
  });

  it("reads supported values and maps each intervention style budget", () => {
    const eco = readPairConfig(
      new TestConfiguration({
        enabled: false,
        debounceMs: 100,
        interventionStyle: "eco",
        "model.provider": "vscode-copilot",
        "model.name": "copilot-selected",
      }),
    );
    const active = readPairConfig(
      new TestConfiguration({
        interventionStyle: "active",
      }),
    );

    expect(eco).toMatchObject({
      enabled: false,
      debounceMs: 300,
      interventionStyle: "eco",
      provider: "vscode-copilot",
      modelName: "copilot-selected",
      budget: {
        maxCalls: 2,
        maxInputTokens: 2_000,
        windowMs: 600_000,
      },
    });
    expect(active.budget).toEqual({
      maxCalls: 8,
      maxInputTokens: 12_000,
      windowMs: 600_000,
    });
  });

  it("falls back safely and warns when an OpenAI-compatible URL is malformed", () => {
    const config = readPairConfig(
      new TestConfiguration({
        interventionStyle: "loud",
        "model.provider": "openai-compatible",
        "model.baseUrl": "not a url",
      }),
    );

    expect(config).toMatchObject({
      interventionStyle: "balanced",
      provider: "local-template",
      baseUrl: undefined,
      statusWarning: expect.stringContaining("OpenAI-compatible"),
    });
  });

  it("rejects non-HTTP OpenAI-compatible endpoints", () => {
    const config = readPairConfig(
      new TestConfiguration({
        "model.provider": "openai-compatible",
        "model.baseUrl": "file:///workspace/secrets",
      }),
    );

    expect(config.provider).toBe("local-template");
    expect(config.baseUrl).toBeUndefined();
    expect(config.statusWarning).toContain("OpenAI-compatible");
  });
});
