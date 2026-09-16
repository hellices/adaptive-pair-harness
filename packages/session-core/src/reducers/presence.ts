import { createPresence } from "../initialState.js";
import { enabledPresenceStatus } from "../presence.js";
import { isPausableStatus, type EventReducer } from "./support.js";

export const presenceEnabled: EventReducer<"PresenceEnabled"> = (snapshot, event) => {
  if (event.actor !== "human") {
    throw new Error("HUMAN_ACTION_REQUIRED");
  }
  return {
    ...snapshot,
    revision: event.revision,
    presence: {
      ...snapshot.presence,
      workspaceId: event.workspaceId,
      status: enabledPresenceStatus(snapshot),
    },
  };
};

export const presenceChanged: EventReducer<"PresenceChanged"> = (snapshot, event) => {
  if (event.actor !== "human") {
    throw new Error("HUMAN_ACTION_REQUIRED");
  }
  if (event.status === "off") {
    return {
      protocolVersion: 1,
      revision: event.revision,
      presence: createPresence(snapshot.presence.workspaceId),
      session: undefined,
    };
  }
  if (snapshot.session?.status === "paused" && event.status !== "paused") {
    throw new Error("SESSION_NOT_RESUMED");
  }
  if (event.status === "paused" && snapshot.session !== undefined && isPausableStatus(snapshot.session.status)) {
    throw new Error("SESSION_PAUSE_REQUIRED");
  }
  return {
    ...snapshot,
    revision: event.revision,
    presence: { ...snapshot.presence, status: event.status },
  };
};

export const workspaceObserved: EventReducer<"WorkspaceObserved"> = (snapshot, event) => {
  if (event.actor !== "host") {
    throw new Error("HOST_ACTION_REQUIRED");
  }
  if (snapshot.presence.status === "off" || snapshot.presence.status === "paused") {
    throw new Error("PRESENCE_NOT_OBSERVING");
  }
  return {
    ...snapshot,
    revision: event.revision,
    presence: {
      ...snapshot.presence,
      observationRevision: snapshot.presence.observationRevision + 1,
    },
  };
};
