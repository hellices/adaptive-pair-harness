// Runnable module verified by the fixture's `test` script. It ships with a bug
// (the retry loop ignores `max` and stops after one attempt) so the first
// verification run genuinely fails; the host smoke test then applies the
// developer's fix on their behalf and re-runs to a real pass.
export function retryUntil(action, max) {
  let attempts = 0;
  while (attempts < 1) {
    attempts += 1;
    if (action(attempts)) {
      return attempts;
    }
  }
  return -1;
}
