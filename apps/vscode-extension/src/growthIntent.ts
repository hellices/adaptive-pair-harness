import type * as vscode from "vscode";
import type { HintLevel } from "@adaptive-pair/protocol";

export type GrowthIntent =
  | "brief"
  | "join"
  | "attempt"
  | "hypothesis"
  | "hint"
  | "reveal"
  | "check"
  | "transfer"
  | "session"
  | "quiet"
  | "chat";

export interface GrowthIntentResult {
  readonly intent: GrowthIntent;
  readonly level: HintLevel | undefined;
}

/**
 * The advertised slash commands and the deterministic intent each one routes
 * to. The manifest's `chatParticipants` commands must match these keys exactly;
 * there is no generic fallthrough for an advertised command.
 */
export const GROWTH_COMMAND_INTENTS: Readonly<Record<string, GrowthIntent>> =
  Object.freeze({
    brief: "brief",
    attempt: "attempt",
    hypothesis: "hypothesis",
    hint: "hint",
    reveal: "reveal",
    check: "check",
    transfer: "transfer",
    session: "session",
  });

const parseExplicitLevel = (prompt: string): HintLevel | undefined => {
  const match = /\blevel\s*([0-5])\b/u.exec(prompt);
  if (match === null) {
    return undefined;
  }
  return Number(match[1]) as HintLevel;
};

const naturalIntent = (prompt: string): GrowthIntent => {
  const text = prompt.toLowerCase();

  if (/\b(stay|be|keep)\s+quiet\b/u.test(text) || /\bquiet\s+mode\b/u.test(text)) {
    return "quiet";
  }
  if (
    /\bshow me (the )?(answer|solution)\b/u.test(text) ||
    /\breveal (the )?(answer|solution)\b/u.test(text) ||
    /\bjust tell me (the )?(answer|solution)\b/u.test(text)
  ) {
    return "reveal";
  }
  if (
    /\bi (think|believe|suspect)\b.*\bcause\b/u.test(text) ||
    /\bthe cause is\b/u.test(text) ||
    /\bmy hypothesis\b/u.test(text)
  ) {
    return "hypothesis";
  }
  if (
    /\bi (tried|attempted)\b/u.test(text) ||
    /\bmy attempt\b/u.test(text) ||
    /\bhere'?s what i (did|tried)\b/u.test(text)
  ) {
    return "attempt";
  }
  if (/\bjoin (me|in|here)\b/u.test(text) || /\bjoin my\b/u.test(text)) {
    return "join";
  }
  // Deterministic core-state routes are matched before the model-backed hint
  // route so an explicit request never falls through to generic guidance.
  if (/\b(on my own|independent(ly)?|transfer|variation)\b/u.test(text)) {
    return "transfer";
  }
  if (
    /\b(run|do) (the )?(check|verification|tests?)\b/u.test(text) ||
    /\bverify (my|the) (work|change|fix)\b/u.test(text)
  ) {
    return "check";
  }
  if (/\b(what mode|current mode|show (mode|status)|session status)\b/u.test(text)) {
    return "session";
  }
  if (
    /\bwhat (is|are) (my|the) (current )?(task|objective|goal|brief|work unit)\b/u.test(
      text,
    ) ||
    /\b(recap|brief) (me|the task|the work unit)\b/u.test(text)
  ) {
    return "brief";
  }
  if (/\b(hint|clue|nudge)\b/u.test(text) || /\bpoint me\b/u.test(text)) {
    return "hint";
  }

  return "chat";
};

export const interpretGrowthIntent = (
  request: vscode.ChatRequest,
): GrowthIntentResult => {
  const level = parseExplicitLevel(request.prompt ?? "");
  const commandIntent =
    typeof request.command === "string"
      ? GROWTH_COMMAND_INTENTS[request.command]
      : undefined;
  if (commandIntent !== undefined) {
    return { intent: commandIntent, level };
  }
  return { intent: naturalIntent(request.prompt ?? ""), level };
};
