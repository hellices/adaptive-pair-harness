import type { PairRuntimeSnapshot, PresenceStatus } from "@adaptive-pair/protocol";

export const enabledPresenceStatus = (snapshot: PairRuntimeSnapshot): PresenceStatus => {
  if (snapshot.session?.status === "paused") {
    return "paused";
  }

  const status = snapshot.presence.status;
  if (status === "observing" || status === "quiet" || status === "engaged") {
    return status;
  }

  const session = snapshot.session;
  return session !== undefined && session.status !== "inactive" && session.status !== "closed"
    ? "engaged"
    : "observing";
};
