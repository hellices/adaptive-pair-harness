import type { PairToolName } from "@adaptive-pair/harness";
import type { GrantUserActionOptions, PairCoordinatorPort, PairToolResult } from "@adaptive-pair/runtime";

export const invokeGrowthUserAction = async (
  coordinator: PairCoordinatorPort,
  name: PairToolName,
  input: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
  observed: GrantUserActionOptions,
): Promise<PairToolResult> => {
  const grantId = await coordinator.grantUserAction(name, signal, observed);
  return coordinator.invokeTool(name, input, signal, { userActionId: grantId });
};
