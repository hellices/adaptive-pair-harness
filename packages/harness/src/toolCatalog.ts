import type { PairRuntimeSnapshot, SessionStatus } from "@adaptive-pair/protocol";
import {
  PAIR_TOOL_CATALOG_VERSION,
  type PairToolDescriptor,
  type PairToolName,
  type PairToolView,
} from "./types.js";

const freezeDescriptor = (
  descriptor: PairToolDescriptor,
): PairToolDescriptor =>
  Object.freeze({
    ...descriptor,
    modes: Object.freeze([...descriptor.modes]),
  });

const isOperationalStatus = (
  status: SessionStatus,
): boolean => status === "ready" || status === "active";

const hasStartedSession = (snapshot: PairRuntimeSnapshot): boolean =>
  snapshot.session !== undefined && snapshot.session.status !== "inactive";

const hasAgreedOperationalWorkUnit = (
  snapshot: PairRuntimeSnapshot,
): boolean => {
  const session = snapshot.session;
  const workUnit = session?.workUnit;

  return (
    session !== undefined &&
    isOperationalStatus(session.status) &&
    session.mode !== undefined &&
    workUnit !== undefined &&
    workUnit.status === "agreed" &&
    workUnit.mode === session.mode
  );
};

const hasOperationalGrowthWorkUnit = (
  snapshot: PairRuntimeSnapshot,
): boolean => {
  const session = snapshot.session;
  const workUnit = session?.workUnit;

  return (
    hasAgreedOperationalWorkUnit(snapshot) &&
    session?.mode === "growth" &&
    session.learningAgreement !== undefined &&
    workUnit?.mode === "growth" &&
    workUnit.owner === "human"
  );
};

const hasOperationalAiOwnedUnit = (
  snapshot: PairRuntimeSnapshot,
): boolean => {
  const session = snapshot.session;
  const workUnit = session?.workUnit;

  return (
    hasAgreedOperationalWorkUnit(snapshot) &&
    workUnit?.owner === "ai" &&
    (session?.mode === "pair" || session?.mode === "delivery")
  );
};

const canProposeWorkUnit = (snapshot: PairRuntimeSnapshot): boolean => {
  const session = snapshot.session;

  return (
    session !== undefined &&
    session.status === "briefing" &&
    session.entrySnapshot !== undefined &&
    session.mode !== undefined &&
    (session.mode !== "growth" || session.learningAgreement !== undefined)
  );
};

const canConfirmLearning = (snapshot: PairRuntimeSnapshot): boolean => {
  const session = snapshot.session;

  return (
    session !== undefined &&
    session.status === "briefing" &&
    session.entrySnapshot !== undefined &&
    (session.mode === undefined || session.mode === "growth")
  );
};

const canSelectMode = (snapshot: PairRuntimeSnapshot): boolean => {
  const session = snapshot.session;

  return (
    session !== undefined &&
    session.status === "briefing" &&
    session.workUnit === undefined
  );
};

const canAgreeWorkUnit = (snapshot: PairRuntimeSnapshot): boolean => {
  const session = snapshot.session;
  const workUnit = session?.workUnit;

  return (
    canProposeWorkUnit(snapshot) &&
    workUnit !== undefined &&
    workUnit.status === "proposed" &&
    session?.mode === workUnit.mode
  );
};

const isVisibleToolName = (
  name: PairToolName,
  snapshot: PairRuntimeSnapshot,
): boolean => {
  switch (name) {
    case "pair_get_state":
      return true;

    case "pair_capture_entry":
      return snapshot.session?.status === "briefing";

    case "pair_confirm_learning":
      return canConfirmLearning(snapshot);

    case "pair_select_mode":
      return canSelectMode(snapshot);

    case "pair_read_scope":
    case "pair_search_scope":
    case "pair_run_verification":
      return hasAgreedOperationalWorkUnit(snapshot);

    case "pair_record_attempt":
    case "pair_record_hypothesis":
    case "pair_request_hint":
    case "pair_reveal_solution":
      return hasOperationalGrowthWorkUnit(snapshot);

    case "pair_propose_work_unit":
      return canProposeWorkUnit(snapshot);

    case "pair_agree_work_unit":
      return canAgreeWorkUnit(snapshot);

    case "pair_apply_edit":
      return hasOperationalAiOwnedUnit(snapshot);

    case "pair_run_command":
      return (
        hasOperationalAiOwnedUnit(snapshot) &&
        snapshot.session?.mode === "delivery"
      );

    case "pair_close_session":
      return hasStartedSession(snapshot) && snapshot.session?.status !== "closed";

    case "pair_accept_handoff":
    case "pair_record_transfer":
      return false;
  }
};

export const PAIR_TOOL_CATALOG: readonly PairToolDescriptor[] = Object.freeze([
  freezeDescriptor({
    name: "pair_get_state",
    effectClass: "read",
    modes: ["growth", "pair", "delivery"],
    requiredEditOwner: "either",
    requiresExplicitUserAction: false,
    requiresConsent: false,
    retry: "bounded-read",
    maximumResultCharacters: 8_000,
  }),
  freezeDescriptor({
    name: "pair_capture_entry",
    effectClass: "read",
    modes: ["growth", "pair", "delivery"],
    requiredEditOwner: "either",
    requiresExplicitUserAction: true,
    requiresConsent: false,
    retry: "bounded-read",
    maximumResultCharacters: 8_000,
  }),
  freezeDescriptor({
    name: "pair_confirm_learning",
    effectClass: "state",
    modes: ["growth"],
    requiredEditOwner: "either",
    requiresExplicitUserAction: true,
    requiresConsent: false,
    retry: "same-key",
    maximumResultCharacters: 4_000,
  }),
  freezeDescriptor({
    name: "pair_select_mode",
    effectClass: "state",
    modes: ["growth", "pair", "delivery"],
    requiredEditOwner: "either",
    requiresExplicitUserAction: true,
    requiresConsent: false,
    retry: "same-key",
    maximumResultCharacters: 2_000,
  }),
  freezeDescriptor({
    name: "pair_read_scope",
    effectClass: "read",
    modes: ["growth", "pair", "delivery"],
    requiredEditOwner: "either",
    requiresExplicitUserAction: false,
    requiresConsent: true,
    retry: "bounded-read",
    maximumResultCharacters: 12_000,
  }),
  freezeDescriptor({
    name: "pair_search_scope",
    effectClass: "read",
    modes: ["growth", "pair", "delivery"],
    requiredEditOwner: "either",
    requiresExplicitUserAction: false,
    requiresConsent: true,
    retry: "bounded-read",
    maximumResultCharacters: 12_000,
  }),
  freezeDescriptor({
    name: "pair_record_attempt",
    effectClass: "state",
    modes: ["growth", "pair"],
    requiredEditOwner: "human",
    requiresExplicitUserAction: true,
    requiresConsent: false,
    retry: "same-key",
    maximumResultCharacters: 2_000,
  }),
  freezeDescriptor({
    name: "pair_record_hypothesis",
    effectClass: "state",
    modes: ["growth", "pair"],
    requiredEditOwner: "human",
    requiresExplicitUserAction: true,
    requiresConsent: false,
    retry: "same-key",
    maximumResultCharacters: 2_000,
  }),
  freezeDescriptor({
    name: "pair_request_hint",
    effectClass: "response",
    modes: ["growth", "pair"],
    requiredEditOwner: "either",
    requiresExplicitUserAction: true,
    requiresConsent: true,
    retry: "never",
    maximumResultCharacters: 8_000,
  }),
  freezeDescriptor({
    name: "pair_reveal_solution",
    effectClass: "response",
    modes: ["growth", "pair"],
    requiredEditOwner: "human",
    requiresExplicitUserAction: true,
    requiresConsent: true,
    retry: "never",
    maximumResultCharacters: 16_000,
  }),
  freezeDescriptor({
    name: "pair_propose_work_unit",
    effectClass: "state",
    modes: ["growth", "pair", "delivery"],
    requiredEditOwner: "either",
    requiresExplicitUserAction: false,
    requiresConsent: false,
    retry: "same-key",
    maximumResultCharacters: 4_000,
  }),
  freezeDescriptor({
    name: "pair_agree_work_unit",
    effectClass: "state",
    modes: ["growth", "pair", "delivery"],
    requiredEditOwner: "either",
    requiresExplicitUserAction: true,
    requiresConsent: false,
    retry: "same-key",
    maximumResultCharacters: 2_000,
  }),
  freezeDescriptor({
    name: "pair_accept_handoff",
    effectClass: "state",
    modes: ["pair", "delivery"],
    requiredEditOwner: "either",
    requiresExplicitUserAction: true,
    requiresConsent: false,
    retry: "same-key",
    maximumResultCharacters: 2_000,
  }),
  freezeDescriptor({
    name: "pair_apply_edit",
    effectClass: "mutation",
    modes: ["pair", "delivery"],
    requiredEditOwner: "ai",
    requiresExplicitUserAction: false,
    requiresConsent: true,
    retry: "never",
    maximumResultCharacters: 8_000,
  }),
  freezeDescriptor({
    name: "pair_run_verification",
    effectClass: "verification",
    modes: ["growth", "pair", "delivery"],
    requiredEditOwner: "either",
    requiresExplicitUserAction: true,
    requiresConsent: true,
    retry: "never",
    maximumResultCharacters: 16_000,
  }),
  freezeDescriptor({
    name: "pair_run_command",
    effectClass: "external",
    modes: ["delivery"],
    requiredEditOwner: "ai",
    requiresExplicitUserAction: true,
    requiresConsent: true,
    retry: "never",
    maximumResultCharacters: 16_000,
  }),
  freezeDescriptor({
    name: "pair_record_transfer",
    effectClass: "state",
    modes: ["growth", "pair"],
    requiredEditOwner: "human",
    requiresExplicitUserAction: true,
    requiresConsent: false,
    retry: "same-key",
    maximumResultCharacters: 4_000,
  }),
  freezeDescriptor({
    name: "pair_close_session",
    effectClass: "state",
    modes: ["growth", "pair", "delivery"],
    requiredEditOwner: "either",
    requiresExplicitUserAction: true,
    requiresConsent: false,
    retry: "same-key",
    maximumResultCharacters: 4_000,
  }),
]);

const baseVisibleTools = (
  snapshot: PairRuntimeSnapshot,
): readonly PairToolDescriptor[] => {
  return Object.freeze(
    PAIR_TOOL_CATALOG.filter(descriptor =>
      isVisibleToolName(descriptor.name, snapshot),
    ),
  );
};

export const toolsFor = (snapshot: PairRuntimeSnapshot): PairToolView =>
  Object.freeze({
    catalogVersion: PAIR_TOOL_CATALOG_VERSION,
    runtimeRevision: snapshot.revision,
    authorityEpoch: snapshot.session?.authorityEpoch,
    tools: baseVisibleTools(snapshot),
  });
