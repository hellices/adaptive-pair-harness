import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";
import { collectPairConversation } from "../src/vscode/pairConversation";

const exchange = (prompt: string, answer: string, conversationId = "current", participant = "adaptivePair.chat") => [
  { prompt, participant },
  { participant, result: { metadata: { pairConversationId: conversationId } }, response: [{ value: { value: answer } }] },
] as unknown as vscode.ChatContext["history"];

describe("pair conversation scoping", () => {
  it("retains a developer's reply and an approved assistant answer", () => {
    expect(collectPairConversation(exchange("Keep the current provider.", "Then test the retry boundary."), "current", true)).toEqual([
      { role: "user", content: "Keep the current provider." },
      { role: "assistant", content: "Then test the retry boundary." },
    ]);
  });

  it("does not forward local workspace-derived assistant text without consent", () => {
    expect(collectPairConversation(exchange("What should we do next?", "A private document says..."), "current", false)).toEqual([
      { role: "user", content: "What should we do next?" },
    ]);
  });

  it("excludes previous sessions or goals and other participants", () => {
    const history = [...exchange("old goal", "old answer", "old"), ...exchange("foreign", "foreign answer", "current", "other.agent")];
    expect(collectPairConversation(history, "current", true)).toEqual([]);
  });

  it("requires a completed matching response, not merely a user turn", () => {
    const history = [{ prompt: "unconfirmed", participant: "adaptivePair.chat" }] as unknown as vscode.ChatContext["history"];
    expect(collectPairConversation(history, "current", true)).toEqual([]);
  });

  it("limits history to the latest three exchanges", () => {
    const history = Array.from({ length: 10 }, (_, index) => exchange(`question-${index}`, `answer-${index}`)).flat();
    const turns = collectPairConversation(history, "current", true);
    expect(turns).toHaveLength(6);
    expect(turns[0]?.content).toBe("question-7");
  });
});
