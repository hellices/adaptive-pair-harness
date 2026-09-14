import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import {
  PAIR_TOOL_CATALOG_VERSION,
  type PairToolDescriptor,
  type PairToolView,
} from "./types.js";

const freezeDescriptor = (
  descriptor: PairToolDescriptor,
): PairToolDescriptor =>
  Object.freeze({
    ...descriptor,
    modes: Object.freeze([...descriptor.modes]),
  });

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
  const mode = snapshot.session?.mode;

  if (mode === undefined) {
    return Object.freeze(
      PAIR_TOOL_CATALOG.filter(
        descriptor =>
          descriptor.name === "pair_get_state" ||
          descriptor.name === "pair_capture_entry",
      ),
    );
  }

  const owner = snapshot.session?.workUnit?.owner;

  return Object.freeze(
    PAIR_TOOL_CATALOG.filter(descriptor => {
      if (!descriptor.modes.includes(mode)) {
        return false;
      }

      if (mode === "growth") {
        return (
          descriptor.name !== "pair_apply_edit" &&
          descriptor.name !== "pair_run_command"
        );
      }

      if (descriptor.name === "pair_apply_edit") {
        return owner === "ai";
      }

      if (descriptor.name === "pair_run_command") {
        return mode === "delivery" && owner === "ai";
      }

      return true;
    }),
  );
};

export const toolsFor = (snapshot: PairRuntimeSnapshot): PairToolView =>
  Object.freeze({
    catalogVersion: PAIR_TOOL_CATALOG_VERSION,
    runtimeRevision: snapshot.revision,
    authorityEpoch: snapshot.session?.authorityEpoch,
    tools: baseVisibleTools(snapshot),
  });
