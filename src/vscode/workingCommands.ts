export interface PairWorkingActions {
  promptForWorkingGoal(): Promise<string>;
  refreshProjectContext(): Promise<string>;
  toggleProjectContextSharing(): Promise<string>;
  draftWorkingAgreement(): Promise<string>;
}

export interface WorkingCommandHandler {
  readonly id: string;
  run(): Promise<void>;
}

export const createWorkingCommandHandlers = (
  currentRuntime: () => PairWorkingActions | undefined,
  notify: (message: string) => unknown,
): readonly WorkingCommandHandler[] => {
  const commands: ReadonlyArray<readonly [string, keyof PairWorkingActions]> = [
    ["adaptivePair.setWorkingGoal", "promptForWorkingGoal"],
    ["adaptivePair.refreshProjectContext", "refreshProjectContext"],
    ["adaptivePair.toggleProjectContextSharing", "toggleProjectContextSharing"],
    ["adaptivePair.draftWorkingAgreement", "draftWorkingAgreement"],
  ];
  return commands.map(([id, action]) => ({
    id,
    run: async () => {
      const runtime = currentRuntime();
      if (runtime === undefined) {
        await notify("Adaptive Pair runtime is rebuilding. Try again in a moment.");
        return;
      }
      try {
        const message = await runtime[action]();
        if (message.length > 0) {
          await notify(message);
        }
      } catch (error: unknown) {
        if (!(error instanceof Error)) {
          throw error;
        }
        await notify(`Adaptive Pair: ${error.message}`);
      }
    },
  }));
};
