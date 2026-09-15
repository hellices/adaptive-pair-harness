import type * as vscode from "vscode";
import type {
  HintLevel,
  PairRuntimeSnapshot,
  PairSessionSnapshot,
} from "@adaptive-pair/protocol";
import type { PairCoordinatorPort, PairToolResult } from "@adaptive-pair/runtime";
import {
  maximumHintLevelForSnapshot,
  type PairToolName,
} from "@adaptive-pair/harness";
import { guardGrowthResponse, type GrowthResponse } from "@adaptive-pair/restraint";
import {
  createGrowthModel,
  GrowthModelFailure,
  type GrowthModel,
  isGrowthModelResult,
} from "./modelAdapter.js";
import { parseVerificationScript } from "./verificationPlan.js";

export const WITHHELD_RESPONSE_MESSAGE = [
  "Adaptive Pair withheld this response because it exceeded the current Growth",
  "hint boundary. Your work was not changed. Ask for the same hint level again,",
  "request a smaller clue, or explicitly reveal the solution.",
].join("\n");

const STALE_TURN_MESSAGE =
  "Adaptive Pair discarded this response because the session mode or authority changed while it was generating. Your work was not changed. Ask again for a fresh, in-boundary response.";

const RESTRAINT_FAILURE_MESSAGE =
  "Adaptive Pair could not produce an in-boundary response, so nothing was shown. Your work was not changed. Try again or ask for a smaller clue.";

const ATTEMPT_REQUIRED_MESSAGE =
  "Make an attempt first. Growth Mode needs a recorded attempt before it will raise the hint level to 2 or higher. Share what you tried, then ask for the hint again.";

const REVEAL_REQUIRED_MESSAGE =
  "A full solution needs an explicit reveal. Use /reveal (or ask to see the answer) so Adaptive Pair can record your authorization before showing a level-5 solution.";

const CONSENT_DECLINED_MESSAGE =
  "Adaptive Pair kept your workspace private. Grant workspace consent for this model to receive grounded, in-boundary hints about your task.";

const NO_SESSION_MESSAGE =
  "No Adaptive Pair session is active. Run \"Adaptive Pair: Start a Session\" or \"Adaptive Pair: Join Work in Progress\" first; nothing is observed until you do.";

const NO_WORK_UNIT_MESSAGE =
  "No Growth work unit is agreed yet. Confirm the learning agreement and agree a work unit before asking for this.";

const TRANSFER_NOT_DISTINCT_MESSAGE = [
  "Adaptive Pair withheld this transfer task because it restated your current",
  "work unit instead of a distinct independent variation. Your work was not",
  "changed. Ask again for a different variation.",
].join("\n");

const TRANSFER_NOT_DEMONSTRATED_NOTE = [
  "Starting a transfer task demonstrates nothing on its own. This variation is",
  "recorded as **started, not demonstrated**; it counts only after you complete",
  "it independently and the result is observed.",
].join("\n");

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

export type GrowthEvaluationOutcome =
  | "delivered"
  | "withheld"
  | "restraint-failure"
  | "transfer-started";

/**
 * A bounded, non-raw record of one Growth turn. It carries only the response
 * class, hint level, and a stable reason code; no prompt, repository, or model
 * text is ever retained here.
 */
export interface GrowthEvaluationRecord {
  readonly outcome: GrowthEvaluationOutcome;
  readonly level: HintLevel | undefined;
  readonly kind: GrowthResponse["kind"] | undefined;
  readonly reason: string | undefined;
  readonly recordedAt: number;
}

/**
 * The state of the independent transfer task for the current work unit. A
 * started transfer is never a demonstrated one: `demonstrated` stays `false`
 * until an independent completion is separately observed and recorded.
 */
export interface GrowthTransferState {
  readonly status: "started";
  readonly workUnitId: string;
  readonly independentCheck: string;
  readonly demonstrated: false;
  readonly startedAt: number;
}

/** The last observed product check, recorded only from a real run result. */
export interface GrowthCheckState {
  readonly script: string;
  readonly status: PairToolResult["status"];
  readonly passed: boolean | undefined;
  readonly observedAt: number;
}

export interface GrowthEvaluationInput {
  readonly outcome: GrowthEvaluationOutcome;
  readonly level?: HintLevel;
  readonly kind?: GrowthResponse["kind"];
  readonly reason?: string;
}

export class GrowthEvaluationLog {
  private readonly entries: GrowthEvaluationRecord[] = [];

  public constructor(private readonly now: () => number = () => Date.now()) {}

  public record(input: GrowthEvaluationInput): void {
    this.entries.push(
      Object.freeze({
        outcome: input.outcome,
        level: input.level,
        kind: input.kind,
        reason: input.reason,
        recordedAt: this.now(),
      }),
    );
  }

  public get records(): readonly GrowthEvaluationRecord[] {
    return Object.freeze([...this.entries]);
  }
}

export const modelConsentKey = (model: vscode.LanguageModelChat): string =>
  `${model.vendor}::${model.family}::${model.id}::${model.version}`;

export class ModelConsentRegistry {
  private readonly granted = new Set<string>();

  public has(model: vscode.LanguageModelChat): boolean {
    return this.granted.has(modelConsentKey(model));
  }

  public grant(model: vscode.LanguageModelChat): void {
    this.granted.add(modelConsentKey(model));
  }

  public revoke(model: vscode.LanguageModelChat): void {
    this.granted.delete(modelConsentKey(model));
  }
}

export type GrowthConsentResult =
  | { readonly status: "granted"; readonly taskContext: string | undefined }
  | { readonly status: "declined" };

export interface GrowthParticipantDependencies {
  readonly coordinator: PairCoordinatorPort;
  readonly consent: ModelConsentRegistry;
  readonly evaluations: GrowthEvaluationLog;
  readonly createModel?: (model: vscode.LanguageModelChat) => GrowthModel;
  readonly requestWorkspaceConsent: (
    model: vscode.LanguageModelChat,
  ) => Promise<boolean>;
  readonly confirmSolutionReveal: (
    model: vscode.LanguageModelChat,
  ) => Promise<boolean>;
  readonly stayQuiet?: () => Promise<unknown>;
  readonly now?: () => number;
}

const MAX_CONTEXT_CHARS = 6_000;
const MAX_RECORD_SUMMARY = 500;
const MAX_FIELD_CHARS = 300;
const MAX_LIST_ITEMS = 5;
const MAX_CHECK_SUMMARY = 800;

/** Bound a developer-authored core-state field before echoing it back. */
const bounded = (
  value: string | undefined,
  limit: number = MAX_FIELD_CHARS,
): string | undefined => {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
};

const boundedList = (values: readonly string[] | undefined): string => {
  const items = (values ?? [])
    .map(value => bounded(value))
    .filter((value): value is string => value !== undefined)
    .slice(0, MAX_LIST_ITEMS);
  return items.length === 0 ? "none" : items.join(", ");
};

const normalizeForComparison = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();

/**
 * A transfer variation must be a genuinely different exercise, so a response
 * that merely restates the agreed objective is rejected rather than delivered.
 */
export const isDistinctVariation = (text: string, objective: string): boolean => {
  const target = normalizeForComparison(objective);
  if (target.length === 0) {
    return true;
  }
  return !normalizeForComparison(text).includes(target);
};

/**
 * The deterministic, trusted request used for a transfer turn. It names the
 * current objective only so the model can avoid repeating it.
 */
const transferRequest = (
  session: PairSessionSnapshot,
  objective: string,
  independentCheck: string,
): string =>
  [
    "Propose one independent transfer task for the developer to attempt alone.",
    `It must be distinct from the current work-unit objective: "${
      bounded(objective) ?? ""
    }".`,
    `Keep it within the same capability (${
      session.workUnit?.capability ?? "implementation"
    }) and aligned with the agreed independent check: "${
      bounded(independentCheck) ?? ""
    }".`,
    "State the variation and its success condition only. Do not include a solution, patch, or implementation of either task.",
  ].join(" ");

const stem = (path: string): string | undefined => {
  const base = path.split(/[\\/]/u).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const name = dot > 0 ? base.slice(0, dot) : base;
  return name.length > 1 ? name : undefined;
};

const deriveTargetIdentifiers = (
  snapshot: PairRuntimeSnapshot,
): readonly string[] => {
  const identifiers = new Set<string>();
  const workUnit = snapshot.session?.workUnit;
  if (workUnit !== undefined) {
    for (const path of workUnit.allowedPaths) {
      const value = stem(path);
      if (value !== undefined) {
        identifiers.add(value);
      }
    }
    for (const key of Object.keys(workUnit.baseline)) {
      const value = stem(key);
      if (value !== undefined) {
        identifiers.add(value);
      }
    }
  }
  return [...identifiers];
};

const abortSignalFromToken = (token: vscode.CancellationToken): AbortSignal => {
  const controller = new AbortController();
  if (token.isCancellationRequested) {
    controller.abort();
  } else {
    token.onCancellationRequested(() => controller.abort());
  }
  return controller.signal;
};

const failureReason = (error: unknown): string => {
  if (error instanceof GrowthModelFailure) {
    return error.code;
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "GROWTH_UNKNOWN_ERROR";
};

export class GrowthParticipant {
  private transfer: GrowthTransferState | undefined;
  private lastCheck: GrowthCheckState | undefined;

  public constructor(private readonly deps: GrowthParticipantDependencies) {}

  /** The current independent transfer state, or `undefined` when none started. */
  public transferStatus(): GrowthTransferState | undefined {
    return this.transfer;
  }

  public handler(): vscode.ChatRequestHandler {
    return (request, context, response, token) =>
      this.handle(request, context, response, token);
  }

  public async handle(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    response: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const signal = abortSignalFromToken(token);
    const model = request.model;
    const { intent, level } = interpretGrowthIntent(request);

    try {
      switch (intent) {
        case "quiet":
          await this.handleQuiet(response);
          return;
        case "attempt":
          await this.handleRecord(request, response, signal, "attempt");
          return;
        case "hypothesis":
          await this.handleRecord(request, response, signal, "hypothesis");
          return;
        case "join":
          this.handleJoin(response);
          return;
        case "brief":
          await this.handleBrief(response);
          return;
        case "session":
          await this.handleSession(response);
          return;
        case "check":
          await this.handleCheck(response, signal);
          return;
        case "transfer":
          await this.handleTransfer(request, context, model, response, signal);
          return;
        case "reveal":
          await this.handleReveal(request, context, model, response, signal);
          return;
        case "hint":
          await this.handleGuidance(request, context, model, response, signal, {
            escalate: true,
            level,
          });
          return;
        default:
          await this.handleGuidance(request, context, model, response, signal, {
            escalate: false,
            level: undefined,
          });
          return;
      }
    } catch (error) {
      this.deps.evaluations.record({
        outcome: "restraint-failure",
        reason: failureReason(error),
      });
      response.markdown(RESTRAINT_FAILURE_MESSAGE);
    }
  }

  /**
   * Report the agreed brief from current core state. This route is entirely
   * deterministic: it reads the runtime snapshot and never compiles a turn or
   * dispatches a language-model request.
   */
  private async handleBrief(response: vscode.ChatResponseStream): Promise<void> {
    const snapshot = await this.deps.coordinator.snapshot();
    const session = snapshot.session;
    if (session === undefined || session.status === "inactive") {
      response.markdown(NO_SESSION_MESSAGE);
      return;
    }

    const lines: string[] = [
      "**Adaptive Pair brief — current agreed state**",
      `- Presence: ${snapshot.presence.status}`,
      `- Session: ${session.status}${
        session.mode === undefined ? "" : ` (mode: ${session.mode})`
      }`,
      `- Goal: ${bounded(session.goal) ?? "not confirmed yet"}`,
      `- Acceptance criteria: ${boundedList(session.criteria)}`,
    ];

    const workUnit = session.workUnit;
    if (workUnit === undefined) {
      lines.push("- Work unit: none agreed yet");
    } else {
      lines.push(
        `- Work unit: ${bounded(workUnit.objective) ?? "(none)"} (${workUnit.status})`,
        `- Owner: ${workUnit.owner === "human" ? "you" : "the assistant"}`,
        `- Scope: ${boundedList(workUnit.allowedPaths)}`,
        `- Verification plan: ${bounded(workUnit.verificationPlan) ?? "not agreed"}`,
        `- Stopping condition: ${bounded(workUnit.stoppingCondition) ?? "not agreed"}`,
      );
    }

    const agreement = session.learningAgreement;
    if (agreement !== undefined) {
      lines.push(
        `- Hint ceiling: level ${agreement.maximumHintLevel}`,
        `- Learning goals: ${boundedList(agreement.learningGoals)}`,
        `- Independent check: ${bounded(agreement.independentCheck) ?? "not agreed"}`,
      );
    }

    response.markdown(lines.join("\n"));
  }

  /**
   * Report mode, work unit, assistance, and the five Growth outcome fields.
   * Product verification is reported separately from Growth, and no outcome is
   * ever inferred from a delivered hint.
   */
  private async handleSession(response: vscode.ChatResponseStream): Promise<void> {
    const snapshot = await this.deps.coordinator.snapshot();
    const session = snapshot.session;
    if (session === undefined || session.status === "inactive") {
      response.markdown(NO_SESSION_MESSAGE);
      return;
    }

    const assistance = session.assistance;
    const ceiling = session.learningAgreement?.maximumHintLevel ?? 0;
    const lines: string[] = [
      "**Adaptive Pair session state**",
      `- Mode: ${session.mode ?? "not selected"}`,
      `- Work unit: ${bounded(session.workUnit?.objective) ?? "none agreed"}${
        session.workUnit === undefined ? "" : ` (${session.workUnit.status})`
      }`,
      `- Owner: ${session.workUnit?.owner === "ai" ? "the assistant" : "you"}`,
      `- Hint level: ${assistance?.hint?.level ?? 0} of ceiling ${ceiling}`,
      `- Attempt recorded: ${assistance?.attempt === undefined ? "no" : "yes"}`,
      `- Hypothesis recorded: ${assistance?.hypothesis === undefined ? "no" : "yes"}`,
      `- Solution reveal authorized: ${
        assistance?.solutionReveal === undefined ? "no" : "yes"
      }`,
      `- Transfer: ${this.transferSummary()}`,
      "",
      "**Outcomes — reported independently**",
      `- Product verification: ${this.productSummary()}`,
      "- Similar generation: not assessed",
      "- Varied debugging: not assessed",
      "- Explanation: not assessed",
      "- Meaningful authorship: not assessed",
      "- Next-assistance proposal: not assessed",
      "",
      "Product verification is separate from Growth: a passing check never marks a Growth outcome, and each Growth field needs its own recorded demonstration.",
    ];

    response.markdown(lines.join("\n"));
  }

  private transferSummary(): string {
    if (this.transfer === undefined) {
      return "not started";
    }
    return `started — not demonstrated (independent check: ${
      bounded(this.transfer.independentCheck) ?? "agreed variation"
    })`;
  }

  private productSummary(): string {
    if (this.lastCheck === undefined) {
      return "no check observed in this session";
    }
    if (this.lastCheck.status !== "confirmed" || this.lastCheck.passed === undefined) {
      return `last check \`${this.lastCheck.script}\` was not observed (${this.lastCheck.status})`;
    }
    return `last check \`${this.lastCheck.script}\` ${
      this.lastCheck.passed ? "passed" : "failed"
    }`;
  }

  /**
   * Run the agreed verification plan through the real coordinator and effect
   * port. The run needs an explicit user-action grant here, and the effect port
   * still asks its own separate confirmation before any process starts.
   */
  private async handleCheck(
    response: vscode.ChatResponseStream,
    signal: AbortSignal,
  ): Promise<void> {
    const snapshot = await this.deps.coordinator.snapshot();
    const workUnit = snapshot.session?.workUnit;
    if (workUnit === undefined) {
      response.markdown(NO_WORK_UNIT_MESSAGE);
      return;
    }

    const script = parseVerificationScript(workUnit.verificationPlan);
    if (script === undefined) {
      response.markdown(
        [
          `The agreed verification plan is \`${
            bounded(workUnit.verificationPlan) ?? "(empty)"
          }\`, which names no allowlisted package script.`,
          "Adaptive Pair only runs an existing root package script (test, check, lint, typecheck, or build).",
          "Agree a plan such as `npm test`, then ask again.",
        ].join("\n"),
      );
      return;
    }

    const grantId = await this.deps.coordinator.grantUserAction(
      "pair_run_verification",
      signal,
    );
    const result = await this.deps.coordinator.invokeTool(
      "pair_run_verification",
      { script, targetPaths: [...workUnit.allowedPaths] },
      signal,
      { userActionId: grantId },
    );

    const passed = result.observation["passed"];
    this.lastCheck = Object.freeze({
      script,
      status: result.status,
      passed: typeof passed === "boolean" ? passed : undefined,
      observedAt: this.now(),
    });

    const outcome =
      result.status !== "confirmed"
        ? `not observed (${result.status})`
        : passed === true
          ? "**passed**"
          : passed === false
            ? "**failed**"
            : "not observed (the runner reported no result)";

    response.markdown(
      [
        `Ran the agreed check \`${script}\` on ${boundedList(workUnit.allowedPaths)}.`,
        `Product result: ${outcome}.`,
        bounded(result.summary, MAX_CHECK_SUMMARY) ?? "",
        "This is a product result only; it demonstrates no Growth outcome.",
      ]
        .filter(line => line.length > 0)
        .join("\n"),
    );
  }

  /**
   * Start an independent transfer task: a bounded variation that must be
   * distinct from the current work-unit objective. Starting one records a
   * non-raw `transfer-started` evaluation and never claims a demonstration.
   */
  private async handleTransfer(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    model: vscode.LanguageModelChat,
    response: vscode.ChatResponseStream,
    signal: AbortSignal,
  ): Promise<void> {
    const snapshot = await this.deps.coordinator.snapshot();
    const session = snapshot.session;
    const workUnit = session?.workUnit;
    if (session === undefined || workUnit === undefined || session.mode !== "growth") {
      response.markdown(NO_WORK_UNIT_MESSAGE);
      return;
    }

    const consent = await this.gatherConsentedContext(
      model,
      request,
      context,
      response,
    );
    if (consent.status === "declined") {
      return;
    }

    const independentCheck =
      session.learningAgreement?.independentCheck ?? "an independent variation";
    const accepted = await this.runGuardedTurn(
      model,
      request,
      consent.taskContext,
      response,
      signal,
      {
        userRequest: transferRequest(session, workUnit.objective, independentCheck),
        acceptedOutcome: "transfer-started",
        validate: result =>
          isDistinctVariation(result.text, workUnit.objective)
            ? undefined
            : "TRANSFER_NOT_DISTINCT",
        withheldMessage: TRANSFER_NOT_DISTINCT_MESSAGE,
      },
    );

    if (accepted === undefined) {
      return;
    }

    this.transfer = Object.freeze({
      status: "started" as const,
      workUnitId: workUnit.id,
      independentCheck,
      demonstrated: false as const,
      startedAt: this.now(),
    });
    response.markdown(TRANSFER_NOT_DEMONSTRATED_NOTE);
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private async handleQuiet(
    response: vscode.ChatResponseStream,
  ): Promise<void> {
    if (this.deps.stayQuiet !== undefined) {
      await this.deps.stayQuiet();
    }
    response.markdown(
      "Staying quiet. Pair Presence remains on and your task continues; ask again whenever you want a hint.",
    );
  }

  private handleJoin(response: vscode.ChatResponseStream): void {
    response.markdown(
      "Run \"Adaptive Pair: Join Work in Progress\" to capture a bounded local entry snapshot. Capturing context never grants edit authority.",
    );
  }

  private async handleRecord(
    request: vscode.ChatRequest,
    response: vscode.ChatResponseStream,
    signal: AbortSignal,
    kind: "attempt" | "hypothesis",
  ): Promise<void> {
    const snapshot = await this.deps.coordinator.snapshot();
    const workUnitId = snapshot.session?.workUnit?.id;
    if (workUnitId === undefined) {
      response.markdown(
        "Start a Growth work unit before recording your attempt or hypothesis.",
      );
      return;
    }

    const name: PairToolName =
      kind === "attempt" ? "pair_record_attempt" : "pair_record_hypothesis";
    await this.invokeWithUserAction(
      name,
      {
        workUnitId,
        summary: (request.prompt ?? "").slice(0, MAX_RECORD_SUMMARY),
        bypassed: false,
      },
      signal,
    );

    response.markdown(
      kind === "attempt"
        ? "Recorded your attempt. You can now request a higher hint level."
        : "Recorded your hypothesis. Diagnosis stays yours; ask for a hint whenever you are ready.",
    );
  }

  private async handleReveal(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    model: vscode.LanguageModelChat,
    response: vscode.ChatResponseStream,
    signal: AbortSignal,
  ): Promise<void> {
    const confirmed = await this.deps.confirmSolutionReveal(model);
    if (!confirmed) {
      response.markdown(
        "Solution reveal cancelled. Your work was not changed; keep going or ask for a smaller clue.",
      );
      return;
    }

    // Gate workspace consent before any reveal/hint state transition so a
    // decline leaves assistance state untouched and never dispatches the model.
    const consent = await this.gatherConsentedContext(
      model,
      request,
      context,
      response,
    );
    if (consent.status === "declined") {
      return;
    }

    const snapshot = await this.deps.coordinator.snapshot();
    const workUnitId = snapshot.session?.workUnit?.id;
    if (workUnitId === undefined) {
      response.markdown("Start a Growth work unit before revealing a solution.");
      return;
    }

    await this.invokeWithUserAction(
      "pair_reveal_solution",
      { workUnitId },
      signal,
    );
    await this.invokeWithUserAction(
      "pair_request_hint",
      { workUnitId, level: 5 },
      signal,
    );

    await this.runGuardedTurn(model, request, consent.taskContext, response, signal);
  }

  private async handleGuidance(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    model: vscode.LanguageModelChat,
    response: vscode.ChatResponseStream,
    signal: AbortSignal,
    options: { readonly escalate: boolean; readonly level: HintLevel | undefined },
  ): Promise<void> {
    const consent = await this.gatherConsentedContext(
      model,
      request,
      context,
      response,
    );
    if (consent.status === "declined") {
      return;
    }

    if (options.escalate) {
      const escalated = await this.escalateHint(options.level, response, signal);
      if (!escalated) {
        return;
      }
    }

    await this.runGuardedTurn(model, request, consent.taskContext, response, signal);
  }

  private async escalateHint(
    explicitLevel: HintLevel | undefined,
    response: vscode.ChatResponseStream,
    signal: AbortSignal,
  ): Promise<boolean> {
    const snapshot = await this.deps.coordinator.snapshot();
    const workUnitId = snapshot.session?.workUnit?.id;
    if (workUnitId === undefined) {
      response.markdown("Start a Growth work unit before requesting a hint.");
      return false;
    }

    const current = snapshot.session?.assistance?.hint?.level ?? 0;
    const requested =
      explicitLevel ?? (Math.min(current + 1, 5) as HintLevel);

    try {
      await this.invokeWithUserAction(
        "pair_request_hint",
        { workUnitId, level: requested },
        signal,
      );
      return true;
    } catch (error) {
      const reason = failureReason(error);
      if (reason === "HINT_REQUIRES_ATTEMPT") {
        response.markdown(ATTEMPT_REQUIRED_MESSAGE);
        return false;
      }
      if (reason === "HINT_REQUIRES_REVEAL") {
        response.markdown(REVEAL_REQUIRED_MESSAGE);
        return false;
      }
      throw error;
    }
  }

  private async runGuardedTurn(
    model: vscode.LanguageModelChat,
    request: vscode.ChatRequest,
    taskContext: string | undefined,
    response: vscode.ChatResponseStream,
    signal: AbortSignal,
    options: {
      /** Replaces the developer prompt as the trusted user-request layer. */
      readonly userRequest?: string;
      readonly acceptedOutcome?: GrowthEvaluationOutcome;
      /** Returns a stable reason code to withhold an otherwise valid response. */
      readonly validate?: (result: GrowthResponse) => string | undefined;
      readonly withheldMessage?: string;
    } = {},
  ): Promise<GrowthResponse | undefined> {
    const before = await this.deps.coordinator.snapshot();
    const prompt = options.userRequest ?? request.prompt ?? "";
    const prepared = await this.deps.coordinator.prepareTurn({
      ...(prompt.length > 0 ? { userRequest: prompt } : {}),
      ...(taskContext === undefined ? {} : { repositoryContext: taskContext }),
    });

    if (
      prepared.instructions.runtimeRevision !== prepared.tools.runtimeRevision ||
      prepared.instructions.authorityEpoch !== prepared.tools.authorityEpoch ||
      prepared.instructions.runtimeRevision !== before.revision
    ) {
      this.rejectStale(response);
      return undefined;
    }

    const growthModel = (this.deps.createModel ??
      (candidate => createGrowthModel(candidate, this.deps.coordinator)))(model);

    let result: GrowthResponse;
    let expectedRuntime = {
      runtimeRevision: before.revision,
      authorityEpoch: before.session?.authorityEpoch,
      mode: before.session?.mode,
    };
    try {
      const output = await growthModel.request(
        prepared.instructions,
        prepared.tools,
        signal,
      );
      if (isGrowthModelResult(output)) {
        result = output.response;
        expectedRuntime = output.runtime;
      } else {
        result = output;
      }
    } catch (error) {
      if (
        error instanceof GrowthModelFailure &&
        error.code === "GROWTH_STALE_TURN"
      ) {
        this.rejectStale(response);
        return undefined;
      }
      this.deps.evaluations.record({
        outcome: "restraint-failure",
        reason: failureReason(error),
      });
      response.markdown(RESTRAINT_FAILURE_MESSAGE);
      return undefined;
    }

    const after = await this.deps.coordinator.snapshot();
    if (
      after.revision !== expectedRuntime.runtimeRevision ||
      after.session?.authorityEpoch !== expectedRuntime.authorityEpoch ||
      after.session?.mode !== expectedRuntime.mode
    ) {
      this.rejectStale(response);
      return undefined;
    }

    const guard = guardGrowthResponse(result, {
      authorizedHintLevel: maximumHintLevelForSnapshot(after),
      revealAuthorized: after.session?.assistance?.solutionReveal !== undefined,
      targetIdentifiers: deriveTargetIdentifiers(after),
    });

    if (!guard.accepted) {
      this.deps.evaluations.record({
        outcome: "withheld",
        level: result.level,
        kind: result.kind,
        reason: guard.reason,
      });
      response.markdown(WITHHELD_RESPONSE_MESSAGE);
      return undefined;
    }

    const rejection = options.validate?.(guard.response);
    if (rejection !== undefined) {
      this.deps.evaluations.record({
        outcome: "withheld",
        level: guard.response.level,
        kind: guard.response.kind,
        reason: rejection,
      });
      response.markdown(options.withheldMessage ?? WITHHELD_RESPONSE_MESSAGE);
      return undefined;
    }

    this.deps.evaluations.record({
      outcome: options.acceptedOutcome ?? "delivered",
      level: guard.response.level,
      kind: guard.response.kind,
    });
    response.markdown(guard.response.text);
    return guard.response;
  }

  private rejectStale(response: vscode.ChatResponseStream): void {
    this.deps.evaluations.record({
      outcome: "restraint-failure",
      reason: "STALE_TURN",
    });
    response.markdown(STALE_TURN_MESSAGE);
  }

  private gatherConsentedContext(
    model: vscode.LanguageModelChat,
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    response: vscode.ChatResponseStream,
  ): Promise<GrowthConsentResult> {
    return this.resolveConsent(model, request, context, response);
  }

  private async resolveConsent(
    model: vscode.LanguageModelChat,
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    response: vscode.ChatResponseStream,
  ): Promise<GrowthConsentResult> {
    if (this.deps.consent.has(model)) {
      return { status: "granted", taskContext: this.gatherTaskContext(request, context) };
    }

    const granted = await this.deps.requestWorkspaceConsent(model);
    if (granted) {
      this.deps.consent.grant(model);
      return { status: "granted", taskContext: this.gatherTaskContext(request, context) };
    }

    // Decline short-circuits the whole turn: no compiled trusted work-unit
    // layer, no model dispatch, and no assistance state transition. The neutral
    // message is the only side effect.
    response.markdown(CONSENT_DECLINED_MESSAGE);
    return { status: "declined" };
  }

  private gatherTaskContext(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
  ): string | undefined {
    const excerpts: string[] = [];
    for (const turn of context.history ?? []) {
      const prompt = (turn as { readonly prompt?: unknown }).prompt;
      if (typeof prompt === "string" && prompt.length > 0) {
        excerpts.push(prompt);
      }
    }

    for (const reference of request.references ?? []) {
      const value = (reference as { readonly value?: unknown }).value;
      if (typeof value === "string" && value.length > 0) {
        excerpts.push(value);
      }
    }

    if (excerpts.length === 0) {
      return undefined;
    }
    return excerpts.join("\n").slice(0, MAX_CONTEXT_CHARS);
  }

  private async invokeWithUserAction(
    name: PairToolName,
    input: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<void> {
    const grantId = await this.deps.coordinator.grantUserAction(name, signal);
    await this.deps.coordinator.invokeTool(name, input, signal, {
      userActionId: grantId,
    });
  }
}
