import { describe, expect, it, vi } from "vitest";
import type { CompiledInstructionEnvelope } from "@adaptive-pair/harness";
import { GrowthModelFailure } from "@adaptive-pair/runtime";

const host = vi.hoisted(() => {
  class LanguageModelTextPart {
    public constructor(public readonly value: string) {}
  }
  class LanguageModelToolCallPart {
    public constructor(
      public readonly callId: string,
      public readonly name: string,
      public readonly input: object,
    ) {}
  }
  class LanguageModelToolResultPart {
    public constructor(public readonly callId: string, public readonly content: unknown[]) {}
  }
  return {
    LanguageModelTextPart,
    LanguageModelToolCallPart,
    LanguageModelToolResultPart,
    LanguageModelChatMessage: { User: (content: unknown) => ({ role: 1, content }) },
  };
});

vi.mock("vscode", () => host);

const { buildInitialMessages, messageText, parseEnvelope, serializeToolCall } =
  await import("../src/growthModelMessages.js");

describe("Growth model message boundary", () => {
  it("keeps untrusted context separate from the trusted response contract", () => {
    const envelope: CompiledInstructionEnvelope = {
      instructionVersion: 1,
      runtimeRevision: 4,
      authorityEpoch: 2,
      maximumHintLevel: 1,
      maximumResponseClass: "question",
      layers: [
        { kind: "product", trusted: true, content: "TRUSTED_GROWTH_RULES" },
        { kind: "untrusted-repository", trusted: false, content: "UNTRUSTED_EXCERPT" },
      ],
    };
    const messages = buildInitialMessages(envelope).map(messageText);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("TRUSTED_GROWTH_RULES");
    expect(messages[0]).toContain("GROWTH_RESPONSE_CONTRACT");
    expect(messages[0]).not.toContain("UNTRUSTED_EXCERPT");
    expect(messages[1]).toContain("UNTRUSTED_EXCERPT");
    expect(messages[1]).toContain("AUTHORIZED_HINT_LEVEL: 1");
  });

  it("parses an immutable JSON envelope without applying release authority", () => {
    const response = { level: 5, kind: "solution-preview", text: "```diff\n+return 1;\n```" };
    const parsed = parseEnvelope(JSON.stringify(response));

    expect(parsed).toEqual(response);
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it.each([
    { text: " ", code: "GROWTH_EMPTY_RESPONSE" },
    { text: "Here is the answer: {}", code: "GROWTH_NON_JSON_RESPONSE" },
    { text: "```json\n{}\n```", code: "GROWTH_NON_JSON_RESPONSE" },
    { text: "{invalid}", code: "GROWTH_NON_JSON_RESPONSE" },
    { text: '{"level":6,"kind":"hint","text":"large"}', code: "GROWTH_INVALID_ENVELOPE" },
    { text: '{"level":1,"kind":"unknown","text":"bad"}', code: "GROWTH_INVALID_ENVELOPE" },
  ])("retains typed parsing failure $code", ({ text, code }) => {
    expect(() => parseEnvelope(text)).toThrow(GrowthModelFailure);
    expect(() => parseEnvelope(text)).toThrow(code);
  });

  it("serializes tool-call arguments and result text for model token accounting", () => {
    const call = new host.LanguageModelToolCallPart("call-1", "adaptive_pair_get_state", { scope: "current" });
    const result = new host.LanguageModelToolResultPart("call-1", [new host.LanguageModelTextPart("bounded result")]);
    const message = host.LanguageModelChatMessage.User([
      new host.LanguageModelTextPart("question"), call, result,
    ]) as import("vscode").LanguageModelChatMessage;

    expect(serializeToolCall(call)).toBe('adaptive_pair_get_state {"scope":"current"}');
    expect(messageText(message)).toBe('question\nadaptive_pair_get_state {"scope":"current"}\nbounded result');
  });
});
