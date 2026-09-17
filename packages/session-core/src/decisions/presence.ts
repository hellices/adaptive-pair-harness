import { enabledPresenceStatus, requiresWorkspaceReset } from "../presence.js";
import { pauseSession } from "./session.js";
import { freezeDecision, isPausableStatus, type DecisionHandler } from "./support.js";

export const enablePresence: DecisionHandler<"EnablePresence"> = (snapshot, command, event) => {
  if (command.actor !== "human") {
    throw new Error("HUMAN_ACTION_REQUIRED");
  }
  if (requiresWorkspaceReset(snapshot, command.workspaceId)) {
    return freezeDecision([
      event(0, "PresenceChanged", { status: "off" }),
      event(1, "PresenceEnabled", { workspaceId: command.workspaceId }),
    ]);
  }
  if (
    snapshot.presence.workspaceId === command.workspaceId &&
    snapshot.presence.status === enabledPresenceStatus(snapshot)
  ) {
    return freezeDecision([]);
  }
  return freezeDecision([event(0, "PresenceEnabled", { workspaceId: command.workspaceId })]);
};

export const setPresence: DecisionHandler<"SetPresence"> = (snapshot, command, event) => {
  if (command.actor !== "human") {
    throw new Error("HUMAN_ACTION_REQUIRED");
  }
  if (command.status !== "off" && snapshot.session?.status === "paused") {
    return freezeDecision([]);
  }
  if (command.status === "paused") {
    if (snapshot.session !== undefined && isPausableStatus(snapshot.session.status)) {
      return pauseSession(snapshot, {
        ...command,
        type: "PauseSession",
        reason: "The developer paused Pair Presence.",
      }, event);
    }
    if (snapshot.presence.status === "off") {
      return freezeDecision([]);
    }
  }
  const status = command.status === "observing" ? enabledPresenceStatus(snapshot) : command.status;
  if (
    status === snapshot.presence.status &&
    (status !== "off" || (snapshot.session === undefined && snapshot.presence.observationRevision === 0))
  ) {
    return freezeDecision([]);
  }
  return freezeDecision([event(0, "PresenceChanged", { status })]);
};

export const observeWorkspace: DecisionHandler<"ObserveWorkspace"> = (snapshot, command, event) => {
  if (command.actor !== "host") {
    throw new Error("HOST_ACTION_REQUIRED");
  }
  return freezeDecision(
    snapshot.presence.status === "off" || snapshot.presence.status === "paused"
      ? []
      : [event(0, "WorkspaceObserved", {})],
  );
};
