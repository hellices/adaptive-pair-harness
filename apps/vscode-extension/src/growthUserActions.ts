import type { PairToolName } from "@adaptive-pair/harness";
import type { PairCoordinatorPort } from "@adaptive-pair/runtime";

export const invokeGrowthUserAction = async (
  coordinator: PairCoordinatorPort,
  name: PairToolName,
  input: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
): Promise<void> => {
  const grantId = await coordinator.grantUserAction(name, signal);
  await coordinator.invokeTool(name, input, signal, { userActionId: grantId });
};
