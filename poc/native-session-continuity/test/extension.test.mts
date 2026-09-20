import { strict as assert } from "node:assert";
import type { ExtensionContext } from "vscode";
import { afterEach, expect, it, vi } from "vitest";
import { activate } from "../extension.js";

interface FixtureProvider {
  provideLanguageModelChatResponse(): Promise<never>;
  provideTokenCount(): Promise<number>;
}

const models = vi.hoisted(() => ({
  register: vi.fn<(vendor: string, provider: FixtureProvider) => { dispose(): void }>(),
}));

vi.mock("vscode", () => ({
  chat: {
    createChatParticipant: () => ({ dispose: () => undefined }),
    onDidDisposeChatSession: () => { throw new Error("CANNOT use API proposal: chatParticipantPrivate"); },
  },
  lm: { registerLanguageModelChatProvider: models.register },
}));

afterEach(() => vi.unstubAllEnvs());

it("accounts for local token counting separately from rejected model response requests", async () => {
  vi.stubEnv("AP_NATIVE_DRIVER", "");
  models.register.mockReset().mockReturnValue({ dispose: () => undefined });
  const api = activate({ subscriptions: [] } as unknown as ExtensionContext);
  const provider = models.register.mock.calls[0]?.[1];
  assert.ok(provider);
  expect(api.getState()).toMatchObject({ modelCalls: 0, tokenCountCalls: 0 });
  await expect(provider.provideTokenCount()).resolves.toBe(1);
  expect(api.getState()).toMatchObject({ modelCalls: 0, tokenCountCalls: 1 });
  await expect(provider.provideLanguageModelChatResponse()).rejects.toThrow("must not invoke a language model");
  expect(api.getState()).toMatchObject({ modelCalls: 1, tokenCountCalls: 1 });
});
