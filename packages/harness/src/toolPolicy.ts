import { nativeToolName } from "./nativeMappings.js";
import {
  type IssuePairUserActionGrantInput,
  PAIR_TOOL_CATALOG_VERSION,
  type PairUserActionGrant,
  type PairToolView,
  type ToolPolicyDecision,
  type VisibleToolInvocation,
} from "./types.js";

type PairUserActionGrantMetadata = {
  readonly nativeToolName: ReturnType<typeof nativeToolName>;
  readonly runtimeRevision: number;
  readonly authorityEpoch: number | undefined;
};

const grantMetadata = new WeakMap<PairUserActionGrant, PairUserActionGrantMetadata>();

export const issuePairUserActionGrant = (
  input: IssuePairUserActionGrantInput,
): PairUserActionGrant => {
  const grant = Object.freeze({}) as PairUserActionGrant;

  grantMetadata.set(grant, {
    nativeToolName: nativeToolName(input.name),
    runtimeRevision: input.runtimeRevision,
    authorityEpoch: input.authorityEpoch,
  });

  return grant;
};

const matchingUserActionGrant = (
  invocation: VisibleToolInvocation,
): PairUserActionGrant | undefined => {
  const userAction = invocation.userAction;

  if (typeof userAction !== "object" || userAction === null) {
    return undefined;
  }

  const metadata = grantMetadata.get(userAction);

  return (
    metadata !== undefined &&
    metadata.nativeToolName === nativeToolName(invocation.name) &&
    metadata.runtimeRevision === invocation.runtimeRevision &&
    metadata.authorityEpoch === invocation.authorityEpoch
  )
    ? userAction
    : undefined;
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

  const matchingGrant = descriptor.requiresExplicitUserAction
    ? matchingUserActionGrant(invocation)
    : undefined;

  if (descriptor.requiresExplicitUserAction && matchingGrant === undefined) {
    return { allowed: false, reason: "USER_ACTION_REQUIRED" };
  }

  if (matchingGrant !== undefined) {
    grantMetadata.delete(matchingGrant);
  }

  return { allowed: true, descriptor };
};
