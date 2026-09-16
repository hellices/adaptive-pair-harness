import type * as vscode from "vscode";
import type { PairToolName } from "@adaptive-pair/harness";
import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { isGrowthWorkUnitCurrent, type GrowthParticipantDependencies, type GrowthTransientState } from "./growthHostState.js";
import { bounded, boundedList, NO_SESSION_MESSAGE, NO_WORK_UNIT_MESSAGE, STALE_TURN_MESSAGE } from "./growthPresentation.js";
import { invokeGrowthUserAction } from "./growthUserActions.js";
import { parseVerificationScript } from "./verificationPlan.js";

const MAX_RECORD_SUMMARY = 500;

const MAX_CHECK_SUMMARY = 800;

export class GrowthLocalRoutes {
  public constructor(
    private readonly deps: GrowthParticipantDependencies,
    private readonly state: GrowthTransientState,
  ) {}

  /**
   * Report the agreed brief from current core state. This route is entirely
   * deterministic: it reads the runtime snapshot and never compiles a turn or
   * dispatches a language-model request.
   */
  public async handleBrief(response: vscode.ChatResponseStream): Promise<void> {
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
  public async handleSession(response: vscode.ChatResponseStream): Promise<void> {
    await this.deps.coordinator.snapshot();
    const snapshot = this.deps.snapshotNow();
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
      `- Transfer: ${this.transferSummary(snapshot)}`,
      "",
      "**Outcomes — reported independently**",
      `- Product verification: ${this.productSummary(snapshot)}`,
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

  private transferSummary(
    snapshot: PairRuntimeSnapshot,
  ): string {
    if (
      this.state.transfer === undefined ||
      !isGrowthWorkUnitCurrent(this.state.transfer, snapshot)
    ) {
      return "not started";
    }
    return `started — not demonstrated (independent check: ${
      bounded(this.state.transfer.independentCheck) ?? "agreed variation"
    })`;
  }

  private productSummary(
    snapshot: PairRuntimeSnapshot,
  ): string {
    if (
      this.state.lastCheck === undefined ||
      !isGrowthWorkUnitCurrent(this.state.lastCheck, snapshot)
    ) {
      return "no check observed in this session";
    }
    if (this.state.lastCheck.status !== "confirmed" || this.state.lastCheck.passed === undefined) {
      return `last check \`${this.state.lastCheck.script}\` was not observed (${this.state.lastCheck.status})`;
    }
    return `last check \`${this.state.lastCheck.script}\` ${
      this.state.lastCheck.passed ? "passed" : "failed"
    }`;
  }

  /**
   * Run the agreed verification plan through the real coordinator and effect
   * port. The run needs an explicit user-action grant here, and the effect port
   * still asks its own separate confirmation before any process starts.
   */
  public async handleCheck(
    response: vscode.ChatResponseStream,
    signal: AbortSignal,
  ): Promise<void> {
    const snapshot = await this.deps.coordinator.snapshot();
    const session = snapshot.session;
    const workUnit = session?.workUnit;
    if (session === undefined || workUnit === undefined) {
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
      { runtimeRevision: snapshot.revision, authorityEpoch: session.authorityEpoch },
    );
    const result = await this.deps.coordinator.invokeTool(
      "pair_run_verification",
      { script, targetPaths: [...workUnit.allowedPaths] },
      signal,
      { userActionId: grantId },
    );

    const passed = result.observation["passed"];
    const check = Object.freeze({
      workspaceId: snapshot.presence.workspaceId,
      sessionId: session.sessionId,
      startedAtRevision: session.startedAtRevision,
      workUnitId: workUnit.id,
      script,
      status: result.status,
      passed: typeof passed === "boolean" ? passed : undefined,
      observedAt: (this.deps.now ?? Date.now)(),
    });
    if (signal.aborted) {
      return;
    }
    const current = this.deps.snapshotNow();
    if (
      !isGrowthWorkUnitCurrent(check, current) ||
      current.revision !== result.runtimeRevision ||
      current.session?.authorityEpoch !== result.authorityEpoch ||
      result.observation["stale"] === true
    ) {
      response.markdown(STALE_TURN_MESSAGE);
      return;
    }
    this.state.lastCheck = check;

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

  public async handleQuiet(
    response: vscode.ChatResponseStream,
  ): Promise<void> {
    if (this.deps.stayQuiet !== undefined) {
      await this.deps.stayQuiet();
    }
    response.markdown(
      "Staying quiet. Pair Presence remains on and your task continues; ask again whenever you want a hint.",
    );
  }

  public handleJoin(response: vscode.ChatResponseStream): void {
    response.markdown(
      "Run \"Adaptive Pair: Join Work in Progress\" to capture a bounded local entry snapshot. Capturing context never grants edit authority.",
    );
  }

  public async handleRecord(
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
    await invokeGrowthUserAction(
      this.deps.coordinator,
      name,
      {
        workUnitId,
        summary: (request.prompt ?? "").slice(0, MAX_RECORD_SUMMARY),
        bypassed: false,
      },
      signal,
      { runtimeRevision: snapshot.revision, authorityEpoch: snapshot.session?.authorityEpoch },
    );

    response.markdown(
      kind === "attempt"
        ? "Recorded your attempt. You can now request a higher hint level."
        : "Recorded your hypothesis. Diagnosis stays yours; ask for a hint whenever you are ready.",
    );
  }
}
