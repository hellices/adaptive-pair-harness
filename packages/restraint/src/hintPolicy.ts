export type HintLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface AssistanceState {
  readonly attempted: boolean;
  readonly bypassedAttempt: boolean;
  readonly hypothesisRecorded: boolean;
  readonly currentLevel: HintLevel;
  readonly maximumLevel: HintLevel;
  readonly revealAuthorized: boolean;
}

export interface HintDecision {
  readonly level: HintLevel;
  readonly requiresAttempt: boolean;
  readonly requiresReveal: boolean;
}

export const nextHintLevel = (
  state: AssistanceState,
  requested: HintLevel,
): HintDecision => {
  const level = Math.min(requested, state.maximumLevel) as HintLevel;

  if (!state.attempted && !state.bypassedAttempt && level > 1) {
    return {
      level: 1,
      requiresAttempt: true,
      requiresReveal: false,
    };
  }

  if (level === 5 && !state.revealAuthorized) {
    return {
      level: 4,
      requiresAttempt: false,
      requiresReveal: true,
    };
  }

  return {
    level,
    requiresAttempt: false,
    requiresReveal: false,
  };
};
