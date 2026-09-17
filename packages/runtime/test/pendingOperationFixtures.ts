import type { Actor, PairCommand, PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { createRuntime } from "@adaptive-pair/session-core";
import { growthRuntime } from "@adaptive-pair/testkit";
import { PairCoordinator } from "../src/coordinator.js";
import { InMemoryJournal } from "../src/journal.js";
import type { EffectRequest, EffectResult, PairToolResult } from "../src/ports.js";

export type PendingTool = "pair_read_scope" | "pair_run_verification";
export type PresenceRoute = "dispatch" | "setPresence";
export type WorkspaceDestination = "workspace-B" | "workspace-A";
export type StopBoundary = "paused" | "off" | "pause-command";

type CommandAction = {
  [CommandType in PairCommand["type"]]: Omit<Extract<PairCommand, { type: CommandType }>,
    "protocolVersion" | "commandId" | "expectedRevision" | "actor" | "observedAt">;
}[PairCommand["type"]];

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Value>((fulfilled, rejected) => {
    resolve = fulfilled;
    reject = rejected;
  });
  return { promise, resolve, reject };
};

export interface PendingEffect {
  readonly request: EffectRequest;
  readonly signal: AbortSignal;
  readonly complete: (result: EffectResult) => void;
  readonly reject: (error: Error) => void;
}

export type EffectSettlement =
  | { readonly status: "fulfilled"; readonly value: PairToolResult | PairRuntimeSnapshot }
  | { readonly status: "rejected"; readonly error: unknown };

export class PendingOperationFixture {
  public readonly store = new InMemoryJournal("stream-1", createRuntime("placeholder"));
  public readonly calls: PendingEffect[] = [];
  public readonly coordinator: PairCoordinator;
  private sequence = 0;
  private readonly callGates = new Map<number, ReturnType<typeof deferred<PendingEffect>>>();
  private readonly settlements: Promise<EffectSettlement>[] = [];

  public constructor(private readonly reuseOperationId = true) {
    this.coordinator = new PairCoordinator({
      store: this.store,
      streamId: "stream-1",
      clock: { now: () => 1_000 + this.sequence },
      ids: { next: prefix => this.nextId(prefix) },
      effects: {
        execute: (request, signal) => {
          const result = deferred<EffectResult>();
          const call: PendingEffect = {
            request, signal, complete: result.resolve, reject: result.reject,
          };
          const index = this.calls.length;
          this.calls.push(call);
          this.callGates.get(index)?.resolve(call);
          return result.promise;
        },
      },
    });
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return prefix === "operation" && this.reuseOperationId
      ? "reused-operation" : `${prefix}-${this.sequence}`;
  }

  public dispatch(action: CommandAction, actor: Actor = "human"): Promise<PairRuntimeSnapshot> {
    return this.coordinator.dispatch({
      ...action,
      protocolVersion: 1,
      commandId: this.nextId("command"),
      expectedRevision: this.store.snapshotNow().revision,
      actor,
      observedAt: 2_000,
    });
  }

  public async initialize(): Promise<void> {
    await this.coordinator.setPresence("observing", "workspace-A");
    await this.startSession("src/original.ts");
    await this.coordinator.observeWorkspace();
  }

  public async startSession(path: string): Promise<void> {
    const template = growthRuntime().session;
    if (template?.entrySnapshot === undefined || template.learningAgreement === undefined ||
        template.workUnit === undefined) {
      throw new Error("INVALID_PENDING_TEMPLATE");
    }
    await this.dispatch({ type: "StartSession", sessionId: "reused-session" });
    await this.dispatch({
      type: "CaptureEntry",
      entry: { ...template.entrySnapshot, workspaceId: this.store.snapshotNow().presence.workspaceId,
        openPaths: [path] },
    });
    await this.dispatch({ type: "ConfirmLearning", agreement: template.learningAgreement });
    await this.dispatch({ type: "SelectMode", mode: "growth" });
    await this.dispatch({
      type: "ProposeWorkUnit",
      workUnit: { ...template.workUnit, id: "reused-unit", status: "proposed", allowedPaths: [path] },
    });
    await this.dispatch({ type: "AgreeWorkUnit", workUnitId: "reused-unit" });
  }

  public async bind(workspaceId: string, route: PresenceRoute): Promise<PairRuntimeSnapshot> {
    return route === "dispatch"
      ? this.dispatch({ type: "EnablePresence", workspaceId })
      : this.coordinator.setPresence("observing", workspaceId);
  }

  public async replace(route: PresenceRoute, destination: WorkspaceDestination): Promise<void> {
    await this.bind("workspace-B", route);
    if (destination === "workspace-A") await this.bind(destination, route);
    await this.startSession("src/replacement.ts");
  }

  public stop(boundary: StopBoundary): Promise<PairRuntimeSnapshot> {
    return boundary === "pause-command"
      ? this.dispatch({ type: "PauseSession", reason: "Stop replacement work." })
      : this.coordinator.setPresence(boundary);
  }

  public waitForCall(index: number): Promise<PendingEffect> {
    const existing = this.calls[index];
    if (existing !== undefined) return Promise.resolve(existing);
    const gate = this.callGates.get(index) ?? deferred<PendingEffect>();
    this.callGates.set(index, gate);
    return gate.promise;
  }

  public async begin(tool: PendingTool, recovery = false) {
    const index = this.calls.length;
    const signal = new AbortController().signal;
    const path = this.store.snapshotNow().session?.workUnit?.allowedPaths[0] ?? "missing";
    let invocation: Promise<PairToolResult | PairRuntimeSnapshot>;
    if (recovery) {
      await this.dispatch({
        type: "AuthorizeOperation", operationId: this.nextId("operation"),
        toolName: "pair_read_scope", kind: "read", input: { path },
      }, "ai");
      invocation = this.coordinator.reconcile();
    } else {
      const userActionId = tool === "pair_run_verification"
        ? await this.coordinator.grantUserAction(tool, signal) : undefined;
      invocation = this.coordinator.invokeTool(
        tool, tool === "pair_read_scope" ? { path } : { plan: "npm test" }, signal,
        userActionId === undefined ? {} : { userActionId },
      );
    }
    const settled: Promise<EffectSettlement> = invocation.then(
      value => ({ status: "fulfilled", value }),
      (error: unknown) => ({ status: "rejected", error }),
    );
    this.settlements.push(settled);
    const call = await Promise.race([
      this.waitForCall(index),
      settled.then(outcome => { throw new Error("EFFECT_NOT_DISPATCHED", { cause: outcome }); }),
    ]);
    return { call, settled };
  }

  public finish(call: PendingEffect, reject = false): void {
    if (reject) {
      call.reject(new Error("OLD_EFFECT_FAILED"));
      return;
    }
    call.complete({
      operationId: call.request.operationId,
      status: "confirmed",
      summary: `Observed ${call.request.workspaceId}:${call.request.allowedPaths.join(",")}`,
      observation: { workspaceId: call.request.workspaceId, paths: call.request.allowedPaths },
      sensitiveData: false,
      partial: false,
    });
  }

  public async finishAll(): Promise<void> {
    for (const call of this.calls) this.finish(call);
    await Promise.all(this.settlements);
  }
}

export const replacementScenarios = [
  { tool: "pair_read_scope", route: "setPresence", destination: "workspace-B" },
  { tool: "pair_run_verification", route: "dispatch", destination: "workspace-B" },
  { tool: "pair_read_scope", route: "dispatch", destination: "workspace-A" },
  { tool: "pair_run_verification", route: "setPresence", destination: "workspace-A" },
] as const;

export const beginReplacement = async (
  scenario: { readonly tool: PendingTool; readonly route: PresenceRoute; readonly destination: WorkspaceDestination },
  reuseOperationId = true,
  recovery = false,
) => {
  const fixture = new PendingOperationFixture(reuseOperationId);
  await fixture.initialize();
  const previous = await fixture.begin(scenario.tool, recovery);
  const previousSnapshot = fixture.store.snapshotNow();
  await fixture.replace(scenario.route, scenario.destination);
  const replacement = await fixture.begin(scenario.tool);
  return { fixture, previous, replacement, previousSnapshot };
};
