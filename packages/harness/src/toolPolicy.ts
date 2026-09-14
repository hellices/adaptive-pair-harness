import { nativeToolName } from "./nativeMappings.js";
import {
  PAIR_TOOL_CATALOG_VERSION,
  type PairToolView,
  type ToolPolicyDecision,
  type VisibleToolInvocation,
} from "./types.js";

const requiresMatchingUserAction = (
  invocation: VisibleToolInvocation,
): boolean => {
  const userAction = invocation.userAction;

  return (
    userAction === undefined ||
    userAction.consumed ||
    userAction.nativeToolName !== nativeToolName(invocation.name) ||
    userAction.runtimeRevision !== invocation.runtimeRevision ||
    userAction.authorityEpoch !== invocation.authorityEpoch
  );
};

export const authorizeVisibleTool = (
  view: PairToolView,
  invocation: VisibleToolInvocation,
): ToolPolicyDecision => {
  if (
    view.catalogVersion !== PAIR_TOOL_CATALOG_VERSION ||
    invocation.catalogVersion !== PAIR_TOOL_CATALOG_VERSION
  ) {
    return {
      allowed: false,
      reason: "UNSUPPORTED_TOOL_CATALOG_VERSION",
    };
  }

  if (
    invocation.runtimeRevision !== view.runtimeRevision ||
    invocation.authorityEpoch !== view.authorityEpoch
  ) {
    return { allowed: false, reason: "STALE_TOOL_VIEW" };
  }

  const descriptor = view.tools.find(tool => tool.name === invocation.name);
  if (descriptor === undefined) {
    return { allowed: false, reason: "TOOL_HIDDEN" };
  }

  if (
    descriptor.requiredEditOwner !== "either" &&
    descriptor.requiredEditOwner !== invocation.owner
  ) {
    return { allowed: false, reason: "WRONG_OWNER" };
  }

  if (
    descriptor.requiresExplicitUserAction &&
    requiresMatchingUserAction(invocation)
  ) {
    return { allowed: false, reason: "USER_ACTION_REQUIRED" };
  }

  return { allowed: true, descriptor };
};
