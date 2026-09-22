import type * as vscode from "vscode";
import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import type { GrowthParticipantDependencies } from "./growthHostState.js";
import type { GrowthSetupOutcome } from "./growthSetup.js";
import { createNativeCheckpoint, inspectNativeHistory, renderNativeHistory } from "./nativeCheckpoint.js";

const SETUP_MESSAGES: Readonly<Record<GrowthSetupOutcome, string>> = {
  completed: "Growth setup is complete. Use /brief to inspect the agreement, make an attempt, then use /attempt, /hint, and /check. You own every edit.",
  cancelled: "Growth setup was cancelled. No work unit was agreed by this request. Any earlier confirmations remain visible in /brief; run /setup again to finish briefing.",
  unavailable: "Growth setup needs a trusted local workspace, enabled Presence, and a started briefing session. Run Adaptive Pair: Start a Session first. To replace operational or incompatible proposed work, explicitly disable and start again. Choose one eligible file and an allowlisted check script.",
  stale: "Growth setup stopped because the current workspace or session changed. Inspect /brief and run /setup again; no stale confirmation is reused.",
  failed: "Growth setup did not complete. Inspect /brief before retrying. Run /setup to review a compatible pending proposal with fresh confirmations, or explicitly disable and start again to discard it. No verification or learning outcome is claimed.",
};

interface GrowthCheckpointResult {
  readonly result: vscode.ChatResult;
  readonly isCurrent: () => boolean;
}

export class GrowthCheckpointRoutes {
  public constructor(private readonly deps: GrowthParticipantDependencies) {}

  private enabled(response: vscode.ChatResponseStream, signal: AbortSignal): boolean {
    if (signal.aborted) { return false; }
    const status = this.deps.snapshotNow().presence.status;
    if (status === "off" || status === "paused") {
      response.markdown("Run Adaptive Pair: Enable Presence first. If the session is paused, use Adaptive Pair: Join Work in Progress to resume it.");
      return false;
    }
    return true;
  }

  public async setup(response: vscode.ChatResponseStream, signal: AbortSignal): Promise<void> {
    if (!this.enabled(response, signal)) { return; }
    if (this.deps.setup === undefined) {
      response.markdown("Native Growth setup is unavailable in this host.");
      return;
    }
    const result = await this.deps.setup(signal);
    if (signal.aborted) { return; }
    const outcome = result.outcome === "completed" && !result.isCurrent() ? "stale" : result.outcome;
    response.markdown(SETUP_MESSAGES[outcome]);
  }

  public history(context: vscode.ChatContext, response: vscode.ChatResponseStream, signal: AbortSignal): void {
    if (!this.enabled(response, signal)) { return; }
    const inspection = inspectNativeHistory(context.history ?? []);
    if (!signal.aborted) { response.markdown(renderNativeHistory(inspection)); }
  }

  private isCurrent(observed: PairRuntimeSnapshot, signal: AbortSignal): boolean {
    const current = this.deps.snapshotNow();
    return !signal.aborted && current.revision === observed.revision &&
      current.presence.status !== "off" && current.presence.status !== "paused" &&
      current.presence.workspaceId === observed.presence.workspaceId &&
      current.session?.sessionId === observed.session?.sessionId &&
      current.session?.startedAtRevision === observed.session?.startedAtRevision &&
      current.session?.authorityEpoch === observed.session?.authorityEpoch;
  }

  public async checkpoint(response: vscode.ChatResponseStream, signal: AbortSignal): Promise<GrowthCheckpointResult | void> {
    if (!this.enabled(response, signal)) { return; }
    const observed = this.deps.snapshotNow();
    const checkpoint = createNativeCheckpoint(observed);
    if (
      checkpoint === undefined || observed.session?.workUnit?.owner !== "human" ||
      (observed.session.status !== "ready" && observed.session.status !== "active")
    ) {
      response.markdown("No live Growth work unit can be checkpointed. Start a session and use /setup first.");
      return;
    }
    if (this.deps.confirmCheckpoint === undefined) {
      response.markdown("Checkpoint saving is unavailable in this host; nothing was saved.");
      return;
    }
    const accepted = await this.deps.confirmCheckpoint(signal);
    if (signal.aborted) { return; }
    if (!this.isCurrent(observed, signal)) {
      response.markdown("The workspace or session changed during confirmation. The checkpoint was not saved; inspect /session and try again.");
      return;
    }
    if (!accepted) {
      response.markdown("The checkpoint was not saved. Your current work was not changed.");
      return;
    }
    response.markdown("Requested a minimized checkpoint for this response. Use /history in this chat to inspect it. VS Code controls native retention; this is not a disk-durability acknowledgement or permission to resume work. Disabling Pair does not delete native chat history.");
    if (this.isCurrent(observed, signal)) {
      return {
        result: { metadata: { adaptivePairCheckpoint: checkpoint } },
        isCurrent: () => this.isCurrent(observed, signal),
      };
    }
  }
}
