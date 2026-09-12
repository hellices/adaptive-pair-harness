import { describe, expect, it } from "vitest";
import {
  apiKeySecretNameForEndpoint,
  readPairConfig,
} from "../src/config/pairConfig";
import type { ConfigurationInspection } from "../src/config/pairConfig";

class TestConfiguration {
  public constructor(
    private readonly values: Readonly<Record<string, unknown>>,
    private readonly inspected: Readonly<
      Record<
        string,
        | {
            readonly defaultValue?: unknown;
            readonly globalValue?: unknown;
            readonly workspaceValue?: unknown;
            readonly workspaceFolderValue?: unknown;
          }
        | undefined
      >
    > = {},
  ) {}

  public get(key: string): unknown {
    return this.values[key];
  }

  public inspect(key: string): ConfigurationInspection | undefined {
    return this.inspected[key];
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
      maxOutputTokens: 720,
      maxOutputTokensPerCall: 180,
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
        maxOutputTokens: 360,
        maxOutputTokensPerCall: 180,
        windowMs: 600_000,
      },
    });
    expect(active.budget).toEqual({
      maxCalls: 8,
      maxInputTokens: 12_000,
      maxOutputTokens: 1_440,
      maxOutputTokensPerCall: 180,
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

  it("disables OpenAI-compatible configuration when baseUrl is not a string", () => {
    const config = readPairConfig(
      new TestConfiguration({
        "model.provider": "openai-compatible",
        "model.baseUrl": { endpoint: "https://model.example/v1" },
      }),
    );

    expect(config.provider).toBe("local-template");
    expect(config.baseUrl).toBeUndefined();
    expect(config.statusWarning).toContain("adaptivePair.model.baseUrl");
  });

  it("surfaces an explicit warning for an invalid provider value", () => {
    const config = readPairConfig(
      new TestConfiguration({
        "model.provider": "mystery-provider",
      }),
    );

    expect(config.provider).toBe("local-template");
    expect(config.statusWarning).toContain("mystery-provider");
    expect(config.statusWarning).toContain("local-template");
  });

  it("ignores workspace-controlled remote routing settings", () => {
    const config = readPairConfig(
      new TestConfiguration(
        {
          "model.provider": "openai-compatible",
          "model.baseUrl": "https://attacker.example/collect",
          "model.name": "workspace-model",
        },
        {
          "model.provider": {
            defaultValue: "local-template",
            globalValue: "openai-compatible",
            workspaceValue: "openai-compatible",
          },
          "model.baseUrl": {
            defaultValue: "http://localhost:11434/v1",
            globalValue: "https://trusted.example/v1",
            workspaceValue: "https://attacker.example/collect",
          },
          "model.name": {
            defaultValue: "qwen2.5-coder:7b",
            globalValue: "trusted-model",
            workspaceFolderValue: "workspace-model",
          },
        },
      ),
    );

    expect(config.provider).toBe("openai-compatible");
    expect(config.baseUrl?.href).toBe("https://trusted.example/v1");
    expect(config.modelName).toBe("trusted-model");
    expect(config.statusWarning).toContain("workspace remote settings ignored");
    expect(config.statusWarning).not.toContain("attacker.example");
  });

  it.each([
    "http://models.example/v1",
    "https://user:password@models.example/v1",
    "https://models.example/v1?api_key=secret",
    "https://models.example/v1?",
    "https://models.example/v1#fragment",
    "https://models.example/v1#",
    "https://models.example/v 1",
    "https://models.example/v\t1",
    "https://models.example/v\n1",
    "https://models.example/v\u00001",
    "https://models.example/v\u007f1",
  ])("rejects unsafe OpenAI-compatible endpoint %s", (baseUrl) => {
    const config = readPairConfig(
      new TestConfiguration({
        "model.provider": "openai-compatible",
        "model.baseUrl": baseUrl,
      }),
    );

    expect(config.provider).toBe("local-template");
    expect(config.baseUrl).toBeUndefined();
    expect(config.statusWarning).toContain("unsafe");
  });

  it.each([
    ["http://localhost:11434/v1", "http://localhost:11434/v1"],
    ["http://127.0.0.1:11434/v1/", "http://127.0.0.1:11434/v1"],
    ["http://[::1]:11434/v1", "http://[::1]:11434/v1"],
    ["https://MODELS.EXAMPLE:443/v1/", "https://models.example/v1"],
  ])("canonicalizes a safe endpoint %s", (baseUrl, expected) => {
    const config = readPairConfig(
      new TestConfiguration({
        "model.provider": "openai-compatible",
        "model.baseUrl": baseUrl,
      }),
    );

    expect(config.provider).toBe("openai-compatible");
    expect(config.baseUrl?.href).toBe(expected);
  });

  it("binds API-key storage names to canonical endpoint origins", () => {
    const first = apiKeySecretNameForEndpoint(
      new URL("https://MODELS.EXAMPLE:443/v1"),
    );
    const sameOrigin = apiKeySecretNameForEndpoint(
      new URL("https://models.example/another/path"),
    );
    const otherOrigin = apiKeySecretNameForEndpoint(
      new URL("https://other.example/v1"),
    );

    expect(first).toBe(sameOrigin);
    expect(first).not.toBe(otherOrigin);
    expect(first).not.toContain("models.example");
  });
});
