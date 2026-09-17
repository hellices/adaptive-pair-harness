export const WITHHELD_RESPONSE_MESSAGE = [
  "Adaptive Pair withheld this response because it exceeded the current Growth",
  "hint boundary. Your work was not changed. Ask for the same hint level again,",
  "request a smaller clue, or explicitly reveal the solution.",
].join("\n");

export const STALE_TURN_MESSAGE =
  "Adaptive Pair discarded this response because the session mode or authority changed while it was generating. Your work was not changed. Ask again for a fresh, in-boundary response.";

export const REPREPARE_TURN_MESSAGE =
  "The session contract was updated. Ask again to continue with fresh context and tools. No hint or Growth outcome was recorded for this transition.";

export const RESTRAINT_FAILURE_MESSAGE =
  "Adaptive Pair could not produce an in-boundary response, so nothing was shown. Your work was not changed. Try again or ask for a smaller clue.";

export const ATTEMPT_REQUIRED_MESSAGE =
  "Make an attempt first. Growth Mode needs a recorded attempt before it will raise the hint level to 2 or higher. Share what you tried, then ask for the hint again.";

export const REVEAL_REQUIRED_MESSAGE =
  "A full solution needs an explicit reveal. Use /reveal (or ask to see the answer) so Adaptive Pair can record your authorization before showing a level-5 solution.";

export const CONSENT_DECLINED_MESSAGE =
  "Adaptive Pair kept your workspace private. Grant workspace consent for this model to receive grounded, in-boundary hints about your task.";

export const NO_SESSION_MESSAGE =
  "No Adaptive Pair session is active. Run \"Adaptive Pair: Start a Session\" or \"Adaptive Pair: Join Work in Progress\" first; nothing is observed until you do.";

export const NO_WORK_UNIT_MESSAGE =
  "No Growth work unit is agreed yet. Confirm the learning agreement and agree a work unit before asking for this.";

export const TRANSFER_NOT_DISTINCT_MESSAGE = [
  "Adaptive Pair withheld this transfer task because it restated your current",
  "work unit instead of a distinct independent variation. Your work was not",
  "changed. Ask again for a different variation.",
].join("\n");

export const TRANSFER_NOT_DEMONSTRATED_NOTE = [
  "Starting a transfer task demonstrates nothing on its own. This variation is",
  "recorded as **started, not demonstrated**; it counts only after you complete",
  "it independently and the result is observed.",
].join("\n");

const MAX_FIELD_CHARS = 300;

const MAX_LIST_ITEMS = 5;

/** Bound a developer-authored core-state field before echoing it back. */
export const bounded = (
  value: string | undefined,
  limit: number = MAX_FIELD_CHARS,
): string | undefined => {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
};

export const boundedList = (values: readonly string[] | undefined): string => {
  const items = (values ?? [])
    .map(value => bounded(value))
    .filter((value): value is string => value !== undefined)
    .slice(0, MAX_LIST_ITEMS);
  return items.length === 0 ? "none" : items.join(", ");
};
